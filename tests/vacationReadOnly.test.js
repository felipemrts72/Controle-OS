import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../backend/src/database/pool.js';
import { getEmployeeVacations, listVacationEmployees } from '../backend/src/services/vacationService.js';

const employeeId = '11111111-1111-4111-8111-111111111111';
const person = { id: employeeId, full_name: 'QA Férias sintético', admission_date: '2025-03-10', employment_status: 'ativo' };

test('GET de listagem e detalhe projeta períodos estáveis sem executar escrita', async () => {
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  const statements = [];
  const respond = async (sql) => {
    const statement = String(sql).trim();
    statements.push(statement);
    if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'SET TRANSACTION READ ONLY') return { rows: [] };
    if (statement.startsWith('SELECT id, full_name, admission_date, employment_status FROM employees WHERE deleted_at')) return { rows: [person] };
    if (statement.startsWith('SELECT id, full_name, admission_date, employment_status FROM employees WHERE id=')) return { rows: [person] };
    if (statement.startsWith('SELECT * FROM vacation_periods WHERE employee_id')) return { rows: [] };
    if (statement.startsWith('SELECT * FROM vacation_absences WHERE employee_id')) return { rows: [] };
    if (statement.startsWith('SELECT * FROM vacation_leaves WHERE employee_id')) return { rows: [] };
    if (statement.startsWith('SELECT a.*, u.name AS actor_name')) return { rows: [] };
    throw new Error(`SQL inesperada: ${statement}`);
  };
  pool.query = respond;
  pool.connect = async () => ({ query: respond, release() {} });
  try {
    const list = await listVacationEmployees('QA Férias');
    const detail = await getEmployeeVacations(employeeId);
    assert.equal(list.employees.length, 1);
    assert.deepEqual(list.employees[0].periods.map((p) => p.id), detail.periods.map((p) => p.id));
    assert.ok(detail.periods.every((p) => p.status === 'PENDENTE DE CONFERÊNCIA' || p.status === 'EM AQUISIÇÃO'));
    assert.ok(statements.includes('SET TRANSACTION READ ONLY'));
    assert.equal(statements.filter((sql) => /^(INSERT|UPDATE|DELETE|ALTER|CREATE|TRUNCATE)\b/i.test(sql)).length, 0);
  } finally {
    pool.connect = originalConnect;
    pool.query = originalQuery;
  }
});
