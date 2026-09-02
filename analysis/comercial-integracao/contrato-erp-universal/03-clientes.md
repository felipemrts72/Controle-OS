# 03 — Clientes: migração para o cadastro mestre OliMen

## Decisão final

Clientes do ERP Universal serão migrados. `customers` será evoluída e continuará como o único cadastro mestre. A estrutura atual não atende o Comercial, mas é reaproveitável após retirar a identidade por nome e adicionar dados estruturados.

## Schema real da origem

`clientes` contém:

- `id SERIAL PK`;
- `nome VARCHAR(120) NOT NULL`;
- `nome_fantasia VARCHAR(120) NULL`;
- `cpf_cnpj VARCHAR(20) NULL`;
- `telefone VARCHAR(20) NULL`;
- `email VARCHAR(120) NULL`;
- `endereco TEXT NULL`;
- `numero VARCHAR(20) NULL`;
- `bairro VARCHAR(120) NULL`;
- `cidade VARCHAR(120) NULL`;
- `cep VARCHAR(20) NULL`;
- `observacoes TEXT NULL`;
- `status VARCHAR(20) NOT NULL DEFAULT 'ativo'`, check ativo/inativo;
- `criado_em TIMESTAMP DEFAULT NOW()`.

Não existem na tabela fonte campos de UF, complemento, tipo de pessoa, transportadora ou “localidade” separados. Transportadoras existem em outro cadastro e não há FK dela em `clientes`.

## Schema real do destino atual

`customers` contém `id UUID`, `name`, `normalized_name UNIQUE`, `phone`, `location`, `carrier_name`, `destination_uf`, `created_at` e `updated_at`.

Ela é mantida indiretamente pelo fluxo de Ordens de Serviço. Não há CRUD/página própria. O upsert atual usa conflito em `normalized_name`, e o autocomplete `/api/internal-orders/customers` é protegido por `orders.view`. Esses comportamentos são insuficientes para o cadastro mestre do Comercial.

## Matriz campo a campo

| ERP `clientes` | `customers` futuro | Obrigatoriedade futura | Escopo | Transformação/decisão |
|---|---|---|---|---|
| `id` | `customer_external_ids.source_id` | obrigatório no vínculo importado | integração | Novo UUID local; ID ERP não é preservado como PK |
| `nome` | `name` | obrigatório | geral | Razão/nome oficial; trim sem perder grafia |
| `nome_fantasia` | `trade_name` | opcional | geral/comercial | Novo campo |
| `cpf_cnpj` | `tax_id` | opcional; recomendado | geral/fiscal/comercial | Preservar exibição, normalizar dígitos para matching e validar |
| implícito no documento | `person_type` | opcional | geral/fiscal | Inferir somente de documento válido; caso contrário nulo |
| `telefone` | `phone` | opcional | geral | Normalizar para comparação sem destruir valor de exibição |
| `email` | `email` | opcional | geral/comercial | Novo campo; trim/lower para busca |
| `endereco` | `address_line` | opcional | geral | Novo campo; não usar `location` |
| `numero` | `address_number` | opcional | geral | Novo campo texto |
| ausência | `address_complement` | opcional | geral | Novo campo nulo |
| `bairro` | `neighborhood` | opcional | geral | Novo campo |
| `cidade` | `city` | opcional | geral | Novo campo estruturado |
| ausência | `state` | opcional | geral | Novo campo; não reutilizar UF de entrega |
| `cep` | `postal_code` | opcional | geral | Novo campo |
| `observacoes` | `notes` | opcional | geral | Novo campo |
| `status` | `is_active` | obrigatório/default true | geral | ativo→true, inativo→false |
| `criado_em` | metadado da origem | opcional | integração/auditoria | Importação tem sua própria data; origem pode ir para metadata |
| ausência | `normalized_name` | derivado, obrigatório para pesquisa | geral | Remover `UNIQUE`; índice não único |
| ausência | `location` | manter legado | OS/entrega | Não sobrescrever automaticamente |
| ausência | `carrier_name` | manter legado | entrega | Não há equivalente na origem |
| ausência | `destination_uf` | manter legado | entrega | Não é UF cadastral |

## Campos faltantes em `customers`

### Gerais

- `trade_name`;
- `tax_id`;
- `email`;
- `address_line`;
- `address_number`;
- `address_complement`;
- `neighborhood`;
- `city`;
- `state`;
- `postal_code`;
- `notes`;
- `is_active`.

### Opcionais/condicionais

- `person_type`, se o cadastro precisar distinguir pessoa física/jurídica;
- representação separada de valor normalizado (`tax_id_normalized`, `phone_normalized`) ou índices por expressão;
- campos de inscrição estadual/municipal não existem na fonte e não são requisito desta migração.

Nenhum campo novo comercial deve ser obrigatório para manter clientes legados. Apenas `name` e a identidade local permanecem mínimos; documento, contato e endereço podem ser enriquecidos depois.

## Problema da unicidade por nome

`normalized_name UNIQUE` funde ou impede homônimos. O serviço atual também faz `INSERT ... ON CONFLICT (normalized_name) DO UPDATE`, o que pode alterar um Cliente incorreto.

Contrato futuro:

- retirar a unicidade do nome normalizado;
- manter índice de pesquisa por nome;
- alterar os fluxos de OS para trabalhar com `customer_id` quando o usuário escolhe um existente;
- criação implícita deve apresentar candidatos e não fundir homônimos;
- documento válido pode ter unicidade parcial controlada, considerando política para matriz/filial e registros duplicados legados.

## Identidade externa

`customer_external_ids` deve conter, conceitualmente:

- `id UUID`;
- `customer_id UUID FK customers`;
- `source_system` (`erp_universal`);
- `source_id` (ID estável da origem);
- `source_code` nulo por enquanto, pois a origem não possui outro código do Cliente;
- `imported_at`, `last_seen_at`;
- `match_status`, `matched_by`, `matched_at` para revisão;
- `source_payload_hash`/metadata controlada, se útil.

Unicidade obrigatória: `(source_system, source_id)`. Um Cliente local pode ter várias identidades externas.

## Deduplicação futura

### Ordem de decisão

1. vínculo externo já existente;
2. CPF/CNPJ normalizado, válido e não vazio;
3. telefone normalizado combinado com nome e cidade;
4. nome normalizado combinado com cidade/UF e outros contatos;
5. revisão humana.

### Resultado

| Classe | Exemplo | Ação |
|---|---|---|
| certa | mesmo vínculo externo ou mesmo documento válido sem divergência | Reutilizar Cliente, preservando campos locais |
| provável | telefone + nome + cidade compatíveis | Solicitar confirmação |
| dúvida | mesmo nome, documento ausente/divergente | Não unir; relatório |
| novo | sem candidato ou candidato rejeitado | Criar novo Cliente |

Nunca unir somente por nome. Telefones duplicados, documentos inválidos/ausentes e homônimos devem constar no relatório de conflitos.

## Regra de atualização

Ao conciliar com Cliente já existente:

- não sobrescrever automaticamente valores locais não vazios;
- apresentar diferenças campo a campo;
- permitir preencher lacunas aprovadas;
- registrar origem e usuário da decisão;
- status inativo na origem não deve inativar automaticamente Cliente OliMen que tenha uso local ativo.

## Consumo pelo Comercial

O módulo precisa de API/UX própria do cadastro mestre, com permissões de Clientes coerentes com o RBAC. O autocomplete atual de Ordens pode inspirar o comportamento, mas não deve ser reutilizado sob `orders.view` nem limitado aos campos de entrega.

No Orçamento:

- `customer_id` mantém a referência ao cadastro mestre;
- todos os dados exibidos/emitidos são congelados como snapshot;
- Cliente inativado continua acessível em Orçamentos históricos;
- alteração posterior do Cliente não altera PDF ou revisão emitida.

## Snapshot do Cliente

Congelar na emissão:

- `customer_id` (referência, não conteúdo histórico);
- `name`;
- `trade_name`;
- `tax_id`;
- `phone`;
- `email`;
- `address_line`;
- `address_number`;
- `address_complement`;
- `neighborhood`;
- `city`;
- `state`;
- `postal_code`.

`notes` só deve entrar no snapshot se fizer parte do documento/negociação. `carrier_name`, `location` e `destination_uf` entram apenas se o Orçamento realmente os apresentar; não devem ser congelados por acaso.

