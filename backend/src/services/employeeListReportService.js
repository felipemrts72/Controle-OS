import ExcelJS from 'exceljs';
import { createPdfDocument, ensurePageSpace, formatDateBR, safeText } from './pdf/pdfDocument.js';

const statusLabel = (value) => ({ ativo: 'Ativo', afastado: 'Afastado', desligado: 'Inativo' })[value] || 'Inativo';
const period = ({ admission_from: from, admission_to: to }) => `${from ? formatDateBR(from) : 'Sem limite'} a ${to ? formatDateBR(to) : 'Sem limite'}`;
const dateOnly = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;

export async function buildEmployeeListPdf(rows, query, emittedAt = new Date()) {
  const context = createPdfDocument({ title: 'Relatório de Funcionários', subtitle: `Período de admissão: ${period(query)}  |  Total de funcionários: ${rows.length}`, company: { nome_fantasia: 'OliMen Gestão' }, emittedAt, timeZone: 'America/Cuiaba', margins: { top: 34, left: 32, right: 32, bottom: 40 } });
  const { doc, margins } = context;
  const widths = [154, 77, 105, 105, 60];
  const headers = ['Funcionário', 'Admissão', 'Cargo', 'Setor', 'Situação'];
  const drawRow = (cells, header = false) => {
    const x = margins.left;
    const height = header ? 24 : Math.max(21, ...cells.map((cell, i) => doc.heightOfString(safeText(cell), { width: widths[i] - 10, fontSize: 8 }) + 8));
    if (ensurePageSpace(context, height + (header ? 0 : 26)) && !header) drawRow(headers, true);
    const top = doc.y;
    if (header) doc.fillColor('#e8eef5').rect(x, top, widths.reduce((a, b) => a + b), height).fill();
    let left = x;
    cells.forEach((cell, i) => {
      doc.fillColor('#1f2937').font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 8.5 : 8)
        .text(safeText(cell), left + 5, top + 6, { width: widths[i] - 10, height: height - 8, ellipsis: true });
      left += widths[i];
    });
    doc.y = top + height;
  };
  drawRow(headers, true);
  if (!rows.length) doc.font('Helvetica').fontSize(9).text('Nenhum funcionário encontrado.', margins.left, doc.y + 10);
  rows.forEach((row) => drawRow([row.full_name, formatDateBR(dateOnly(row.admission_date)), row.job_title || '-', row.sector_name || '-', statusLabel(row.employment_status)]));
  doc.end();
  return context.finished;
}

export async function buildEmployeeListExcel(rows, query, emittedAt = new Date()) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OliMen Gestão';
  const sheet = workbook.addWorksheet('Funcionários', { views: [{ state: 'frozen', ySplit: 6 }] });
  sheet.columns = [{ width: 38 }, { width: 19 }, { width: 28 }, { width: 28 }, { width: 16 }];
  sheet.mergeCells('A1:E1'); sheet.getCell('A1').value = 'OliMen Gestão';
  sheet.mergeCells('A2:E2'); sheet.getCell('A2').value = 'Relatório de Funcionários';
  sheet.mergeCells('A3:E3'); sheet.getCell('A3').value = `Período de admissão: ${period(query)}`;
  sheet.mergeCells('A4:E4'); sheet.getCell('A4').value = `Data de emissão: ${emittedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba' })}  |  Total de funcionários: ${rows.length}`;
  sheet.getRow(6).values = ['Funcionário', 'Data de admissão', 'Cargo', 'Setor', 'Situação'];
  for (const row of rows) {
    const iso = dateOnly(row.admission_date);
    const item = sheet.addRow([row.full_name, iso ? new Date(`${iso}T12:00:00Z`) : null, row.job_title || '', row.sector_name || '', statusLabel(row.employment_status)]);
    item.getCell(2).numFmt = 'dd/mm/yyyy';
  }
  for (const number of [1, 2, 6]) { sheet.getRow(number).font = { bold: true, color: { argb: number === 6 ? 'FFFFFFFF' : 'FF1F3A5F' } }; }
  sheet.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
  sheet.autoFilter = { from: 'A6', to: `E${Math.max(6, sheet.rowCount)}` };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
