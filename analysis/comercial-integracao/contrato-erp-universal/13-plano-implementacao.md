# 13 — Plano futuro de implementação e homologação

Este plano é deliberadamente sequencial por dependência. Nenhuma fase foi iniciada por esta documentação.

## Fase 0 — Aprovar contrato e decisões

- aprovar este contrato campo a campo;
- definir política de código local;
- fechar tipos/unidades e campos operacionais pendentes;
- decidir perfil comercial de Produto;
- aprovar modelo completo de Cliente e documento duplicado;
- definir revisão/emissão/status/retenção do PDF;
- decidir escopo de histórico e assinatura;
- medir dados/arquivos reais em dry run somente leitura.

**Saída:** decisões sem ambiguidade e critérios de aceite assinados.

## Fase 1 — Preparar cadastros mestres e identidade

- evoluir `customers` e retirar unicidade por nome;
- criar CRUD/autocomplete mestre de Cliente com RBAC;
- preparar Produto para lacunas aprovadas, sem quebrar consumidores;
- adicionar descrição/perfil comercial conforme decisão;
- criar `product_external_ids` e `customer_external_ids`;
- criar ledger de importação/auditoria;
- testes de regressão de OS, Produto, Compras, Produção e Expedição.

**Saída:** Clientes homônimos e Produtos legados coexistem; nenhum módulo operacional foi acoplado ao Comercial.

## Fase 2 — Importar Clientes

- dry run completo;
- saneamento/normalização;
- revisão de documentos, telefones e homônimos;
- aplicar lotes idempotentes;
- reconciliar contagens e amostras;
- manter campos locais e preencher apenas decisões aprovadas.

**Saída:** todos os Clientes necessários estão em `customers`, com identidade externa e sem falsas fusões.

## Fase 3 — Conciliar/importar Produtos

- dry run de códigos/SKUs, nomes, tipos e unidades;
- revisão de conflitos e dados operacionais ausentes;
- aplicar vínculos/novos pendentes;
- preservar Produtos/UUIDs existentes;
- validar buscas comerciais sem afetar fluxos operacionais.

**Saída:** todos os Produtos necessários têm `products.id` e vínculo externo; nenhum dado local foi sobrescrito automaticamente.

## Fase 4 — Catálogo Técnico

- criar tabelas versionadas e Permissões;
- criar UI dentro de Produtos;
- ampliar storage protegido para galeria;
- implementar rascunho/publicação/imutabilidade;
- migrar versões/textos/imagens por Produto resolvido;
- validar compartilhamento de arquivos e hashes;
- impedir edição/exclusão histórica.

**Saída:** versões completas, imutáveis, com mídia acessível; Produto sem Catálogo continua válido.

## Fase 5 — Comercial/Orçamentos

- adicionar menu **Comercial → Orçamentos**;
- criar tabelas/ciclo de rascunho/emissão/estado/revisão;
- consumir `customers`/`products` por FK;
- implementar snapshots, cálculo e condições de pagamento;
- vincular versão técnica exata por item;
- implementar RBAC/auditoria;
- assegurar ausência de chamadas a Estoque/Produção/Compras/Expedição.

**Saída:** Orçamento novo funciona isoladamente e permanece histórico após alteração dos mestres.

## Fase 6 — PDF e impressão

- construir renderer sobre PDFKit OliMen;
- usar snapshots/versões, logo e assinatura aprovadas;
- reproduzir regras de páginas comerciais e técnicas;
- armazenar PDF oficial e hash;
- usar o mesmo arquivo para baixar/imprimir;
- testar paginação longa, caracteres, imagens ausentes e dispositivos suportados.

**Saída:** PDF equivalente funcionalmente, determinístico e auditável.

## Fase 7 — Histórico opcional

- selecionar janela/estados de Orçamentos úteis;
- documentar limitações dos snapshots fonte;
- importar por mapas já consolidados;
- não recriar efeitos operacionais;
- arquivar PDF/metadata conforme política;
- reconciliar amostras e totais.

**Saída:** histórico aprovado está consultável sem alegar precisão não existente na fonte.

## Fase 8 — Homologação e transição

- executar cenários objetivos abaixo;
- operação paralela e importação delta;
- treinamento e aceite;
- plano de rollback/continuidade;
- congelar origem gradualmente;
- desativar ERP apenas após todos os critérios.

## Critérios objetivos de homologação

### Clientes

- todos os Clientes necessários disponíveis;
- homônimos preservados;
- CPF/CNPJ/telefone normalizados sem falsa união;
- busca/edição protegidas por Permissão;
- edição do Cliente não altera Orçamento emitido.

### Produtos

- todos os Produtos necessários resolvidos;
- colisões de código decididas;
- `conjunto`/`consumivel` tratados;
- legados sem Catálogo/foto/preço permanecem utilizáveis;
- Produto inativo continua visível em histórico;
- nenhuma regressão operacional.

### Catálogo/mídia

- todas as versões/filhos reconciliados;
- uma versão ativa por Catálogo;
- versão publicada/usada não editável;
- imagens acessíveis e hashes corretos;
- paths antigos inexistentes no banco;
- arquivos compartilhados não quebram por exclusão.

### Orçamento/PDF

- data comercial separada da auditoria;
- cálculos e pagamentos conferidos;
- Cliente/Produto/Empresa congelados;
- checkbox e versão exata por item;
- Produto repetido não duplica ficha igual;
- páginas comerciais têm assinaturas/rodapé e páginas técnicas não;
- download e impressão usam o mesmo PDF;
- alteração posterior de mestre/layout não muda arquivo oficial.

### Segurança e isolamento

- permissões positivas e negativas testadas;
- uploads privados e path-safe;
- eventos em `audit_logs`;
- nenhum saldo, reserva, OS, Produção, Compra, Entrega ou Venda criado pelo fluxo inicial;
- backups de DB/storage restaurados em teste.

### Importação

- dry run reproduzível;
- reexecução gera zero duplicações;
- contagens fonte/destino conciliadas;
- conflitos resolvidos ou explicitamente adiados;
- mapa de IDs completo;
- erros retomáveis sem edição manual de banco.

## Critérios para desativação gradual do ERP

- nenhum Orçamento novo depende da origem;
- Clientes/Produtos/Catálogos necessários foram validados;
- PDF OliMen aceito por Comercial e direção;
- histórico necessário acessível no OliMen ou arquivo de consulta definido;
- delta final importado e reconciliado;
- usuários/permissões/treinamento concluídos;
- backup e plano de retorno disponíveis;
- prazo legal de retenção/consulta definido;
- monitoramento inicial sem divergências críticas.

## Dependências

```text
Contrato aprovado
      ↓
Mestres + identidades externas
      ↓
Clientes → Produtos/equivalências
      ↓
Catálogo + mídia versionada
      ↓
Comercial/Orçamentos + snapshots
      ↓
PDF oficial
      ↓
Histórico opcional
      ↓
Homologação, delta e desativação gradual
```

## Próximo passo recomendado

Realizar uma revisão humana deste contrato com responsáveis de Comercial, Produto/Produção, cadastro de Clientes e infraestrutura. Fechar as dez decisões listadas em `12-riscos.md`. Depois, transformar a Fase 1 em especificação implementável e plano de migrations — ainda separando claramente preparação dos mestres de qualquer importação de dados.
