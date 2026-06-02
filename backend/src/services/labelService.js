import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export async function createShipmentCode(client) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const exists = await client.query('SELECT id FROM shipment_volumes WHERE shipment_code = $1', [code]);
    if (exists.rowCount === 0) return code;
  }
  throw new Error('Não foi possível gerar código único.');
}

export async function buildLabelPdf(volume) {
  const doc = new PDFDocument({ size: [283.46, 141.73], margin: 10 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const qrDataUrl = await QRCode.toDataURL(volume.shipment_code);
  const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');

  doc.fontSize(13).font('Helvetica-Bold').text(volume.customer_name, { width: 178, ellipsis: true });
  doc.fontSize(7).font('Helvetica');
  doc.text(`Venda: ${volume.sale_number}`);
  doc.text(`Produto: ${volume.product_name_snapshot}`, { width: 178, ellipsis: true });
  doc.text(`Entrega: ${new Date(volume.promised_date).toLocaleDateString('pt-BR')}`);
  doc.text(`Telefone: ${volume.customer_phone || '-'}`);
  doc.text(`Peso: ${Number(volume.weight_kg).toLocaleString('pt-BR')} kg`);
  doc.image(qrBuffer, 204, 18, { width: 62, height: 62 });
  doc.fontSize(9).font('Helvetica-Bold').text(`Código: ${volume.shipment_code}`, 190, 84, { align: 'center', width: 85 });
  doc.fontSize(10).text(`Volume: ${volume.volume_number}/${volume.total_volumes}`, 190, 106, { align: 'center', width: 85 });
  doc.end();

  return finished;
}
