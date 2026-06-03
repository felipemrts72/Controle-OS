import QRCode from 'qrcode';

export async function generateQrCodeBuffer(content) {
  return QRCode.toBuffer(String(content), {
    errorCorrectionLevel: 'M',
    margin: 1,
    type: 'png',
    width: 360,
  });
}
