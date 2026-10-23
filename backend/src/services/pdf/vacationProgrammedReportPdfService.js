import { addDays } from '../vacationRules.js';
import { addParagraph, createPdfDocument, ensurePageSpace, finalizePdf, formatCpfBR, formatDateBR, safeText } from './pdfDocument.js';

const timezone = 'America/Cuiaba';
const date = (value) => formatDateBR(value, timezone);

export function summarizeProgrammedVacations(rows) {
  const employees = new Set(rows.map((row) => row.employee_id));
  const bonusByPeriod = new Map();
  for (const row of rows) bonusByPeriod.set(row.period_id, Math.max(bonusByPeriod.get(row.period_id) || 0, Number(row.bonus_days || 0)));
  return {
    employees: employees.size,
    programs: rows.length,
    days: rows.reduce((sum, row) => sum + Number(row.days), 0),
    bonus: [...bonusByPeriod.values()].reduce((sum, days) => sum + days, 0),
  };
}

function addProgramCard(context, row) {
  const { doc, margins } = context;
  const x = margins.left;
  const width = doc.page.width - margins.left - margins.right;
  doc.font('Helvetica-Bold').fontSize(10.5);
  const nameHeight = Math.max(15, doc.heightOfString(safeText(row.full_name), { width: width - 28 }));
  const cardHeight = 105 + nameHeight;
  ensurePageSpace(context, cardHeight + 10);
  const y = doc.y;
  doc.save();
  doc.roundedRect(x, y, width, cardHeight, 6).fillAndStroke('#f8fafc', '#cbd5e1');
  doc.fillColor('#1f3a5f').font('Helvetica-Bold').fontSize(10.5)
    .text(safeText(row.full_name), x + 13, y + 11, { width: width - 26 });
  const metaY = y + 13 + nameHeight;
  const cpf = row.cpf ? ` · CPF: ${formatCpfBR(row.cpf)}` : '';
  doc.fillColor('#475569').font('Helvetica').fontSize(8.3)
    .text(`Cargo: ${safeText(row.job_title, 'Não informado')}${cpf}`, x + 13, metaY, { width: width - 26, lineBreak: false });
  const left = x + 13;
  const right = x + width / 2 + 5;
  const halfWidth = width / 2 - 20;
  const line = (label, value, textX, textY) => doc.fillColor('#1f2937').font('Helvetica').fontSize(9)
    .text(`${label}: ${value}`, textX, textY, { width: halfWidth, lineBreak: false });
  const firstY = metaY + 19;
  line('Início', date(row.start_date), left, firstY);
  line('Término', date(row.end_date), right, firstY);
  line('Dias de gozo', String(row.days), left, firstY + 17);
  line('Abono pecuniário', `${Number(row.bonus_days || 0)} dias`, right, firstY + 17);
  line('Retorno previsto', date(addDays(row.end_date, 1)), left, firstY + 34);
  doc.fillColor('#475569').font('Helvetica').fontSize(8.3)
    .text(`Período aquisitivo: ${date(row.acquisition_start)} a ${date(row.acquisition_end)}`, left, firstY + 57, { width: width - 26, lineBreak: false });
  doc.restore();
  doc.y = y + cardHeight + 10;
}

export async function buildVacationProgrammedReportPdf({ rows, company, range = {}, emittedAt = new Date() }) {
  const sorted = [...rows].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.full_name).localeCompare(String(b.full_name), 'pt-BR') || String(a.id).localeCompare(String(b.id)));
  const totals = summarizeProgrammedVacations(sorted);
  const interval = range.start || range.end ? `Programações com gozo no intervalo: ${range.start ? date(range.start) : 'sem início definido'} a ${range.end ? date(range.end) : 'sem fim definido'}` : 'Todas as férias programadas';
  const context = createPdfDocument({ title: 'RELATÓRIO GERAL DE FÉRIAS PROGRAMADAS', subtitle: interval, company: { ...company, nome_fantasia: company.razao_social || company.nome_fantasia }, emittedAt, timeZone: timezone });
  addParagraph(context, `${totals.employees} funcionário(s) · ${totals.programs} programação(ões) · ${totals.days} dias de gozo · ${totals.bonus} dias de abono pecuniário`, { bold: true, fontSize: 9.3, spacingAfter: 12 });
  for (const row of sorted) addProgramCard(context, row);
  return finalizePdf(context);
}
