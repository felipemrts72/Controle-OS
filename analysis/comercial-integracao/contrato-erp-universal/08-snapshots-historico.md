# 08 — Snapshots e preservação histórica

## Princípio

FK responde **qual cadastro originou o documento**. Snapshot responde **o que foi acordado/exibido naquela emissão**. O Orçamento precisa dos dois.

Produto, Cliente e Empresa podem mudar ou ficar inativos; uma revisão emitida e seu PDF não podem mudar por isso.

## Momento de congelamento

- `draft`: usa dados editáveis e pode gerar prévia não oficial;
- transição para `sent`/emitido: valida, calcula, captura snapshots, sela versão técnica e gera o PDF oficial;
- após emissão: conteúdo e snapshots imutáveis;
- negociação sem mudança de conteúdo altera apenas estado/auditoria;
- mudança material cria nova revisão e novos snapshots.

## Matriz FK × snapshot

| Informação | FK viva | Snapshot | Motivo |
|---|:---:|:---:|---|
| Cliente | `customer_id` | sim, completo | Rastreabilidade + documento imutável |
| Produto do item | `product_id` | sim, por item | Métricas/integração + texto/preço históricos |
| Catálogo | via Produto/Catálogo | não suficiente | Cadastro pode evoluir |
| Versão técnica | `product_catalog_version_id` | conteúdo versionado imutável | A própria versão é o snapshot técnico |
| Empresa | referência singleton opcional | sim | Dados oficiais mudam ao longo do tempo |
| Usuário criador/emissor | FKs | nome/cargo somente se exibidos | Auditoria e apresentação |
| Formas/parcelas | relação com revisão | linhas imutáveis | Condições negociadas |
| PDF | relação `commercial_quote_documents` | arquivo + hash | Preserva layout e bytes emitidos |

## Snapshot de Cliente

Campos mínimos na emissão:

- ID local como referência;
- nome/razão social;
- nome fantasia;
- CPF/CNPJ;
- telefone;
- e-mail;
- endereço/logradouro;
- número;
- complemento;
- bairro;
- cidade;
- UF;
- CEP.

O ERP só congelava `cliente_nome`; na migração histórica, os demais valores eventualmente obtidos do Cliente atual devem ser marcados como **reconstruídos na data da extração**, não como verdade da data original.

## Snapshot de Produto/item

Por item:

- `product_id`;
- código mostrado;
- nome mostrado;
- descrição comercial;
- unidade;
- quantidade;
- preço unitário;
- desconto unitário absoluto;
- desconto percentual;
- subtotal bruto;
- desconto calculado;
- total líquido;
- ordem;
- decisão de incluir Catálogo;
- ID exato da versão técnica.

Mesmo que a descrição venha do Catálogo ou de `products`, o item persiste o texto final. Preço do mestre é apenas sugestão; `unit_price` do item é a verdade do Orçamento.

Para histórico ERP, código/unidade não estavam congelados. A importação deve usar valores disponíveis no momento da extração e registrar a origem/reconstrução; não inventar campos silenciosamente.

## Snapshot da Empresa

Usar JSONB com `schema_version`, contendo os campos efetivamente apresentados, referências/hashes da logo e assinatura e opções do documento. `company_settings` continua sendo o cadastro oficial para novas emissões, mas não é consultada para reemitir uma revisão já selada.

## Snapshot técnico

O Catálogo não deve ser duplicado dentro de cada Orçamento. A versão técnica imutável já é um snapshot normalizado. A FK restritiva impede exclusão e o selo de publicação/uso impede edição.

O PDF pode registrar também hash lógico do conteúdo da versão, útil para validar integridade entre banco, mídia e documento.

## Condições comerciais

Congelar:

- data comercial;
- status no evento de emissão e histórico de transições;
- observações/validade, se adotada;
- desconto geral;
- formas de pagamento, valores, parcelas e vencimentos;
- fórmula/versão de cálculo;
- totais bruto, descontos e líquido.

`created_at` é auditoria e não substitui `commercial_date`.

## PDF oficial

Dados congelados não bastam para manter o mesmo layout após evolução do renderer. Para documento oficial:

- gerar uma vez na emissão;
- armazenar em storage protegido;
- gravar SHA-256, MIME, bytes, renderer/schema version, data e usuário;
- download e impressão usam o mesmo arquivo;
- nunca sobrescrever o arquivo oficial;
- regeneração eventual cria nova representação auditada, sem apagar o original.

## Imutabilidade por estado/revisão

| Objeto | Pode editar? | Como alterar depois |
|---|---:|---|
| Orçamento draft | sim | editar a própria revisão |
| Orçamento emitido | não | criar nova revisão |
| estado pós-emissão | transição controlada | evento auditado |
| Catálogo draft | sim | editar/descartar com regras |
| Catálogo publicado | não | clonar nova versão |
| Catálogo usado | não | clonar nova versão |
| PDF oficial | não | nova revisão/representação |

## Exclusão e inativação

- Produto/Cliente usam inativação; histórico mantém FK e snapshots;
- Orçamento emitido é cancelado/arquivado, não apagado fisicamente;
- versão técnica referenciada não é excluída;
- Cliente eventualmente apagado fisicamente deixa FK nula somente se a política aceitar, mas snapshot permanece;
- rascunhos sem uso podem ter política de exclusão separada e auditada.

## Auditoria necessária

Eventos: criação, edição de draft, alteração de data comercial, emissão, nova revisão, clonagem, mudança de estado, cancelamento, criação/clonagem/publicação de Catálogo, ativação de versão, geração/download de PDF e decisões de matching/importação.

`audit_logs` é a base oficial. Se o negócio precisar de uma timeline consultável e transacional de estados, uma tabela específica pode ser adicionada sem substituir a auditoria.

