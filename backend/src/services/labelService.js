import PDFDocument from 'pdfkit';
import { generateQrCodeBuffer } from '../utils/qrCode.js';

const mmToPt = (mm) => mm * 2.834645669;

export const DEFAULT_LABEL_SIZE = {
  name: '150x100 mm paisagem',
  widthMm: 150,
  heightMm: 100,
  orientation: 'landscape',
};

const DEFAULT_LABEL_MODEL = '15x10';
const LABEL_SIZE_15X10 = [
  mmToPt(DEFAULT_LABEL_SIZE.widthMm),
  mmToPt(DEFAULT_LABEL_SIZE.heightMm),
];
const LABEL_SIZE_10X5 = [
  mmToPt(100),
  mmToPt(50),
];

export function normalizeLabelModel(labelModel) {
  return labelModel === '10x5' ? '10x5' : DEFAULT_LABEL_MODEL;
}

function logLabelPdfConfig(pageCount, labelModel, labelSize) {
  console.log('Label PDF config:', {
    labelModel,
    pageWidthPt: labelSize[0],
    pageHeightPt: labelSize[1],
    pageCount,
  });
}

function getFittedFontSize(doc, text, { font, maxSize, minSize, width }) {
  doc.font(font);
  for (let size = maxSize; size >= minSize; size -= 1) {
    doc.fontSize(size);
    if (doc.widthOfString(String(text || '-')) <= width) return size;
  }
  return minSize;
}

function drawFittedText(doc, text, x, y, options) {
  const {
    width,
    font = 'Helvetica',
    maxSize,
    minSize,
    align = 'left',
  } = options;
  const fontSize = getFittedFontSize(doc, text, { font, maxSize, minSize, width });
  doc.font(font).fontSize(fontSize).text(text || '-', x, y, {
    width,
    align,
    ellipsis: true,
    lineBreak: false,
  });
}

export async function createShipmentCode(client) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exists = await client.query('SELECT id FROM shipment_volumes WHERE shipment_code = $1', [code]);
    if (exists.rowCount === 0) return code;
  }
  throw new Error('Não foi possível gerar código único.');
}

async function drawLabel15x10(doc, volume) {
  const qrBuffer = await generateQrCodeBuffer(volume.shipment_code);
  const deliveryType = volume.delivery_type || 'transportadora';
  const usesInvoice = deliveryType === 'transportadora' || deliveryType === 'frota_propria';
  const documentText = usesInvoice ? `NF: ${volume.invoice_number || '-'}` : `Venda: ${volume.sale_number}`;
  const destinationParts = [volume.destination_city, volume.destination_uf].filter(Boolean);
  const destinationText = usesInvoice && destinationParts.length ? destinationParts.join('/') : '';
  const productText = `Produto: ${volume.product_name_snapshot || '-'}`;
  const weightText = `Peso: ${Number(volume.weight_kg || 0).toLocaleString('pt-BR')} kg`;
  const pageWidth = LABEL_SIZE_15X10[0];
  const pageHeight = LABEL_SIZE_15X10[1];
  const padding = 14;
  const qrSize = 118;
  const qrX = pageWidth - padding - qrSize;
  const qrY = 18;
  const textWidth = qrX - padding - 14;

  drawFittedText(doc, volume.customer_name || '-', padding, 14, { width: textWidth, font: 'Helvetica-Bold', maxSize: 24, minSize: 14 });
  drawFittedText(doc, documentText, padding, 46, { width: textWidth, font: 'Helvetica-Bold', maxSize: 22, minSize: 13 });
  if (destinationText) {
    drawFittedText(doc, destinationText, padding, 78, { width: textWidth, font: 'Helvetica-Bold', maxSize: 17, minSize: 11 });
  }
  doc.fontSize(11).font('Helvetica').text(`Telefone: ${volume.customer_phone || '-'}`, padding, destinationText ? 105 : 80, { width: textWidth, ellipsis: true, lineBreak: false });
  doc.fontSize(12).font('Helvetica-Bold').text(productText, padding, destinationText ? 132 : 108, { width: textWidth, height: 42, ellipsis: true });
  doc.fontSize(12).font('Helvetica-Bold').text(weightText, padding, destinationText ? 185 : 160, { width: textWidth, ellipsis: true, lineBreak: false });
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fontSize(18).font('Helvetica-Bold').text(volume.shipment_code, qrX, qrY + qrSize + 10, { align: 'center', width: qrSize });
  doc.fontSize(16).font('Helvetica-Bold').text(`Volume ${volume.volume_number}/${volume.total_volumes}`, qrX, pageHeight - 42, { align: 'center', width: qrSize });
}

async function drawLabel10x5(doc, volume) {
  const qrBuffer = await generateQrCodeBuffer(volume.shipment_code);
  const deliveryType = volume.delivery_type || 'transportadora';
  const usesInvoice = deliveryType === 'transportadora' || deliveryType === 'frota_propria';
  const documentText = usesInvoice ? `NF: ${volume.invoice_number || '-'}` : `Venda: ${volume.sale_number}`;
  const destinationText = usesInvoice ? [volume.destination_city, volume.destination_uf].filter(Boolean).join('/') : '';
  const productText = `Produto: ${volume.product_name_snapshot || '-'}`;
  const weightText = `Peso: ${Number(volume.weight_kg || 0).toLocaleString('pt-BR')} kg`;
  const pageWidth = LABEL_SIZE_10X5[0];
  const pageHeight = LABEL_SIZE_10X5[1];
  const padding = 8;
  const qrSize = 78;
  const qrX = pageWidth - padding - qrSize;
  const qrY = 10;
  const textWidth = qrX - padding - 12;

  drawFittedText(doc, volume.customer_name || '-', padding, 8, { width: textWidth, font: 'Helvetica-Bold', maxSize: 13, minSize: 9 });
  drawFittedText(doc, documentText, padding, 25, { width: textWidth, font: 'Helvetica-Bold', maxSize: 12, minSize: 8 });
  if (destinationText) {
    drawFittedText(doc, destinationText, padding, 41, { width: textWidth, font: 'Helvetica-Bold', maxSize: 10, minSize: 7 });
  }
  doc.fontSize(7.5).font('Helvetica').text(productText, padding, destinationText ? 57 : 43, { width: textWidth, height: 26, ellipsis: true });
  doc.fontSize(8).font('Helvetica-Bold').text(weightText, padding, destinationText ? 88 : 74, { width: textWidth, ellipsis: true, lineBreak: false });
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fontSize(11).font('Helvetica-Bold').text(volume.shipment_code, qrX, qrY + qrSize + 5, { align: 'center', width: qrSize });
  doc.fontSize(10).font('Helvetica-Bold').text(`Volume ${volume.volume_number}/${volume.total_volumes}`, qrX, pageHeight - 23, { align: 'center', width: qrSize });
}

function createLabelDocument(labelSize) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    size: labelSize,
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  return { doc, finished, labelSize };
}

async function addLabelPage15x10(doc, volume) {
  doc.addPage({ size: LABEL_SIZE_15X10, margin: 0 });
  await drawLabel15x10(doc, volume);
}

async function addLabelPage10x5(doc, volume) {
  doc.addPage({ size: LABEL_SIZE_10X5, margin: 0 });
  await drawLabel10x5(doc, volume);
}

async function buildLabelPdf15x10(volume) {
  const { doc, finished } = createLabelDocument(LABEL_SIZE_15X10);
  logLabelPdfConfig(1, '15x10', LABEL_SIZE_15X10);
  await addLabelPage15x10(doc, volume);
  doc.end();

  return finished;
}

async function buildLabelPdf10x5(volume) {
  const { doc, finished } = createLabelDocument(LABEL_SIZE_10X5);
  logLabelPdfConfig(1, '10x5', LABEL_SIZE_10X5);
  await addLabelPage10x5(doc, volume);
  doc.end();

  return finished;
}

async function buildLabelBatchPdf15x10(volumes) {
  const { doc, finished } = createLabelDocument(LABEL_SIZE_15X10);
  logLabelPdfConfig(volumes.length, '15x10', LABEL_SIZE_15X10);

  for (const volume of volumes) {
    await addLabelPage15x10(doc, volume);
  }

  doc.end();
  return finished;
}

async function buildLabelBatchPdf10x5(volumes) {
  const { doc, finished } = createLabelDocument(LABEL_SIZE_10X5);
  logLabelPdfConfig(volumes.length, '10x5', LABEL_SIZE_10X5);

  for (const volume of volumes) {
    await addLabelPage10x5(doc, volume);
  }

  doc.end();
  return finished;
}

export async function buildLabelPdf(volume, options = {}) {
  const labelModel = normalizeLabelModel(options.labelModel);
  if (labelModel === '10x5') return buildLabelPdf10x5(volume);
  return buildLabelPdf15x10(volume);
}

export async function buildLabelBatchPdf(volumes, options = {}) {
  const labelModel = normalizeLabelModel(options.labelModel);
  if (labelModel === '10x5') return buildLabelBatchPdf10x5(volumes);
  return buildLabelBatchPdf15x10(volumes);
}
