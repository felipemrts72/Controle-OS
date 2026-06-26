import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import './LabelQueuePage.css';

function groupVolumes(volumes) {
  const groups = new Map();

  for (const volume of volumes) {
    const key = volume.sold_item_id;
    const group = groups.get(key) || {
      sold_item_id: key,
      internal_order_id: volume.internal_order_id,
      customer_name: volume.customer_name,
      sale_number: volume.sale_number,
      delivery_type: volume.delivery_type || 'transportadora',
      invoice_number: volume.invoice_number || '',
      destination_city: volume.destination_city || '',
      destination_uf: volume.destination_uf || '',
      product_name_snapshot: volume.product_name_snapshot,
      volumes: [],
    };

    group.volumes.push(volume);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const sortedVolumes = [...group.volumes].sort((a, b) => Number(a.volume_number) - Number(b.volume_number));
    const generated = sortedVolumes.filter((volume) => volume.label_status === 'label_generated').length;

    return {
      ...group,
      volumes: sortedVolumes,
      total: sortedVolumes.length,
      generated,
      pending: sortedVolumes.length - generated,
    };
  });
}

function deliveryRequiresInvoice(deliveryType) {
  const type = deliveryType || 'transportadora';
  return type === 'transportadora' || type === 'frota_propria';
}

export function LabelQueuePage() {
  const toast = useToast();
  const [volumes, setVolumes] = useState([]);
  const [confirmGroupId, setConfirmGroupId] = useState(null);
  const [individualGroupId, setIndividualGroupId] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoicePrompt, setInvoicePrompt] = useState(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const groups = groupVolumes(volumes);
  const confirmGroup = groups.find((group) => group.sold_item_id === confirmGroupId);
  const individualGroup = groups.find((group) => group.sold_item_id === individualGroupId);
  const invoicePromptVolume = invoicePrompt ? volumes.find((volume) => volume.id === invoicePrompt.volumeId) : null;

  useEscapeKey(Boolean(confirmGroup || individualGroup || invoicePrompt), () => {
    setConfirmGroupId(null);
    setIndividualGroupId(null);
    setInvoicePrompt(null);
    setInvoiceNumber('');
  });

  async function load() {
    const response = await api.get('/labels/queue');
    const nextVolumes = response.data.filter((volume) => volume.order_status !== 'deleted' && !volume.deleted_at && !volume.order_deleted_at);
    setVolumes(nextVolumes);
    return nextVolumes;
  }

  function openPdf(blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function printBatch(group) {
    if (!group) return;
    try {
      setIsPrinting(true);
      if (deliveryRequiresInvoice(group.delivery_type) && !group.invoice_number) {
        const nextInvoiceNumber = invoiceNumber.trim();
        if (!nextInvoiceNumber) {
          toast.error('Informe o numero da Nota Fiscal.');
          return;
        }
        await api.patch(`/labels/internal-order/${group.internal_order_id}/invoice`, { invoice_number: nextInvoiceNumber });
      }
      const response = await api.get(`/labels/sold-item/${group.sold_item_id}/pdf`, { responseType: 'blob' });
      openPdf(response.data);
      await load();
      setConfirmGroupId(null);
      setInvoiceNumber('');
      toast.success('Etiquetas abertas para impressão.');
    } catch {
      toast.error('Não foi possível gerar as etiquetas deste item.');
    } finally {
      setIsPrinting(false);
    }
  }

  async function printSingle(volume, options = {}) {
    if (!options.skipInvoiceCheck && deliveryRequiresInvoice(volume.delivery_type) && !volume.invoice_number) {
      setInvoicePrompt({ volumeId: volume.id, internalOrderId: volume.internal_order_id });
      setInvoiceNumber('');
      return;
    }

    try {
      setIsPrinting(true);
      const response = await api.get(`/labels/${volume.id}/pdf`, { responseType: 'blob' });
      openPdf(response.data);
      await load();
      toast.success(volume.label_status === 'label_generated' ? 'Etiqueta aberta para reimpressão.' : 'Etiqueta gerada com sucesso.');
    } catch {
      toast.error(volume.label_status === 'label_generated' ? 'Não foi possível abrir a etiqueta.' : 'Não foi possível gerar a etiqueta.');
    } finally {
      setIsPrinting(false);
    }
  }

  async function saveInvoiceAndPrintSingle() {
    if (!invoicePrompt || !invoicePromptVolume) return;
    const nextInvoiceNumber = invoiceNumber.trim();
    if (!nextInvoiceNumber) {
      toast.error('Informe o numero da Nota Fiscal.');
      return;
    }

    try {
      setIsPrinting(true);
      await api.patch(`/labels/internal-order/${invoicePrompt.internalOrderId}/invoice`, { invoice_number: nextInvoiceNumber });
      setInvoicePrompt(null);
      setInvoiceNumber('');
      await printSingle(invoicePromptVolume, { skipInvoiceCheck: true });
    } catch {
      toast.error('Não foi possível salvar a Nota Fiscal.');
    } finally {
      setIsPrinting(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <section className="page label-queue-page">
      <div className="page__header">
        <h1 className="page__title">Fila de Etiquetas</h1>
      </div>
      <div className="label-queue-page__list">
        {groups.map((group) => (
          <article className="label-queue-group" key={group.sold_item_id}>
            <div className="label-queue-group__main">
              <strong>{group.customer_name}</strong>
              <span>Venda: {group.sale_number}</span>
              <span>Produto: {group.product_name_snapshot}</span>
            </div>
            <div className="label-queue-group__stats">
              <span>Volumes: <strong>{group.total}</strong></span>
              <span>Geradas: <strong>{group.generated}</strong></span>
              <span>Pendentes: <strong>{group.pending}</strong></span>
            </div>
            <div className="label-queue-group__actions">
              <button className="button button_primary" type="button" onClick={() => {
                setConfirmGroupId(group.sold_item_id);
                setInvoiceNumber(group.invoice_number || '');
              }}>
                Imprimir etiquetas
              </button>
              <button className="button" type="button" onClick={() => setIndividualGroupId(group.sold_item_id)}>
                Imprimir etiqueta individual
              </button>
            </div>
          </article>
        ))}
        {groups.length === 0 && <div className="panel">Nenhuma etiqueta liberada.</div>}
      </div>

      {confirmGroup && (
        <div className="label-modal">
          <div className="label-modal__content">
            <h2>Imprimir etiquetas</h2>
            <p>Deseja gerar/imprimir todas as {confirmGroup.total} etiquetas deste item?</p>
            {confirmGroup.generated > 0 && (
              <p>Este item já possui {confirmGroup.generated} etiquetas geradas. Deseja reimprimir todas mesmo assim?</p>
            )}
            {deliveryRequiresInvoice(confirmGroup.delivery_type) && !confirmGroup.invoice_number && (
              <label className="field">
                <span className="field__label">Numero da Nota Fiscal</span>
                <input className="field__input" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} autoFocus />
              </label>
            )}
            <div className="label-modal__actions">
              <button className="button" type="button" onClick={() => {
                setConfirmGroupId(null);
                setInvoiceNumber('');
              }} disabled={isPrinting}>Cancelar</button>
              <button className="button button_primary" type="button" onClick={() => printBatch(confirmGroup)} disabled={isPrinting}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {individualGroup && (
        <div className="label-modal">
          <div className="label-modal__content label-modal__content_wide">
            <h2>Etiquetas individuais</h2>
            <p>{individualGroup.customer_name} · Venda {individualGroup.sale_number} · {individualGroup.product_name_snapshot}</p>
            <div className="label-volume-list">
              {individualGroup.volumes.map((volume) => (
                <div className="label-volume-list__row" key={volume.id}>
                  <strong>Volume {volume.volume_number}/{volume.total_volumes}</strong>
                  <StatusBadge value={volume.label_status} />
                  <span>Código: {volume.shipment_code || '-'}</span>
                  <button className="button button_primary" type="button" onClick={() => printSingle(volume)} disabled={isPrinting}>
                    {volume.label_status === 'label_generated' ? 'Reimprimir' : 'Imprimir'}
                  </button>
                </div>
              ))}
            </div>
            <div className="label-modal__actions">
              <button className="button" type="button" onClick={() => setIndividualGroupId(null)} disabled={isPrinting}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {invoicePrompt && invoicePromptVolume && (
        <div className="label-modal">
          <div className="label-modal__content">
            <h2>Numero da Nota Fiscal</h2>
            <p>{invoicePromptVolume.customer_name} · Venda {invoicePromptVolume.sale_number}</p>
            <label className="field">
              <span className="field__label">Numero da Nota Fiscal</span>
              <input className="field__input" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} autoFocus />
            </label>
            <div className="label-modal__actions">
              <button className="button" type="button" onClick={() => {
                setInvoicePrompt(null);
                setInvoiceNumber('');
              }} disabled={isPrinting}>Cancelar</button>
              <button className="button button_primary" type="button" onClick={saveInvoiceAndPrintSingle} disabled={isPrinting}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
