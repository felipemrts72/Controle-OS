# 04 — Orçamentos Comerciais

## Local no OliMen

Criar futuramente **Comercial → Orçamentos**, com rota de interface `/comercial/orcamentos` e namespace de API/tabelas claramente comercial. Não reutilizar `purchase_quotes`, telas, permissões ou regras das Cotações de Compras.

Padrão de implementação futuro do destino: rota Express → controller fino → service transacional com SQL parametrizado, validação e `audit_logs`. O OliMen não possui camada repository formal; copiar controller/service/repository do ERP produziria arquitetura estranha ao destino.

## Origem confirmada: cabeçalho

| Campo ERP | Regra real | Campo futuro | Contrato |
|---|---|---|---|
| `id` | serial PK e número exibido | `id UUID`, `quote_number`, identidade externa | Não preservar PK; número legado deve ter namespace/proveniência |
| `cliente_id` | nullable, FK `clientes`, `ON DELETE SET NULL` | `customer_id UUID` | Resolver mapa; manter FK mesmo com snapshots |
| `cliente_nome` | snapshot mínimo obrigatório | snapshots estruturados | Preservar e ampliar |
| `desconto_geral` | numeric, default 0 | `general_discount_amount` | Valor absoluto, congelado |
| `status` | rascunho/enviado/aprovado/rejeitado | status comercial | Mapear sem efeitos operacionais |
| `criado_em` | auditoria | `created_at` e/ou `source_created_at` | Separar de data comercial |
| `data_orcamento` | data do negócio | `commercial_date` | Preservar |
| `observacoes` | texto | `notes`/snapshot | Congelar ao emitir |

O ERP não persiste telefone/endereço do Cliente, subtotal ou total do Orçamento. O PDF atual consulta parte dos dados vivos de Cliente/Empresa; isso é uma limitação da fonte, não comportamento a reproduzir.

## Estrutura futura do cabeçalho

`commercial_quotes`, conceitualmente:

- `id UUID PK`;
- `quote_number BIGINT` ou número segundo sequência comercial OliMen;
- `revision_number INTEGER NOT NULL DEFAULT 0`;
- `root_quote_id UUID` ou chave equivalente para agrupar revisões;
- `previous_revision_id UUID NULL` para rastrear origem da revisão;
- `customer_id UUID NULL FK customers`;
- snapshots do Cliente, preferencialmente em colunas estruturadas para pesquisa/documento;
- `company_snapshot JSONB NOT NULL` com schema versionado;
- `commercial_date DATE NOT NULL`;
- `status`;
- `general_discount_amount NUMERIC`;
- `notes`;
- totais consolidados/snapshot e versão da fórmula;
- `emitted_at`, `emitted_by`;
- `created_by`, `updated_by`, `created_at`, `updated_at`;
- marca de cancelamento/arquivamento, se necessária, sem exclusão física de emitido.

O banco pode manter `customer_id` nulo para acomodar legado realmente órfão e eventual `ON DELETE SET NULL`; o service deve exigir Cliente selecionado em todo Orçamento novo. Snapshot nunca é opcional na emissão.

Unicidade recomendada: `(quote_number, revision_number)`. O desenho deve permitir `#85 Rev. 0`, `#85 Rev. 1` e `#85 Rev. 2` desde a primeira migration, ainda que a interface de revisão venha depois.

## Itens: FK + snapshot

| Campo ERP | Regra real | Destino futuro | Decisão |
|---|---|---|---|
| `id` | serial | UUID | Novo ID; identidade de origem via importação quando histórico |
| `orcamento_id` | FK cascade | `commercial_quote_id` | FK ao cabeçalho/revisão |
| `produto_id` | nullable no DB; serviço normalmente resolve/cria | `product_id UUID NOT NULL` | Resolver antes de importar; não criar Produto implícito silenciosamente |
| `quantidade` | > 0 | `quantity` | Copiar |
| `preco_unitario` | >= 0 | `unit_price` | Snapshot |
| `desconto_valor` | >= 0; desconto **por unidade**, multiplicado pela quantidade | `unit_discount_amount` | Nomear para eliminar ambiguidade |
| `desconto_percentual` | 0..100 | `discount_percent` | Preservar |
| `nome_customizado` | snapshot opcional | `product_name_snapshot` | Nome efetivamente exibido |
| `descricao` | nullable no DB, exigida no fluxo | `description_snapshot` | Preservar |
| `incluir_catalogo` | boolean | `include_catalog` | Preservar |
| `catalogo_versao_id` | FK `RESTRICT`; obrigatório quando incluir | `product_catalog_version_id` | Resolver versão exata; FK restritiva |
| ausente | código snapshot | `product_code_snapshot` | Novo e obrigatório para emissão quando exibido |
| ausente | unidade snapshot | `measurement_unit_snapshot` | Novo |
| calculado | total líquido | `line_total_snapshot` | Persistir na emissão para história/auditoria |
| ordem implícita | retorno/ID | `line_order` | Novo, explícito |

O item deve guardar Produto como referência e congelar código, nome, unidade, descrição, quantidade, preço, descontos e total. Alterar `products` depois não muda a revisão.

## Fórmula herdada e contrato de cálculo

No ERP:

1. bruto do item = `quantidade × preco_unitario`;
2. se `desconto_valor > 0`, desconto = `desconto_valor × quantidade`;
3. caso contrário, desconto = bruto × percentual / 100;
4. líquido do item = `max(bruto - desconto, 0)`;
5. total = `max(soma dos líquidos - desconto_geral, 0)`.

O futuro service deve ter uma única implementação dessa regra, validar valores e congelar os resultados na emissão. Forma de pagamento deve ser validada contra o total conforme política comercial; a origem não garante essa soma no backend.

## Formas e parcelas de pagamento

### Origem

`orcamento_formas_pagamento`: forma, valor, parcelas, ordem e timestamps. Formas observadas: dinheiro, PIX, débito, crédito, boleto, cheque, transferência e outro.

`orcamento_pagamento_parcelas`: número da parcela, vencimento opcional, valor e timestamps. O ERP gera linhas detalhadas especialmente para boleto/cheque; no cartão pode existir apenas a quantidade.

### Destino

- `commercial_quote_payment_methods` ligada à revisão;
- `commercial_quote_installments` ligada à forma;
- snapshot da descrição/forma, valor, número de parcelas e ordem;
- nenhuma criação de conta a receber, lançamento financeiro ou venda na primeira versão;
- em revisão emitida, condições e parcelas são imutáveis.

## Estados

Modelo conceitual do destino:

| Estado | Uso |
|---|---|
| `draft` | edição livre; PDF apenas como prévia não oficial |
| `sent` | revisão emitida e congelada |
| `negotiation` | negociação sem reescrever conteúdo; mudança material cria revisão |
| `approved` | aceitação comercial, sem efeito operacional inicial |
| `refused` | recusado pelo Cliente |
| `expired` | validade encerrada |
| `cancelled` | cancelamento preservando histórico |

Mapeamento histórico: rascunho→draft, enviado→sent, aprovado→approved, rejeitado→refused. O efeito do ERP que cria venda, reserva, Produção e Entrega ao aprovar **não será transportado**.

## Emissão, edição e revisão

- enquanto `draft`, cabeçalho/itens podem mudar;
- ao emitir/enviar, consolidar snapshots, totals e versão técnica;
- revisão emitida não é editada;
- alteração posterior cria nova revisão ligada ao mesmo número-base;
- clonar Orçamento é operação distinta de criar revisão e deve ser auditada;
- nova revisão resolve explicitamente qual versão de Catálogo usar; não troca silenciosamente pela ativa.

## Catálogo por item

- checkbox disponível apenas para Produto elegível;
- ao marcar, gravar a versão exata;
- item sem Catálogo mantém `include_catalog=false` e FK nula;
- produto repetido no Orçamento gera uma única ficha no PDF por Produto **somente se as versões forem iguais**;
- se itens do mesmo Produto referirem versões diferentes, não escolher “o primeiro”: bloquear inconsistência ou renderizar cada versão de forma determinística.

## Permissões futuras

Seguindo a convenção real de códigos `dominio.acao` do OliMen:

- `commercial_quotes.view`;
- `commercial_quotes.create`;
- `commercial_quotes.edit`;
- `commercial_quotes.delete` (na prática cancelar/arquivar emitidos);
- `commercial_quotes.pdf`.

O frontend usa Permissões para visibilidade, mas a autorização obrigatória permanece no backend.

## Auditoria

Registrar em `audit_logs`: criação, edição de rascunho, emissão, nova revisão, clonagem, mudança de data comercial, mudança de estado, cancelamento e geração/download do PDF oficial. O evento deve guardar IDs, revisão e metadados não sensíveis.

## Orçamentos históricos do ERP

Classificação: **opcional/condicionada**, não necessária para o primeiro go-live e não recomendada de forma cega.

Limitações:

- Cliente só tem nome congelado; demais dados vêm do cadastro atual;
- item não guarda código nem unidade;
- o “código” impresso pode ser `produto_id`;
- versões e arquivos precisam existir antes;
- aprovações antigas têm efeitos operacionais que não serão recriados;
- o PDF não era persistido como documento imutável.

Se o negócio exigir histórico, importar após Clientes, Produtos e Catálogo, registrar `data_extraction`, proveniência e limitações, gerar snapshot explícito dos valores disponíveis e, quando aprovado juridicamente, arquivar o PDF migrado com hash. Não apresentar dados reconstruídos como se fossem o conteúdo original da data.
