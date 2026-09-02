# 09 — Banco e migrations

## Banco

- PostgreSQL.
- Driver `pg`, sem ORM/query builder.
- Extensão `pgcrypto` para UUID/hash legado.
- Schema público implícito.
- FKs, checks, índices e transações são usados extensivamente.
- Auditoria genérica em `audit_logs` com `previous_value`/`new_value` JSONB.

## Fontes de schema

- `database/schema.sql`: snapshot consolidado disponível.
- `database/migrations/*.sql`: evolução incremental.

Os arquivos não são equivalentes. O README declara divergências conhecidas, inclusive tipos de Produto e Permissões. Este levantamento considera o `schema.sql` base e aplica conceitualmente todas as migrations em ordem de nome; não valida o banco vivo.

## Runner

Arquivo: `scripts/migrate.js`.

- Carrega `.env` da raiz.
- Lê somente `.sql` em `database/migrations`.
- Ordena lexicograficamente com locale `en`.
- Calcula SHA-256 do conteúdo.
- Controla `filename`, `checksum`, `applied_at` em `schema_migrations`.
- Classifica como aplicada, pendente ou alterada.
- Recusa aplicar se uma migration já aplicada mudou de checksum.
- Usa `pg_advisory_lock(hashtext('olimen_gestao_migrations'))`.
- Aplica cada migration pendente em transação própria e grava checksum na mesma transação.
- Faz rollback da migration que falhar e para o processo.
- `repair` só reconcilia checksum de migrations explicitamente suportadas após validar o estado do banco.

## Comandos existentes

- `npm run migrate` → `node scripts/migrate.js up`.
- `npm run migrate:status` → somente status.
- `npm run migrate:repair -- <arquivo.sql>` → reparo controlado.

Nenhum desses comandos foi executado neste mapeamento.

## Nomes e ordem

Os nomes seguem majoritariamente `YYYYMMDD_descricao.sql`. Há sufixos `z_` para forçar ordem no mesmo dia. Isso funciona porque a ordenação é lexicográfica, mas datas repetidas sem sequência explícita merecem atenção.

## Idempotência

É heterogênea:

- algumas migrations usam `IF NOT EXISTS`, blocos `DO` e `ON CONFLICT`;
- outras criam tabelas/índices sem `IF NOT EXISTS` ou adicionam constraints diretamente;
- o runner garante execução única por filename/checksum, então idempotência SQL completa não é requisito efetivo;
- várias migrations contêm `BEGIN/COMMIT` próprios, enquanto o runner também abre uma transação. PostgreSQL aceita o fluxo com avisos/semântica de transação já ativa, mas o padrão é inconsistente e deve ser uniformizado futuramente.

## Modelo de Produto relevante

As migrations adicionaram em momentos diferentes:

- tipos dinâmicos e roteiro;
- `internal_code` único case-insensitive;
- catálogo de unidades e estado/origem de revisão;
- uma foto cadastral por Produto.

Logo, uma migration futura do Comercial não deve redefinir `products`; deve adicionar relações e, somente se necessário, campos opcionais bem justificados.

## Tabelas futuras prováveis

Nomes são propostas, não implementação:

- `technical_catalogs` — identidade/estado atual por Produto;
- `technical_catalog_versions` — versões, status, datas, autor e snapshot base;
- `technical_catalog_version_images` — múltiplas imagens ordenadas;
- `technical_catalog_version_specifications` — especificações ordenadas/chave-valor;
- `technical_catalog_version_included_items` — itens inclusos;
- `commercial_quotes` — cabeçalho, Cliente, snapshots, status, validade, condições e totais;
- `commercial_quote_items` — Produto opcional/obrigatório conforme regra, snapshots, quantidade, unidade, preço e total;
- `commercial_quote_history` — transições/eventos/auditoria específica;
- `product_external_identifiers` — origem, chave externa, Produto interno, estado/confiança da equivalência e auditoria.

Possíveis tabelas condicionais:

- anexos/documentos técnicos, se não couberem nas imagens;
- arquivos de PDF gerado, apenas se houver requisito de persistir exatamente o binário emitido;
- assinaturas, se houver múltiplos responsáveis/versionamento.

## Tabelas a reutilizar

- `products`, `product_types`, `measurement_units`;
- `customers` (com evolução, não duplicação);
- `company_settings`;
- `users`, `roles`, `permissions`, `role_permissions`;
- `audit_logs`;
- `sectors` apenas onde a regra operacional realmente exigir.

## Integridade recomendada

- FKs para identidades internas e `ON DELETE` conservador.
- Soft delete/cancelamento para Orçamentos históricos.
- Unicidade de identificador externo por `(source_system, external_id)`.
- Unique parcial/constraint para uma versão publicada atual por Catálogo, se aplicável.
- Número de Orçamento único e gerado atomicamente.
- Checks de status, quantidade e valores não negativos/positivos.
- Snapshots `NOT NULL` no momento apropriado para documentos emitidos.
- Índices em status/data/Cliente/Produto e FKs.
- Timestamps preferencialmente `TIMESTAMPTZ` de forma consistente.
