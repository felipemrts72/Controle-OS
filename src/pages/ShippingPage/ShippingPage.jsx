import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import { ShippingLookup } from '../../components/ShippingLookup/ShippingLookup.jsx';
import { ShippingResultCard } from '../../components/ShippingResultCard/ShippingResultCard.jsx';
import { QrScannerBox } from '../../components/QrScannerBox/QrScannerBox.jsx';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import { canAccessPermission } from '../../utils/permissions.js';
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
  const user = getStoredUser();
  const canConfirm = canAccessPermission(user, 'shipping.confirm');
  const canViewReadyOrders = canAccessPermission(user, 'shipping.ready_admin.view');
  const [volumes, setVolumes] = useState([]);
  const [saleSummary, setSaleSummary] = useState(null);
  const [currentSaleNumber, setCurrentSaleNumber] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [pendingSaleSwitch, setPendingSaleSwitch] = useState(null);
  const [readyOrders, setReadyOrders] = useState([]);
  const [readyOrdersLoading, setReadyOrdersLoading] = useState(false);
  const [readyOrderConfirmation, setReadyOrderConfirmation] = useState(null);
  const lookupRef = useRef(null);
  const autoCloseTimerRef = useRef(null);
  const lastReadRef = useRef({ code: '', readAt: 0 });

  useEscapeKey(Boolean(feedback), () => {
    setFeedback(null);
    setPendingSaleSwitch(null);
  });

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

  const refreshReadyOrders = useCallback(async () => {
    if (!canViewReadyOrders) return;
    setReadyOrdersLoading(true);
    try {
      const response = await api.get('/shipping/ready');
      setReadyOrders(response.data);
    } catch {
      toast.error('Não foi possível carregar vendas prontas para expedição.');
    } finally {
      setReadyOrdersLoading(false);
    }
  }, [canViewReadyOrders, toast]);

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

  useEffect(() => {
    refreshReadyOrders();
  }, [refreshReadyOrders]);

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

  async function loadReadyOrder(order) {
    await lookupSale(order.sale_number);
    toast.success('Venda carregada para expedição.');
  }

  async function handleLoadReadyOrder(order) {
    if (Number(order.released_for_label_volumes) > 0) {
      setReadyOrderConfirmation({ step: 1, order });
      return;
    }
    await loadReadyOrder(order);
  }

  async function confirmReadyOrderLoad() {
    if (!readyOrderConfirmation?.order) return;
    if (readyOrderConfirmation.step === 1) {
      setReadyOrderConfirmation({ ...readyOrderConfirmation, step: 2 });
      return;
    }
    const order = readyOrderConfirmation.order;
    setReadyOrderConfirmation(null);
    await loadReadyOrder(order);
  }

  async function confirmCode(code) {
    if (!canConfirm) return;
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
      await refreshReadyOrders();

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
    if (!canConfirm) return;
    const response = await api.post(`/shipping/sale/${sale}/confirm-all`);
    applyLookup(response.data);
    setCurrentSaleNumber(response.data.sale_summary?.sale_number || sale);
    await refreshShippingData(response.data.sale_summary?.sale_number || sale);
    await refreshReadyOrders();
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
      if (!canConfirm) {
        applyLookup(response.data);
        toast.success('Volume localizado.');
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
      {canViewReadyOrders && (
        <section className="shipping-ready panel">
          <div className="shipping-ready__header">
            <div>
              <h2>Prontas para expedição</h2>
              {readyOrdersLoading && <span>Atualizando...</span>}
            </div>
            <button className="button" type="button" onClick={refreshReadyOrders}>Atualizar</button>
          </div>

          {!readyOrdersLoading && readyOrders.length === 0 && (
            <p className="shipping-ready__empty">Nenhuma venda pronta para expedição no momento.</p>
          )}

          {readyOrders.length > 0 && (
            <div className="shipping-ready__list">
              {readyOrders.map((order) => {
                const hasPendingLabels = Number(order.released_for_label_volumes) > 0;
                return (
                  <article className={`shipping-ready__card${hasPendingLabels ? ' shipping-ready__card_warning' : ''}`} key={order.internal_order_id}>
                    <div className="shipping-ready__card-header">
                      <div>
                        <h3>Venda {order.sale_number}</h3>
                        <p>Cliente: {order.customer_name}</p>
                      </div>
                      <StatusBadge value={order.order_status} />
                    </div>
                    <div className="shipping-ready__meta">
                      <span>Entrega: <strong>{formatDate(order.promised_date)}</strong></span>
                      <span>Serviços: <strong>{order.ready_tasks}/{order.total_tasks}</strong></span>
                      <span>Volumes: <strong>{order.shipped_volumes} de {order.total_volumes} expedidos</strong></span>
                      <span>Pendentes: <strong>{order.pending_volumes}</strong></span>
                      <span>Etiquetas geradas: <strong>{order.label_generated_volumes}</strong></span>
                      <span>Prontos sem etiqueta: <strong>{order.ready_without_label_volumes}</strong></span>
                      <span>Liberados sem etiqueta: <strong>{order.released_for_label_volumes}</strong></span>
                      <span>Aguardando tarefas: <strong>{order.waiting_tasks_volumes}</strong></span>
                    </div>
                    {hasPendingLabels && (
                      <p className="shipping-ready__alert">Atenção: existem volumes liberados para etiqueta, mas sem etiqueta gerada.</p>
                    )}
                    <div className="shipping-ready__actions">
                      <button className="button button_primary" type="button" onClick={() => handleLoadReadyOrder(order)}>Carregar venda</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
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
        canConfirm={canConfirm}
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

      <ConfirmModal
        open={Boolean(readyOrderConfirmation)}
        title={readyOrderConfirmation?.step === 1 ? 'Etiquetas ainda não geradas' : 'Confirmar carregamento para expedição?'}
        onCancel={() => setReadyOrderConfirmation(null)}
        showCancel={false}
        actions={(
          <>
            <button className="button" type="button" onClick={() => setReadyOrderConfirmation(null)}>Cancelar</button>
            <button className="button button_primary" type="button" onClick={confirmReadyOrderLoad}>
              {readyOrderConfirmation?.step === 1 ? 'Continuar mesmo assim' : 'Sim, carregar venda'}
            </button>
          </>
        )}
      >
        {readyOrderConfirmation?.step === 1 ? (
          <p>Esta venda possui volumes liberados para etiqueta, mas nem todas as etiquetas foram geradas.</p>
        ) : (
          <p>Você tem certeza que deseja carregar esta venda para expedição mesmo com etiquetas pendentes?</p>
        )}
      </ConfirmModal>
    </section>
  );
}
