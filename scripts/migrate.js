import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const envPath = path.join(projectRoot, '.env');
const migrationsDirectory = path.join(projectRoot, 'database', 'migrations');
const command = process.argv[2] || 'up';
const repairTarget = process.argv[3];
const migrationTable = 'schema_migrations';
const advisoryLockKey = 'olimen_gestao_migrations';

dotenv.config({ path: envPath });

function checksum(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function loadMigrations() {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));

  return Promise.all(filenames.map(async (filename) => {
    const sql = await fs.readFile(path.join(migrationsDirectory, filename), 'utf8');
    return { filename, sql, checksum: checksum(sql) };
  }));
}

async function migrationTableExists(client) {
  const result = await client.query("SELECT to_regclass('public.schema_migrations') AS table_name");
  return Boolean(result.rows[0]?.table_name);
}

async function loadAppliedMigrations(client) {
  if (!(await migrationTableExists(client))) return new Map();
  const result = await client.query(
    `SELECT filename, checksum, applied_at
     FROM ${migrationTable}
     ORDER BY filename`,
  );
  return new Map(result.rows.map((row) => [row.filename, row]));
}

function classifyMigrations(migrations, applied) {
  return migrations.map((migration) => {
    const record = applied.get(migration.filename);
    if (!record) return { ...migration, status: 'pending', appliedAt: null };
    if (record.checksum !== migration.checksum) return { ...migration, status: 'changed', appliedAt: record.applied_at };
    return { ...migration, status: 'applied', appliedAt: record.applied_at };
  });
}

async function showStatus(client, migrations) {
  const applied = await loadAppliedMigrations(client);
  const classified = classifyMigrations(migrations, applied);
  if (!classified.length) {
    console.log('Nenhuma migration SQL foi encontrada.');
    return;
  }

  console.log('Status das migrations:');
  for (const migration of classified) {
    const marker = migration.status === 'applied' ? '[aplicada]' : migration.status === 'changed' ? '[alterada]' : '[pendente]';
    console.log(`${marker} ${migration.filename}`);
  }

  const pending = classified.filter((migration) => migration.status === 'pending').length;
  const changed = classified.filter((migration) => migration.status === 'changed').length;
  console.log(`Resumo: ${classified.length - pending - changed} aplicada(s), ${pending} pendente(s), ${changed} alterada(s).`);
  if (changed) process.exitCode = 1;
}

async function ensureMigrationTable(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${migrationTable} (
      filename TEXT PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );
}

async function assertRequiredTables(client, tableNames) {
  const result = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    [tableNames],
  );
  const actual = new Set(result.rows.map((row) => row.tablename));
  return tableNames.every((tableName) => actual.has(tableName));
}

async function assertRequiredColumns(client, expectedColumns) {
  const tableNames = Object.keys(expectedColumns);
  const result = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [tableNames],
  );
  const actual = new Map();
  for (const row of result.rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }
  return Object.entries(expectedColumns).every(([tableName, columnNames]) => (
    columnNames.every((columnName) => actual.get(tableName)?.has(columnName))
  ));
}

async function assertRequiredDatabaseObjects(client, { indexes = [], constraints = [] }) {
  const [indexResult, constraintResult] = await Promise.all([
    client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`, [indexes]),
    client.query(
      `SELECT c.conname
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public' AND c.conname = ANY($1::text[])`,
      [constraints],
    ),
  ]);
  const actualIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const actualConstraints = new Set(constraintResult.rows.map((row) => row.conname));
  return indexes.every((name) => actualIndexes.has(name))
    && constraints.every((name) => actualConstraints.has(name));
}

async function assertPermissionsAndAdminGrant(client, permissionCodes) {
  const result = await client.query(
    `SELECT p.code, p.group_name,
      EXISTS (
        SELECT 1 FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        WHERE rp.permission_id = p.id AND r.slug = 'admin'
      ) AS admin_granted
     FROM permissions p
     WHERE p.code = ANY($1::varchar[])`,
    [permissionCodes],
  );
  return permissionCodes.every((code) => {
    const permission = result.rows.find((row) => row.code === code);
    return permission?.group_name === 'Compras e fornecedores' && permission.admin_granted;
  });
}

async function assertMigrationState(client, filename) {
  if (filename === '20260731_purchases_suppliers_module.sql') {
    const tableNames = [
      'material_groups', 'suppliers', 'supplier_material_groups', 'purchase_counters',
      'purchase_requests', 'purchase_request_items', 'purchase_request_history',
      'purchase_quote_requests', 'purchase_quote_items', 'purchase_quote_suppliers',
      'purchase_quote_dispatches', 'supplier_proposals', 'supplier_proposal_items',
      'purchase_quote_selections', 'purchases', 'purchase_items', 'purchase_receipts',
      'purchase_receipt_items', 'purchase_domain_events',
    ];
    const requiredColumns = {
      material_groups: ['id', 'name', 'normalized_name', 'is_active', 'created_at', 'updated_at'],
      suppliers: ['id', 'person_type', 'legal_name', 'tax_id', 'is_active', 'created_at', 'updated_at'],
      supplier_material_groups: ['supplier_id', 'material_group_id'],
      purchase_counters: ['counter_type', 'counter_year', 'last_value'],
      purchase_requests: ['id', 'number', 'requester_id', 'sector_id', 'status', 'purpose', 'is_preapproved'],
      purchase_request_items: ['id', 'request_id', 'description', 'unit', 'quantity', 'product_id'],
      purchase_request_history: ['id', 'request_id', 'user_id', 'new_status', 'action'],
      purchase_quote_requests: ['id', 'number', 'purchase_request_id', 'status', 'responsible_id'],
      purchase_quote_items: ['id', 'quote_request_id', 'request_item_id', 'description', 'unit', 'quantity'],
      purchase_quote_suppliers: ['quote_request_id', 'supplier_id', 'added_at'],
      purchase_quote_dispatches: ['id', 'quote_request_id', 'supplier_id', 'channel', 'sent_by'],
      supplier_proposals: ['id', 'quote_request_id', 'supplier_id', 'proposal_date', 'total_value'],
      supplier_proposal_items: ['id', 'proposal_id', 'request_item_id', 'unit_value', 'quote_item_id'],
      purchase_quote_selections: ['id', 'quote_request_id', 'request_item_id', 'supplier_id', 'quote_item_id'],
      purchases: ['id', 'number', 'purchase_request_id', 'quote_request_id', 'supplier_id', 'buyer_id', 'status'],
      purchase_items: ['id', 'purchase_id', 'request_item_id', 'quantity', 'received_quantity'],
      purchase_receipts: ['id', 'purchase_id', 'receipt_date', 'responsible_id'],
      purchase_receipt_items: ['id', 'receipt_id', 'purchase_item_id', 'quantity', 'has_discrepancy', 'is_damaged', 'is_rejected'],
      purchase_domain_events: ['id', 'event_type', 'aggregate_type', 'aggregate_id', 'payload', 'processed_at'],
    };
    const indexes = [
      'idx_suppliers_search', 'idx_suppliers_active', 'idx_supplier_groups_group',
      'idx_purchase_requests_status', 'idx_purchase_requests_requester',
      'idx_purchase_request_items_request', 'idx_purchase_request_history_request',
      'idx_quote_requests_status', 'idx_quote_requests_request', 'idx_proposals_quote',
      'idx_purchases_status', 'idx_purchases_request', 'idx_purchase_items_purchase',
      'idx_receipts_purchase', 'idx_domain_events_pending',
    ];
    const constraints = [
      'material_groups_pkey', 'material_groups_normalized_name_key', 'suppliers_pkey',
      'suppliers_tax_id_key', 'supplier_material_groups_pkey', 'purchase_counters_pkey',
      'purchase_requests_pkey', 'purchase_requests_number_key', 'purchase_request_items_pkey',
      'purchase_quote_requests_pkey', 'purchase_quote_requests_number_key', 'purchases_pkey',
      'purchases_number_key', 'purchase_receipts_pkey', 'purchase_receipt_items_pkey',
    ];
    const permissionCodes = [
      'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.deactivate',
      'supplier_groups.manage', 'purchases.view', 'purchases.create_request',
      'purchases.edit_own_request', 'purchases.approve', 'purchases.create_preapproved',
      'purchases.create_direct', 'purchases.cancel', 'purchases.receive',
      'purchases.view_values', 'purchase_quotes.create', 'purchase_quotes.send',
      'purchase_quotes.register_response', 'purchase_quotes.choose_supplier', 'purchase_quotes.pdf',
    ];
    const expectedGroups = [
      'rolamentos', 'ferragens', 'aço e chapas', 'ferramentas', 'soldagem', 'elétrica',
      'hidráulica', 'pintura', 'motores', 'usinagem', 'equipamentos de proteção', 'administrativo',
    ];
    const materialGroups = await client.query('SELECT normalized_name FROM material_groups');
    const actualGroups = new Set(materialGroups.rows.map((row) => row.normalized_name));
    const valid = await assertRequiredTables(client, tableNames)
      && await assertRequiredColumns(client, requiredColumns)
      && await assertRequiredDatabaseObjects(client, { indexes, constraints })
      && await assertPermissionsAndAdminGrant(client, permissionCodes)
      && expectedGroups.every((groupName) => actualGroups.has(groupName));
    if (!valid) throw new Error(`O banco não corresponde ao estado esperado de ${filename}.`);
    return 'Tabelas, colunas, índices, constraints, permissões, grants e grupos de materiais de Compras validados.';
  }

  if (filename === '20260731_z_purchase_import_catalog_direct_quotes.sql') {
    const tableNames = [
      'supplier_item_mappings', 'supplier_item_price_history',
      'purchase_import_batches', 'purchase_import_items',
    ];
    const requiredColumns = {
      company_settings: ['delivery_address', 'purchase_response_email', 'purchase_response_whatsapp', 'purchase_responsible_name'],
      products: ['internal_code'],
      purchase_quote_requests: ['quote_type', 'contact_responsible_name'],
      purchase_quote_items: ['id', 'description', 'material_group_id', 'unit', 'quantity', 'internal_product_id', 'supplier_item_code'],
      supplier_proposal_items: ['quote_item_id', 'supplier_item_code', 'supplier_item_description', 'internal_product_id', 'unit'],
      purchase_quote_selections: ['quote_item_id'],
      purchase_items: ['quote_item_id', 'internal_product_id', 'supplier_item_code'],
      supplier_item_mappings: ['id', 'supplier_id', 'supplier_item_description', 'normalized_description', 'internal_product_id', 'is_active'],
      supplier_item_price_history: ['id', 'supplier_id', 'supplier_item_description', 'source', 'unit_price'],
      purchase_import_batches: ['id', 'context', 'source_type', 'confirmed_by', 'confirmed_at'],
      purchase_import_items: ['id', 'batch_id', 'line_number', 'description', 'link_action', 'warnings'],
    };
    const indexes = [
      'idx_products_internal_code_unique', 'idx_quote_items_request_item_unique',
      'idx_quote_items_quote', 'idx_proposal_items_quote_item_unique',
      'idx_quote_selections_quote_item_unique', 'idx_supplier_mapping_active_code',
      'idx_supplier_mapping_active_description', 'idx_supplier_mappings_product',
      'idx_supplier_mappings_search', 'idx_supplier_prices_mapping_date',
      'idx_supplier_prices_supplier_date', 'idx_supplier_prices_product_date',
    ];
    const constraints = [
      'purchase_quote_requests_type_check', 'purchase_quote_requests_origin_check',
      'purchase_quote_items_pkey', 'purchase_quote_items_quantity_check',
      'supplier_proposal_items_quote_item_id_fkey', 'purchase_quote_selections_quote_item_id_fkey',
      'purchase_items_quote_item_id_fkey', 'purchase_items_internal_product_id_fkey',
      'supplier_item_mappings_pkey', 'supplier_item_price_history_pkey',
      'purchase_import_batches_pkey', 'purchase_import_items_pkey',
    ];
    const permissionCodes = [
      'purchase_items.import', 'supplier_catalog.manage', 'supplier_catalog.view',
      'purchase_imports.create_product', 'supplier_prices.view',
    ];
    const data = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM purchase_quote_requests
         WHERE NOT ((quote_type = 'request' AND purchase_request_id IS NOT NULL)
           OR (quote_type = 'direct' AND purchase_request_id IS NULL)))::int AS invalid_quote_origins,
        (SELECT COUNT(*) FROM purchase_quote_items
         WHERE id IS NULL OR description IS NULL OR unit IS NULL OR quantity IS NULL OR quantity <= 0)::int AS invalid_quote_items,
        (SELECT COUNT(*) FROM supplier_proposal_items spi
         JOIN supplier_proposals sp ON sp.id = spi.proposal_id
         JOIN purchase_quote_items qi ON qi.id = spi.quote_item_id
         WHERE qi.quote_request_id <> sp.quote_request_id)::int AS invalid_proposal_links,
        (SELECT COUNT(*) FROM purchase_quote_selections s
         JOIN purchase_quote_items qi ON qi.id = s.quote_item_id
         WHERE qi.quote_request_id <> s.quote_request_id)::int AS invalid_selection_links
    `);
    const state = data.rows[0];
    const valid = await assertRequiredTables(client, tableNames)
      && await assertRequiredColumns(client, requiredColumns)
      && await assertRequiredDatabaseObjects(client, { indexes, constraints })
      && await assertPermissionsAndAdminGrant(client, permissionCodes)
      && Object.values(state).every((count) => count === 0);
    if (!valid) throw new Error(`O banco não corresponde ao estado esperado de ${filename}.`);
    return 'Cotações diretas, catálogo, importações, permissões, constraints, índices e vínculos de dados validados.';
  }

  if (filename === '20260728_employee_awards.sql') {
    const expectedColumns = [
      'id', 'employee_id', 'amount', 'award_date', 'performance_description',
      'employee_name_snapshot', 'employee_cpf_snapshot', 'job_title_snapshot', 'sector_name_snapshot',
      'company_name_snapshot', 'company_cnpj_snapshot', 'company_city_snapshot',
      'representative_name_snapshot', 'representative_job_title_snapshot', 'created_by', 'updated_by',
      'deleted_by', 'created_at', 'updated_at', 'deleted_at',
    ];
    const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employee_awards'`);
    const constraints = await client.query(`SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname = 'employee_awards'`);
    const indexes = await client.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'employee_awards'`);
    const permissions = await client.query(`SELECT p.code, EXISTS (SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_id = p.id AND r.slug = 'admin') AS admin_granted FROM permissions p WHERE p.code LIKE 'awards.%'`);
    const columnNames = new Set(columns.rows.map((row) => row.column_name));
    const constraintNames = new Set(constraints.rows.map((row) => row.conname));
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    const permissionCodes = new Set(permissions.rows.filter((row) => row.admin_granted).map((row) => row.code));
    const requiredConstraints = ['employee_awards_pkey', 'employee_awards_amount_positive', 'employee_awards_description_not_blank', 'employee_awards_employee_id_fkey', 'employee_awards_created_by_fkey'];
    const requiredIndexes = ['idx_employee_awards_employee_date', 'idx_employee_awards_award_date', 'idx_employee_awards_created_by', 'idx_employee_awards_active'];
    const requiredPermissions = ['awards.view', 'awards.create', 'awards.edit', 'awards.delete', 'awards.pdf'];
    if (!expectedColumns.every((column) => columnNames.has(column))
      || !requiredConstraints.every((constraint) => constraintNames.has(constraint))
      || !requiredIndexes.every((index) => indexNames.has(index))
      || !requiredPermissions.every((permission) => permissionCodes.has(permission))) {
      throw new Error(`O banco não corresponde ao estado esperado de ${filename}.`);
    }
    return 'Tabela, constraints, índices e permissões de Prêmios validados.';
  }

  if (filename === '20260728_sector_name_normalization.sql') {
    const result = await client.query(`
      SELECT
        to_regclass('public.sectors') IS NOT NULL AS table_exists,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'sectors'
            AND indexname = 'idx_sectors_name_normalized_unique'
        ) AS index_exists,
        (SELECT COUNT(*) FROM sectors WHERE name IS DISTINCT FROM regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))::int AS unnormalized,
        (SELECT COUNT(*) FROM (
          SELECT lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
          FROM sectors GROUP BY 1 HAVING COUNT(*) > 1
        ) duplicates)::int AS duplicate_groups
    `);
    const state = result.rows[0];
    if (!state.table_exists || !state.index_exists || state.unnormalized !== 0 || state.duplicate_groups !== 0) {
      throw new Error(`O banco não corresponde ao estado esperado de ${filename}.`);
    }
    return 'Índice único normalizado e dados de setores validados.';
  }

  if (filename === '20260729_employee_dependent_identification.sql') {
    const columns = await client.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employee_dependents' AND column_name IN ('cpf', 'identification_number', 'identification_type')`);
    const constraint = await client.query(`SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'public' AND t.relname = 'employee_dependents' AND c.conname = 'employee_dependents_identification_type_check'`);
    const data = await client.query(`SELECT COUNT(*) FILTER (WHERE identification_type IS NULL OR identification_type NOT IN ('cpf', 'matricula'))::int AS invalid_types FROM employee_dependents`);
    const columnMap = new Map(columns.rows.map((row) => [row.column_name, row]));
    const typeColumn = columnMap.get('identification_type');
    if (columnMap.has('cpf') || !columnMap.has('identification_number') || !typeColumn
      || typeColumn.is_nullable !== 'NO' || !String(typeColumn.column_default || '').includes("'cpf'")
      || !constraint.rows[0] || data.rows[0].invalid_types !== 0) {
      throw new Error(`O banco não corresponde ao estado esperado de ${filename}.`);
    }
    return 'Colunas, default, constraint e tipos de identificação validados.';
  }

  if (filename === '20260730_correct_existing_dependent_identification_types.sql') {
    const result = await client.query(`
      SELECT COUNT(*) FILTER (
        WHERE identification_number IS NOT NULL
          AND created_at < TIMESTAMP '2026-07-29 00:00:00'
          AND identification_type IS DISTINCT FROM 'matricula'
      )::int AS legacy_not_matricula
      FROM employee_dependents
    `);
    if (result.rows[0].legacy_not_matricula !== 0) {
      throw new Error(`O banco não corresponde ao estado esperado de ${filename}.`);
    }
    return 'Classificação dos dependentes legados validada.';
  }

  throw new Error(`Reparo não suportado para ${filename}: não há validação de estado definida.`);
}

async function repair(client, migrations, filename) {
  if (!filename || path.basename(filename) !== filename || !filename.toLowerCase().endsWith('.sql')) {
    throw new Error('Informe explicitamente um arquivo de migration .sql, sem caminho.');
  }
  const migration = migrations.find((item) => item.filename === filename);
  if (!migration) throw new Error(`Migration não encontrada: ${filename}`);

  await client.query('SELECT pg_advisory_lock(hashtext($1))', [advisoryLockKey]);
  try {
    const applied = await loadAppliedMigrations(client);
    const record = applied.get(filename);
    if (!record) throw new Error(`A migration não está aplicada: ${filename}`);

    const validation = await assertMigrationState(client, filename);
    if (record.checksum === migration.checksum) {
      console.log(`Checksum já está reconciliado: ${filename}`);
      return;
    }

    const updated = await client.query(
      `UPDATE ${migrationTable} SET checksum = $1 WHERE filename = $2 AND checksum = $3 RETURNING checksum`,
      [migration.checksum, filename, record.checksum],
    );
    if (!updated.rows[0]) throw new Error(`O checksum mudou durante o reparo: ${filename}`);
    console.log(`Estado validado: ${validation}`);
    console.log(`Checksum reconciliado: ${filename}`);
    console.log(`Anterior: ${record.checksum}`);
    console.log(`Novo: ${migration.checksum}`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryLockKey]).catch(() => {});
  }
}

async function migrate(client, migrations) {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [advisoryLockKey]);
  try {
    await ensureMigrationTable(client);
    const applied = await loadAppliedMigrations(client);
    const classified = classifyMigrations(migrations, applied);
    const changed = classified.find((migration) => migration.status === 'changed');
    if (changed) throw new Error(`A migration já aplicada foi alterada: ${changed.filename}`);

    const pending = classified.filter((migration) => migration.status === 'pending');
    if (!pending.length) {
      console.log('Nenhuma migration pendente.');
      return;
    }

    for (const migration of pending) {
      console.log(`Aplicando ${migration.filename}...`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${migrationTable} (filename, checksum)
           VALUES ($1, $2)`,
          [migration.filename, migration.checksum],
        );
        await client.query('COMMIT');
        console.log(`Aplicada: ${migration.filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falha ao aplicar ${migration.filename}: ${error.message}`, { cause: error });
      }
    }
    console.log(`${pending.length} migration(s) aplicada(s) com sucesso.`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [advisoryLockKey]).catch(() => {});
  }
}

async function main() {
  if (!String(process.env.DATABASE_URL || '').trim()) {
    throw new Error('DATABASE_URL não foi encontrada no arquivo .env.');
  }
  if (!['up', 'status', 'repair'].includes(command)) {
    throw new Error('Comando inválido. Use npm run migrate, npm run migrate:status ou npm run migrate:repair -- <migration.sql>.');
  }

  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    if (command === 'status') await showStatus(client, migrations);
    else if (command === 'repair') await repair(client, migrations, repairTarget);
    else await migrate(client, migrations);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
