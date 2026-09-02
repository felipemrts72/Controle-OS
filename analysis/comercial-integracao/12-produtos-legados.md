# 12 — Produtos legados, importados e identidade de origem

## O que o modelo aceita hoje

### Aceita

- Produto ativo sem foto (`product_images` é opcional).
- Produto ativo sem catálogo/especificações/itens inclusos, pois essas estruturas não existem.
- `internal_code` nulo.
- `measurement_unit_code` nulo no banco.
- `sector_id` nulo no banco e registros legados podem aparecer no filtro “Sem setor”.
- Produto preliminar ativo com `pending_review`.
- Nome duplicado.
- Tipo criado dinamicamente, desde que o fluxo de gravação o valide em `product_types`.

### Não aceita ou bloqueia no fluxo regular

- Nome nulo.
- Tipo nulo.
- volumes nulos, zero ou negativos.
- peso nulo, zero ou negativo.
- cadastro regular sem setor ativo.
- cadastro regular sem unidade válida.
- Revenda nova com roteiro.

Não existe campo descrição; portanto “descrição vazia” não é representável como vazio versus ausente — é simplesmente uma lacuna de schema.

## Produto preliminar existente

Compras já cria Produto ativo com:

- `type = resale`;
- setor Expedição;
- 1 volume;
- 1 kg;
- unidade nula;
- `review_status = pending_review`;
- `creation_origin = purchases`;
- usuário/data preliminar.

Isso prova a capacidade de enriquecimento progressivo, mas os valores de tipo/setor/volume/peso são **defaults técnicos**, não dados confiáveis. Eles não podem ser tratados como verdade durante importação ou Orçamento sem revisão.

## Definições conceituais recomendadas

| Conceito | Tratamento recomendado |
|---|---|
| Produto completo | Cadastro operacional aprovado + requisitos do contexto atendidos; completude pode ser derivada |
| Produto legado | Produto preexistente com lacunas; não precisa de status exclusivo se continuar operacional |
| Produto importado | Produto com identificador externo registrado; origem deve ser explícita e auditável |
| Produto sem Catálogo Técnico | Ausência de catálogo publicado; relação opcional é suficiente |
| Produto sem preço | Ausência de preço comercial; não tornar Produto inativo por isso |

Evitar multiplicar estados na tabela `products`. Estado cadastral (`review_status`), origem, atividade, completude técnica e disponibilidade comercial são dimensões diferentes. Uma única enumeração “completo/legado/importado/sem catálogo/sem preço” produziria combinações impossíveis de representar.

## Estratégia preliminar

1. Manter todos os Produtos existentes e seus UUIDs.
2. Acrescentar campos comerciais/técnicos como opcionais ou em relações opcionais.
3. Derivar indicadores de pendência por contexto (cadastro, Catálogo, Comercial), em vez de bloquear o Produto inteiro.
4. Permitir Orçamento com Produto legado quando a regra comercial aceitar, preservando snapshots do que foi emitido.
5. Exigir revisão humana antes de consolidar Produto importado ou equivalência incerta.
6. Nunca sobrescrever automaticamente nome, tipo, setor, volume, peso, unidade ou foto de Produto existente.
7. Enriquecer em etapas, com auditoria.

## Origem: avaliação do campo atual

`creation_origin` não é suficiente para origem externa:

- check aceita apenas `manual` e `purchases`;
- descreve **como o registro nasceu dentro do OliMen**, não qual sistema o identificava;
- um Produto manual pode depois ser vinculado ao ERP Universal;
- um Produto pode ter vários identificadores externos;
- guardar apenas origem no Produto não guarda a chave externa nem histórico de equivalência.

Não estender simplesmente o check para `erp_universal` como solução única.

## Abordagem mais segura: tabela de identificadores/equivalência

Conceito futuro:

| Campo conceitual | Finalidade |
|---|---|
| `id` | identidade da equivalência |
| `product_id` | FK ao Produto OliMen |
| `source_system` | por exemplo, `erp_universal` |
| `external_id` | chave estável externa, preferida ao código exibido |
| `external_code` | código legível externo, se distinto |
| `match_status` | confirmado/pendente/rejeitado, se necessário |
| `matched_by`, `matched_at` | revisão humana |
| `metadata` | contexto controlado, opcional |
| timestamps | auditoria |

Unicidade principal: `(source_system, external_id)`. Pode haver unicidade adicional de código por origem se a fonte garantir isso. Um Produto OliMen pode ter zero ou vários identificadores externos.

## Deduplicação futura

Ordem de decisão recomendada:

1. Equivalência explícita já confirmada por sistema + ID externo.
2. Código interno local somente se a política disser que o valor é realmente compartilhado.
3. Candidatos por código externo, nome normalizado, tipo, unidade e outros atributos.
4. Exibição de candidatos e diferenças ao usuário.
5. Confirmação de vínculo ou criação de novo Produto.
6. Nunca atualizar automaticamente Produto existente durante matching.

Nome sozinho não é chave. O algoritmo atual de Compras é adequado para **sugestão**, não para decisão automática entre ERPs.

## Códigos conflitantes: 117 × 117

`internal_code` tem unique case-insensitive. Se OliMen já possui código `117`, inserir outro Produto como `117` falha. A futura importação deve:

- verificar primeiro se há equivalência confirmada;
- mostrar Produto OliMen 117 como candidato, sem assumir igualdade;
- se forem diferentes, manter 117 apenas como `external_code` de `erp_universal`;
- atribuir ao novo Produto um código interno segundo política OliMen (sequência/prefixo/manual);
- não mudar o código do Produto OliMen existente silenciosamente.

Hoje não existe sequência/counter para Produtos. O código é opcional e inserido manualmente no fluxo preliminar de Compras. Uma política de códigos deve ser definida antes da importação.

## Estratégia pedida: viabilidade

| Objetivo | Viável? | Condição |
|---|:---:|---|
| Manter Produtos OliMen | Sim | Não recriar nem alterar UUIDs |
| Importar exclusivos | Sim | Gerar/definir dados mínimos e registrar origem |
| Detectar equivalentes | Parcial | Sugestão já existe; falta equivalência externa persistida |
| Não sobrescrever | Sim | Import em duas etapas e revisão humana |
| Marcar origem | Parcial | `creation_origin` é insuficiente; usar tabela externa |
| Permitir incompleto | Sim | Usar pendência e relações opcionais; tratar defaults artificiais |
| Complementar depois | Sim | Edição/auditoria já existem; ampliar campos/relações |
