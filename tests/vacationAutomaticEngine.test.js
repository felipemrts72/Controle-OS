import test from 'node:test';
import assert from 'node:assert/strict';
import { vacationComplianceAlerts, vacationStatus, validateLeaveCollection } from '../backend/src/services/vacationRules.js';

const period = { acquisition_end: '2025-01-01', concession_end: '2026-01-01' };
const leave = (days, status, bonus_days = 0, start_date = '2025-02-01') => ({ days, status, bonus_days, start_date, end_date: new Date(Date.parse(`${start_date}T00:00:00Z`) + (days - 1) * 86400000).toISOString().slice(0, 10) });
const status = (leaves) => vacationStatus(period, 30, leaves, '2025-08-01');

test('gozo integral e gozo com abono concluem o período', () => {
  assert.equal(status([leave(30, 'gozada')]).status, 'CONCLUÍDO — SALDO 0 DIAS');
  assert.equal(status([leave(20, 'gozada', 10)]).balance, 0);
  assert.equal(status([leave(15, 'historica', 10), leave(5, 'gozada', 0, '2025-03-01')]).balance, 0);
  assert.equal(status([leave(14, 'historica', 10), leave(6, 'gozada', 0, '2025-03-01')]).status, 'CONCLUÍDO — SALDO 0 DIAS');
});

test('excesso de direito e fração futura ilegal são bloqueados', () => {
  assert.throws(() => validateLeaveCollection([leave(15, 'historica'), leave(15, 'programada', 10, '2025-03-01')], 30), /ultrapassaria/);
  assert.throws(() => validateLeaveCollection([leave(4, 'programada')], 30), /pelo menos 5/);
  assert.throws(() => validateLeaveCollection([leave(10, 'programada', 0), leave(10, 'programada', 0, '2025-03-01')], 30), /14 dias/);
});

test('abono duplicado e histórico irregular são identificados sem perda do registro', () => {
  assert.throws(() => validateLeaveCollection([leave(14, 'historica', 5), leave(6, 'programada', 5, '2025-03-01')], 30), /Já existe abono/);
  assert.equal(status([leave(4, 'historica', 10)]).free_balance, 16);
  assert.match(vacationComplianceAlerts([leave(4, 'historica', 10)], 'historical_estimate', 16).join(' '), /Fracionamento histórico/);
});

test('edição e cancelamento recalculam o saldo sem contar duas vezes', () => {
  assert.equal(status([leave(15, 'gozada'), leave(10, 'programada', 0, '2025-03-01')]).free_balance, 5);
  assert.equal(status([leave(15, 'gozada'), leave(5, 'programada', 0, '2025-03-01')]).free_balance, 10);
  assert.equal(status([leave(15, 'gozada'), leave(5, 'cancelada', 0, '2025-03-01')]).free_balance, 15);
});
