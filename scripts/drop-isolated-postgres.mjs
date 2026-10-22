import assert from 'node:assert/strict';
import pg from 'pg';

assert.equal(process.argv[2], '--apply', 'Informe --apply para excluir somente o banco sintético.');
const url = new URL(process.env.DATABASE_URL || '');
const database = decodeURIComponent(url.pathname.slice(1));
assert.match(database, /^(olimen_qa_[a-z0-9_]+|controle_os_ferias_validacao_[0-9a-f]{8})$/);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Somente PostgreSQL local de teste.');
const target = new pg.Client({ connectionString: url.toString() });
await target.connect();
try {
  const location = (await target.query('SHOW data_directory')).rows[0].data_directory.replaceAll('\\','/').toLowerCase();
  assert.ok(location.includes('/temp/olimen-pg-'), 'O cluster precisa ser descartável e temporário.');
  const marker = await target.query("SELECT to_regclass('public.qa_environment_marker') IS NOT NULL AS present");
  assert.ok(marker.rows[0].present, 'Banco sem marcador explícito de homologação; exclusão recusada.');
  const confirmed = await target.query('SELECT id FROM qa_environment_marker WHERE id=TRUE');
  assert.equal(confirmed.rowCount, 1);
} finally { await target.end(); }
url.pathname = '/postgres';
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE "${database}"`);
  console.log(`Banco sintético excluído: ${database}`);
} finally { await client.end(); }
