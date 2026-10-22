import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonths, periodsFromAdmission } from '../backend/src/services/vacationRules.js';
import { alertForPeriod, decorateVacationPeriods, matchesVacationFilter } from '../backend/src/services/vacationAlerts.js';

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
