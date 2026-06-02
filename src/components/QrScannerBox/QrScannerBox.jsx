import { QrCode } from 'lucide-react';
import './QrScannerBox.css';

export function QrScannerBox() {
  return (
    <div className="qr-scanner-box panel">
      <QrCode size={34} />
      <strong>Leitor de QR Code</strong>
      <span>Use um leitor conectado ao campo de código.</span>
    </div>
  );
}
