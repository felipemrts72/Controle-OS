# Contrato técnico — ERP Universal → OliMen Gestão

## Finalidade e limites

Este conjunto consolida os dois mapeamentos existentes e define o contrato **futuro** de integração do Comercial. A fonte é o ERP Universal; o destino e sistema mestre final é o OliMen Gestão.

Foram lidos integralmente:

- ERP Universal: `analysis/migracao-olimen/comercial/`;
- OliMen Gestão: `analysis/comercial-integracao/`.

Também foram consultados, de forma somente leitura, os schemas e os pontos de código necessários para confirmar Clientes, Produtos e Configurações da Empresa. Esta entrega não implementa o contrato: não altera código ou banco, não cria/executa migration, não importa dados, não copia upload e não instala dependência.

## Decisão atualizada sobre Clientes

O cadastro atual `customers` do OliMen **não é suficiente nem deve continuar sendo identificado apenas pelo nome normalizado**. Clientes do ERP Universal passam a fazer parte da migração. A decisão é:

1. manter `customers` como cadastro mestre final;
2. enriquecê-la com os dados civis, contato, endereço e atividade que faltam;
3. remover a unicidade de `normalized_name` e manter esse valor apenas como índice de pesquisa;
4. registrar a identidade do ERP em `customer_external_ids`;
5. conciliar homônimos por documento e outros sinais, sempre com revisão humana nos casos ambíguos;
6. congelar os dados comerciais do Cliente em cada revisão emitida do Orçamento.

Não criar `customers_comercial`, `clientes_orcamento` ou outro cadastro mestre paralelo.

## Matriz de decisões

| Área | Decisão consolidada |
|---|---|
| Produtos | Reutilizar `products` como único cadastro mestre |
| Identidade de Produto | Criar `product_external_ids`; ID/SKU do ERP não são automaticamente o código OliMen |
| Clientes | Migrar ERP Universal para `customers`, após evolução do modelo |
| Identidade de Cliente | Criar `customer_external_ids`; documento válido é o melhor sinal de equivalência |
| Empresa | Reutilizar `company_settings` como fonte oficial; não sobrescrever cegamente com a origem |
| Catálogo | Criar estruturas próprias, relacionadas a `products`, com versões imutáveis |
| Orçamentos | Criar namespace e tabelas `commercial_*`; não reutilizar Cotações de Compras |
| Itens | Manter FK para Produto e snapshots comerciais do item |
| Histórico | Congelar Cliente, Empresa, item, preço, condições e versão técnica na emissão |
| PDF | Estender a infraestrutura PDFKit do OliMen e transportar regras/layout, não um segundo motor |
| Uploads | Migrar para storage protegido do OliMen; nunca persistir caminho absoluto/URL antiga |
| Estoque | Sem reserva, saldo ou movimento na primeira versão |
| Produção | Sem ordem, tarefa, BOM ou efeito operacional na primeira versão |
| Compras/Expedição | Sem criação automática ou acoplamento inicial |
| Aprovação | Estado comercial apenas; não transportar os efeitos operacionais do ERP |
| Orçamentos históricos | Migração opcional e condicionada à necessidade legal/operacional e às limitações dos dados-fonte |

## Invariantes do contrato

- Um Produto comercial continua sendo o mesmo `products.id` usado pelos demais módulos.
- Um Cliente comercial continua sendo o mesmo `customers.id` usado pelos demais módulos.
- Nenhum registro local é sobrescrito por similaridade, nome ou colisão de código.
- IDs inteiros do ERP nunca são presumidos iguais aos UUIDs do OliMen.
- `(source_system, source_id)` é a identidade reexecutável da origem.
- Nome é sinal de pesquisa, não chave de Produto ou Cliente.
- Produto/Cliente ambíguo vai para relatório de conflito e decisão humana.
- Produto sem catálogo, foto, preço ou descrição comercial permanece válido.
- Orçamento emitido não muda quando Produto, Cliente, Empresa, layout ou Catálogo mudarem.
- Versão técnica publicada ou usada em Orçamento é imutável.
- Orçamento Comercial não movimenta Estoque, Produção, Compras ou Expedição na primeira versão.

## Lacunas confirmadas em `customers`

Campos gerais a acrescentar: nome fantasia, CPF/CNPJ, e-mail, logradouro/endereço, número, complemento, bairro, cidade, UF, CEP, observações e ativo/inativo. `person_type` pode ser opcional se houver validação confiável; não deve ser inferido à força quando o documento for ausente/inválido.

Além dos campos, há duas mudanças estruturais indispensáveis:

- `normalized_name` deve deixar de ser `UNIQUE`, pois homônimos são legítimos;
- o upsert atual por `normalized_name` precisa futuramente ser substituído por identidade explícita/deduplicação controlada.

`location`, `carrier_name` e `destination_uf` continuam úteis ao fluxo de entrega, mas não substituem endereço civil estruturado. Em especial, `destination_uf` não deve ser reaproveitado como UF cadastral.

## Lacunas confirmadas em `products`

- `description` geral opcional;
- preço comercial de referência opcional em extensão 1:1;
- identidade externa persistente;
- política explícita para código local versus SKU/código externo;
- tratamento sem valores inventados para volume/peso ausentes na origem;
- tipos `conjunto` e `consumivel` sem equivalência comportamental pronta no OliMen.

Decisão recomendada: adicionar `products.description` como descrição geral opcional. Preservar `preco_venda` em extensão 1:1 (`product_commercial_profiles.reference_sale_price`), sem torná-lo requisito operacional; descrições explicitamente comerciais/técnicas continuam nas versões do Catálogo. NCM não existe na fonte mapeada nem no destino e deve ser uma decisão fiscal futura, não requisito desta migração.

## Estruturas futuras

### Reutilizar

- `products`;
- `customers`;
- `company_settings`;
- `users`, `roles`, `permissions`, `role_permissions`;
- `audit_logs`;
- infraestrutura autenticada de arquivos e PDF.

### Criar — núcleo

- `product_external_ids`;
- `customer_external_ids`;
- `product_commercial_profiles`;
- `product_catalogs`;
- `product_catalog_versions`;
- `product_catalog_images`;
- `product_catalog_specifications`;
- `product_catalog_included_items`;
- `commercial_quotes`;
- `commercial_quote_items`;
- `commercial_quote_payment_methods`;
- `commercial_quote_installments`;
- `commercial_quote_documents` para preservar o PDF emitido e seu hash.

### Criar — conforme decisão final de escopo

- `integration_import_runs` e `integration_import_records`, recomendados para dry run, idempotência e rastreabilidade;
- histórico específico de estados, caso `audit_logs` não atenda consultas de negócio;
- configuração/assinantes separados somente se houver múltiplos representantes. Para um único representante, `signature_path` opcional em `company_settings` é suficiente.

## Momento do snapshot

O snapshot deve ser consolidado quando uma revisão sai de `draft` e é **emitida/enviada**. Após isso:

- conteúdo comercial e referências técnicas da revisão ficam imutáveis;
- mudança de conteúdo cria nova revisão (`#85 Rev. 1`), não altera a revisão emitida;
- transições de estado posteriores registram auditoria sem reescrever snapshots;
- o PDF final é armazenado uma vez, com hash e versão do renderer, e o mesmo binário serve para baixar e imprimir.

## Navegação dos documentos

1. [01-matriz-geral.md](01-matriz-geral.md) — matriz consolidada por conceito/campo.
2. [02-produtos.md](02-produtos.md) — Produto mestre, tipos, lacunas e conciliação.
3. [03-clientes.md](03-clientes.md) — evolução de `customers` e migração de Clientes.
4. [04-orcamentos.md](04-orcamentos.md) — schema e regras do Comercial.
5. [05-catalogo-tecnico.md](05-catalogo-tecnico.md) — Catálogo versionado e imutável.
6. [06-configuracoes-documentos.md](06-configuracoes-documentos.md) — Empresa, assinatura e PDF.
7. [07-uploads-midia.md](07-uploads-midia.md) — contrato de arquivos.
8. [08-snapshots-historico.md](08-snapshots-historico.md) — congelamento histórico.
9. [09-identidade-equivalencia.md](09-identidade-equivalencia.md) — IDs externos e deduplicação.
10. [10-banco-destino.md](10-banco-destino.md) — proposta consolidada de schema futuro.
11. [11-plano-importacao.md](11-plano-importacao.md) — importador idempotente, dry run e conflitos.
12. [12-riscos.md](12-riscos.md) — riscos e controles.
13. [13-plano-implementacao.md](13-plano-implementacao.md) — ordem futura e homologação.

## Decisões ainda humanas, mas sem bloquear o contrato

- política de geração do `internal_code` local;
- se Produtos importados pendentes podem aparecer imediatamente no Comercial;
- se preço comercial ficará em extensão 1:1 ou no mestre;
- necessidade legal de importar Orçamentos antigos;
- preservação do PDF como arquivo oficial versus regeneração apenas para rascunhos;
- um ou vários representantes/assinaturas.
