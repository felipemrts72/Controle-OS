import PDFDocument from 'pdfkit';
import { generateQrCodeBuffer } from '../utils/qrCode.js';

const mmToPt = (mm) => mm * 2.834645669;

export const DEFAULT_LABEL_SIZE = {
  name: '100x50 mm paisagem',
  widthMm: 100,
  heightMm: 50,
  orientation: 'landscape',
};

const LABEL_SIZE = [
  mmToPt(DEFAULT_LABEL_SIZE.widthMm),
  mmToPt(DEFAULT_LABEL_SIZE.heightMm),
];

function logLabelPdfConfig(pageCount) {
  console.log('Label PDF config:', {
    labelWidthMm: DEFAULT_LABEL_SIZE.widthMm,
    labelHeightMm: DEFAULT_LABEL_SIZE.heightMm,
    pageWidthPt: LABEL_SIZE[0],
    pageHeightPt: LABEL_SIZE[1],
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

async function drawLabelPage(doc, volume) {
  const qrBuffer = await generateQrCodeBuffer(volume.shipment_code);
  const deliveryType = volume.delivery_type || 'transportadora';
  const usesInvoice = deliveryType === 'transportadora' || deliveryType === 'frota_propria';
  const documentText = usesInvoice ? `NF: ${volume.invoice_number || '-'}` : `Venda: ${volume.sale_number}`;
  const destinationCity = usesInvoice ? volume.destination_city || '' : '';
  const destinationUf = usesInvoice ? volume.destination_uf || '' : '';
  const productText = `Produto: ${volume.product_name_snapshot || '-'}`;
  const weightText = `Peso: ${Number(volume.weight_kg || 0).toLocaleString('pt-BR')} kg`;
  const pageWidth = LABEL_SIZE[0];
  const padding = 8;
  const qrSize = 92;
  const qrX = pageWidth - padding - qrSize;
  const qrY = 8;
  const textWidth = qrX - padding - 10;

  drawFittedText(doc, volume.customer_name || '-', padding, 8, { width: textWidth, font: 'Helvetica-Bold', maxSize: 18, minSize: 12 });
  drawFittedText(doc, documentText, padding, 32, { width: textWidth, font: 'Helvetica-Bold', maxSize: 17, minSize: 12 });
  if (destinationCity || destinationUf) {
    drawFittedText(doc, destinationCity || '-', padding, 55, { width: textWidth, font: 'Helvetica-Bold', maxSize: 14, minSize: 10 });
    drawFittedText(doc, destinationUf || '-', padding, 73, { width: textWidth, font: 'Helvetica-Bold', maxSize: 13, minSize: 10 });
  }
  doc.fontSize(9).font('Helvetica').text(`Telefone: ${volume.customer_phone || '-'}`, padding, destinationCity || destinationUf ? 92 : 58, { width: textWidth, ellipsis: true, lineBreak: false });
  doc.fontSize(9).font('Helvetica').text(productText, padding, destinationCity || destinationUf ? 106 : 74, { width: textWidth, ellipsis: true, lineBreak: false });
  doc.fontSize(9).font('Helvetica').text(weightText, padding, destinationCity || destinationUf ? 121 : 90, { width: textWidth, ellipsis: true, lineBreak: false });
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fontSize(12).font('Helvetica-Bold').text(volume.shipment_code, qrX, qrY + qrSize + 4, { align: 'center', width: qrSize });
  doc.fontSize(11).font('Helvetica-Bold').text(`Volume ${volume.volume_number}/${volume.total_volumes}`, qrX, qrY + qrSize + 22, { align: 'center', width: qrSize });
}

function createLabelDocument() {
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
    size: LABEL_SIZE,
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  return { doc, finished };
}

async function addLabelPage(doc, volume) {
  doc.addPage({ size: LABEL_SIZE, margin: 0 });
  await drawLabelPage(doc, volume);
}

export async function buildLabelPdf(volume) {
  const { doc, finished } = createLabelDocument();
  logLabelPdfConfig(1);
  await addLabelPage(doc, volume);
  doc.end();

  return finished;
}

export async function buildLabelBatchPdf(volumes) {
  const { doc, finished } = createLabelDocument();
  logLabelPdfConfig(volumes.length);

  for (const volume of volumes) {
    await addLabelPage(doc, volume);
  }

  doc.end();
  return finished;
}
