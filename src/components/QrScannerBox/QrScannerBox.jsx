import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import './QrScannerBox.css';

const QR_READER_ID = 'qr-scanner-reader';

export function QrScannerBox({ onScan }) {
  const toast = useToast();
  const scannerRef = useRef(null);
  const lastScanRef = useRef({ text: '', scannedAt: 0 });
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');

  async function startScanner() {
    try {
      setError('');
      lastScanRef.current = { text: '', scannedAt: 0 };

      const scanner = new Html5Qrcode(QR_READER_ID);
      scannerRef.current = scanner;

      const config = {
        fps: 10,
        qrbox: { width: 260, height: 260 },
      };
      const handleSuccess = async (decodedText) => {
        const now = Date.now();
        const normalizedText = String(decodedText || '').trim();
        const isRepeatedScan = lastScanRef.current.text === normalizedText
          && now - lastScanRef.current.scannedAt < 1800;

        if (isRepeatedScan) return;

        lastScanRef.current = { text: normalizedText, scannedAt: now };
        await onScan?.(decodedText);
      };

      try {
        await scanner.start(
          { facingMode: 'environment' },
          config,
          handleSuccess,
          () => {},
        );
      } catch {
        const cameras = await Html5Qrcode.getCameras();
        if (!cameras.length) throw new Error('Câmera não encontrada.');
        await scanner.start(
          cameras[0].id,
          config,
          handleSuccess,
          () => {},
        );
      }

      setIsScanning(true);
    } catch {
      setError('Não foi possível acessar a câmera. Verifique a permissão da câmera no navegador.');
      toast.error('Não foi possível acessar a câmera.');
      await stopScanner();
    }
  }

  async function stopScanner() {
    if (!scannerRef.current) return;

    try {
      const isRunning = scannerRef.current.isScanning;
      if (isRunning) await scannerRef.current.stop();
      await scannerRef.current.clear();
    } catch {
      // evita quebrar se o scanner já estiver parado
    } finally {
      scannerRef.current = null;
      setIsScanning(false);
    }
  }

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  return (
    <div className="qr-scanner-box panel">
      <div className="qr-scanner-box__header">
        <h2 className="qr-scanner-box__title">Leitor de QR Code</h2>

        {!isScanning ? (
          <button
            className="button"
            type="button"
            onClick={startScanner}
          >
            Abrir câmera
          </button>
        ) : (
          <button
            className="button"
            type="button"
            onClick={stopScanner}
          >
            Fechar câmera
          </button>
        )}
      </div>

      <div className="qr-scanner-box__reader" id={QR_READER_ID} />

      {error && <p className="qr-scanner-box__error">{error}</p>}
    </div>
  );
}
