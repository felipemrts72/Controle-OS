import assert from 'node:assert/strict';
import fs from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const env = dotenv.parse(fs.readFileSync('.env'));
const source = new URL(env.DATABASE_URL);
const testName = process.env.VACATION_TEST_DB;
if (!/^controle_os_ferias_validacao_[0-9a-f]{8}$/.test(testName || '')) throw new Error('VACATION_TEST_DB deve identificar banco isolado de Férias.');
if (decodeURIComponent(source.pathname.slice(1)) === testName) throw new Error('Origem e teste não podem ser iguais.');
const testUrl = new URL(source);
testUrl.pathname = `/${testName}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.JWT_SECRET = env.JWT_SECRET;

const { query, pool } = await import('../backend/src/database/pool.js');
const { dateOnly } = await import('../backend/src/services/vacationRules.js');
const { app } = await import('../backend/src/app.js');
const {
  getEmployeeVacations, listVacationEmployees, saveAbsence, cancelAbsence, reviewPeriod, saveLeave,
  changeLeave, correctConfirmedLeave, regularizeHistoricalLeave,
} = await import('../backend/src/services/vacationService.js');

const checks = [];
const record = (name) => checks.push(name);
const expectStatus = async (operation, status) => {
  try { await operation(); assert.fail(`Operação deveria falhar com ${status}.`); }
  catch (error) { assert.equal(error.status || error.code, status); }
};
const period = (detail, ordinal = 1) => detail.periods.find((item) => item.ordinal === ordinal);
const date = (value) => dateOnly(value);

const identity = await query('SELECT current_database() AS database_name, to_regclass($1) IS NOT NULL AS module_present', ['public.vacation_periods']);
assert.equal(identity.rows[0].database_name, testName);
assert.equal(identity.rows[0].module_present, true);
const permission = await query("SELECT COUNT(*)::int AS total FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id JOIN roles r ON r.id=rp.role_id WHERE p.code LIKE 'vacations.%' AND r.slug='admin'");
assert.equal(permission.rows[0].total, 8);
const schema = await query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [['vacation_periods', 'vacation_absences', 'vacation_leaves', 'vacation_audit']]);
assert.equal(schema.rows.length, 4);
const constraints = await query("SELECT conname FROM pg_constraint WHERE conrelid IN ('vacation_absences'::regclass,'vacation_leaves'::regclass,'vacation_audit'::regclass) AND contype='f' AND conname LIKE '%employee_id_fkey'");
assert.ok(constraints.rows.length >= 3);
record('schema, chaves compostas e RBAC');

const suffix = Math.random().toString(36).slice(2, 10);
const adminRole = (await query("SELECT id FROM roles WHERE slug='admin'")).rows[0].id;
const viewerRole = (await query("SELECT id FROM roles WHERE slug='viewer'")).rows[0].id;
const adminId = (await query("INSERT INTO users (name, username, password_hash, role, role_id) VALUES ('QA Férias', $1, 'synthetic-no-login', 'admin', $2) RETURNING id", [`qa_ferias_admin_${suffix}`, adminRole])).rows[0].id;
const viewerId = (await query("INSERT INTO users (name, username, password_hash, role, role_id) VALUES ('QA Férias sem acesso', $1, 'synthetic-no-login', 'viewer', $2) RETURNING id", [`qa_ferias_viewer_${suffix}`, viewerRole])).rows[0].id;
const makeEmployee = async (label, admission) => (await query("INSERT INTO employees (full_name, admission_date, employment_status, created_by) VALUES ($1,$2,'ativo',$3) RETURNING id", [`QA Férias ${label} ${suffix}`, admission, adminId])).rows[0].id;
const oldId = await makeEmployee('histórico', '2020-02-29');
const bandsId = await makeEmployee('faixas', '2024-03-10');
const futureId = await makeEmployee('frações', '2025-03-10');
const twoId = await makeEmployee('duas frações', '2025-02-10');
const currentId = await makeEmployee('atual', '2026-03-10');
const yearId = await makeEmployee('virada', '2023-12-15');
const otherId = await makeEmployee('isolamento', '2025-03-10');
const syntheticIds = [oldId, bandsId, futureId, twoId, currentId, yearId, otherId];
const beforeRead = await query('SELECT COUNT(*)::int AS periods FROM vacation_periods WHERE employee_id = ANY($1::uuid[])', [syntheticIds]);
assert.equal(beforeRead.rows[0].periods, 0);
const listed = await listVacationEmployees(suffix);
assert.equal(listed.employees.length, 7);
await Promise.all(Array.from({ length: 8 }, () => getEmployeeVacations(currentId)));
const afterRead = await query('SELECT COUNT(*)::int AS periods FROM vacation_periods WHERE employee_id = ANY($1::uuid[])', [syntheticIds]);
assert.equal(afterRead.rows[0].periods, 0);
const restoredEmployee = await query("SELECT id FROM employees WHERE full_name NOT LIKE 'QA Férias %' AND admission_date IS NOT NULL AND deleted_at IS NULL LIMIT 1");
if (restoredEmployee.rows[0]) {
  await getEmployeeVacations(restoredEmployee.rows[0].id);
  const restoredWrites = await query('SELECT COUNT(*)::int AS periods FROM vacation_periods WHERE employee_id=$1', [restoredEmployee.rows[0].id]);
  assert.equal(restoredWrites.rows[0].periods, 0);
}
record('listagem e detalhe GET não persistem períodos, inclusive sob concorrência');
const current = await getEmployeeVacations(currentId);
assert.equal(current.periods.length, 1);
assert.equal(period(current).status, 'EM AQUISIÇÃO');
assert.equal(period(current).balance, null);
const old = await getEmployeeVacations(oldId);
assert.ok(old.periods.length >= 6);
assert.equal(date(period(old).acquisition_start), '2020-02-29');
assert.equal(date(period(old).acquisition_end), '2021-02-27');
assert.equal(date(period(old, 2).acquisition_start), '2021-02-28');
const year = await getEmployeeVacations(yearId);
assert.equal(date(period(year).acquisition_end), '2024-12-14');
record('períodos recentes, antigos, bissextos e virada de ano');
const concurrentInitial = await Promise.allSettled(Array.from({ length: 2 }, () => saveAbsence(yearId, {
  occurrence_date: '2024-01-10', quantity: 1, classification: 'justificada', notes: 'Concorrência sintética',
}, adminId)));
assert.equal(concurrentInitial.filter((item) => item.status === 'fulfilled').length, 1);
assert.equal(concurrentInitial.filter((item) => item.status === 'rejected' && item.reason.status === 409).length, 1);
const createdOnce = await query('SELECT COUNT(*)::int AS total FROM vacation_periods WHERE employee_id=$1', [yearId]);
assert.equal(createdOnce.rows[0].total, 1);
record('criação inicial transacional e idempotente sob concorrência');

let bands = await getEmployeeVacations(bandsId);
const acquisition = period(bands);
const dates = Array.from({ length: 33 }, (_, index) => {
  const value = new Date(Date.UTC(2024, 3, index + 1));
  return value.toISOString().slice(0, 10);
});
const first = await saveAbsence(bandsId, { occurrence_date: dates[0], quantity: 1, classification: 'injustificada', notes: 'Teste sintético' }, adminId);
const materialized = await query('SELECT ordinal FROM vacation_periods WHERE employee_id=$1', [bandsId]);
assert.deepEqual(materialized.rows.map((row) => row.ordinal), [1]);
await expectStatus(() => saveAbsence(bandsId, { occurrence_date: dates[0], quantity: 1, classification: 'injustificada' }, adminId), 409);
await saveAbsence(bandsId, { occurrence_date: '2024-05-20', quantity: 0.5, classification: 'injustificada' }, adminId);
await saveAbsence(bandsId, { occurrence_date: '2024-05-21', quantity: 1, classification: 'justificada' }, adminId);
await saveAbsence(bandsId, { occurrence_date: '2024-05-22', quantity: 1, classification: 'pendente' }, adminId);
bands = await getEmployeeVacations(bandsId);
assert.equal(period(bands).full_unjustified, 1);
assert.equal(period(bands).half_unjustified, 1);
assert.equal(period(bands).justified, 1);
assert.equal(period(bands).pending, 1);
assert.equal(period(bands).months.find((month) => month.month === '2024-05').absences.length, 3);
await expectStatus(() => reviewPeriod(bandsId, acquisition.id, { confirmed: true, note: 'Conferência sintética do histórico' }, adminId), 409);
const half = period(bands).absences.find((entry) => Number(entry.quantity) === 0.5);
const pending = period(bands).absences.find((entry) => entry.classification === 'pendente');
await saveAbsence(bandsId, { occurrence_date: '2024-05-20', quantity: 0.5, classification: 'justificada', notes: 'Reclassificação sintética' }, adminId, half.id);
await cancelAbsence(bandsId, pending.id, adminId);
for (let index = 1; index < dates.length; index += 1) {
  await saveAbsence(bandsId, { occurrence_date: dates[index], quantity: 1, classification: 'injustificada' }, adminId);
  if ([5, 14, 23, 32].includes(index)) {
    await reviewPeriod(bandsId, acquisition.id, { confirmed: true, note: 'Faixa legal conferida com registros sintéticos' }, adminId);
    const expected = new Map([[5, 24], [14, 18], [23, 12], [32, 0]]).get(index);
    const checked = await getEmployeeVacations(bandsId);
    assert.equal(period(checked).entitlement, expected);
  }
}
assert.equal((await getEmployeeVacations(bandsId)).periods.find((entry) => entry.ordinal === 1).full_unjustified, 33);
record('faltas, duplicidade, meses, revisão e faixas do art. 130');

const future = await getEmployeeVacations(futureId);
const futurePeriod = period(future);
await reviewPeriod(futureId, futurePeriod.id, { confirmed: true, note: 'Histórico sintético sem faltas nem férias anteriores' }, adminId);
const schedule = (start_date, end_date) => saveLeave(futureId, futurePeriod.id, { start_date, end_date, notice_date: '2026-10-01', calendar_confirmed: true, employee_agreed: true, calendar_review_note: 'Cuiabá MT, feriados locais e escala sintética conferidos' }, adminId);
await expectStatus(() => schedule('2027-01-15', '2027-01-17'), 400);
await expectStatus(() => saveLeave(futureId, futurePeriod.id, { start_date: '2027-01-15', end_date: '2027-01-28', notice_date: '2026-10-01', calendar_confirmed: false, employee_agreed: true, calendar_review_note: 'Sem revisão de calendário' }, adminId), 400);
const leave14 = await schedule('2027-01-15', '2027-01-28');
await expectStatus(() => schedule('2027-01-20', '2027-02-02'), 409);
const leave5 = await schedule('2027-02-05', '2027-02-09');
const leave11 = await schedule('2027-02-20', '2027-03-02');
assert.equal((await getEmployeeVacations(futureId)).periods.find((entry) => entry.ordinal === 1).planned, 30);
await expectStatus(() => schedule('2027-03-04', '2027-03-08'), 400);
const two = await getEmployeeVacations(twoId);
await reviewPeriod(twoId, period(two).id, { confirmed: true, note: 'Histórico sintético de férias conferido' }, adminId);
const twoSchedule = (start_date, end_date) => saveLeave(twoId, period(two).id, { start_date, end_date, notice_date: '2026-10-01', calendar_confirmed: true, employee_agreed: true, calendar_review_note: 'Cuiabá MT e escala sintética conferidos' }, adminId);
await twoSchedule('2026-12-01', '2026-12-15');
await twoSchedule('2027-01-01', '2027-01-15');
record('programação, aviso, calendário e frações de dois/três períodos');

const historicalPeriod = period(old);
await regularizeHistoricalLeave(oldId, historicalPeriod.id, { start_date: '2021-04-01', end_date: '2021-04-14', notes: 'Documento sintético de férias anteriores' }, adminId);
await reviewPeriod(oldId, historicalPeriod.id, { confirmed: true, note: 'Documentos sintéticos de férias revisados' }, adminId);
assert.equal(period(await getEmployeeVacations(oldId)).balance, 16);
record('regularização histórica e saldo');

const bandPeriod = period(await getEmployeeVacations(bandsId));
await expectStatus(() => query('INSERT INTO vacation_absences (employee_id,period_id,occurrence_date,quantity,classification) VALUES ($1,$2,$3,1,$4)', [oldId, bandPeriod.id, '2024-04-01', 'justificada']), '23503');
record('chave composta isola funcionários');

await query('UPDATE employees SET admission_date=$1 WHERE id=$2', ['2024-03-11', bandsId]);
const changed = await getEmployeeVacations(bandsId);
assert.equal(period(changed).special_case, true);
assert.equal(period(changed).balance, null);
await expectStatus(() => reviewPeriod(bandsId, acquisition.id, { confirmed: true, note: 'Tentativa com admissão alterada' }, adminId), 409);
record('alteração da admissão suspende saldo confirmado');

const confirmedPeriod = period(await getEmployeeVacations(otherId));
await reviewPeriod(otherId, confirmedPeriod.id, { confirmed: true, note: 'Histórico sintético completo para baixa' }, adminId);
const inserted = await query("INSERT INTO vacation_leaves (employee_id,period_id,start_date,end_date,days,status,notice_date,employee_agreed,calendar_confirmed,calendar_review_note,calendar_reviewed_by,created_by) VALUES ($1,$2,'2026-05-01','2026-05-14',14,'programada','2026-03-01',TRUE,TRUE,'Escala e feriados sintéticos revisados',$3,$3) RETURNING id", [otherId, confirmedPeriod.id, adminId]);
const confirmedId = inserted.rows[0].id;
const confirmed = await changeLeave(otherId, confirmedId, 'confirm', adminId);
assert.equal(confirmed.status, 'gozada');
await expectStatus(() => changeLeave(otherId, confirmedId, 'confirm', adminId), 409);
assert.equal(period(await getEmployeeVacations(otherId)).balance, 16);
const corrected = await correctConfirmedLeave(otherId, confirmedId, { action: 'correct', version: confirmed.version, start_date: '2026-05-01', end_date: '2026-05-15', reason: 'Documento sintético corrigido' }, adminId);
assert.equal(corrected.balance, 15);
const concurrent = await Promise.allSettled([
  correctConfirmedLeave(otherId, confirmedId, { action: 'correct', version: corrected.leave.version, start_date: '2026-05-01', end_date: '2026-05-16', reason: 'Correção sintética concorrente' }, adminId),
  correctConfirmedLeave(otherId, confirmedId, { action: 'correct', version: corrected.leave.version, start_date: '2026-05-01', end_date: '2026-05-17', reason: 'Correção sintética concorrente' }, adminId),
]);
assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
assert.equal(concurrent.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
const latest = (await query('SELECT version FROM vacation_leaves WHERE id=$1', [confirmedId])).rows[0];
const cancelled = await correctConfirmedLeave(otherId, confirmedId, { action: 'cancel', version: latest.version, reason: 'Baixa sintética indevida' }, adminId);
assert.equal(cancelled.balance, 30);
assert.equal(period(await getEmployeeVacations(otherId)).balance, 30);
const audit = await query("SELECT action, before_data, after_data, reason FROM vacation_audit WHERE employee_id=$1 AND action IN ('confirm','correct_confirmed','cancel_confirmed') ORDER BY id", [otherId]);
assert.ok(audit.rows.length >= 4 && audit.rows.every((item) => item.before_data && item.after_data));
record('baixa, correção, cancelamento, concorrência, auditoria e saldo');

const server = app.listen(0, '127.0.0.1');
try {
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (userId) => fetch(`${base}/api/vacations/employees/${futureId}`, { headers: { Authorization: `Bearer ${jwt.sign({ id: userId }, process.env.JWT_SECRET)}` } });
  const allowed = await request(adminId);
  const forbidden = await request(viewerId);
  assert.equal(allowed.status, 200);
  assert.equal(forbidden.status, 403);
  record('HTTP 200/403 com RBAC real');
} finally { server.close(); }

const touched = await query("SELECT COUNT(*)::int AS non_synthetic FROM vacation_periods vp JOIN employees e ON e.id=vp.employee_id WHERE e.full_name NOT LIKE 'QA Férias %'");
assert.equal(touched.rows[0].non_synthetic, 0);
record('nenhum período criado para funcionários restaurados');
await pool.end();
console.log(JSON.stringify({ database: testName, checks, synthetic_employees: syntheticIds.length, passed: checks.length }));
