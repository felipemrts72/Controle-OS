# 02 — Produtos: mestre, campos e conciliação

## Decisão

`products` permanece o único cadastro mestre. O Comercial consulta essa tabela e suas extensões; Catálogo se relaciona a ela. Não haverá tabela de “produtos comerciais” paralela.

## Comparação integral dos campos reais

| ERP `produtos` | Tipo/regra da origem | OliMen atual | Compatibilidade | Contrato |
|---|---|---|---|---|
| `id` | `SERIAL PK` | `products.id UUID` | Nenhuma | Novo UUID ou UUID já conciliado; guardar em `product_external_ids` |
| `nome` | `TEXT NOT NULL` | `name VARCHAR NOT NULL` | Exata com normalização | Não atualizar Produto local sem confirmação |
| `descricao` | `TEXT NULL` | ausente | Lacuna | Criar `products.description TEXT NULL` como descrição geral |
| `sku` | `VARCHAR(50) NULL UNIQUE` | `internal_code VARCHAR(80) NULL`, unique por `lower` | Aproximada | SKU é código da origem; só vira código local por decisão de matching |
| `tipo` | enum obrigatório | `type VARCHAR NOT NULL`, catálogo `product_types` lógico | Aproximada | Mapear por tabela abaixo |
| `estoque_minimo` | `NUMERIC(12,2) DEFAULT 0` | ausente | Fora do escopo | Não transportar no Comercial |
| `custo` | `NUMERIC(12,2) DEFAULT 0` | ausente | Fora do escopo | Não transportar |
| `preco_venda` | `NUMERIC(12,2) NULL` | ausente | Lacuna comercial | `product_commercial_profiles.reference_sale_price`; item sempre congela preço |
| `unidade_medida` | `VARCHAR(10) NULL DEFAULT UN` | `measurement_unit_code VARCHAR(20) NULL FK` | Boa após conversão | Canonicalizar e validar código |
| `ultimo_preco_compra` | `NUMERIC(12,2) NULL` | Compras tem domínio próprio | Não equivalente | Não transportar |
| `status` | ativo/inativo | `is_active BOOLEAN` | Exata por conversão | ativo→true; inativo→false |
| `criado_em` | timestamp | `created_at` | Semântica diferente ao importar | Registrar importação; preservar data fonte em proveniência se exigido |
| ausência | — | `sector_id UUID NULL` | Destino exclusivo | Manter valor local; não inventar na importação |
| ausência | — | `default_volume_quantity INTEGER NOT NULL > 0` | Bloqueador para novo importado | Não usar default artificial como verdade |
| ausência | — | `default_total_weight_kg NUMERIC NOT NULL > 0` | Bloqueador para novo importado | Não usar `1 kg` como verdade |
| ausência | — | `review_status` pending/approved | Destino exclusivo | Novo importado incompleto fica pendente |
| ausência | — | `creation_origin` manual/purchases | Destino exclusivo | Manter; não representa identidade externa |
| ausência | — | campos de revisão por usuário/data | Destino exclusivo | Preencher apenas pelo workflow de revisão |

O ERP não tem colunas separadas de foto, origem, revisão, peso, volume ou setor em `produtos`. Foto técnica está nas versões do Catálogo; o OliMen tem uma foto simples opcional em `product_images`, que não substitui galeria versionada.

## Tipos

### Origem confirmada

`materia_prima`, `revenda`, `fabricado`, `conjunto`, `consumivel`.

### Destino confirmado

Tipos padrão: `manufactured`, `resale`, `material_prima`; o sistema permite tipos cadastrados dinamicamente. O comportamento, porém, não é apenas visual: `manufactured` participa de roteiros/Produção; `resale` não deve ter roteiro; `material_prima` aparece em usos específicos de materiais.

| ERP | OliMen candidato | Confiança | Regra |
|---|---|---:|---|
| `fabricado` | `manufactured` | alta | Correspondência semântica; não criar/alterar roteiro |
| `revenda` | `resale` | alta | Correspondência semântica |
| `materia_prima` | `material_prima` | alta | Correspondência semântica; sem trazer estoque/BOM |
| `conjunto` | novo tipo `conjunto` ou `manufactured` | baixa | Não colapsar automaticamente; revisão do comportamento operacional |
| `consumivel` | novo tipo `consumivel` ou material | baixa | Não colapsar automaticamente; revisão humana |

Mudança de tipo no OliMen é possível, exceto que a aplicação impede troca para `resale` quando existe roteiro. A importação nunca deve alterar o tipo de Produto equivalente sem revisão.

## Código, SKU e identidade

- `products.id` é identidade interna UUID.
- `produtos.id` é a chave técnica da origem e também aparece como “código” no PDF legado; isso não o transforma em código mestre.
- `produtos.sku` é o único identificador legível exclusivo na tabela fonte.
- `products.internal_code` é código local opcional e único case-insensitive.

Contrato:

1. guardar `produtos.id` em `product_external_ids.source_id`;
2. guardar `produtos.sku` em `source_code`;
3. preencher `internal_code` somente quando o Produto for novo, o código estiver livre e a política de códigos autorizar;
4. em Produto conciliado, preservar o código OliMen;
5. congelar no item o código efetivamente exibido na emissão.

### Colisão 117 × 117

Se ERP e OliMen possuem “117” e são Produtos diferentes:

- bloquear qualquer overwrite;
- manter 117 como `source_code` do vínculo ERP;
- gerar/atribuir outro `internal_code` local conforme política futura, ou mantê-lo nulo enquanto pendente;
- registrar conflito e decisão humana;
- nunca alterar silenciosamente o Produto OliMen 117.

## Deduplicação

### Classificação

| Classe | Critério mínimo | Ação |
|---|---|---|
| correspondência certa | vínculo externo já confirmado; ou SKU/código compartilhado validado + atributos compatíveis | Reutilizar `product_id`, sem sobrescrever |
| provável | código candidato e nome/tipo/unidade compatíveis | Revisão humana obrigatória |
| dúvida | apenas nome semelhante, descrições divergentes, tipo/unidade incompatíveis | Bloquear e relatar |
| novo Produto | nenhum candidato relevante ou rejeição explícita dos candidatos | Criar após política de campos mínimos |

### Sinais, em ordem

1. `(source_system, source_id)` já persistido;
2. SKU/código dentro do namespace correto;
3. nome normalizado;
4. tipo convertido;
5. unidade convertida;
6. descrição normalizada;
7. preço apenas como sinal fraco;
8. catálogo e referências históricas como contexto;
9. confirmação humana.

Nome exato, isoladamente, nunca une Produtos.

## Produto legado/incompleto

O modelo futuro deve aceitar Produto:

- sem Catálogo;
- sem descrição geral/comercial;
- sem foto;
- sem preço;
- sem especificações/ficha técnica.

Essas ausências não alteram `is_active`. Completude operacional, revisão cadastral, disponibilidade comercial, origem e Catálogo são dimensões separadas.

Os campos novos comerciais/técnicos devem ser nulos/opcionais. Os bloqueadores reais do destino para um Produto novo são `name`, `type`, `default_volume_quantity` e `default_total_weight_kg`; o fluxo regular também exige unidade e setor. Como volume/peso/setor não existem na fonte, o importador não pode inventar `1`, `1 kg` ou “Expedição”. Duas alternativas são admissíveis antes da implementação:

- permitir nulo enquanto `review_status=pending_review`, exigindo o dado somente nos fluxos operacionais; ou
- manter o registro em staging de importação e criar `products` apenas após revisão dos campos obrigatórios.

A primeira favorece enriquecimento progressivo, mas exige auditoria de todos os consumidores de volume/peso. A segunda preserva invariantes atuais, mas atrasa a disponibilidade do Produto. O contrato recomenda a primeira somente após prova de compatibilidade; até lá, staging/revisão é o comportamento seguro.

## Campos a adicionar: decisão por responsabilidade

| Informação | Local recomendado | Motivo |
|---|---|---|
| descrição geral | `products.description NULL` | Preserva `produtos.descricao` e pode servir vários módulos |
| descrição comercial/técnica | versão do Catálogo; perfil só se surgir descrição comercial não versionada | Não é dado operacional |
| preço de referência | `product_commercial_profiles.reference_sale_price NULL` | Preço é comercial, opcional e não substitui snapshot |
| moeda/vigência do preço | perfil/tabela comercial futura | Não existe na origem; evitar número sem contexto |
| SKU/código externo | `product_external_ids.source_code` | Namespace e proveniência |
| origem | tabela externa | `creation_origin` não comporta múltiplas fontes/IDs |
| NCM | extensão fiscal futura | Ausente nos dois modelos analisados |
| imagens/especificações | Catálogo versionado | Precisam de história e imutabilidade |

## Relações OliMen que devem continuar intactas

- `product_images`: foto simples opcional, sem convertê-la em galeria técnica;
- `product_components`/roteiros/tarefas: Produção, não Catálogo;
- itens vendidos e Ordens: snapshots/relacionamentos existentes;
- unidade/setor/volume/peso: usos operacionais locais;
- compras preliminares: fluxo atual, sem reutilizar seus defaults artificiais para importação.

O Comercial inicial apenas lê o Produto e grava FK/snapshots. Não reserva, movimenta, fabrica, compra ou expede.
