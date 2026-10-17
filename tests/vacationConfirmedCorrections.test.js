import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../backend/src/database/pool.js';
import { changeLeave, correctConfirmedLeave } from '../backend/src/services/vacationService.js';
import { validateLeaveCollection } from '../backend/src/services/vacationRules.js';
import { requirePermission } from '../backend/src/middlewares/authMiddleware.js';
import { vacationRoutes } from '../backend/src/routes/vacationRoutes.js';

const employeeId = '11111111-1111-4111-8111-111111111111';
const periodId = '22222222-2222-4222-8222-222222222222';
const leaveId = '33333333-3333-4333-8333-333333333333';
const actorId = '44444444-4444-4444-8444-444444444444';
const baseLeave = () => ({ id: leaveId, employee_id: employeeId, period_id: periodId, start_date: '2025-04-01', end_date: '2025-04-14', days: 14, status: 'gozada', version: 2 });

function fixture() {
  const state = { leave: baseLeave(), audits: [], commits: 0, rollbacks: 0 };
  const original = pool.connect;
  let locked = false;
  const waiters = [];
  pool.connect = async () => {
    let ownsLock = false;
    return {
    async query(sql, params = []) {
      const statement = String(sql).trim();
      if (statement === 'BEGIN') return { rows: [] };
      if (statement === 'COMMIT' || statement === 'ROLLBACK') {
        if (statement === 'COMMIT') state.commits += 1; else state.rollbacks += 1;
        if (ownsLock) { ownsLock = false; locked = false; waiters.shift()?.(); }
        return { rows: [] };
      }
      if (statement.startsWith('SELECT id, full_name, admission_date')) {
        if (locked) await new Promise((resolve) => waiters.push(resolve));
        locked = true; ownsLock = true;
        return { rows: [{ id: employeeId, employment_status: 'ativo' }] };
      }
      if (statement.startsWith('SELECT * FROM vacation_leaves WHERE id=')) return { rows: [state.leave] };
      if (statement.startsWith('SELECT * FROM vacation_periods WHERE id=')) return { rows: [{ id: periodId, employee_id: employeeId, concession_start: '2025-03-10', concession_end: '2026-03-09', reviewed_at: '2025-03-15', special_case: false }] };
      if (statement.startsWith('SELECT * FROM vacation_leaves WHERE employee_id=')) return { rows: [] };
      if (statement.startsWith('SELECT * FROM vacation_leaves WHERE period_id=')) return { rows: [] };
      if (statement.startsWith('SELECT quantity, classification FROM vacation_absences')) return { rows: [] };
      if (statement.startsWith('UPDATE vacation_leaves SET')) {
        state.leave = statement.includes('status=$1')
          ? { ...state.leave, status: params[0], version: state.leave.version + 1 }
          : statement.includes("status='cancelada'")
          ? { ...state.leave, status: 'cancelada', version: state.leave.version + 1 }
          : { ...state.leave, start_date: params[0], end_date: params[1], days: params[2], version: state.leave.version + 1 };
        return { rows: [state.leave] };
      }
      if (statement.startsWith('INSERT INTO vacation_audit')) { state.audits.push(params); return { rows: [] }; }
      throw new Error(`SQL não simulada: ${statement}`);
    },
    release() {},
  }; };
  return { state, restore: () => { pool.connect = original; } };
}

test('corrige baixa com versão, motivo, antes/depois e saldo na mesma transação', async () => {
  const { state, restore } = fixture();
  try {
    const result = await correctConfirmedLeave(employeeId, leaveId, { action: 'correct', version: 2, start_date: '2025-04-01', end_date: '2025-04-15', reason: 'Correção documental' }, actorId);
    assert.equal(result.leave.days, 15);
    assert.equal(result.balance, 15);
    assert.equal(state.commits, 1);
    assert.equal(state.audits.length, 1);
    assert.equal(JSON.parse(state.audits[0][5]).days, 14);
    assert.equal(JSON.parse(state.audits[0][6]).days, 15);
    assert.equal(state.audits[0][8], 'Correção documental');
  } finally { restore(); }
});

test('cancelamento lógico restaura saldo e rejeita segunda correção obsoleta', async () => {
  const { state, restore } = fixture();
  try {
    const result = await correctConfirmedLeave(employeeId, leaveId, { action: 'cancel', version: 2, reason: 'Baixa lançada por engano' }, actorId);
    assert.equal(result.leave.status, 'cancelada');
    assert.equal(result.balance, 30);
    assert.equal(state.audits[0][4], 'cancel_confirmed');
    await assert.rejects(correctConfirmedLeave(employeeId, leaveId, { action: 'cancel', version: 2, reason: 'Tentativa repetida' }, actorId), { status: 409 });
    assert.equal(state.audits.length, 1);
  } finally { restore(); }
});

test('correção sem motivo ou com versão antiga reverte sem auditoria', async () => {
  const { state, restore } = fixture();
  try {
    await assert.rejects(correctConfirmedLeave(employeeId, leaveId, { action: 'cancel', version: 2, reason: 'curto' }, actorId), { status: 400 });
    await assert.rejects(correctConfirmedLeave(employeeId, leaveId, { action: 'cancel', version: 1, reason: 'Correção repetida' }, actorId), { status: 409 });
    assert.equal(state.audits.length, 0);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 2);
  } finally { restore(); }
});

test('duas correções concorrentes serializam pelo funcionário e só uma confirma', async () => {
  const { state, restore } = fixture();
  try {
    const payload = { action: 'cancel', version: 2, reason: 'Baixa duplicada no histórico' };
    const results = await Promise.allSettled([
      correctConfirmedLeave(employeeId, leaveId, payload, actorId),
      correctConfirmedLeave(employeeId, leaveId, payload, actorId),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
    assert.equal(state.audits.length, 1);
    assert.equal(state.leave.version, 3);
  } finally { restore(); }
});

test('baixa repetida é rejeitada e não gera segunda auditoria', async () => {
  const { state, restore } = fixture();
  state.leave.status = 'programada';
  try {
    await changeLeave(employeeId, leaveId, 'confirm', actorId);
    await assert.rejects(changeLeave(employeeId, leaveId, 'confirm', actorId), { status: 409 });
    assert.equal(state.leave.status, 'gozada');
    assert.equal(state.audits.length, 1);
  } finally { restore(); }
});

test('integridade recusa saldo negativo, sobreposição e fracionamento inválido', () => {
  assert.throws(() => validateLeaveCollection([{ ...baseLeave(), days: 31 }], 30));
  assert.throws(() => validateLeaveCollection([baseLeave(), { ...baseLeave(), id: actorId }], 30));
  assert.throws(() => validateLeaveCollection([{ ...baseLeave(), days: 10 }, { ...baseLeave(), id: actorId, start_date: '2025-05-01', end_date: '2025-05-10', days: 10 }], 30));
});

test('correção de baixa confirmada exige permissão própria', () => {
  const middleware = requirePermission('vacations.confirmed.correct');
  let failure;
  middleware({ user: { permissions: ['vacations.correct'] } }, null, (error) => { failure = error; });
  assert.equal(failure.status, 403);
  middleware({ user: { permissions: ['vacations.confirmed.correct'] } }, null, (error) => { failure = error; });
  assert.equal(failure, undefined);
});

test('programação exige também conferência administrativa do calendário', () => {
  const route = vacationRoutes.stack.find((layer) => layer.route?.path === '/employees/:employeeId/periods/:periodId/leaves');
  assert.ok(route);
  let error;
  const user = { permissions: ['vacations.schedule'] };
  route.route.stack[0].handle({ user }, null, (nextError) => { error = nextError; });
  assert.equal(error, undefined);
  route.route.stack[1].handle({ user }, null, (nextError) => { error = nextError; });
  assert.equal(error.status, 403);
});
