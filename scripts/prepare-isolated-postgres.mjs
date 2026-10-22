import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Point DATABASE_URL at a newly created, disposable local database before running.
const url = new URL(process.env.DATABASE_URL || '');
const database = decodeURIComponent(url.pathname.slice(1));
assert.match(database, /^(olimen_qa_[a-z0-9_]+|controle_os_ferias_validacao_[0-9a-f]{8})$/);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Somente PostgreSQL local de teste.');
const root = path.resolve(import.meta.dirname, '..');
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  const empty = await client.query("SELECT to_regclass('public.schema_migrations') IS NULL AS empty");
  assert.ok(empty.rows[0].empty, 'Use um banco novo e vazio; esta preparação não sobrescreve dados.');
  const location = (await client.query('SHOW data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase();
  assert.ok(location.includes('/temp/olimen-pg-'), 'Use um cluster PostgreSQL descartável olimen-pg-* dentro da pasta temporária.');
  const encoding = (await client.query('SHOW server_encoding')).rows[0].server_encoding;
  assert.equal(encoding, 'UTF8', 'Crie o banco sintético com createdb -E UTF8 -T template0.');
} finally { await client.end(); }
const schema = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', url.toString(), '-f', path.join(root, 'database/schema.sql')], { cwd: root, stdio: 'inherit' });
if (schema.status !== 0) throw new Error('Falha ao aplicar schema.sql.');
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  const schemaText = fs.readFileSync(path.join(root, 'database/schema.sql'), 'utf8');
  const included = [...schemaText.matchAll(/^\\ir migrations\/(.+\.sql)$/gm)].map((match) => match[1]);
  // This historical correction requires the original 45 ERP records. It has no rows to correct in a synthetic database.
  const testOnlySkipped = '20260827_zzz_fix_legacy_number_order.sql';
  for (const filename of [...included, testOnlySkipped]) {
    const sql = fs.readFileSync(path.join(root, 'database/migrations', filename));
    await db.query('INSERT INTO schema_migrations(filename,checksum) VALUES ($1,$2) ON CONFLICT DO NOTHING', [filename, createHash('sha256').update(sql).digest('hex')]);
  }
} finally { await db.end(); }
const migrate = spawnSync(process.execPath, ['scripts/migrate.js', 'up'], { cwd: root, env: process.env, stdio: 'inherit' });
if (migrate.status !== 0) throw new Error('Falha nas migrations.');
const fixtures = new pg.Client({ connectionString: url.toString() });
await fixtures.connect();
try {
  for (const [slug, name] of [['estoquista','Estoquista'],['entregas','Entregas'],['expedicao_teste','Expedição Teste']]) {
    await fixtures.query('INSERT INTO roles(slug,name) VALUES($1,$2) ON CONFLICT(slug) DO NOTHING', [slug,name]);
  }
  await fixtures.query("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.slug IN ('estoquista','entregas','expedicao_teste') AND p.code='dashboard.view' ON CONFLICT DO NOTHING");
  await fixtures.query("INSERT INTO users(name,username,password_hash,role,role_id) SELECT 'QA Admin','felipe','synthetic-no-login','admin',id FROM roles WHERE slug='admin' ON CONFLICT(username) DO NOTHING");
  await fixtures.query("INSERT INTO users(name,username,password_hash,role,role_id) SELECT 'QA Viewer','qa_viewer','synthetic-no-login','viewer',id FROM roles WHERE slug='viewer' ON CONFLICT(username) DO NOTHING");
  await fixtures.query("INSERT INTO users(name,username,password_hash,role,role_id) SELECT 'QA Manager','qa_manager','synthetic-no-login','manager',id FROM roles WHERE slug='manager' ON CONFLICT(username) DO NOTHING");
  await fixtures.query("INSERT INTO users(name,username,password_hash,role,role_id) SELECT 'QA Shipping','qa_shipping','synthetic-no-login','shipping',id FROM roles WHERE slug='entregas' ON CONFLICT(username) DO NOTHING");
  await fixtures.query("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE (r.slug='estoquista' AND p.code IN ('products.cost.view','products.cost.edit')) OR (r.slug='manager' AND p.code IN ('commercial.catalog.view','commercial.quotes.view','commercial.quotes.create')) ON CONFLICT DO NOTHING");
  await fixtures.query("INSERT INTO employees(full_name,admission_date,employment_status,current_salary) VALUES ('QA Funcionário Inicial','2020-01-01','ativo',2500)");
  await fixtures.query("INSERT INTO customers(name,normalized_name) VALUES ('QA Cliente','qa cliente')");
  for (const [name, type, review] of [['QA Fabricado','manufactured','approved'],['QA Pendente','manufactured','pending_review'],['QA Revenda','resale','approved']]) {
    await fixtures.query("INSERT INTO products(name,type,sector_id,default_volume_quantity,default_total_weight_kg,review_status) SELECT $1,$2,id,1,1,$3 FROM sectors WHERE slug='montagem' LIMIT 1", [name, type, review]);
  }
  await fixtures.query("INSERT INTO product_images(product_id,original_name,stored_name,mime_type,size_bytes) SELECT id,'qa.png','qa-synthetic.png','image/png',8 FROM products WHERE name='QA Fabricado' LIMIT 1");
  await fixtures.query("CREATE TABLE qa_environment_marker (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await fixtures.query('INSERT INTO qa_environment_marker(id) VALUES(TRUE)');
} finally { await fixtures.end(); }
const legacy = spawnSync(process.execPath, ['scripts/seed-legacy-qa.mjs'], { cwd: root, env: process.env, stdio: 'inherit' });
if (legacy.status !== 0) throw new Error('Falha nas fixtures históricas sintéticas.');
console.log(`Banco sintético preparado: ${database}.`);
