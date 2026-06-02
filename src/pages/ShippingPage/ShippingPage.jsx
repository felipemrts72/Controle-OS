import { useState } from 'react';
import { api } from '../../services/api.js';
import { ShippingLookup } from '../../components/ShippingLookup/ShippingLookup.jsx';
import { ShippingResultCard } from '../../components/ShippingResultCard/ShippingResultCard.jsx';
import { QrScannerBox } from '../../components/QrScannerBox/QrScannerBox.jsx';
import './ShippingPage.css';

export function ShippingPage() {
  const [volumes, setVolumes] = useState([]);
  const [message, setMessage] = useState('');

  async function lookupCode(code) {
    const response = await api.get(`/shipping/code/${code}`);
    setVolumes([response.data]);
    setMessage('');
  }

  async function lookupSale(sale) {
    const response = await api.get(`/shipping/sale/${sale}`);
    setVolumes(response.data);
    setMessage('');
  }

  async function confirmCode(code) {
    await api.post(`/shipping/code/${code}/confirm`);
    setMessage('Expedição confirmada.');
    setVolumes([]);
  }

  async function confirmSale(sale) {
    await api.post(`/shipping/sale/${sale}/confirm-all`);
    setMessage('Venda expedida.');
    setVolumes([]);
  }

  return (
    <section className="page shipping-page">
      <div className="page__header">
        <h1 className="page__title">Expedição</h1>
      </div>
      <QrScannerBox />
      <ShippingLookup onLookupCode={lookupCode} onLookupSale={lookupSale} />
      {message && <div className="shipping-page__message">{message}</div>}
      <ShippingResultCard volumes={volumes} onConfirmCode={confirmCode} onConfirmSale={confirmSale} />
    </section>
  );
}
