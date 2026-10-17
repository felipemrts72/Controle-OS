import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneralAdvanceReportPdf, buildIndividualAdvanceReportPdf } from '../backend/src/services/pdf/advancePdfService.js';
import { buildAwardTermPdf } from '../backend/src/services/pdf/awardPdfService.js';
import { buildEmployeeProfilePdf } from '../backend/src/services/pdf/employeePdfService.js';
import { formatDateBR } from '../backend/src/services/pdf/pdfDocument.js';
import { buildPurchaseQuotePdf } from '../backend/src/services/pdf/purchaseQuotePdfService.js';

const entryDate = new Date('2026-09-08T12:00:00.000Z');

function reportFixture(filter) {
  return {
    employee: {
      full_name: 'Colaborador Teste',
      job_title: 'Operador',
      sector_name: 'Produção',
    },
    filter,
    entries: [{
      id: 'advance-1',
      entry_type: 'individual',
      receipt_at: entryDate,
      amount: '2511.66',
      source_bank: 'Banco Teste',
    }],
    total_amount: '2511.66',
    future_plans: [],
  };
}

test('formatDateBR formata Date e string ISO em dd/mm/aaaa', () => {
  assert.equal(formatDateBR(entryDate), '08/09/2026');
  assert.equal(formatDateBR('2026-08-01'), '01/08/2026');
});

test('formatDateBR funciona sem timezone explícita e preserva timezone válida', () => {
  assert.match(formatDateBR(new Date('2026-09-08T12:00:00.000Z')), /^\d{2}\/\d{2}\/\d{4}$/);
  assert.equal(formatDateBR(new Date('2026-09-08T02:00:00.000Z'), 'America/Cuiaba'), '07/09/2026');
  assert.throws(
    () => formatDateBR(entryDate, 'Timezone/Inexistente'),
    /Invalid time zone/,
  );
});

test('formatDateBR ignora objeto de contexto recebido como argumento extra de callback', () => {
  const tableRow = { date: entryDate, amount: '2511.66', origin: 'Vale individual' };
  assert.doesNotThrow(() => formatDateBR(tableRow.date, tableRow));
  assert.equal(formatDateBR(tableRow.date, tableRow), '08/09/2026');
});

test('formatDateBR trata null e undefined', () => {
  assert.equal(formatDateBR(null), '-');
  assert.equal(formatDateBR(undefined), '-');
});

for (const [mode, filter] of [
  ['período', { type: 'period', period: { from: '2026-08-01', to: '2026-09-08' } }],
  ['ciclo atual', { type: 'cycle', cycle: { opened_at: '2026-08-01', closed_at: null, status: 'open', opened_by_name: 'Administrador' } }],
]) {
  test(`PDF individual por ${mode} gera buffer válido sem Invalid time zone`, async () => {
    const report = reportFixture(filter);
    let pdf;
    await assert.doesNotReject(async () => {
      pdf = await buildIndividualAdvanceReportPdf(report);
    });
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1_000);
    assert.equal(report.total_amount, '2511.66');
    assert.equal(report.entries[0].amount, '2511.66');
  });
}

test('PDFs compartilhados de vales, funcionários, compras e prêmios continuam válidos', async () => {
  const documents = await Promise.all([
    buildGeneralAdvanceReportPdf({
      filter: { type: 'period', period: { from: '2026-08-01', to: '2026-09-08' } },
      rows: [{ employee_name: 'Colaborador Teste', total_amount: '2511.66' }],
      total_amount: '2511.66',
    }),
    buildEmployeeProfilePdf({
      employee: { full_name: 'Colaborador Teste', birth_date: entryDate, admission_date: '2026-08-01', employment_status: 'ativo' },
      dependents: [{ full_name: 'Dependente Teste', relationship: 'Filho', birth_date: entryDate }],
    }),
    buildPurchaseQuotePdf({
      number: 'COT-1', request_number: 'SOL-1', response_deadline: entryDate,
      items: [{ description: 'Item Teste', quantity: 1, unit: 'un' }],
    }),
    buildAwardTermPdf({
      award_date: entryDate,
      employee_name_snapshot: 'Colaborador Teste',
      amount: '100.00',
      performance_description: 'Desempenho de teste.',
      company_name_snapshot: 'Empresa Teste',
      representative_name_snapshot: 'Representante Teste',
      representative_job_title_snapshot: 'Gerente',
    }),
  ]);

  for (const pdf of documents) assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
