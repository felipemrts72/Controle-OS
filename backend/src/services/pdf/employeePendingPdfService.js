import {
  addChecklist,
  addKeyValueGrid,
  addParagraph,
  addSectionTitle,
  createPdfDocument,
  ensurePageSpace,
  finalizePdf,
  formatDateBR,
  safeText,
} from './pdfDocument.js';

const REPORT_TIME_ZONE = 'America/Cuiaba';

function addEmployeeSignature(context, employeeName) {
  ensurePageSpace(context, 76);
  const { doc, margins } = context;
  const width = doc.page.width - margins.left - margins.right;
  const signatureWidth = Math.min(300, width * 0.64);
  const x = margins.left + (width - signatureWidth) / 2;
  const y = doc.y + 36;
  doc.strokeColor('#64748b').lineWidth(0.6)
    .moveTo(x, y)
    .lineTo(x + signatureWidth, y)
    .stroke();
  doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(8.5)
    .text(safeText(employeeName), x, y + 6, { width: signatureWidth, align: 'center' });
  doc.fillColor('#475569').font('Helvetica').fontSize(8)
    .text('Assinatura do funcionário', x, y + 19, { width: signatureWidth, align: 'center' });
  doc.y = y + 38;
}

export async function buildEmployeePendingReportPdf(employees, options = {}) {
  const emittedAt = options.emittedAt || new Date();
  const context = createPdfDocument({
    title: 'RELATÓRIO DE PENDÊNCIAS CADASTRAIS',
    subtitle: 'Documentos e informações necessários para conclusão do cadastro',
    company: options.company || {},
    emittedAt,
    timeZone: REPORT_TIME_ZONE,
    orientation: 'portrait',
    margins: { top: 32, right: 38, bottom: 46, left: 38 },
  });
  context.company = { ...(options.company || {}), logo: null };

  if (!employees.length) {
    addParagraph(context, 'Nenhuma pendência cadastral encontrada.', { fontSize: 10 });
    return finalizePdf(context);
  }

  employees.forEach((employee, index) => {
    if (index > 0) context.addPage();
    addKeyValueGrid(context, [
      { label: 'Nome', value: employee.full_name },
      { label: 'Cargo', value: employee.job_title || 'Não informado' },
      { label: 'Setor', value: employee.sector_name || 'Não informado' },
      { label: 'Data', value: formatDateBR(emittedAt, REPORT_TIME_ZONE) },
    ]);
    addSectionTitle(context, 'Pendências');
    if (employee.pendencies.length) {
      addChecklist(context, employee.pendencies);
    } else {
      addParagraph(context, 'Nenhuma pendência cadastral encontrada.', { color: '#475569', fontSize: 9.5 });
    }
    addEmployeeSignature(context, employee.full_name);
  });

  return finalizePdf(context);
}
