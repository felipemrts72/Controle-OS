import test from 'node:test';
import assert from 'node:assert/strict';
import { addCivilDays, endFromDays, inclusiveCivilDays, updateVacationDates } from '../src/pages/VacationsPage/vacationDates.js';
import { entitlementForPeriod } from '../backend/src/services/vacationService.js';
import { buildVacationAccountingPdf } from '../backend/src/services/pdf/vacationAccountingPdfService.js';
import { sendPdfResponse } from '../backend/src/services/pdf/pdfDocument.js';

test('datas civis contam o primeiro dia e atravessam mês, ano e fevereiro', () => {
  assert.equal(endFromDays('2026-12-21', 15), '2027-01-04');
  assert.equal(endFromDays('2026-12-21', 20), '2027-01-09');
  assert.equal(endFromDays('2026-12-21', 30), '2027-01-19');
  assert.equal(endFromDays('2028-02-28', 3), '2028-03-01');
  assert.equal(inclusiveCivilDays('2026-12-21', '2027-01-19'), 30);
  assert.equal(addCivilDays('2027-01-19', 1), '2027-01-20');
  assert.deepEqual(updateVacationDates({ start_date: '2026-12-21', days: 30, end_date: '2027-01-19' }, { days: 15 }), { start_date: '2026-12-21', days: 15, end_date: '2027-01-04' });
});

test('PDF de férias programadas sem pagamento confirmado é binário e disponível sem revisão manual', async () => {
  const period = { acquisition_start: '2025-01-01', acquisition_end: '2025-12-31', concession_start: '2026-01-01', concession_end: '2026-12-31', reviewed_at: null, special_case: false };
  const leave = { start_date: '2026-11-01', end_date: '2026-11-20', days: 20, bonus_days: 10, status: 'programada', payment_confirmed_at: null };
  const { entitlement } = entitlementForPeriod(period, [], [leave], '2026-10-23');
  assert.equal(entitlement, 30);
  const pdf = await buildVacationAccountingPdf({ employee: { id: 'test-employee', full_name: 'Funcionário Teste', admission_date: '2024-01-01', job_title: 'Operador', sector_name: 'Produção' }, period, leave, others: [], entitlement, company: { razao_social: 'Empresa Teste', cnpj: '12345678000190' } });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const headers = {};
  let body;
  const res = { headersSent: false, setHeader: (name, value) => { headers[name] = value; }, send: (value) => { body = value; } };
  assert.equal(sendPdfResponse(res, pdf, 'ferias-teste.pdf'), true);
  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /attachment; filename="ferias-teste.pdf"/);
  assert.equal(body, pdf);
});
