import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCompensation, reportPeriod, canManageCompensation, updateCompensation, compensationReport } from '../backend/src/services/employeeCompensationService.js';
import { pool } from '../backend/src/database/pool.js';

const user = { id: 'admin-test', permissions: ['employees.view', 'employees.salary.view', 'employees.salary.manage', 'employees.meal_allowance.view', 'employees.meal_allowance.manage'] };
const current = { id: 'employee-test', current_salary: '2500.00', meal_allowance: '450.00' };
const payload = (values) => ({ ...values, expected: { current_salary: 2500, meal_allowance: 450 }, effective_from: '2026-12-01' });
test('aumento individual de salário, benefício e ambos', () => {
  for (const values of [{ current_salary: 2800 }, { meal_allowance: 500 }, { current_salary: 2800, meal_allowance: 500 }]) {
    const changes = validateCompensation(payload(values), current, user);
    assert.equal(changes.length, Object.keys(values).length);
    if (values.current_salary) { assert.equal(changes[0].difference, 300); assert.equal(changes[0].percentage, 12); }
  }
});
test('omitidos, vazios e iguais não geram alterações', () => {
  for (const values of [{}, { current_salary: '' }, { meal_allowance: null }, { current_salary: 2500, meal_allowance: 450 }]) assert.deepEqual(validateCompensation(payload(values), current, user), []);
});
test('rejeita reduções, inválidos, casas extras, overflow, campos alheios e datas inexistentes', () => {
  for (const values of [{ current_salary: 2400 }, { meal_allowance: 400 }, { current_salary: -1 }, { current_salary: Infinity }, { current_salary: '2800' }, { current_salary: true }, { current_salary: 2800.001 }, { current_salary: 1e12 }, { job_title: 'outro' }]) assert.throws(() => validateCompensation(payload(values), current, user));
  assert.throws(() => validateCompensation({ effective_from: '2026-02-30' }, current, user));
});
test('permissão de gestão não dispensa visualização; ficha genérica não autoriza remuneração', () => {
  const limited = { permissions: ['employees.view', 'employees.edit', 'employees.manage'] };
  assert.equal(canManageCompensation(limited, 'current_salary'), false);
  assert.throws(() => validateCompensation(payload({ current_salary: 2800 }), current, limited), { status: 403 });
  assert.throws(() => validateCompensation(payload({ meal_allowance: 500 }), current, { ...user, permissions: user.permissions.filter((p) => p !== 'employees.meal_allowance.manage') }), { status: 403 });
});
test('concorrência exige valores conferidos; base zero não inventa percentual', () => {
  assert.throws(() => validateCompensation(payload({ current_salary: 2800 }), { ...current, current_salary: 2600 }, user), { status: 409 });
  assert.equal(validateCompensation({ current_salary: 100, expected: { current_salary: 0 } }, { ...current, current_salary: 0 }, user)[0].percentage, null);
});
test('período mensal valida limites e virada do ano', () => {
  assert.deepEqual(reportPeriod({ month: '12', year: '2026' }), { month: 12, year: 2026, start: '2026-12-01', end: '2027-01-01' });
  for (const month of [0, 13, 1.2, 'abc']) assert.throws(() => reportPeriod({ month, year: 2026 }));
});
test('grava somente campos alterados e histórico/auditoria por campo; repetição não duplica', async () => {
  const original = pool.connect;
  const calls = [];
  let row = { ...current };
  pool.connect = async () => ({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id')) return { rows: [{ ...row }] };
    if (sql.startsWith('UPDATE employees')) row[sql.includes('current_salary') ? 'current_salary' : 'meal_allowance'] = params[0];
    return { rows: [] };
  }, release() {} });
  try {
    const body = payload({ current_salary: 2800, meal_allowance: 500 });
    assert.equal((await updateCompensation(current.id, body, user)).changes.length, 2);
    assert.equal(calls.filter((call) => call.sql.startsWith('INSERT INTO employee_')).length, 2);
    assert.equal(calls.filter((call) => call.sql.startsWith('INSERT INTO audit_logs')).length, 2);
    assert.ok(calls.some((call) => call.sql.includes('FOR UPDATE')));
    calls.length = 0;
    assert.equal((await updateCompensation(current.id, body, user)).changes.length, 0);
    assert.equal(calls.filter((call) => /^(INSERT|UPDATE)/.test(call.sql)).length, 0);
    assert.equal((await compensationReport({ month: 11, year: 2026 }, user)).rows.length, 0);
    assert.ok(calls.some((call) => call.sql.includes('previous_value IS NOT NULL') && call.sql.includes('previous_value <> h.new_value')));
  } finally { pool.connect = original; }
});
