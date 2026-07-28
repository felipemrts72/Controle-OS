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
  if (!['up', 'status'].includes(command)) {
    throw new Error('Comando inválido. Use npm run migrate ou npm run migrate:status.');
  }

  const migrations = await loadMigrations();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    if (command === 'status') await showStatus(client, migrations);
    else await migrate(client, migrations);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
