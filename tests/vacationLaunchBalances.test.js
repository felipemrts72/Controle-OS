import test from 'node:test';
import assert from 'node:assert/strict';
import { vacationBalances, validateLeaveCollection } from '../backend/src/services/vacationRules.js';

test('gozo, programação e cancelamento têm efeitos distintos no saldo', () => {
  const leaves = [
    { status: 'gozada', days: 15, start_date: '2026-01-01', end_date: '2026-01-15' },
    { status: 'programada', days: 10, start_date: '2026-11-01', end_date: '2026-11-10' },
    { status: 'cancelada', days: 5, start_date: '2026-12-01', end_date: '2026-12-05' },
  ];
  assert.deepEqual(vacationBalances(30, leaves), { taken: 15, planned: 10, balance: 15, free_balance: 5 });
  assert.deepEqual(vacationBalances(30, [{ ...leaves[0] }, { ...leaves[1], status: 'gozada' }]), { taken: 25, planned: 0, balance: 5, free_balance: 5 });
  assert.deepEqual(vacationBalances(null, leaves), { taken: 15, planned: 10, balance: null, free_balance: null });
});

test('frações ativas não ultrapassam o direito e datas sobrepostas são recusadas', () => {
  assert.throws(() => validateLeaveCollection([
    { status: 'gozada', days: 15, start_date: '2026-01-01', end_date: '2026-01-15' },
    { status: 'programada', days: 16, start_date: '2026-11-01', end_date: '2026-11-16' },
  ], 30));
  assert.throws(() => validateLeaveCollection([
    { status: 'gozada', days: 15, start_date: '2026-01-01', end_date: '2026-01-15' },
    { status: 'programada', days: 10, start_date: '2026-01-10', end_date: '2026-01-19' },
  ], 30));
});
