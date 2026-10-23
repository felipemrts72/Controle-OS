import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayDate, holidaysForYear } from '../backend/src/services/holidayService.js';
import { validateFutureDates } from '../backend/src/services/vacationService.js';
import { decemberPriority } from '../backend/src/services/vacationAlerts.js';
import { periodsFromAdmission } from '../backend/src/services/vacationRules.js';

test('feriados fixos e Sexta-feira Santa recorrem em anos diferentes', () => {
  const fixed = { name: 'Peixoto', month: 5, day: 13, active: true };
  const miner = { name: 'Garimpeiro', month: 7, day: 21, active: true };
  const friday = { name: 'Sexta-feira Santa', movable_rule: 'good_friday', active: true };
  assert.deepEqual(holidaysForYear([fixed, miner, friday], 2026).map((row) => row.date), ['2026-04-03', '2026-05-13', '2026-07-21']);
  assert.equal(holidayDate(friday, 2027), '2027-03-26');
  assert.equal(holidayDate(fixed, 2027), '2027-05-13');
});

test('ponto facultativo não bloqueia; feriado e repouso bloqueiam programação futura', async () => {
  const period = { concession_start: '2026-01-01', concession_end: '2026-12-01' };
  const optional = async (date) => date === '2026-11-03' ? [{ name: 'Ponto', classification: 'ponto_facultativo', no_work: false }] : [];
  await validateFutureDates('2026-11-02', '2026-11-06', period, '2026-09-01', '2026-10-01', optional);
  const legal = async (date) => date === '2026-11-03' ? [{ name: 'Feriado local', classification: 'feriado_legal', no_work: true }] : [];
  await assert.rejects(validateFutureDates('2026-11-02', '2026-11-06', period, '2026-09-01', '2026-10-01', legal), /Feriado local.*2026-11-03/);
  await assert.rejects(validateFutureDates('2026-11-06', '2026-11-10', period, '2026-09-01', '2026-10-01', optional), /repouso semanal/);
});

test('DSR domingo: quinta permitida; sexta, sábado e domingo bloqueados', async () => {
  const period = { concession_start: '2026-01-01', concession_end: '2026-12-31' };
  const args = [period, '2026-09-01', '2026-10-01'];
  const holidays = async () => [];
  await validateFutureDates('2026-11-05', '2026-11-09', ...args, holidays);
  for (const start of ['2026-11-06', '2026-11-07', '2026-11-08']) {
    await assert.rejects(validateFutureDates(start, '2026-11-12', ...args, holidays), (error) => error.message === 'Não é permitido iniciar férias nesta data devido ao descanso semanal remunerado de domingo.');
  }
  const sundayHoliday = async (date) => date === '2026-11-08' ? [{ name: 'Feriado no domingo', classification: 'feriado_legal', no_work: true }] : [];
  await assert.rejects(validateFutureDates('2026-11-06', '2026-11-12', ...args, sundayHoliday), (error) => error.message === 'Não é permitido iniciar férias nesta data devido ao descanso semanal remunerado de domingo.');
});

test('segundo aquisitivo não oculta primeiro prazo de dezembro; atraso mantém prioridade', () => {
  const periods = periodsFromAdmission('2024-12-11', '2026-10-23');
  assert.equal(periods[0].concession_end, '2026-12-10');
  assert.equal(periods[1].acquisition_end, '2026-12-10');
  assert.equal(decemberPriority({ ...periods[0], balance: 30 }, 2026, '2026-10-23'), 'Vencem até 31 de dezembro');
  assert.equal(decemberPriority({ ...periods[0], balance: 30 }, 2027, '2027-01-02'), 'Atrasadas');
});
