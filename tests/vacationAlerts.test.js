import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonths, businessToday, periodsFromAdmission, vacationBalances } from '../backend/src/services/vacationRules.js';
import { alertForPeriod, decemberPriority, decorateVacationPeriods, matchesVacationFilter } from '../backend/src/services/vacationAlerts.js';

const today = '2026-10-22';
const period = (overrides = {}) => ({ acquisition_start: '2024-01-01', acquisition_end: '2024-12-31', concession_end: '2026-02-28', balance: 30, leaves: [], ...overrides });

test('ciclos aquisitivos seguem aniversários e não são reiniciados por férias individuais', () => {
  const result = periodsFromAdmission('2024-02-29', '2026-10-22');
  assert.equal(result[0].acquisition_end, '2025-02-27');
  assert.equal(result[1].acquisition_start, '2025-02-28');
  assert.equal(result[1].concession_end, '2027-02-27');
});

test('quatro meses são de calendário e os limites são inclusivos', () => {
  assert.equal(addCalendarMonths('2026-10-31', 4), '2027-02-28');
  assert.equal(addCalendarMonths(today, 4), '2027-02-22');
  assert.equal(alertForPeriod(period({ concession_end: today }), today).due_soon, true);
  assert.equal(alertForPeriod(period({ concession_end: '2027-02-22' }), today).due_soon, true);
  assert.equal(alertForPeriod(period({ concession_end: '2027-02-23' }), today).due_soon, false);
  assert.equal(alertForPeriod(period({ concession_end: '2026-10-21' }), today).overdue, true);
  assert.equal(alertForPeriod(period({ concession_end: '2026-10-21' }), today).due_soon, false);
});

test('saldo confirmado, gozo parcial, programação e conferência', () => {
  assert.equal(alertForPeriod(period({ balance: 0 }), today).acquired, false);
  assert.equal(alertForPeriod(period({ balance: 10 }), today).acquired, true);
  const planned = alertForPeriod(period({ balance: 10, concession_end: '2027-01-01', leaves: [{ status: 'programada', start_date: '2026-11-01', end_date: '2026-11-10', days: 10 }] }), today);
  assert.equal(planned.planned_before_due, 10);
  assert.equal(planned.planned_may_clear, true);
  assert.equal(planned.acquired, true);
  const unknown = alertForPeriod(period({ balance: null }), today);
  assert.equal(unknown.acquired, true);
  assert.equal(unknown.needs_review, true);
  assert.equal(alertForPeriod(period({ acquisition_end: today, balance: null }), today).acquired, false);
});

test('filtros compartilham a classificação do cartão', () => {
  const [overdue, upcoming] = decorateVacationPeriods([period(), period({ concession_end: '2027-01-10' })], today);
  assert.equal(matchesVacationFilter(overdue, 'overdue'), true);
  assert.equal(matchesVacationFilter(overdue, 'due_soon'), false);
  assert.equal(matchesVacationFilter(upcoming, 'due_soon'), true);
  assert.equal(matchesVacationFilter(upcoming, 'acquired'), true);
});

test('planejamento abate programacao ativa, gozo e abono por periodo', () => {
  const schedule = (days, change = {}) => ({ status: 'programada', start_date: '2026-11-01', end_date: '2026-11-30', days, ...change });
  const cases = [
    [[], 30, false],
    [[schedule(30)], 0, true],
    [[schedule(14)], 16, true],
    [[schedule(14), schedule(16)], 0, true],
    [[schedule(30, { status: 'cancelada' })], 30, false],
    [[schedule(30, { status: 'gozada' })], 0, false],
    [[schedule(30, { end_date: '2026-10-20' })], 0, false],
    [[schedule(14, { status: 'historica', bonus_days: 2 }), schedule(9)], 5, true],
  ];
  for (const [leaves, remaining, scheduled] of cases) {
    const summary = period({ concession_end: '2026-12-10', leaves, ...vacationBalances(30, leaves) });
    const alert = alertForPeriod(summary, today);
    assert.equal(summary.free_balance, remaining);
    assert.equal(Boolean(decemberPriority(summary, 2026, today)), remaining > 0);
    assert.equal(alert.due_soon, remaining > 0);
    assert.equal(alert.scheduled, scheduled);
  }
  const leaves = [schedule(30)];
  const summary = period({ leaves, ...vacationBalances(30, leaves) });
  assert.equal(alertForPeriod(summary, today).overdue, true);
  assert.equal(alertForPeriod({ ...summary, concession_end: '2026-11-28' }, today).concession_risk, true);
});

test('dashboard conta funcionarios distintos e reflete alteracoes da fonte por periodo', async () => {
  const { pool } = await import('../backend/src/database/pool.js');
  const { listVacationEmployees } = await import('../backend/src/services/vacationService.js');
  const original = pool.connect;
  const current = businessToday();
  const people = ['Joao', 'Pedro'].map((full_name) => ({ id: full_name, full_name, admission_date: '2020-01-01' }));
  const ranges = periodsFromAdmission('2020-01-01', current);
  const periods = [
    { ...ranges[0], id: 'j1', employee_id: 'Joao' },
    { ...ranges[1], id: 'j2', employee_id: 'Joao' },
    { ...ranges[0], id: 'p1', employee_id: 'Pedro' },
  ];
  const schedule = (id, employee_id, period_id, days, date) => ({ id, employee_id, period_id, status: 'programada', start_date: date, end_date: date, notice_date: '2020-01-01', days });
  const leaves = [schedule('a', 'Joao', 'j1', 14, '2190-02-01'), schedule('b', 'Joao', 'j1', 16, '2190-03-01'), schedule('c', 'Pedro', 'p1', 30, '2190-01-01')];
  pool.connect = async () => ({
    release() {},
    async query(sql) {
      if (sql.includes('FROM employees')) return { rows: people };
      if (sql.includes('FROM vacation_periods')) return { rows: periods };
      if (sql.includes('FROM vacation_leaves')) return { rows: leaves };
      return { rows: [] };
    },
  });
  try {
    const query = () => listVacationEmployees({ filter: 'scheduled' });
    const initial = await query();
    assert.equal(initial.indicators.scheduled, 2);
    assert.equal(initial.indicators.december, 2);
    assert.deepEqual(initial.employees.map(({ id }) => id), ['Pedro', 'Joao']);
    const joao = initial.employees[1];
    assert.equal(joao.periods.find(({ id }) => id === 'j1').free_balance, 0);
    assert.equal(joao.periods.find(({ id }) => id === 'j2').free_balance, 30);
    leaves[1].days = 10;
    assert.equal((await query()).employees[1].periods.find(({ id }) => id === 'j1').free_balance, 6);
    leaves[0].status = 'cancelada';
    leaves[1].status = 'gozada';
    const changed = await query();
    assert.equal(changed.indicators.scheduled, 1);
    assert.deepEqual(changed.employees.map(({ id }) => id), ['Pedro']);
  } finally {
    pool.connect = original;
  }
});
