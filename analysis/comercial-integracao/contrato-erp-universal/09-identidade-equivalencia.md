# 09 — Identidade externa, equivalência e deduplicação

## IDs não são transportados como PK

O ERP usa inteiros seriais; o OliMen usa UUIDs. Toda migração mantém mapas:

```text
erp_universal:produtos.id  → products.id
erp_universal:clientes.id  → customers.id
erp_universal:catalogo...  → product_catalog...id
erp_universal:orcamentos.id → commercial_quotes.id (se histórico)
```

Preservar o número em uma coluna de exibição ou metadata não equivale a preservar a PK.

## Tabelas dedicadas para mestres

### `product_external_ids`

| Campo conceitual | Regra |
|---|---|
| `id` | UUID PK |
| `product_id` | FK `products`, não nula |
| `source_system` | `erp_universal` |
| `source_id` | ID estável da origem, armazenado sem ambiguidade |
| `source_code` | SKU/código legível da origem, nullable |
| `match_status` | confirmed/pending/rejected, conforme workflow |
| `matched_by`, `matched_at` | auditoria da decisão |
| `imported_at`, `last_seen_at` | rastreabilidade |
| `source_payload_hash` | detecção de mudança/reexecução, opcional |

Unicidade: `(source_system, source_id)`. Índice em `(source_system, source_code)` para busca; unicidade de `source_code` só se a fonte garantir valores não nulos exclusivos.

### `customer_external_ids`

Mesma estrutura, apontando `customer_id`. Na origem atual não há código alternativo de Cliente; `source_code` pode ficar nulo. Unicidade principal também é `(source_system, source_id)`.

## Por que `creation_origin` não resolve

O campo de Produto aceita `manual`/`purchases` e descreve como o registro nasceu no OliMen. Um Produto manual pode depois ser conciliado com o ERP e um Produto pode ter várias identidades externas. Alterar o enum para `erp_universal` não preservaria ID, código, revisão nem múltiplas fontes.

## Identidade das demais entidades

Catálogos, versões e Orçamentos históricos também precisam de idempotência. Há duas opções coerentes:

1. campos opcionais `source_system`/`source_id` nas novas tabelas que só pertencem ao novo domínio; ou
2. `integration_import_runs` + `integration_import_records`, com tipo de entidade, ID externo, ID local e hash.

Recomendação: tabelas dedicadas para Produto/Cliente, pois participam de matching contínuo; ledger genérico para Catálogo/Orçamento/lotes. Constraints específicas (catálogo único por Produto, versão única por número, Orçamento externo único) continuam no domínio.

## Algoritmo de Produto

### Geração de candidatos

- vínculo externo existente;
- `source_code`/SKU e `internal_code` no namespace correto;
- nome sem acento/case/espaços/pontuação irrelevante;
- tipo convertido;
- unidade convertida;
- descrição normalizada;
- sinais secundários: preço, Catálogo, uso histórico.

### Pontuação/classificação

- **certa**: vínculo externo confirmado; ou regra de chave empresarial aprovada sem divergência;
- **provável**: vários sinais fortes compatíveis;
- **dúvida**: sinais insuficientes/conflitantes;
- **novo**: nenhum candidato ou rejeição manual.

Somente “certa” por chave previamente confirmada pode ser automática. “Provável” e “dúvida” exigem revisão. Nome isolado nunca é suficiente.

## Algoritmo de Cliente

Prioridades:

1. vínculo externo;
2. CPF/CNPJ normalizado válido;
3. telefone normalizado + nome/cidade;
4. nome normalizado + cidade/UF + e-mail/telefone;
5. revisão humana.

Documento ausente/inválido e telefone compartilhado devem reduzir confiança. Não unir homônimos por `normalized_name`.

## Política de conflito

Para qualquer divergência:

- não sobrescrever;
- mostrar lado ERP e OliMen campo a campo;
- permitir “vincular preservando local”, “preencher lacunas aprovadas”, “criar novo” ou “rejeitar candidato”;
- registrar decisão, usuário e data;
- uma rejeição deve evitar que o mesmo falso candidato reapareça indefinidamente.

## Código de Produto conflitante

O namespace do ERP é diferente do código local. Se ambos possuem 117:

1. procurar vínculo externo;
2. comparar candidatos sem assumir igualdade;
3. se iguais e confirmados, manter `internal_code` OliMen e guardar 117 como `source_code`;
4. se diferentes, criar novo Produto com outro código local/nulo e manter 117 apenas na origem;
5. registrar conflito;
6. jamais alterar código local existente automaticamente.

Antes da importação real, definir geração de código OliMen (manual, sequência ou prefixo). O banco atual não possui sequência de código de Produto.

## Alterações da origem após importação

Reexecução calcula hash e diferenças. Regra padrão:

- identidade externa já vinculada encontra o mesmo local;
- mudanças da fonte não sobrescrevem dados mestres locais automaticamente;
- campos explicitamente governados pela origem podem ser atualizados apenas se o contrato de autoridade disser isso;
- diferenças viram relatório/patch proposto;
- Catálogo ainda não publicado pode ser atualizado conforme regra; versão publicada gera nova versão, nunca edição.

## Importação reexecutável

Cada operação deve ser `upsert` por identidade externa, não por nome. O lote registra estado `planned/applied/failed/skipped/conflict`, hash e mensagem. Reexecutar o mesmo lote/dados produz zero duplicações e aponta o mesmo UUID.

## Revisão humana e separação de funções

- analista revisa candidatos;
- usuário autorizado confirma vínculo/criação;
- importador aplica decisões congeladas;
- auditoria registra todos os passos;
- dry run nunca cria vínculo definitivo.

Decisões podem ser exportadas/importadas como arquivo de manifesto no futuro, mas esse arquivo não substitui constraints do banco.

