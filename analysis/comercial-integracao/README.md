# Mapeamento do OliMen Gestão para o futuro módulo Comercial

## Objetivo e limites

Este diretório registra o **OliMen Gestão como sistema-destino** para uma futura integração de Produtos, Catálogo Técnico, Orçamentos, PDF e impressão. É um levantamento estático do repositório na branch `feature/module-reorganization`, em 11/08/2026.

Não foi aberto nem consultado o ERP Universal. Não houve conexão com o banco, execução de SQL, execução de migrations, cópia de arquivos, instalação de dependências ou implementação funcional. O estado de banco documentado é o estado **esperado pelos arquivos versionados**, obtido pela leitura combinada de `database/schema.sql` e `database/migrations/*.sql`; o próprio projeto alerta que o schema consolidado e as migrations divergem.

## Resumo executivo

- Produtos já são o cadastro mestre compartilhado em `products` e aparecem visualmente em **Estoque > Produtos**. Comercial deve somente referenciá-los.
- O cadastro aceita produto preliminar ativo e incompleto por meio de `review_status = pending_review`, hoje criado por Compras. O formulário regular, porém, exige tipo, setor, unidade, volumes e peso.
- Os tipos reais iniciais são `manufactured`, `resale` e `material_prima`, mas `product_types` permite tipos adicionais. `products.type` não possui FK para `product_types.code`; a consistência é garantida no serviço de gravação.
- `internal_code` é o único código de negócio do Produto e tem unicidade case-insensitive quando não nulo. Não há SKU separado, código de barras, NCM, descrição comercial, preço mestre ou identificador de origem externa.
- Clientes existem em `customers`, mas o cadastro é mínimo e é mantido indiretamente durante a criação/edição de Ordens de Produção. Não existe CRUD/página própria de Clientes, documento fiscal, e-mail, endereço estruturado nem ativo/inativo.
- `internal_orders` já demonstra o padrão correto de histórico: preserva `customer_id`, `customer_name` e `customer_phone`; `sold_items` preserva `product_name_snapshot`. Orçamentos devem ampliar esse padrão com snapshot completo e imutável.
- `company_settings` é uma tabela singleton reutilizável e já entrega dados e logo a PDFs. Não deve ser duplicada.
- Há uploads protegidos de logo, foto cadastral de Produto e documentos de Funcionário, todos em filesystem local e enviados como corpo binário bruto. Não há Multer nem storage em nuvem.
- O RBAC usa Perfis e Permissões dinâmicos (`roles`, `permissions`, `role_permissions`) e checagem tanto nas rotas Express quanto nas rotas/ações React.
- O backend já possui uma infraestrutura comum de PDFKit em `backend/src/services/pdf/`; ela deve ser estendida, não substituída por uma árvore paralela.
- Não existem tabelas de estoque, saldo, reservas ou movimentações. Recebimentos e Expedição não movimentam estoque.
- Não existe Catálogo Técnico, versionamento técnico, imagens de versão, especificações, itens inclusos ou Orçamentos comerciais.

## Decisões importantes

### 1. Onde Produtos devem ficar?

Em **Estoque > Produtos**, sobre a tabela mestre `products`. A localização visual já comunica corretamente que o Produto não pertence exclusivamente a um módulo consumidor.

### 2. Como Comercial deve consumir Produtos?

Por FK para `products.id`, usando endpoints de busca autenticados e preservando snapshots comerciais do item no Orçamento. Comercial não deve possuir uma cópia de Produto.

### 3. Onde Catálogo Técnico deve ficar?

No domínio do Produto, com acesso pela edição/detalhe de Produto — idealmente uma aba **Catálogo Técnico** — e tabelas próprias relacionadas a `products.id`. As versões devem ser imutáveis depois de publicadas.

### 4. Como Clientes serão reutilizados?

Por FK para `customers.id` e busca/autocomplete dedicado ao Comercial. Antes disso, o cadastro oficial precisa ser enriquecido ou ter um CRUD próprio; não deve ser criada uma tabela paralela de clientes comerciais.

### 5. Como Configurações da Empresa serão reutilizadas?

Por `company_settings` e `getCompanyPdfData()`. Os dados devem ser copiados para snapshot do documento quando a imutabilidade histórica for necessária.

### 6. Como uploads serão reutilizados?

Reutilizando o padrão atual: endpoint autenticado, corpo binário bruto, allowlist de MIME/extensão/assinatura, limite, nome gerado, metadados no banco e arquivo fora da árvore pública. Para Catálogo Técnico será necessária uma coleção de imagens, e não o modelo 1:1 de `product_images`.

### 7. Como permissões serão adicionadas?

Novos códigos em `permissions`, grants explícitos em `role_permissions`, middlewares `authenticate` + `requirePermission` no backend, `RoleRoute`/`canAccessPermission` no frontend e apresentação em `modulePresentation.js`. Terminologia: **Perfis e Permissões**.

### 8. Como o PDF deve se encaixar?

Como novos builders em `backend/src/services/pdf/`, reutilizando `pdfDocument.js`, `getCompanyPdfData()` e `sendPdfResponse()`. Separar subpastas `orcamento/` e `catalogo/` apenas quando a quantidade de templates/helpers justificar; não criar `backend/src/pdf/` concorrente.

### 9. Quais tabelas novas serão provavelmente necessárias?

No mínimo: cabeçalho de orçamento comercial, itens de orçamento, histórico/transições do orçamento, catálogo técnico, versões do catálogo, imagens das versões, especificações e itens inclusos. É recomendada também uma tabela de identificadores externos/equivalência de Produto. Persistência de PDFs gerados e assinatura da empresa são decisões separadas, não pressupostos.

### 10. Quais tabelas NÃO devem ser duplicadas?

`products`, `product_types`, `measurement_units`, `customers`, `company_settings`, `users`, `roles`, `permissions`, `role_permissions`, `audit_logs` e a infraestrutura existente de metadados/arquivos.

### 11. Como tratar produtos legados?

Manter `products.is_active = true`, permitir ausência de catálogo/fotos/dados comerciais e expor uma noção de completude derivada. `review_status` já cobre revisão cadastral geral; não deve ser sobrecarregado para significar publicação de Catálogo Técnico.

### 12. Como tratar produtos importados?

Importar somente após revisão humana, sem sobrescrever correspondências automaticamente. Registrar sistema de origem + chave externa em uma tabela de equivalência; marcar o registro como pendente de revisão quando faltarem dados obrigatórios locais.

### 13. Como evitar conflito de códigos?

Não tratar o número externo como `internal_code` automaticamente. Primeiro procurar equivalência explícita; depois comparar código/nome/unidade com candidatos; por fim criar um novo código interno segundo uma política própria. Guardar “ERP Universal / 117” como identificador externo exclusivo por origem.

### 14. Quais campos atuais impedem cadastro parcial?

No banco: `name`, `type`, `default_volume_quantity` e `default_total_weight_kg` são `NOT NULL`, e volumes/peso devem ser positivos. No fluxo regular: setor e unidade também são exigidos pelo backend, embora `sector_id` e `measurement_unit_code` aceitem nulo no banco. O fluxo preliminar contorna unidade e usa defaults artificiais (`resale`, Expedição, 1 volume, 1 kg).

### 15. Quais são os maiores riscos?

Colisão de `internal_code`; falsa equivalência por nome; falta de identificador de origem; clientes insuficientes para documentos comerciais; snapshots incompletos; defaults preliminares confundidos com dados reais; vínculo lógico não garantido por FK entre tipo e Produto; storage local em implantação com múltiplas instâncias; versionamento técnico mutável; autorizações só no frontend; e mistura indevida entre Comercial, Compras e Produção.

## Documentos

1. [01-arquitetura.md](01-arquitetura.md)
2. [02-produtos.md](02-produtos.md)
3. [03-clientes.md](03-clientes.md)
4. [04-configuracoes-empresa.md](04-configuracoes-empresa.md)
5. [05-uploads-midia.md](05-uploads-midia.md)
6. [06-auth-permissoes.md](06-auth-permissoes.md)
7. [07-menu-ui.md](07-menu-ui.md)
8. [08-api-backend.md](08-api-backend.md)
9. [09-banco-migrations.md](09-banco-migrations.md)
10. [10-pdf-documentos.md](10-pdf-documentos.md)
11. [11-matriz-compatibilidade.md](11-matriz-compatibilidade.md)
12. [12-produtos-legados.md](12-produtos-legados.md)
13. [13-riscos.md](13-riscos.md)
14. [14-plano-integracao.md](14-plano-integracao.md)

## Fontes primárias analisadas

`README.md`, `ARCHITECTURE.md`, `package.json`, `database/schema.sql`, todas as migrations em `database/migrations/`, `scripts/migrate.js`, `backend/src/**`, `src/**` e testes relacionados a Produtos, autorização e apresentação de módulos. Nenhum arquivo em `uploads/` foi necessário para o levantamento.
