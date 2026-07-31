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

async function assertMigrationState(client, filename) {
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
