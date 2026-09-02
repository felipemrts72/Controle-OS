import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/database/pool.js';
import { app } from '../backend/src/app.js';
import { approveAdvanceList, saveAdvanceItem, submitAdvanceList, removeAdvanceItem, updateAdvanceList } from '../backend/src/services/advanceService.js';

// Real PostgreSQL/HTTP, isolated tables. Never alter production lists or salaries.
const schema = `test_advance_review_${randomUUID().replaceAll('-', '')}`;
const tables = ['employees', 'advance_cycles', 'advance_lists', 'advance_list_items', 'audit_logs'];
let db, originalConnect, originalQuery, user, token, server, baseUrl, listId, cycleId, ids;
let failAudit = false;

before(async () => {
  originalConnect = pool.connect.bind(pool);
  originalQuery = pool.query.bind(pool);
  user = (await pool.query("SELECT id, username FROM users WHERE username = 'admin' AND is_active = TRUE AND approval_status = 'approved'")).rows[0];
  assert.ok(user, 'Requires existing superadmin for authenticated local integration tests');
  user = { ...user, permissions: [], is_super_admin: true };
  token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '10m' });
  await pool.query(`CREATE SCHEMA ${schema}`);
  for (const table of tables) await pool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
  pool.query = db.query.bind(db);
  pool.connect = async () => {
    const client = await db.connect();
    return {
      query(sql, params) {
        if (failAudit && String(sql).includes('INSERT INTO audit_logs')) {
          failAudit = false;
          throw new Error('Injected audit failure');
        }
        return client.query(sql, params);
      },
      release: () => client.release(),
    };
  };
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/advances`;
});

beforeEach(async () => {
  await db.query(`TRUNCATE ${tables.map((table) => `${schema}.${table}`).join(', ')}`);
  cycleId = randomUUID();
  listId = randomUUID();
  ids = [];
  await db.query("INSERT INTO advance_cycles (id, opened_by) VALUES ($1, $2)", [cycleId, user.id]);
  await db.query("INSERT INTO advance_lists (id, cycle_id, list_date, created_by, status) VALUES ($1, $2, CURRENT_DATE, $3, 'pending_approval')", [listId, cycleId, user.id]);
  for (const [index, amount] of [100, 1100, 1600, 1200, 1700].entries()) {
    const employeeId = randomUUID();
    const lineId = randomUUID();
    await db.query('INSERT INTO employees (id, full_name, current_salary) VALUES ($1, $2, 2500)', [employeeId, `Teste ${String.fromCharCode(65 + index)}`]);
    await db.query('INSERT INTO advance_list_items (id, list_id, employee_id, amount, confirmed) VALUES ($1, $2, $3, $4, TRUE)', [lineId, listId, employeeId, amount]);
    ids.push({ lineId, employeeId });
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  pool.connect = originalConnect;
  pool.query = originalQuery;
  if (db) await db.end();
  // Generated schema is exclusively owned by this test, including on assertion failure.
  if (originalQuery) await originalQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
});

const approve = (body = {}, actor = user) => approveAdvanceList(listId, body, actor);
const choices = (review, reject = []) => ({ review_token: review.review_token,
  decisions: review.review_items.map((item) => ({ line_id: item.line_id, decision: reject.includes(item.line_id) ? 'reject' : 'approve' })) });
const state = async () => ({
  list: (await db.query('SELECT * FROM advance_lists WHERE id = $1', [listId])).rows[0],
  items: (await db.query('SELECT * FROM advance_list_items WHERE list_id = $1 ORDER BY id', [listId])).rows,
  audit: (await db.query('SELECT * FROM audit_logs ORDER BY created_at, id')).rows,
});
const post = (body) => fetch(`${baseUrl}/lists/${listId}/approve`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('HTTP: A OK + B/D WARNING + C/E OVERRIDE retornam uma revisão e aprovam uma única vez', async () => {
  const response = await post({});
  assert.equal(response.status, 200);
  const review = await response.json();
  assert.equal(review.requires_review, true);
  assert.deepEqual(review.review_items.map((item) => item.employee_name).sort(), ['Teste B', 'Teste C', 'Teste D', 'Teste E']);
  assert.equal(review.review_items.filter((item) => item.classification === 'WARNING').length, 2);
  assert.equal(review.review_items.filter((item) => item.classification === 'OVERRIDE_REQUIRED').length, 2);
  assert.equal((await state()).audit.length, 0);
  const confirmed = await post(choices(review));
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).status, 'approved');
  const persisted = await state();
  assert.equal(persisted.audit.filter((entry) => entry.action === 'approve').length, 1);
  assert.equal(persisted.audit.filter((entry) => entry.action === 'override_limits').length, 2);
  assert.equal(persisted.audit.filter((entry) => entry.action === 'threshold_warning_confirmed').length, 2);
  for (const entry of persisted.audit.filter((entry) => entry.action === 'override_limits')) {
    assert.equal(entry.user_id, user.id);
    assert.ok(entry.created_at);
    for (const field of ['list_id', 'line_id', 'employee_id', 'amount', 'salary', 'accumulated_before', 'projected_total', 'projected_percentage', 'rule']) assert.ok(entry.new_value[field] != null);
  }
  assert.equal((await post(choices(review))).status, 409);
  assert.equal((await state()).audit.length, persisted.audit.length);
});

test('✕ persiste negação explícita, não salva ✓ e exige edição/remoção', async () => {
  const review = await approve();
  const result = await approve(choices(review, [ids[2].lineId]));
  assert.equal(result.requires_edit, true);
  assert.equal(result.list.status, 'pending_approval');
  assert.equal(result.list.items.length, 5);
  let persisted = await state();
  assert.equal(persisted.audit.length, 1);
  assert.equal(persisted.audit[0].action, 'limit_authorization_rejected');
  assert.ok(persisted.items.find((item) => item.id === ids[2].lineId).limit_review_rejected_at);
  assert.equal(persisted.items.some((item) => item.override_used || item.threshold_warning_confirmed), false);
  assert.equal((await approve()).requires_edit, true);
  await saveAdvanceItem(listId, ids[2].lineId, { amount: 100 }, user);
  assert.equal((await state()).items.find((item) => item.id === ids[2].lineId).limit_review_rejected_at, null);
  const fresh = await approve();
  assert.equal((await approve(choices(fresh))).status, 'approved');
});

test('cancelar revisão não grava nada e a lista continua editável', async () => {
  const previous = await state();
  await approve();
  assert.deepEqual(await state(), previous);
  await saveAdvanceItem(listId, ids[0].lineId, { amount: 99 }, user);
  assert.equal((await state()).list.status, 'pending_approval');
});

for (const change of ['amount', 'salary', 'employee', 'list', 'other_list', 'remove', 'insert']) {
  test(`revalida e descarta decisões antigas após alteração: ${change}`, async () => {
    const review = await approve();
    if (change === 'amount') await saveAdvanceItem(listId, ids[1].lineId, { amount: 1300 }, user);
    if (change === 'salary') await db.query('UPDATE employees SET current_salary = 2000 WHERE id = $1', [ids[1].employeeId]);
    if (change === 'employee') {
      const employeeId = randomUUID();
      await db.query("INSERT INTO employees (id, full_name, current_salary) VALUES ($1, 'Substituto', 3000)", [employeeId]);
      await saveAdvanceItem(listId, ids[1].lineId, { employee_id: employeeId, amount: 1100 }, user);
    }
    if (change === 'list') await updateAdvanceList(listId, { list_date: '2026-09-01' }, user);
    if (change === 'remove') await removeAdvanceItem(listId, ids[1].lineId, user);
    if (change === 'insert') {
      const employeeId = randomUUID();
      await db.query("INSERT INTO employees (id, full_name, current_salary) VALUES ($1, 'Novo', 3000)", [employeeId]);
      await saveAdvanceItem(listId, null, { employee_id: employeeId, amount: 100 }, user);
    }
    if (change === 'other_list') {
      const other = (await db.query("INSERT INTO advance_lists (cycle_id, list_date) VALUES ($1, CURRENT_DATE) RETURNING id", [cycleId])).rows[0].id;
      await db.query('INSERT INTO advance_list_items (list_id, employee_id, amount, confirmed) VALUES ($1, $2, 10, TRUE)', [other, ids[1].employeeId]);
    }
    const result = await approve(choices(review));
    assert.equal(result.code, 'LIST_REVIEW_STALE');
    assert.notEqual(result.review_token, review.review_token);
    assert.equal((await state()).list.status, 'pending_approval');
    assert.equal((await state()).audit.some((entry) => ['approve', 'override_limits', 'threshold_warning_confirmed'].includes(entry.action)), false);
  });
}

test('alteração que elimina todas as pendências ainda exige confirmação atualizada', async () => {
  const review = await approve();
  await db.query('UPDATE employees SET current_salary = 10000');
  const fresh = await approve(choices(review));
  assert.equal(fresh.code, 'LIST_REVIEW_STALE');
  assert.deepEqual(fresh.review_items, []);
  assert.equal((await approve(choices(fresh))).status, 'approved');
});

test('sem pendências aprova diretamente', async () => {
  await db.query('UPDATE advance_list_items SET amount = 100');
  assert.equal((await approve()).status, 'approved');
  assert.deepEqual((await state()).audit.map((entry) => entry.action), ['approve']);
});

test('10 pendências são retornadas e confirmadas em uma operação', async () => {
  await db.query('UPDATE advance_list_items SET amount = 1600');
  for (let i = 5; i < 10; i++) {
    const employeeId = randomUUID();
    await db.query('INSERT INTO employees (id, full_name, current_salary) VALUES ($1, $2, 2500)', [employeeId, `Teste ${i}`]);
    await saveAdvanceItem(listId, null, { employee_id: employeeId, amount: 1100 }, user);
  }
  const review = await approve();
  assert.equal(review.review_items.length, 10);
  assert.equal((await approve(choices(review))).status, 'approved');
  assert.equal((await state()).audit.filter((entry) => entry.action === 'approve').length, 1);
});

test('conexões concorrentes / duas abas: só uma aprovação e uma auditoria', async () => {
  const review = await approve();
  const results = await Promise.allSettled([approve(choices(review)), approve(choices(review))]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'LIST_ALREADY_APPROVED');
  assert.equal((await state()).audit.filter((entry) => entry.action === 'approve').length, 1);
});

test('falha durante persistência causa rollback integral', async () => {
  const review = await approve();
  const previous = await state();
  failAudit = true;
  await assert.rejects(() => approve(choices(review)), /Injected audit failure/);
  assert.deepEqual(await state(), previous);
});

test('RBAC: manage não concede approve nem override; flags antigas não autorizam', async () => {
  const manager = { id: user.id, permissions: ['advances.manage'] };
  await assert.rejects(() => approve({}, manager), (error) => error.status === 403);
  const approver = { id: user.id, permissions: ['advances.approve', 'advances.manage'] };
  const review = await approve({ override_confirmed: true, threshold_warning_confirmed: true }, approver);
  assert.equal(review.review_items.filter((item) => !item.can_authorize).length, 2);
  await assert.rejects(() => approve(choices(review), approver), (error) => error.status === 403);
  assert.equal((await state()).audit.length, 0);
});

test('decisões incompletas, duplicadas ou de outra linha são recusadas sem gravação', async () => {
  const review = await approve();
  const body = choices(review);
  for (const decisions of [body.decisions.slice(1), [...body.decisions, body.decisions[0]], [...body.decisions, { line_id: ids[0].lineId, decision: 'approve' }]]) {
    await assert.rejects(() => approve({ ...body, decisions }), (error) => error.status === 400);
  }
  assert.equal((await state()).audit.length, 0);
});

test('lançar e salvar nunca exige warning/override, mesmo com salário ausente', async () => {
  await db.query('UPDATE employees SET current_salary = NULL WHERE id = $1', [ids[0].employeeId]);
  await saveAdvanceItem(listId, ids[0].lineId, { amount: 100000, override_confirmed: true }, user);
  await submitAdvanceList(listId, user);
  assert.equal((await state()).audit.some((entry) => entry.action === 'override_limits'), false);
  assert.equal((await state()).items.some((item) => item.override_used), false);
  const review = await approve();
  assert.equal(review.review_items.find((item) => item.line_id === ids[0].lineId).rule, 'SALARY_MISSING');
});

test('preserva limites exatos: 40%, 60% e salários até 1999,99', async () => {
  await db.query('UPDATE advance_list_items SET amount = 1000');
  await db.query('UPDATE advance_list_items SET amount = 1500 WHERE id = $1', [ids[1].lineId]);
  await db.query('UPDATE employees SET current_salary = 1999.99 WHERE id = $1', [ids[2].employeeId]);
  const review = await approve();
  assert.deepEqual(review.review_items.map((item) => item.employee_name).sort(), ['Teste B', 'Teste C']);
  assert.equal(review.review_items.find((item) => item.employee_name === 'Teste B').classification, 'WARNING');
  assert.equal(review.review_items.find((item) => item.employee_name === 'Teste C').maximum_percentage, 40);
});
