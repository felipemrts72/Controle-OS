import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { app } from '../backend/src/app.js';
import { pool } from '../backend/src/database/pool.js';
import { listVacationEmployees, getEmployeeVacations } from '../backend/src/services/vacationService.js';
import { addCalendarMonths, addDays, businessToday } from '../backend/src/services/vacationRules.js';

const testUrl = new URL(process.env.DATABASE_URL || '');
const database = decodeURIComponent(testUrl.pathname.slice(1));
assert.ok(['127.0.0.1','localhost'].includes(testUrl.hostname));
assert.match(database, /^(olimen_qa_[a-z0-9_]+|controle_os_ferias_validacao_[0-9a-f]{8})$/);
const today = businessToday();
const q = (sql, values = []) => pool.query(sql, values);
const suffix = 'alertas_' + Math.random().toString(36).slice(2, 10);
const role = (await q("SELECT id FROM roles WHERE slug='admin'")).rows[0].id;
const viewerRole = (await q("SELECT id FROM roles WHERE slug='viewer'")).rows[0].id;
const admin = (await q("INSERT INTO users (name, username, password_hash, role, role_id) VALUES ('QA Férias Alertas', $1, 'synthetic', 'admin', $2) RETURNING id", [suffix + '_admin', role])).rows[0].id;
const viewer = (await q("INSERT INTO users (name, username, password_hash, role, role_id) VALUES ('QA Férias sem permissão', $1, 'synthetic', 'viewer', $2) RETURNING id", [suffix + '_viewer', viewerRole])).rows[0].id;
const make = async (name, admission, status = 'ativo') => (await q('INSERT INTO employees (full_name, admission_date, employment_status, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [`QA ${suffix} ${name}`, admission, status, admin])).rows[0].id;
const review = async (employeeId, ordinal = 1) => {
  const detail = await getEmployeeVacations(employeeId);
  const p = detail.periods.find((item) => item.ordinal === ordinal);
  assert.ok(p);
  await q('INSERT INTO vacation_periods (id, employee_id, ordinal, acquisition_start, acquisition_end, concession_start, concession_end, reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())', [p.id, employeeId, ordinal, p.acquisition_start, p.acquisition_end, p.concession_start, p.concession_end]);
  return p;
};
const dueAdmission = addCalendarMonths(today, -21);
const dueIds = [];
for (let index = 0; index < 22; index += 1) {
  const id = await make(`prazo ${String(index).padStart(2, '0')}`, index === 0 ? addCalendarMonths(today, -22) : dueAdmission);
  await review(id);
  dueIds.push(id);
}
const pendingId = await make('conferência', dueAdmission);
const overdueId = await make('vencida', addCalendarMonths(today, -30));
await review(overdueId, 1);
const inactiveId = await make('inativo', dueAdmission, 'desligado');
await review(inactiveId);
const quitId = await make('quitado', dueAdmission);
const quit = await review(quitId);
await q("INSERT INTO vacation_leaves (employee_id, period_id, start_date, end_date, days, status) VALUES ($1,$2,$3,$4,30,'gozada')", [quitId, quit.id, addDays(today, -50), addDays(today, -21)]);
const partialId = dueIds[0];
const partial = (await getEmployeeVacations(partialId)).periods.find((item) => item.ordinal === 1);
await q("INSERT INTO vacation_leaves (employee_id, period_id, start_date, end_date, days, status) VALUES ($1,$2,$3,$4,10,'gozada')", [partialId, partial.id, addDays(today, -40), addDays(today, -31)]);
const programmedId = dueIds[1];
const programmed = (await getEmployeeVacations(programmedId)).periods.find((item) => item.ordinal === 1);
await q("INSERT INTO vacation_leaves (employee_id, period_id, start_date, end_date, days, status) VALUES ($1,$2,$3,$4,30,'programada')", [programmedId, programmed.id, addDays(today, 35), addDays(today, 64)]);

const all = await listVacationEmployees({ search: suffix });
assert.equal(all.indicators.acquired, 24);
assert.equal(all.indicators.due_soon, 23);
assert.equal(all.indicators.overdue, 1);
assert.equal(all.total, 25);
const due = await listVacationEmployees({ search: suffix, filter: 'due_soon' });
assert.equal(due.total, 23);
assert.equal(due.employees.length, 20);
assert.equal(due.employees[0].id, dueIds[0]);
assert.equal(due.employees[0].periods.some((p) => p.alert.due_soon), true);
const second = await listVacationEmployees({ search: suffix, filter: 'due_soon', page: 2 });
assert.equal(second.employees.length, 3);
assert.equal(new Set([...due.employees, ...second.employees].map((e) => e.id)).size, 23);
const pending = due.employees.concat(second.employees).find((e) => e.id === pendingId);
assert.ok(pending.periods.some((p) => p.alert.needs_review));
const programmedResult = due.employees.concat(second.employees).find((e) => e.id === programmedId);
assert.ok(programmedResult.periods.some((p) => p.alert.planned_may_clear && p.balance === 30));
const partialResult = due.employees.concat(second.employees).find((e) => e.id === partialId);
assert.ok(partialResult.periods.some((p) => p.balance === 20));
const expired = await listVacationEmployees({ search: suffix, filter: 'overdue' });
assert.equal(expired.total, 1);
assert.equal(expired.employees[0].id, overdueId);
assert.ok(expired.employees[0].periods.filter((p) => p.alert.acquired).length >= 2);
const pendingFilter = await listVacationEmployees({ search: suffix, filter: 'due_soon', status: 'PENDENTE DE CONFERÊNCIA' });
assert.equal(pendingFilter.total, 1);
assert.equal(pendingFilter.indicators.due_soon, 1);
assert.equal((await listVacationEmployees({ search: `${suffix} inexistente`, filter: 'acquired' })).total, 0);
await assert.rejects(() => listVacationEmployees({ filter: 'invalid' }), { status: 400 });
await assert.rejects(() => listVacationEmployees({ page: 0 }), { status: 400 });

const server = app.listen(0);
try {
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}/api/vacations?search=${suffix}&filter=due_soon`;
  const get = (token) => fetch(endpoint, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await get()).status, 401);
  const secret = process.env.JWT_SECRET || 'dev-secret';
  assert.equal((await get(jwt.sign({ id: viewer }, secret))).status, 403);
  const response = await get(jwt.sign({ id: admin }, secret));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 23);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}
console.log(`Banco isolado ${database}: 23 próximos, 1 vencido, paginação 20+3, permissões e saldos verificados.`);
