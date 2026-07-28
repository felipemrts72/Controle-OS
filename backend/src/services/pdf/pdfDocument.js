import PDFDocument from 'pdfkit';

const PRODUCT_NAME = 'OliMen Gestão';
const DEFAULT_MARGINS = { top: 42, right: 42, bottom: 52, left: 42 };
const COLORS = {
  primary: '#1f3a5f',
  text: '#1f2937',
  muted: '#64748b',
  border: '#cbd5e1',
  surface: '#f1f5f9',
  white: '#ffffff',
};

export function safeText(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return text || fallback;
}

export function formatDateBR(value) {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('pt-BR');
}

export function formatDateTimeBR(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
}

export function formatCurrencyBR(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ')
    : '-';
}

export function formatCpfBR(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return safeText(value);
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatPhoneBR(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return safeText(value);
}

export function formatAddressBR(address = {}) {
  return [
    [address.street, address.address_number].filter(Boolean).join(', '),
    address.complement,
    address.neighborhood,
    [address.city, address.state].filter(Boolean).join(' - '),
    address.zip_code ? `CEP ${address.zip_code}` : null,
  ].filter(Boolean).join(' | ') || '-';
}

function contentWidth(context) {
  return context.doc.page.width - context.margins.left - context.margins.right;
}

export function addDocumentHeader(context) {
  const { doc, margins, title, subtitle, institutionalName, emittedAt } = context;
  const width = contentWidth(context);
  let y = margins.top;

  doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(9)
    .text(safeText(institutionalName || PRODUCT_NAME), margins.left, y, { width });
  y += 17;

  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(17)
    .text(safeText(title), margins.left, y, { width });
  y = doc.y + 4;

  if (subtitle) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
      .text(safeText(subtitle), margins.left, y, { width: width * 0.7 });
    y = Math.max(doc.y, y + 12);
  }

  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
    .text(`Emitido em ${formatDateTimeBR(emittedAt)}`, margins.left, y, { width, align: 'right' });
  y = Math.max(doc.y, y + 12) + 7;

  doc.strokeColor(COLORS.primary).lineWidth(1)
    .moveTo(margins.left, y)
    .lineTo(doc.page.width - margins.right, y)
    .stroke();
  doc.y = y + 14;
  doc.fillColor(COLORS.text);
}

export function createPdfDocument({
  title,
  subtitle = '',
  institutionalName = '',
  orientation = 'portrait',
  margins = DEFAULT_MARGINS,
  emittedAt = new Date(),
} = {}) {
  const normalizedMargins = { ...DEFAULT_MARGINS, ...margins };
  const layout = orientation === 'landscape' ? 'landscape' : 'portrait';
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: 'A4',
    layout,
    margins: normalizedMargins,
    info: {
      Title: safeText(title, 'Documento administrativo'),
      Author: PRODUCT_NAME,
      Creator: PRODUCT_NAME,
    },
  });
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
  });

  const context = {
    doc,
    finished,
    title: safeText(title, 'Documento administrativo'),
    subtitle,
    institutionalName,
    emittedAt,
    margins: normalizedMargins,
    orientation: layout,
  };
  context.addPage = () => {
    doc.addPage({ size: 'A4', layout, margins: { ...normalizedMargins, bottom: 0 } });
    addDocumentHeader(context);
  };
  context.addPage();
  return context;
}

export function ensurePageSpace(context, requiredHeight = 60) {
  const { doc, margins } = context;
  const contentBottom = doc.page.height - margins.bottom;
  if (doc.y + requiredHeight <= contentBottom) return false;
  context.addPage();
  return true;
}

export function addSectionTitle(context, title) {
  ensurePageSpace(context, 34);
  const { doc, margins } = context;
  const width = contentWidth(context);
  const y = doc.y;
  doc.fillColor(COLORS.surface).rect(margins.left, y, width, 24).fill();
  doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(10)
    .text(safeText(title), margins.left + 8, y + 7, { width: width - 16, lineBreak: false });
  doc.y = y + 32;
  doc.fillColor(COLORS.text);
}

export function addParagraph(context, text, options = {}) {
  const { doc, margins } = context;
  const width = options.width || contentWidth(context);
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(options.fontSize || 9);
  const value = safeText(text);
  const height = doc.heightOfString(value, { width, lineGap: options.lineGap || 2 });
  ensurePageSpace(context, height + (options.spacingAfter ?? 10));
  doc.fillColor(options.color || COLORS.text).text(value, margins.left, doc.y, {
    width,
    align: options.align || 'left',
    lineGap: options.lineGap || 2,
  });
  doc.y += options.spacingAfter ?? 10;
}

export function addKeyValueRows(context, rows) {
  const { doc, margins } = context;
  const width = contentWidth(context);
  const labelWidth = width * 0.28;
  const valueWidth = width - labelWidth - 16;

  for (const row of rows) {
    const label = safeText(row.label);
    const value = safeText(row.value);
    doc.font('Helvetica-Bold').fontSize(9);
    const labelHeight = doc.heightOfString(label, { width: labelWidth });
    doc.font('Helvetica').fontSize(9);
    const valueHeight = doc.heightOfString(value, { width: valueWidth });
    const rowHeight = Math.max(18, labelHeight, valueHeight) + 8;
    ensurePageSpace(context, rowHeight);
    const y = doc.y;

    doc.strokeColor(COLORS.border).lineWidth(0.5)
      .moveTo(margins.left, y + rowHeight)
      .lineTo(margins.left + width, y + rowHeight)
      .stroke();
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9)
      .text(label, margins.left, y + 4, { width: labelWidth });
    doc.fillColor(COLORS.text).font('Helvetica').fontSize(9)
      .text(value, margins.left + labelWidth + 16, y + 4, { width: valueWidth });
    doc.y = y + rowHeight;
  }
  doc.y += 8;
}

function normalizedColumns(columns, width) {
  const total = columns.reduce((sum, column) => sum + Number(column.width || 1), 0);
  return columns.map((column) => ({ ...column, renderedWidth: width * (Number(column.width || 1) / total) }));
}

function tableRowHeight(doc, columns, row, font, fontSize, padding) {
  return Math.max(24, ...columns.map((column) => {
    const rawValue = typeof column.format === 'function' ? column.format(row[column.key], row) : row[column.key];
    doc.font(font).fontSize(fontSize);
    return doc.heightOfString(safeText(rawValue), { width: column.renderedWidth - padding * 2 }) + padding * 2;
  }));
}

function drawTableRow(context, columns, row, { header = false, shaded = false } = {}) {
  const { doc, margins } = context;
  const padding = 6;
  const font = header ? 'Helvetica-Bold' : 'Helvetica';
  const fontSize = header ? 8.5 : 8.5;
  const values = header
    ? Object.fromEntries(columns.map((column) => [column.key, column.label]))
    : row;
  const rowHeight = tableRowHeight(doc, columns, values, font, fontSize, padding);
  const y = doc.y;
  let x = margins.left;

  for (const column of columns) {
    const rawValue = header
      ? column.label
      : typeof column.format === 'function'
        ? column.format(row[column.key], row)
        : row[column.key];
    if (header || shaded) {
      doc.fillColor(header ? COLORS.primary : COLORS.surface)
        .rect(x, y, column.renderedWidth, rowHeight)
        .fill();
    }
    doc.strokeColor(COLORS.border).lineWidth(0.5)
      .rect(x, y, column.renderedWidth, rowHeight)
      .stroke();
    doc.fillColor(header ? COLORS.white : COLORS.text).font(font).fontSize(fontSize)
      .text(safeText(rawValue), x + padding, y + padding, {
        width: column.renderedWidth - padding * 2,
        align: column.align || 'left',
      });
    x += column.renderedWidth;
  }
  doc.y = y + rowHeight;
  return rowHeight;
}

export function addTable(context, { columns, rows = [], emptyMessage = 'Nenhum registro encontrado.' }) {
  const width = contentWidth(context);
  const renderedColumns = normalizedColumns(columns, width);
  ensurePageSpace(context, 30);
  drawTableRow(context, renderedColumns, {}, { header: true });

  if (!rows.length) {
    addParagraph(context, emptyMessage, { color: COLORS.muted });
    return;
  }

  rows.forEach((row, index) => {
    const estimatedHeight = tableRowHeight(context.doc, renderedColumns, row, 'Helvetica', 8.5, 6);
    if (ensurePageSpace(context, estimatedHeight)) {
      drawTableRow(context, renderedColumns, {}, { header: true });
    }
    drawTableRow(context, renderedColumns, row, { shaded: index % 2 === 1 });
  });
  context.doc.y += 10;
}

export function addTotalLine(context, label, value) {
  ensurePageSpace(context, 38);
  const { doc, margins } = context;
  const width = contentWidth(context);
  const y = doc.y;
  doc.strokeColor(COLORS.primary).lineWidth(1)
    .moveTo(margins.left, y)
    .lineTo(margins.left + width, y)
    .stroke();
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11)
    .text(`${safeText(label)}: ${safeText(value)}`, margins.left, y + 9, { width, align: 'right' });
  doc.y = y + 34;
}

function addDocumentFooters(context) {
  const { doc, margins } = context;
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const width = contentWidth(context);
    const lineY = doc.page.height - margins.bottom + 8;
    const textY = lineY + 7;
    doc.strokeColor(COLORS.border).lineWidth(0.5)
      .moveTo(margins.left, lineY)
      .lineTo(doc.page.width - margins.right, lineY)
      .stroke();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5)
      .text(`Gerado pelo ${PRODUCT_NAME}`, margins.left, textY, { width: width * 0.7, lineBreak: false });
    doc.text(`Página ${index - range.start + 1} de ${range.count}`, margins.left, textY, {
      width,
      align: 'right',
      lineBreak: false,
    });
  }
}

export async function finalizePdf(context) {
  addDocumentFooters(context);
  context.doc.end();
  return context.finished;
}

export function sanitizePdfFilename(filename) {
  const normalized = safeText(filename, 'documento.pdf')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safeFilename = normalized || 'documento.pdf';
  return safeFilename.toLowerCase().endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`;
}

export function sendPdfResponse(res, pdf, filename) {
  const safeFilename = sanitizePdfFilename(filename);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
}
