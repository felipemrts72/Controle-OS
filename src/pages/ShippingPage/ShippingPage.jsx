import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../services/api.js';
import { ShippingLookup } from '../../components/ShippingLookup/ShippingLookup.jsx';
import { ShippingResultCard } from '../../components/ShippingResultCard/ShippingResultCard.jsx';
import { QrScannerBox } from '../../components/QrScannerBox/QrScannerBox.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './ShippingPage.css';

function formatDate(date) {
  return date ? new Date(date).toLocaleDateString('pt-BR') : '-';
}

function beep(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = type === 'error' ? 180 : 660;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    window.setTimeout(() => {
      oscillator.stop();
      context.close();
    }, type === 'error' ? 180 : 110);
  } catch {
    // Sound feedback is optional.
  }
}

function getRemainingText(count) {
  return count === 1 ? 'FALTA 1 VOLUME' : `FALTAM ${count} VOLUMES`;
}

export function ShippingPage() {
  const toast = useToast();
  const [volumes, setVolumes] = useState([]);
  const [saleSummary, setSaleSummary] = useState(null);
  const [currentSaleNumber, setCurrentSaleNumber] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [pendingSaleSwitch, setPendingSaleSwitch] = useState(null);
  const lookupRef = useRef(null);
  const autoCloseTimerRef = useRef(null);
  const lastReadRef = useRef({ code: '', readAt: 0 });

  function getSummaryFromVolume(volume) {
    if (!volume) return null;
    return volume.sale_summary || {
      sale_number: volume.sale_number,
      customer_name: volume.customer_name,
      promised_date: volume.promised_date,
      total_volumes: volume.total_sale_volumes,
      shipped_volumes: volume.shipped_sale_volumes,
      remaining_volumes: volume.remaining_volumes,
    };
  }

  function applyLookup(payload) {
    const nextVolumes = payload.volumes || (payload.shipment_volume_id ? [payload] : []);
    const nextSummary = payload.sale_summary || getSummaryFromVolume(nextVolumes[0]);
    setVolumes(nextVolumes);
    setSaleSummary(nextSummary);
    if (nextSummary?.sale_number) setCurrentSaleNumber(nextSummary.sale_number);
    setMessage('');
  }

  function showFeedback(nextFeedback) {
    setFeedback(nextFeedback);
    if (['invalid', 'already'].includes(nextFeedback.variant)) beep('error');
    else beep('success');
  }

  function focusCodeReader() {
    lookupRef.current?.clearCode();
    lookupRef.current?.focusCode();
  }

  // Prevents duplicated processing when the same QR/code stays in front of the reader.
  function shouldIgnoreDuplicateCode(code) {
    const now = Date.now();
    const isDuplicate = lastReadRef.current.code === code && now - lastReadRef.current.readAt < 2000;
    if (!isDuplicate) lastReadRef.current = { code, readAt: now };
    return isDuplicate;
  }

  // Refreshes expedição data from the API without a full page reload.
  const refreshShippingData = useCallback(async (saleNumber = currentSaleNumber) => {
    if (!saleNumber) return;
    const response = await api.get(`/shipping/sale/${saleNumber}`);
    applyLookup(response.data);
  }, [currentSaleNumber]);

  // Keeps a single auto-close timer for already-shipped feedback.
  function scheduleAutoCloseAfterAlreadyShipped(saleNumber) {
    if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    autoCloseTimerRef.current = window.setTimeout(async () => {
      setFeedback(null);
      await refreshShippingData(saleNumber);
      focusCodeReader();
      autoCloseTimerRef.current = null;
    }, 3000);
  }

  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) window.clearTimeout(autoCloseTimerRef.current);
    };
  }, []);

  async function lookupCode(code) {
    const normalizedCode = String(code || '').replace(/\s/g, '');
    if (shouldIgnoreDuplicateCode(normalizedCode)) return;
    try {
      const response = await api.get(`/shipping/code/${normalizedCode}`);
      applyLookup(response.data);
      toast.success('Volume localizado.');
    } catch {
      setVolumes([]);
      setSaleSummary(null);
      showFeedback({
        variant: 'invalid',
        title: 'CÓDIGO NÃO ENCONTRADO',
        text: 'Código não encontrado.',
      });
      toast.error('Código não encontrado.');
    }
  }

  async function lookupSale(sale) {
    const response = await api.get(`/shipping/sale/${sale}`);
    applyLookup(response.data);
    if (response.data.sale_summary) setCurrentSaleNumber(response.data.sale_summary.sale_number);
  }

  async function confirmCode(code) {
    try {
      const response = await api.post(`/shipping/code/${code}/confirm`);
      const volume = response.data;
      const summary = getSummaryFromVolume(volume);
      if (summary) {
        setSaleSummary(summary);
        setCurrentSaleNumber(summary.sale_number);
      }
      if (volume) setVolumes([volume]);
      await refreshShippingData(summary?.sale_number);

      if (volume.sale_completed) {
        toast.success('Venda concluída.');
        showFeedback({
          variant: 'completed',
          title: 'VENDA CONCLUÍDA',
          saleSummary: summary,
        });
        return;
      }

      showFeedback({
        variant: 'confirmed',
        title: 'VOLUME CONFIRMADO',
        saleSummary: summary,
      });
      toast.success('Expedição confirmada.');
    } catch (error) {
      if (error.response?.status === 409 && error.response.data) {
        const volume = error.response.data;
        const summary = getSummaryFromVolume(volume);
        setVolumes([volume]);
        setSaleSummary(summary);
        setCurrentSaleNumber(summary?.sale_number || '');
        showFeedback({
          variant: 'already',
          title: 'VOLUME JÁ EXPEDIDO',
          text: summary?.remaining_volumes === 0
            ? 'Todos os volumes desta venda já foram expedidos.'
            : `Este volume já foi expedido. Ainda restam ${summary.remaining_volumes} volume(s) para expedir.`,
          saleSummary: summary,
        });
        toast.error('Volume já expedido.');
        scheduleAutoCloseAfterAlreadyShipped(summary?.sale_number);
        return;
      }
      showFeedback({
        variant: 'invalid',
        title: 'CÓDIGO NÃO ENCONTRADO',
        text: 'Código não encontrado.',
      });
      toast.error('Não foi possível confirmar a expedição.');
    }
  }

  async function confirmSale(sale) {
    const response = await api.post(`/shipping/sale/${sale}/confirm-all`);
    applyLookup(response.data);
    setCurrentSaleNumber(response.data.sale_summary?.sale_number || sale);
    await refreshShippingData(response.data.sale_summary?.sale_number || sale);
    toast.success('Venda concluída.');
    showFeedback({
      variant: 'completed',
      title: 'VENDA CONCLUÍDA',
      saleSummary: response.data.sale_summary,
    });
  }

  async function handleQrScan(decodedText) {
    const code = String(decodedText || '').replace(/\s/g, '');
    if (shouldIgnoreDuplicateCode(code)) return;
    if (!/^\d{6}$/.test(code)) {
      showFeedback({
        variant: 'invalid',
        title: 'QR CODE INVÁLIDO',
        text: 'Não foi possível localizar este volume.',
      });
      toast.error('QR Code inválido.');
      return;
    }

    try {
      const response = await api.get(`/shipping/code/${code}`);
      const nextSaleNumber = response.data.sale_number;
      if (currentSaleNumber && nextSaleNumber && currentSaleNumber !== nextSaleNumber) {
        setPendingSaleSwitch({ code, nextSaleNumber });
        setFeedback({
          variant: 'warning',
          title: 'ATENÇÃO',
          text: `Você estava expedindo a venda ${currentSaleNumber}. Agora foi lido um volume da venda ${nextSaleNumber}. Deseja trocar para esta venda?`,
        });
        toast.warning('Volume pertence a outra venda.');
        return;
      }
      await confirmCode(code);
    } catch {
      showFeedback({
        variant: 'invalid',
        title: 'CÓDIGO NÃO ENCONTRADO',
        text: 'Código não encontrado.',
      });
      toast.error('Código não encontrado.');
    }
  }

  async function switchSale() {
    if (!pendingSaleSwitch) return;
    setCurrentSaleNumber(pendingSaleSwitch.nextSaleNumber);
    const code = pendingSaleSwitch.code;
    setPendingSaleSwitch(null);
    await confirmCode(code);
  }

  return (
    <section className="page shipping-page">
      <div className="page__header">
        <h1 className="page__title">Expedição</h1>
      </div>
      <QrScannerBox onScan={handleQrScan} />
      <ShippingLookup ref={lookupRef} onLookupCode={lookupCode} onLookupSale={lookupSale} />
      {saleSummary && (
        <section className="shipping-page__status panel">
          <div>
            <span>Venda</span>
            <strong>{saleSummary.sale_number}</strong>
          </div>
          <div>
            <span>Cliente</span>
            <strong>{saleSummary.customer_name}</strong>
          </div>
          <div>
            <span>Data de entrega</span>
            <strong>{formatDate(saleSummary.promised_date)}</strong>
          </div>
          <div>
            <span>Expedidos</span>
            <strong>{saleSummary.shipped_volumes}/{saleSummary.total_volumes}</strong>
          </div>
          <div className="shipping-page__remaining">
            <span>Faltam</span>
            <strong>{saleSummary.remaining_volumes}</strong>
          </div>
        </section>
      )}
      {message && <div className="shipping-page__message">{message}</div>}
      <ShippingResultCard
        volumes={volumes}
        onConfirmCode={confirmCode}
        onConfirmSale={confirmSale}
      />

      {feedback && (
        <div className="shipping-page__modal">
          <div className={`shipping-page__modal-content shipping-page__modal-content_${feedback.variant}`}>
            <h2>{feedback.title}</h2>
            {feedback.saleSummary && (
              <>
                <p>Venda: {feedback.saleSummary.sale_number}</p>
                <p>Cliente: {feedback.saleSummary.customer_name}</p>
                {feedback.variant === 'confirmed' && <p>Entrega: {formatDate(feedback.saleSummary.promised_date)}</p>}
                {feedback.variant === 'completed' ? (
                  <strong className="shipping-page__modal-main">
                    {feedback.saleSummary.shipped_volumes} DE {feedback.saleSummary.total_volumes} VOLUMES EXPEDIDOS
                  </strong>
                ) : (
                  <strong className="shipping-page__modal-main">
                    {getRemainingText(feedback.saleSummary.remaining_volumes)}
                  </strong>
                )}
              </>
            )}
            {feedback.text && <p>{feedback.text}</p>}
            <div className="shipping-page__modal-actions">
              {feedback.variant === 'warning' ? (
                <>
                  <button className="button" type="button" onClick={() => { setFeedback(null); setPendingSaleSwitch(null); }}>Cancelar</button>
                  <button className="button button_primary" type="button" onClick={switchSale}>Trocar venda</button>
                </>
              ) : (
                <button className="button button_primary" type="button" onClick={() => setFeedback(null)}>Fechar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
