import test from 'node:test';
import assert from 'node:assert/strict';
import { vacationProgrammedReport, reportDateRange } from '../backend/src/services/vacationProgrammedReportService.js';
import { buildVacationProgrammedReportPdf, summarizeProgrammedVacations } from '../backend/src/services/pdf/vacationProgrammedReportPdfService.js';
import { requirePermission } from '../backend/src/middlewares/authMiddleware.js';
import { sendPdfResponse } from '../backend/src/services/pdf/pdfDocument.js';

const rows = [
  { id: 'l1', employee_id: 'e1', period_id: 'p1', full_name: 'Ana Teste', job_title: 'Operadora', cpf: null, start_date: '2026-12-21', end_date: '2027-01-03', days: 14, bonus_days: 10, acquisition_start: '2025-01-01', acquisition_end: '2025-12-31' },
  { id: 'l2', employee_id: 'e1', period_id: 'p1', full_name: 'Ana Teste', job_title: 'Operadora', cpf: null, start_date: '2027-02-01', end_date: '2027-02-06', days: 6, bonus_days: 10, acquisition_start: '2025-01-01', acquisition_end: '2025-12-31' },
  { id: 'l3', employee_id: 'e2', period_id: 'p2', full_name: 'Beto Teste', job_title: 'Soldador', cpf: '12345678909', start_date: '2027-03-01', end_date: '2027-03-20', days: 20, bonus_days: 0, acquisition_start: '2025-03-01', acquisition_end: '2026-02-28' },
];

test('relatório separa programações fracionadas e não duplica abono do mesmo período', async () => {
  assert.deepEqual(summarizeProgrammedVacations(rows), { employees: 2, programs: 3, days: 40, bonus: 10 });
  const pdf = await buildVacationProgrammedReportPdf({ rows, company: { razao_social: 'Empresa Teste', cnpj: '12345678000190' }, emittedAt: new Date('2026-10-23T12:00:00Z') });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 2000);
});

test('rota usa somente programadas, filtra por sobreposição e não pagina', async () => {
  let sql; let params;
  const result = await vacationProgrammedReport({ start_date: '2026-12-01', end_date: '2027-03-31' }, {
    query: async (statement, values) => { sql = statement; params = values; return { rows }; },
    getCompanyPdfData: async () => ({ razao_social: 'Empresa Teste' }),
    buildPdf: async () => Buffer.from('%PDF-test'),
    emittedAt: new Date('2026-10-23T12:00:00Z'),
  });
  assert.match(sql, /l\.status = 'programada'/);
  assert.match(sql, /l\.end_date >= \$1::date/);
  assert.match(sql, /l\.start_date <= \$2::date/);
  assert.doesNotMatch(sql, /\bLIMIT\b|\bOFFSET\b/i);
  assert.deepEqual(params, ['2026-12-01', '2027-03-31']);
  assert.equal(result.filename, 'Ferias_Programadas_2026-10-23.pdf');
  assert.deepEqual(reportDateRange({}), { start: null, end: null });
  await assert.rejects(() => vacationProgrammedReport({}, { query: async () => ({ rows: [] }) }), /Nenhuma férias programada/);
});

test('download PDF requer permissão e transmite binário autenticado', () => {
  const permission = requirePermission('vacations.view');
  let allowed = false;
  permission({ user: { permissions: ['vacations.view'] } }, {}, (error) => { assert.equal(error, undefined); allowed = true; });
  assert.equal(allowed, true);
  permission({ user: { permissions: [] } }, {}, (error) => assert.equal(error.status, 403));
  const headers = {}; let body;
  const res = { headersSent: false, setHeader: (key, value) => { headers[key] = value; }, send: (value) => { body = value; } };
  const pdf = Buffer.from('%PDF-test');
  sendPdfResponse(res, pdf, 'Ferias_Programadas_2026-10-23.pdf');
  assert.equal(headers['Content-Type'], 'application/pdf');
  assert.match(headers['Content-Disposition'], /attachment/);
  assert.equal(body, pdf);
});
