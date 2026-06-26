import PDFDocument from 'pdfkit';
import { generateQrCodeBuffer } from '../utils/qrCode.js';

const mmToPt = (mm) => mm * 2.834645669;

export const DEFAULT_LABEL_SIZE = {
  name: '50x100 mm retrato',
  widthMm: 50,
  heightMm: 100,
  orientation: 'portrait',
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
  const destinationParts = [volume.destination_city, volume.destination_uf].filter(Boolean);
  const destinationText = usesInvoice && destinationParts.length ? destinationParts.join('/') : '';
  const productText = `Produto: ${volume.product_name_snapshot || '-'}`;
  const weightText = `Peso: ${Number(volume.weight_kg || 0).toLocaleString('pt-BR')} kg`;
  const pageWidth = LABEL_SIZE[0];
  const pageHeight = LABEL_SIZE[1];
  const padding = 6;
  const contentWidth = pageWidth - (padding * 2);
  const qrSize = 92;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = destinationText ? 122 : 106;

  doc.fontSize(16).font('Helvetica-Bold').text(volume.customer_name || '-', padding, 8, { width: contentWidth, ellipsis: true, lineBreak: false });
  doc.fontSize(15).font('Helvetica-Bold').text(documentText, padding, 31, { width: contentWidth, ellipsis: true, lineBreak: false });
  if (destinationText) {
    doc.fontSize(13).font('Helvetica-Bold').text(destinationText, padding, 53, { width: contentWidth, ellipsis: true, lineBreak: false });
  }
  doc.fontSize(9).font('Helvetica').text(`Telefone: ${volume.customer_phone || '-'}`, padding, destinationText ? 76 : 55, { width: contentWidth, ellipsis: true, lineBreak: false });
  doc.fontSize(10).font('Helvetica-Bold').text(productText, padding, destinationText ? 91 : 70, { width: contentWidth, ellipsis: true, lineBreak: false });
  doc.fontSize(9).font('Helvetica').text(weightText, padding, destinationText ? 107 : 86, { width: contentWidth, ellipsis: true, lineBreak: false });
  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fontSize(14).font('Helvetica-Bold').text(volume.shipment_code, padding, qrY + qrSize + 6, { align: 'center', width: contentWidth });
  doc.fontSize(13).font('Helvetica-Bold').text(`Volume ${volume.volume_number}/${volume.total_volumes}`, padding, pageHeight - 25, { align: 'center', width: contentWidth });
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
