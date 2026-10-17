import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../backend/src/database/pool.js';
import { getAdvanceList, getAdvancesHome, updateIndividualAdvance, cancelIndividualAdvance } from '../backend/src/services/advanceService.js';

const schema = `test_advance_correction_${randomUUID().replaceAll('-', '')}`;
const tables = ['employees', 'advance_cycles', 'advance_lists', 'advance_list_items', 'advance_installment_plans', 'advance_installments', 'audit_logs'];
let db, oldConnect, oldQuery, userId, employeeId, listId, itemId, cycleId;
const actor = (permissions) => ({ id: userId, permissions });
const editable = () => actor(['advances.edit', 'advances.delete', 'advances.override_limits']);

before(async () => {
  oldConnect = pool.connect.bind(pool);
  oldQuery = pool.query.bind(pool);
  userId = (await pool.query("SELECT id FROM users WHERE username = 'admin' LIMIT 1")).rows[0].id;
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of tables) await pool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  employeeId = randomUUID(); listId = randomUUID(); itemId = randomUUID(); cycleId = randomUUID();
  await db.query('INSERT INTO employees (id, full_name, current_salary) VALUES ($1, $2, 2500)', [employeeId, 'Funcionário Teste']);
  await db.query('INSERT INTO advance_cycles (id, opened_by) VALUES ($1, $2)', [cycleId, userId]);
  await db.query("INSERT INTO advance_lists (id, cycle_id, list_date, status, created_by) VALUES ($1, $2, '2026-10-05', 'approved', $3)", [listId, cycleId, userId]);
  await db.query("INSERT INTO advance_list_items (id, list_id, employee_id, amount, confirmed, entry_type, receipt_at) VALUES ($1, $2, $3, 100, TRUE, 'individual', '2026-10-05 10:00:00')", [itemId, listId, employeeId]);
});

after(async () => {
  pool.connect = oldConnect; pool.query = oldQuery;
  if (db) await db.end();
  if (oldQuery) await oldQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

const current = async () => (await getAdvanceList(listId)).items[0];
const body = (version, amount = '150,00') => ({ row_version: version, employee_id: employeeId, amount, receipt_at: '2026-10-06T11:30', source_bank: 'Sicoob' });

test('edita valor, data e banco; recalcula totais, limite e auditoria', async () => {
  const item = await current();
  const list = await updateIndividualAdvance(listId, itemId, body(item.row_version), editable());
  assert.equal(Number(list.total_amount), 150);
  assert.equal(Number(list.items[0].amount), 150);
  assert.equal(list.items[0].source_bank, 'Sicoob');
  assert.equal(Number((await getAdvancesHome()).open_cycle.total_amount), 150);
  const audit = await db.query("SELECT * FROM audit_logs WHERE action = 'individual_advance_update'");
  assert.equal(audit.rowCount, 1);
});

test('versão antiga e usuário sem permissão são recusados', async () => {
  await assert.rejects(updateIndividualAdvance(listId, itemId, body('0'), editable()), { status: 409 });
  const item = await current();
  await assert.rejects(updateIndividualAdvance(listId, itemId, body(item.row_version), actor(['advances.view'])), { status: 403 });
});

test('revalida limite e exige override', async () => {
  const item = await current();
  await assert.rejects(updateIndividualAdvance(listId, itemId, body(item.row_version, '2.000,00'), actor(['advances.edit'])), { status: 403 });
  const list = await updateIndividualAdvance(listId, itemId, body(item.row_version, '2.000,00'), editable());
  assert.equal(list.items[0].override_used, true);
  assert.equal(Number(list.total_amount), 2000);
});

test('ciclo fechado preserva histórico e bloqueia alteração', async () => {
  const item = await current();
  await db.query("UPDATE advance_cycles SET status = 'closed', closed_at = NOW() WHERE id = $1", [cycleId]);
  await assert.rejects(updateIndividualAdvance(listId, itemId, body(item.row_version), editable()), { status: 409 });
  await db.query("UPDATE advance_cycles SET status = 'open', closed_at = NULL WHERE id = $1", [cycleId]);
});

test('cancelamento preserva linha e auditoria, remove dos totais e do limite', async () => {
  const otherItemId = randomUUID();
  const otherEmployeeId = randomUUID();
  await db.query('INSERT INTO employees (id, full_name, current_salary) VALUES ($1, $2, 2500)', [otherEmployeeId, 'Outro Funcionário']);
  await db.query("INSERT INTO advance_list_items (id, list_id, employee_id, amount, confirmed, entry_type, receipt_at) VALUES ($1, $2, $3, 50, TRUE, 'individual', '2026-10-05 12:00:00')", [otherItemId, listId, otherEmployeeId]);
  const item = (await getAdvanceList(listId)).items.find((entry) => entry.id === itemId);
  await cancelIndividualAdvance(listId, itemId, { row_version: item.row_version }, editable());
  const saved = (await db.query('SELECT * FROM advance_list_items WHERE id = $1', [itemId])).rows[0];
  assert.equal(saved.status, 'cancelled');
  assert.ok(saved.removed_at);
  assert.equal(Number((await getAdvancesHome()).open_cycle.total_amount), 50);
  assert.equal((await db.query('SELECT status, deleted_at FROM advance_lists WHERE id = $1', [listId])).rows[0].status, 'approved');
  assert.equal((await db.query('SELECT status FROM advance_list_items WHERE id = $1', [otherItemId])).rows[0].status, 'active');
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action = 'individual_advance_cancel'")).rows[0].count, 1);
});

