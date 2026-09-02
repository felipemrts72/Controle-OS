// Local, disposable UI/API smoke server. No production rows are changed.
// Start: node scripts/smoke-advance-list-review.js
// Stop: POST http://127.0.0.1:4187/__smoke/stop (also cleans up on SIGINT/SIGTERM).
import express from 'express';
import pg from 'pg';
import bcrypt from 'bcrypt';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pool } from '../backend/src/database/pool.js';
import { app } from '../backend/src/app.js';

const schema = `test_advance_ui_${randomUUID().replaceAll('-', '')}`;
const tables = ['users', 'employees', 'advance_cycles', 'advance_lists', 'advance_list_items', 'advance_installment_plans', 'advance_installments', 'audit_logs'];
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
const listId = randomUUID();
const cycleId = randomUUID();
const userId = randomUUID();
const password = `Smoke-${randomUUID()}`;
let server, stopping = false;

async function reset(count = 11) {
  await db.query(`TRUNCATE ${tables.filter((table) => table !== 'users').map((table) => `${schema}.${table}`).join(', ')}`);
  await db.query('INSERT INTO advance_cycles (id, opened_by) VALUES ($1, $2)', [cycleId, userId]);
  await db.query("INSERT INTO advance_lists (id, cycle_id, list_date, created_by, status) VALUES ($1, $2, CURRENT_DATE, $3, 'pending_approval')", [listId, cycleId, userId]);
  for (let index = 0; index < count; index++) {
    const employeeId = randomUUID();
    await db.query('INSERT INTO employees (id, full_name, current_salary) VALUES ($1, $2, 2500)', [employeeId, `Funcionário Teste ${String.fromCharCode(65 + index)}`]);
    await db.query('INSERT INTO advance_list_items (list_id, employee_id, amount, confirmed) VALUES ($1, $2, $3, TRUE)', [listId, employeeId, index === 0 ? 100 : index % 2 ? 1100 : 1600]);
  }
}

async function stop() {
  if (stopping) return;
  stopping = true;
  if (server) await new Promise((resolve) => server.close(resolve));
  pool.query = originalQuery;
  pool.connect = originalConnect;
  await db.end();
  await originalQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.end();
  console.log('Smoke encerrado; schema e fixtures removidos.');
  process.exit(0);
}

try {
  await originalQuery(`CREATE SCHEMA ${schema}`);
  for (const table of tables) await originalQuery(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  await db.query(`INSERT INTO users (id, name, username, password_hash, role, role_id, is_active, approval_status)
    VALUES ($1, 'Smoke Vales', 'admin', $2, 'admin', (SELECT id FROM roles WHERE slug = 'admin'), TRUE, 'approved')`, [userId, await bcrypt.hash(password, 10)]);
  await reset();
  app.get('/__smoke/state', async (_req, res) => res.json({
    list: (await db.query('SELECT id, status FROM advance_lists WHERE id = $1', [listId])).rows[0],
    audit: (await db.query('SELECT action, COUNT(*)::int AS count FROM audit_logs GROUP BY action')).rows,
  }));
  app.post('/__smoke/reset', async (req, res) => { await reset(Number(req.body.count || 11)); res.json({ listId }); });
  app.post('/__smoke/stop', (_req, res) => { res.json({ ok: true }); setImmediate(stop); });
  app.use(express.static(path.resolve('dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  server = app.listen(4187, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:4187/vales/${listId}`, username: 'admin', password, schema })));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  setTimeout(stop, 20 * 60 * 1000).unref();
} catch (error) {
  console.error(error.message);
  await stop();
}
