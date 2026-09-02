# 10 — Proposta consolidada de banco destino

Esta é uma proposta de schema **futuro**, não uma migration. Nomes seguem o padrão inglês/snake_case predominante do OliMen e separam `commercial_*` de `purchase_*`.

## Reutilizar

| Tabela | Uso no contrato | Adaptação |
|---|---|---|
| `products` | cadastro mestre | descrição opcional; política para campos operacionais pendentes |
| `customers` | cadastro mestre | enriquecer campos e retirar unique do nome normalizado |
| `company_settings` | Empresa oficial | assinatura opcional/configuração documental se aprovada |
| `users` | autoria/emissão/revisão | nenhuma duplicação |
| `roles`, `permissions`, `role_permissions` | RBAC | acrescentar códigos de Permissão via migration futura |
| `audit_logs` | eventos comerciais/técnicos/importação | novos tipos/metadados conforme padrão |
| `measurement_units` | normalização de unidade | mapear aliases da origem |
| `product_types` | tipos cadastrados | revisar `conjunto`/`consumivel` |

Não reutilizar `purchase_quotes`, tabelas de Produção, componentes, Ordens, Entregas ou Compras para representar o Comercial.

## Evolução de `products`

### Recomendada

- `description TEXT NULL`, se aprovada como descrição geral;
- considerar permitir `default_volume_quantity`/`default_total_weight_kg` nulos somente em `pending_review`, após auditoria de compatibilidade;
- manter `internal_code` opcional e único local;
- não adicionar uma coluna simples `origin` como substituta da tabela externa.

### Extensão comercial recomendada

`product_commercial_profiles`:

- `product_id UUID PK/FK products`;
- `reference_sale_price NUMERIC(14,2) NULL CHECK >= 0`;
- `commercial_description TEXT NULL` somente se surgir conteúdo comercial não versionado distinto de `products.description` e do Catálogo;
- `currency_code`/vigência somente se a política exigir;
- timestamps/autoria.

O preço do perfil é sugestão; o item do Orçamento sempre congela o valor.

## Evolução de `customers`

Adicionar campos opcionais, exceto `is_active` com default:

- `trade_name VARCHAR`;
- `tax_id VARCHAR`;
- `person_type VARCHAR NULL`, se necessário;
- `email VARCHAR`;
- `address_line TEXT`;
- `address_number VARCHAR`;
- `address_complement VARCHAR/TEXT`;
- `neighborhood VARCHAR`;
- `city VARCHAR`;
- `state VARCHAR(2)`;
- `postal_code VARCHAR`;
- `notes TEXT`;
- `is_active BOOLEAN NOT NULL DEFAULT TRUE`.

Remover `UNIQUE(normalized_name)` e criar índice não único. Criar unicidade parcial de documento normalizado apenas depois de limpar/validar a base e definir exceções. `location`, `carrier_name` e `destination_uf` permanecem por compatibilidade de Entrega.

## Identidade externa

### `product_external_ids`

- PK UUID;
- FK `product_id`;
- `source_system`, `source_id`, `source_code`;
- estado/autoria do matching;
- timestamps/hash;
- unique `(source_system, source_id)`;
- índices por Produto e código da fonte.

### `customer_external_ids`

Estrutura equivalente, FK `customer_id`, unique `(source_system, source_id)`.

Política de delete: `RESTRICT` ou cascade apenas quando o mestre ainda não possui uso; preferir preservar proveniência. Inativar mestre não apaga identidade.

## Catálogo Técnico

### `product_catalogs`

- `id UUID PK`;
- `product_id UUID NOT NULL UNIQUE FK products`;
- `is_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
- `category VARCHAR NOT NULL` com domínio equipamento/acessorio/peca/servico;
- timestamps/autoria.

### `product_catalog_versions`

- `id UUID PK`;
- `product_catalog_id UUID NOT NULL FK`;
- `version_number INTEGER NOT NULL CHECK > 0`;
- `commercial_name TEXT NOT NULL`;
- `subtitle`, `commercial_description`, `applications`, `notes` nulos;
- `catalog_order INTEGER NULL`;
- `status` ou `is_active`;
- `published_at`, `locked_at`, `created_by`, timestamps;
- unique `(product_catalog_id, version_number)`;
- índice/constraint parcial de uma ativa por catálogo.

### `product_catalog_images`

- `id UUID PK`;
- `product_catalog_version_id UUID NOT NULL FK`;
- `storage_key TEXT NOT NULL`;
- `sha256`, MIME, tamanho/dimensões opcionais;
- `caption TEXT NULL`;
- `display_order INTEGER NOT NULL DEFAULT 0 CHECK >= 0`;
- `is_primary BOOLEAN NOT NULL DEFAULT FALSE`;
- timestamps/autoria;
- unique parcial de imagem principal por versão.

### `product_catalog_specifications`

- versão FK;
- ordem >= 0;
- `name TEXT NOT NULL`;
- `value TEXT NOT NULL`.

### `product_catalog_included_items`

- versão FK;
- ordem >= 0;
- `description TEXT NOT NULL`.

FK de filhos pode ser cascade apenas para versão em rascunho sem uso. Services devem impedir qualquer mutação de versão bloqueada.

## Orçamentos Comerciais

### `commercial_quotes`

- `id UUID PK`;
- `quote_number BIGINT NOT NULL`;
- `revision_number INTEGER NOT NULL DEFAULT 0`;
- `root_quote_id`, `previous_revision_id`;
- `customer_id UUID NULL FK customers`;
- snapshots estruturados do Cliente;
- `company_snapshot JSONB NOT NULL` + `snapshot_schema_version`;
- `commercial_date DATE NOT NULL`;
- `status VARCHAR NOT NULL`;
- `general_discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0`;
- totais snapshot (`gross_total`, `discount_total`, `net_total`);
- `calculation_version`;
- `notes TEXT NULL`;
- `emitted_at/by`, `created_by`, `updated_by`, timestamps;
- unique `(quote_number, revision_number)`;
- índices em Cliente, estado, data comercial e número.

`customer_id` pode ser nullable no schema para legado órfão, mas é obrigatório no service para Orçamentos novos. A emissão exige snapshots completos mesmo quando a referência histórica for nula.

### `commercial_quote_items`

- PK/FK revisão;
- `product_id UUID NOT NULL FK products`;
- `line_order INTEGER NOT NULL`;
- snapshots de código, nome, descrição e unidade;
- quantidade/preço/descontos/totais NUMERIC com checks;
- `include_catalog BOOLEAN NOT NULL DEFAULT FALSE`;
- `product_catalog_version_id UUID NULL FK RESTRICT`;
- check coerente entre checkbox e versão;
- unique `(commercial_quote_id, line_order)`.

### `commercial_quote_payment_methods`

- FK revisão;
- forma/código + descrição snapshot;
- valor > 0;
- número de parcelas >= 1;
- ordem;
- timestamps.

### `commercial_quote_installments`

- FK forma de pagamento;
- número >= 1;
- vencimento opcional;
- valor >= 0;
- unique `(payment_method_id, installment_number)`.

### `commercial_quote_documents`

- `id UUID PK`;
- `commercial_quote_id UUID NOT NULL FK`;
- tipo (`official`, eventualmente `regenerated_copy`);
- `storage_key TEXT NOT NULL`;
- `sha256`, MIME, tamanho;
- `renderer_version`, `snapshot_schema_version`;
- `generated_at`, `generated_by`;
- imutável; unique do documento oficial por revisão, salvo política de múltiplas emissões.

## Importação/auditoria técnica recomendada

### `integration_import_runs`

Lote, fonte, modo dry-run/aplicação, início/fim, usuário, versão do contrato, contagens e status.

### `integration_import_records`

Lote, tipo de entidade, source ID, local ID, ação planned/created/linked/updated/skipped/conflict/error, hash e mensagem sanitizada. Unique por lote/entidade externa e índice global por fonte/entidade/source ID.

Essas tabelas não substituem `product_external_ids`/`customer_external_ids`; elas registram execuções.

## Permissões futuras

- `commercial_quotes.view/create/edit/delete/pdf`;
- `products.catalog.view/edit/publish` (ou forma achatada equivalente, escolhida uma vez);
- permissões próprias de Cliente, caso ainda não existam, separadas de `orders.view`.

## Regras de FK/delete

- Produto/Cliente: inativação, não deleção por causa de histórico;
- item → Produto: preservar FK; nenhum cascade;
- item → versão técnica: `RESTRICT`;
- Orçamento emitido → filhos: não apagar; cancelamento/imutabilidade no service;
- rascunho descartável pode usar cascade transacional controlado;
- documento oficial/arquivo nunca é sobrescrito;
- identidade externa não deve apontar para dois mestres.

## O que não criar

- `commercial_products`;
- `customers_comercial`;
- `clientes_orcamento` como cadastro mestre;
- segunda tabela de Empresa;
- usuários/perfis/permissões paralelos;
- motor/tabela de upload público separado;
- Orçamento dentro de Compras;
- cópia de BOM, estoque, reserva, entrega ou venda para o Comercial inicial.
