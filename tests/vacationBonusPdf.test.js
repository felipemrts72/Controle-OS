import test from 'node:test';
import assert from 'node:assert/strict';
import { vacationBalances, validateLeaveCollection } from '../backend/src/services/vacationRules.js';
import { buildVacationAccountingPdf } from '../backend/src/services/pdf/vacationAccountingPdfService.js';

test('abono reduz saldo uma vez, respeita um terço e cancelamento devolve saldo', () => {
  const leave = { start_date: '2026-11-01', end_date: '2026-11-20', days: 20, status: 'programada', bonus_days: 10 };
  validateLeaveCollection([leave], 30);
  assert.equal(vacationBalances(30, [leave]).free_balance, 0);
  assert.equal(vacationBalances(30, [{ ...leave, status: 'gozada' }]).balance, 0);
  assert.equal(vacationBalances(30, [{ ...leave, status: 'cancelada' }]).free_balance, 30);
  assert.throws(() => validateLeaveCollection([{ ...leave, bonus_days: 11 }], 30));
  assert.throws(() => validateLeaveCollection([leave, { ...leave, start_date: '2026-12-01', end_date: '2026-12-05', days: 5, bonus_days: 1 }], 30));
});

test('PDF administrativo é gerado em memória', async () => {
  const pdf = await buildVacationAccountingPdf({
    employee: { full_name: 'Funcionário Teste', admission_date: '2024-01-01', job_title: 'Operador', sector_name: 'Produção' },
    period: { acquisition_start: '2024-01-01', acquisition_end: '2024-12-31', concession_start: '2025-01-01', concession_end: '2025-12-31' },
    leave: { start_date: '2025-11-01', end_date: '2025-11-20', days: 20, bonus_days: 10, bonus_requested_at: '2024-12-01', notes: 'Conferido' },
    others: [], entitlement: 30, company: { razao_social: 'Empresa Teste', cnpj: '12345678000190' },
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 1000);
});
