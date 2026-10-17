import test from 'node:test';
import assert from 'node:assert/strict';
import { article130Days, calendarDays, monthsInPeriod, periodsFromAdmission, validateFractions } from '../backend/src/services/vacationRules.js';

test('períodos aquisitivos e concessivos atravessam anos', () => {
  const periods = periodsFromAdmission('2024-03-10', '2026-10-16');
  assert.deepEqual(periods.map((p) => [p.acquisition_start, p.acquisition_end, p.concession_start, p.concession_end]), [
    ['2024-03-10', '2025-03-09', '2025-03-10', '2026-03-09'],
    ['2025-03-10', '2026-03-09', '2026-03-10', '2027-03-09'],
    ['2026-03-10', '2027-03-09', '2027-03-10', '2028-03-09'],
  ]);
});
test('meses parciais e ano bissexto', () => {
  const months = monthsInPeriod('2023-03-10', '2024-03-09');
  assert.equal(months.length, 13);
  assert.deepEqual(months[0], { month: '2023-03', start: '2023-03-10', end: '2023-03-31' });
  assert.deepEqual(months[11], { month: '2024-02', start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(months[12], { month: '2024-03', start: '2024-03-01', end: '2024-03-09' });
  assert.equal(periodsFromAdmission('2020-02-29', '2024-03-01')[1].acquisition_start, '2021-02-28');
});
test('faixas do artigo 130 consideram somente faltas integrais injustificadas', () => {
  for (const [count, expected] of [[0, 30], [5, 30], [6, 24], [14, 24], [15, 18], [23, 18], [24, 12], [32, 12], [33, 0]]) assert.equal(article130Days(count), expected);
});
test('frações, duração e saldo', () => {
  assert.equal(calendarDays('2026-07-01', '2026-07-14'), 14);
  assert.doesNotThrow(() => validateFractions([5, 14, 11], 30, true));
  assert.throws(() => validateFractions([3, 27], 30));
  assert.throws(() => validateFractions([10, 10, 10], 30, true));
  assert.throws(() => validateFractions([10, 10], 30));
  assert.throws(() => validateFractions([15, 16], 30));
});
