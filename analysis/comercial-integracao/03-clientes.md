# 03 — Clientes

## Estado atual

Tabela oficial: `customers`. Não há página, menu ou CRUD autônomo de Clientes. O cadastro foi derivado de Ordens de Produção históricas e é criado/atualizado automaticamente em `upsertCustomerForOrder()` durante o fluxo de OS.

| Campo | Tipo | Obrigatório/nulo/default | Uso atual |
|---|---|---|---|
| `id` | UUID | PK, default `gen_random_uuid()` | Identidade oficial |
| `name` | VARCHAR | `NOT NULL` quando os dados permitem | Nome do cliente |
| `normalized_name` | VARCHAR | `NOT NULL` quando os dados permitem; único | Deduplicação/busca por nome normalizado |
| `phone` | VARCHAR | opcional | Telefone |
| `location` | VARCHAR | opcional | Cidade/localidade em texto livre |
| `carrier_name` | VARCHAR | opcional | Transportadora preferencial observada em OS |
| `destination_uf` | VARCHAR(2) | opcional | UF de destino |
| `created_at` | TIMESTAMP | default `NOW()` | Auditoria temporal |
| `updated_at` | TIMESTAMP | default `NOW()` | Auditoria temporal |

Campos solicitados que **não existem**: razão social separada, nome fantasia separado, CPF/CNPJ, e-mail, logradouro, número, complemento, bairro, cidade estruturada, CEP, observações, ativo/inativo e tipo pessoa.

## Busca e autocomplete

- Endpoint: `GET /api/internal-orders/customers?q=<termo>`.
- Permissão: `orders.view`.
- Implementação: `internalOrderController.listCustomers` → `orderService.searchCustomers`.
- Requer pelo menos 2 caracteres normalizados.
- Busca `normalized_name LIKE %termo%`, prioriza igualdade e limita a 8 resultados.
- Componente: autocomplete embutido em `InternalOrderForm`; debounce de 250 ms.
- Resultado: `id`, `name`, `phone`, `location`, `carrier_name`, `destination_uf`.

Não é um componente genérico reutilizável; está acoplado ao formulário de OS e à permissão de OS. Comercial precisará de endpoint/permissão e componente adequados, ainda reutilizando a mesma tabela.

## Criação, atualização e duplicidade

- O nome é normalizado com trim, colapso de espaços e lowercase.
- Há índice único em `normalized_name`.
- Antes do upsert, o serviço procura nomes “muito similares” removendo acentos/não alfanuméricos e aceitando prefixo quando ambos têm ao menos cinco caracteres.
- Se encontra similar, atualiza o cadastro existente.
- Campos vazios de OS não apagam valores existentes por causa de `COALESCE`.
- Alterar o nome de um cliente selecionado pode fundi-lo a outro registro com o mesmo nome normalizado.

Riscos: homônimos são fundidos; razão social/nome fantasia não são distinguíveis; não há documento fiscal como chave; o mecanismo de prefixo pode causar falso positivo; não há auditoria específica de Cliente.

## Permissões

Não existem permissões de Cliente (`customers.*`). O único acesso é indireto por `orders.view`, e a escrita ocorre como efeito colateral de criar/editar OS. Para o Comercial, serão necessárias permissões próprias ou uma política explícita que separe “buscar cliente” de “gerenciar cliente”.

## Histórico já preservado em Ordens de Produção

`internal_orders` guarda simultaneamente:

- `customer_id` (referência atual);
- `customer_name` (snapshot);
- `customer_phone` (snapshot);
- `carrier_name`, `destination_city`, `destination_uf` (dados da entrega daquela ordem).

Esse padrão evita que nome/telefone históricos dependam exclusivamente do cadastro vivo, embora o snapshot atual seja parcial.

## Decisão arquitetural futura: snapshot no Orçamento

O Orçamento deve guardar a FK e um snapshot imutável no cabeçalho. Mínimo recomendado no momento da primeira emissão/aceite, conforme a regra de negócio:

- `customer_id`;
- nome exibido;
- razão social/nome fantasia, quando existirem;
- CPF/CNPJ;
- telefone;
- e-mail;
- endereço completo estruturado e/ou uma representação pronta para impressão;
- cidade, UF e CEP;
- contato/responsável;
- observações comerciais relevantes.

O PDF deve ler o snapshot do Orçamento, nunca consultar `customers` para substituir valores históricos. A FK continua útil para navegar pelo relacionamento e montar histórico atual do Cliente.

Recomendação de modelagem: colunas snapshot explícitas para os campos usados em filtro/relatório e, opcionalmente, um JSONB de snapshot integral para rastreabilidade. JSONB sozinho dificulta constraints e consultas; colunas sozinhas tornam evolução mais trabalhosa. A decisão final deve definir o instante de congelamento (criação, envio, revisão ou aceite) e se uma nova emissão cria revisão do Orçamento.

## Preparação necessária antes do Comercial

1. Definir o cadastro oficial desejado e enriquecer `customers`, sem duplicá-lo.
2. Criar CRUD/página ou ao menos APIs próprias de consulta e manutenção.
3. Definir deduplicação por documento fiscal e tratamento de homônimos.
4. Criar permissões `customers.view/manage` se o escopo exigir.
5. Extrair autocomplete reutilizável.
6. Preservar compatibilidade com OS legadas e campos nulos.
