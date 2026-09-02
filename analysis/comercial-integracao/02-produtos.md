# 02 — Produtos: cadastro mestre

## Localização e papel

- Tabela mestre: `products`.
- UI: **Estoque > Produtos**.
- Lista: `src/pages/ProductsPage/ProductsPage.jsx`, rota `/produtos`.
- Criação/edição: `ProductFormPage` + `ProductForm`, rotas `/produtos/novo` e `/produtos/:id`.
- API: `/api/products`.
- Implementação principal: `backend/src/routes/productRoutes.js` e funções em `backend/src/controllers/basicControllers.js`.

Produto é compartilhado por Produção, Compras, Ordens, Etiquetas e Expedição. Comercial deve referenciar esse cadastro, jamais duplicá-lo.

## Campos efetivos de `products`

Classificação: C = comercial, E = estoque/cadastro mestre, P = produção, F = fiscal, T = técnico. “Uso” descreve o estado atual, não uma obrigação futura.

| Campo | Tipo esperado | Obrigatório / nulo / default | Finalidade e uso atual | C | E | P | F | T |
|---|---|---|---|:---:|:---:|:---:|:---:|:---:|
| `id` | UUID | PK, não nulo, `gen_random_uuid()` | Identidade interna e alvo de FKs | ✓ | ✓ | ✓ |  | ✓ |
| `name` | VARCHAR | `NOT NULL`, sem default | Nome exibido, busca e snapshot em itens vendidos | ✓ | ✓ | ✓ |  | ✓ |
| `type` | VARCHAR | `NOT NULL`, sem default | Código lógico de `product_types`; controla regras produtivas | ✓ | ✓ | ✓ |  | ✓ |
| `sector_id` | UUID | aceita nulo no banco; FK `sectors(id)` | Setor responsável/fallback de tarefa; backend regular exige setor ativo |  | ✓ | ✓ |  | ✓ |
| `default_volume_quantity` | INTEGER | `NOT NULL`, `> 0` | Volumes por unidade para expedição |  | ✓ | ✓ |  |  |
| `default_total_weight_kg` | NUMERIC(10,2) | `NOT NULL`, `> 0` | Peso total usado para calcular peso por volume |  | ✓ | ✓ |  | ✓ |
| `is_active` | BOOLEAN | aceita nulo no DDL; default `TRUE` | Soft delete e filtro operacional | ✓ | ✓ | ✓ |  | ✓ |
| `created_at` | TIMESTAMP | aceita nulo; default `NOW()` | Auditoria temporal |  | ✓ |  |  |  |
| `updated_at` | TIMESTAMP | aceita nulo; default `NOW()` | Auditoria temporal |  | ✓ |  |  |  |
| `internal_code` | VARCHAR(80) | aceita nulo; sem default | Código interno exibido e pesquisado; criado sobretudo em Compras | ✓ | ✓ |  | possível | possível |
| `measurement_unit_code` | VARCHAR(20) | aceita nulo; FK para `measurement_units(code)` | Unidade padrão de apresentação/Compras; não é saldo | ✓ | ✓ |  | possível | ✓ |
| `review_status` | VARCHAR(30) | `NOT NULL`, default `approved`; check `pending_review/approved` | Completude/revisão do cadastro preliminar | ✓ | ✓ |  |  |  |
| `creation_origin` | VARCHAR(30) | `NOT NULL`, default `manual`; check `manual/purchases` | Origem do fluxo de criação local, não sistema externo | ✓ | ✓ |  |  |  |
| `preliminary_created_by` | UUID | aceita nulo; FK `users(id)` | Autor do cadastro preliminar |  | ✓ |  |  |  |
| `preliminary_created_at` | TIMESTAMPTZ | aceita nulo | Data do cadastro preliminar |  | ✓ |  |  |  |
| `reviewed_by` | UUID | aceita nulo; FK `users(id)` | Usuário que aprovou preliminar |  | ✓ |  |  |  |
| `reviewed_at` | TIMESTAMPTZ | aceita nulo | Data da aprovação |  | ✓ |  |  |  |

Campos inexistentes: descrição geral/comercial, SKU separado, código de barras, NCM, preço de venda, custo mestre, marca, categoria de Produto, observações, dados fiscais, slug, origem externa, chave legada e catálogo técnico.

## Constraints e índices

- PK em `id`.
- Check positivo em `default_volume_quantity` e `default_total_weight_kg`.
- Check de `review_status` e `creation_origin`.
- FK de `measurement_unit_code` para `measurement_units.code`.
- FK de setor e usuários de revisão/criação.
- Índice `idx_products_type` em `type`.
- Índice `idx_products_review_status` em `(review_status, is_active)`.
- Índice único parcial `idx_products_internal_code_unique` em `lower(internal_code)` quando não nulo.
- **Sem unique em `name`**.
- **Sem FK de `products.type` para `product_types.code`**. O check original dos três tipos foi removido para permitir tipos dinâmicos; o backend valida o código ativo ao salvar.

## Relacionamentos principais

| Estrutura | Relação com Produto | Comportamento relevante |
|---|---|---|
| `sectors` | `products.sector_id → sectors.id` | Setor pode ser nulo no DB; cadastro regular exige setor ativo |
| `measurement_units` | `measurement_unit_code → code` | Unidade pode ser nula no DB; catálogo não representa saldo |
| `product_types` | junção lógica `products.type = product_types.code` | Sem FK; service valida nas gravações normais |
| `product_images` | 1:0..1 por unique em `product_id` | Cascade em exclusão física do Produto |
| `product_components` | Produto pai e Produto-material opcional | Pai tem cascade; material não tem cascade; service impede self/ciclo/duplicidade |
| `product_manufacturing_steps` | 1:N | Cascade ao excluir Produto; etapas têm setor obrigatório |
| `sold_items` | N:1 por `product_id` | Mantém também `product_name_snapshot`; sem cascade |
| Itens de Compras | múltiplas FKs `product_id`/`internal_product_id` | Descrições de item preservam contexto; sem movimentar estoque |
| `supplier_item_mappings` | N:1 opcional | Liga códigos/descrições de fornecedor ao Produto, não sistemas ERP |
| `supplier_item_price_history` | N:1 opcional | Histórico de preço de fornecedor, não preço comercial mestre |

`product_components` contém `id`, `product_id`, `material_product_id`, `component_name`, `sector_id`, `quantity` positiva, `is_required` e timestamps. `product_manufacturing_steps` contém nome, setor, quantidade positiva e ordem; `product_step_dependencies` forma o grafo entre etapas.

## Tipos de Produto

Tabela `product_types`: `id`, `code` único, `name`, `is_system`, `is_active`, `created_at`, `updated_at`.

Tipos de sistema confirmados:

| Código | Nome | Impacto real |
|---|---|---|
| `manufactured` | Fabricado | Se houver roteiro, ele é copiado para tarefas da OS. Sem roteiro, componentes ou setor geram tarefas. O formulário mostra roteiro e avisa se estiver vazio. |
| `resale` | Revenda | Cadastro normal não aceita roteiro. Na OS, sem roteiro não gera tarefas por tipo e libera volumes diretamente para etiqueta. É o tipo artificial usado por Produto preliminar de Compras. |
| `material_prima` | Matéria-prima | É omitido da busca normal de itens da OS e só pode ser lançado como peça de reposição. Pode ser componente de outro Produto. Pode ter roteiro no formulário porque apenas `resale` é excluído. |

Outros tipos podem ser criados na UI/API. Eles não têm comportamento especial além do comportamento genérico: podem ter roteiro; sem roteiro não entram no fallback exclusivo de `manufactured` a menos que sejam lançados como peça de reposição. Isso é um risco de extensão.

### Troca de tipo

É permitida para qualquer tipo ativo. A única trava específica é mudar para `resale` enquanto ainda houver roteiro salvo: primeiro é preciso remover/salvar o roteiro. Para `resale`, o backend não sincroniza roteiro; para os demais tipos, sincroniza se `manufacturing_steps` for enviado.

## Identificação e deduplicação

| Conceito | Estado atual | Uso futuro seguro |
|---|---|---|
| ID interno | UUID | FK canônica dentro do OliMen; nunca reutilizar ID externo |
| Código | `internal_code` opcional e único case-insensitive | Bom identificador local depois de política de atribuição |
| SKU | Não existe separado | Não assumir que `internal_code` equivale a SKU externo |
| Nome | Obrigatório, não único | Apenas candidato de equivalência, nunca chave automática |
| Descrição | Não existe em Produto | Snapshot de itens de Compras não é descrição mestre |
| Código de barras | Não existe | Lacuna |
| NCM | Não existe | Lacuna fiscal |
| Unidade | Catálogo `measurement_units`, campo opcional no DB | Comparar após normalização/alias; não usar sozinho |
| Identificador alternativo | Mapeamentos por fornecedor existem em `supplier_item_mappings` | Não usar para origem ERP; é semântica de fornecedor |

O fluxo de importação de Compras já procura candidatos por nome/código e exige confirmação em possível duplicidade. Essa lógica é útil como referência, mas não representa equivalência confiável entre sistemas.

## Unidades

`measurement_units` é catálogo central, não estoque. Campos: UUID, `code` único, nome, símbolo, aliases (array), ativo, ordem e timestamps. Códigos instalados pela migration: `UN`, `KG`, `G`, `T`, `M`, `CM`, `MM`, `M²`, `M³`, `L`, `ML`, `CX`, `PCT`, `PAR`, `JG`, `BARRA`, `CHAPA`, `ROLO`, `KIT`, `CONJ`, `PC`.

O serviço resolve código ou alias ignorando caixa, acentos e espaços. Imports podem apresentar unidade legada, mas a confirmação exige unidade válida.

## Categorias

Não existe categoria de Produto. `material_groups` pertence ao domínio de Compras/fornecedores e se relaciona a solicitações, itens e mapeamentos de fornecedor; não deve ser renomeado ou tratado automaticamente como categoria comercial.

## Edição e foto

- A tela é página, não modal.
- O formulário atual é uma sequência: dados básicos, aviso de revisão, componentes, roteiro (exceto Revenda), aviso de Fabricado sem roteiro, foto.
- Não há sistema de abas. A futura aba Catálogo Técnico exigirá introduzir navegação interna na página ou uma subrota, preservando o formulário existente.
- Foto atual: `product_images`, relação 1:1 (`product_id UNIQUE`), PNG/JPEG até 5 MiB, opcional. É foto cadastral, explicitamente não ficha técnica completa.
- O campo `internal_code` aparece na lista e no fluxo preliminar de Compras, mas **não é editado pelo formulário regular nem persistido por `saveProduct`**. Isso deve ser resolvido antes de uma política de códigos importados.

Endpoints atuais:

| Método e rota | Regra |
|---|---|
| `GET /api/products` | lista ativos; suporta paginação/filtros com `products.view` |
| `GET /api/products/search` | busca ativos; até 40; omite matéria-prima por padrão |
| `GET /api/products/types` | lista tipos conforme qualquer Permissão relevante de Produto |
| `POST/PUT /api/products/types[/:id]` | cria/edita tipo com `products.types.manage` |
| `POST /api/products` | cria cadastro regular com `products.create` |
| `GET /api/products/:id` | detalhe, componentes e roteiro |
| `PUT /api/products/:id` | edita com `products.edit` |
| `DELETE /api/products/:id` | inativa com `products.delete` |
| `GET/PUT/DELETE /api/products/:id/photo` | leitura/gestão de foto com Permissões contextuais |

No frontend regular não há busca de duplicidade por nome nem validação de `internal_code`, pois o campo nem é editável ali. O fluxo preliminar de Compras apresenta candidatos similares e requer confirmação; a unicidade do código é garantida no banco/backend.

## Exclusão/inativação

`DELETE /api/products/:id` faz somente `UPDATE products SET is_active = FALSE`. Não há reativação exposta na UI/API e a listagem filtra ativos. O registro e suas FKs históricas permanecem.

Uma exclusão física seria normalmente bloqueada por FKs sem cascade (`sold_items`, itens/mapeamentos de Compras etc.) e faria cascade de estruturas filhas como componentes/roteiro/foto em algumas relações. O Comercial deve sempre preservar FK e snapshots históricos e nunca depender de o Produto continuar ativo.

## Produto × Produção

- `product_components`: composição operacional, com Produto pai, Produto material opcional, nome do componente, setor, quantidade e obrigatório.
- `product_manufacturing_steps`: roteiro por Produto.
- `product_step_dependencies`: dependências acíclicas entre etapas.
- Ao criar OS, o roteiro é copiado para `internal_tasks`; isso protege a execução contra mudanças futuras do roteiro.
- Sem roteiro, Fabricado/peça de reposição usa componentes ou Produto/setor como tarefas.
- Volumes/peso geram `shipment_volumes`.

Catálogo Técnico deve ser relacionamento novo e não deve alterar essas regras.

## Produto × Estoque

Não existem quantidade, saldo, estoque mínimo, reserva, entrada, saída ou tabela de movimentação. `measurement_unit_code` não é saldo. Compras registra `received_quantity` e recebimentos no seu domínio, mas não cria estoque. Expedição também não baixa estoque.

Primeira integração Comercial deve ficar completamente fora de: `purchase_receipts`, `shipment_volumes`, futuras movimentações, reservas e qualquer cálculo de disponibilidade.

## Produto × Compras

Compras referencia `products` por `product_id`/`internal_product_id`, mantém descrições em itens como snapshot e possui mapeamentos/códigos/preços por fornecedor. Pode criar Produto preliminar com defaults e foto. Não há preço de venda mestre; histórico de preços é de fornecedor/compra.

## Espaço para Catálogo Técnico

O UUID de Produto suporta naturalmente relações 1:N. Recomendação futura:

```text
products 1 ── 0..1 technical_catalogs
technical_catalogs 1 ── N technical_catalog_versions
technical_catalog_versions 1 ── N images
technical_catalog_versions 1 ── N specifications
technical_catalog_versions 1 ── N included_items
```

Não reutilizar `product_images` como imagens versionadas: ele suporta uma única foto mutável por Produto e sua finalidade está explicitamente limitada.
