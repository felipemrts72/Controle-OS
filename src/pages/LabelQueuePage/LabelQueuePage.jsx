import { useEffect, useState } from 'react';
import { api, getStoredUser } from '../../services/api.js';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { LabelGenerationModal } from '../../components/LabelGenerationModal/LabelGenerationModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import { canAccessPermission } from '../../utils/permissions.js';
import {
  createSingleLabel,
  createSoldItemLabels,
  downloadSingleLabel,
  downloadSoldItemLabels,
  generateThenDownloadLabels,
  labelCounts,
  labelErrorMessage,
} from '../../utils/labelWorkflow.js';
import './LabelQueuePage.css';

const labelModels = ['15x10', '10x5'];

export function groupLabelQueueVolumes(volumes) {
  const groups = new Map();
  for (const volume of volumes) {
    const group = groups.get(volume.sold_item_id) || {
      sold_item_id: volume.sold_item_id,
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
    groups.set(volume.sold_item_id, group);
  }

  return [...groups.values()].map((group) => {
    const sortedVolumes = [...group.volumes].sort((a, b) => Number(a.volume_number) - Number(b.volume_number));
    return { ...group, volumes: sortedVolumes, ...labelCounts(sortedVolumes) };
  });
}

export function LabelQueuePage() {
  const toast = useToast();
  const user = getStoredUser();
  const canPrint = canAccessPermission(user, 'labels.print');
  const canReprint = canAccessPermission(user, 'labels.reprint');
  const [volumes, setVolumes] = useState([]);
  const [generationTarget, setGenerationTarget] = useState(null);
  const [individualGroupId, setIndividualGroupId] = useState(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [labelModel, setLabelModel] = useState('15x10');

  const groups = groupLabelQueueVolumes(volumes);
  const individualGroup = groups.find((group) => group.sold_item_id === individualGroupId);

  useEscapeKey(Boolean(generationTarget || individualGroup), () => {
    closeGenerationModal();
    setIndividualGroupId(null);
  });

  async function load() {
    const response = await api.get('/labels/queue');
    const nextVolumes = response.data.filter((volume) => volume.order_status !== 'deleted' && !volume.deleted_at && !volume.order_deleted_at);
    setVolumes(nextVolumes);
    return nextVolumes;
  }

  useEffect(() => { load().catch(() => toast.error('Não foi possível carregar a fila de etiquetas.')); }, []);

  function closeGenerationModal() {
    setGenerationTarget(null);
    setInvoiceNumber('');
    setDownloadFailed(false);
  }

  function openGroupGeneration(group) {
    setGenerationTarget({ type: 'group', group });
    setInvoiceNumber(group.invoice_number || '');
    setDownloadFailed(false);
  }

  function openSingleGeneration(volume) {
    setGenerationTarget({ type: 'single', volume });
    setInvoiceNumber(volume.invoice_number || '');
    setDownloadFailed(false);
  }

  async function downloadGroup(group) {
    await downloadSoldItemLabels(group.sold_item_id, group.sale_number, labelModel);
  }

  async function reprintGroup(group) {
    setIsPrinting(true);
    try {
      await downloadGroup(group);
      toast.success('PDF baixado com as etiquetas existentes.');
    } catch (error) {
      toast.error(labelErrorMessage(error, 'Não foi possível baixar as etiquetas.'));
    } finally {
      setIsPrinting(false);
    }
  }

  async function confirmGeneration() {
    if (!generationTarget) return;
    const nextInvoiceNumber = invoiceNumber.trim();
    if (!nextInvoiceNumber) {
      toast.error('Informe a Nota Fiscal antes de gerar as etiquetas.');
      return;
    }

    setIsPrinting(true);
    try {
      const outcome = await generateThenDownloadLabels({
        create: () => generationTarget.type === 'group'
          ? createSoldItemLabels(generationTarget.group.sold_item_id, nextInvoiceNumber)
          : createSingleLabel(generationTarget.volume.id, nextInvoiceNumber),
        refresh: load,
        download: () => generationTarget.type === 'group'
          ? downloadGroup(generationTarget.group)
          : downloadSingleLabel({ ...generationTarget.volume, shipment_code: 'gerada' }, labelModel),
      });
      if (outcome.status === 'download_failed') {
        setDownloadFailed(true);
        toast.error('As etiquetas foram geradas, mas o PDF não pôde ser baixado.');
      } else {
        toast.success('Etiquetas geradas e PDF baixado.');
        closeGenerationModal();
      }
    } catch (error) {
      toast.error(labelErrorMessage(error, 'Não foi possível gerar as etiquetas.'));
    } finally {
      setIsPrinting(false);
    }
  }

  async function retryDownload() {
    if (!generationTarget) return;
    setIsPrinting(true);
    try {
      if (generationTarget.type === 'group') {
        await downloadGroup(generationTarget.group);
      } else {
        await downloadSingleLabel(generationTarget.volume, labelModel);
      }
      toast.success('PDF baixado com a etiqueta já gerada.');
      closeGenerationModal();
    } catch {
      toast.error('Não foi possível baixar o PDF. As etiquetas existentes foram preservadas.');
    } finally {
      setIsPrinting(false);
    }
  }

  async function reprintSingle(volume) {
    setIsPrinting(true);
    try {
      await downloadSingleLabel(volume, labelModel);
      toast.success('Etiqueta baixada para reimpressão.');
    } catch (error) {
      toast.error(labelErrorMessage(error, 'Não foi possível baixar a etiqueta.'));
    } finally {
      setIsPrinting(false);
    }
  }

  const targetDetails = generationTarget?.type === 'group' ? {
    sale_number: generationTarget.group.sale_number,
    customer_name: generationTarget.group.customer_name,
    product_name: generationTarget.group.product_name_snapshot,
    total: generationTarget.group.pending,
    delivery_type: generationTarget.group.delivery_type,
    destination_city: generationTarget.group.destination_city,
    destination_uf: generationTarget.group.destination_uf,
    contains_ready_without_label: generationTarget.group.volumes.some((volume) => volume.label_status === 'ready_without_label'),
  } : generationTarget?.type === 'single' ? {
    sale_number: generationTarget.volume.sale_number,
    customer_name: generationTarget.volume.customer_name,
    product_name: generationTarget.volume.product_name_snapshot,
    total: 1,
    delivery_type: generationTarget.volume.delivery_type,
    destination_city: generationTarget.volume.destination_city,
    destination_uf: generationTarget.volume.destination_uf,
    contains_ready_without_label: generationTarget.volume.label_status === 'ready_without_label',
  } : null;

  return (
    <section className="page label-queue-page">
      <div className="page__header">
        <h1 className="page__title">Fila de etiquetas</h1>
        <div className="label-model-toggle" aria-label="Modelo de etiqueta">
          {labelModels.map((model) => (
            <button
              className={`label-model-toggle__button${labelModel === model ? ' label-model-toggle__button_active' : ''}`}
              type="button"
              key={model}
              onClick={() => setLabelModel(model)}
              aria-pressed={labelModel === model}
            >
              {model}
            </button>
          ))}
        </div>
      </div>

      <div className="label-queue-page__list">
        {groups.map((group) => (
          <article className="label-queue-group" key={group.sold_item_id}>
            <div className="label-queue-group__main">
              <strong>{group.customer_name}</strong>
              <span>Venda: {group.sale_number}</span>
              <span>Produto: {group.product_name_snapshot}</span>
              {group.volumes.some((volume) => volume.label_status === 'ready_without_label') && (
                <span>Este item foi liberado sem etiqueta, mas ainda é possível gerar as etiquetas.</span>
              )}
            </div>
            <div className="label-queue-group__stats">
              <span>Volumes: <strong>{group.total}</strong></span>
              <span>Geradas: <strong>{group.generated}</strong></span>
              <span>Pendentes: <strong>{group.pending}</strong></span>
            </div>
            <div className="label-queue-group__actions">
              {group.pending > 0 && canPrint && (
                <button className="button button_primary" type="button" onClick={() => openGroupGeneration(group)} disabled={isPrinting}>
                  Gerar etiquetas
                </button>
              )}
              {group.pending === 0 && canReprint && (
                <button className="button button_primary" type="button" onClick={() => reprintGroup(group)} disabled={isPrinting}>
                  Reimprimir / baixar novamente
                </button>
              )}
              {(canPrint || canReprint) && (
                <button className="button" type="button" onClick={() => setIndividualGroupId(group.sold_item_id)} disabled={isPrinting}>
                  Etiqueta individual
                </button>
              )}
            </div>
          </article>
        ))}
        {groups.length === 0 && <div className="panel">Nenhuma etiqueta liberada.</div>}
      </div>

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
                  {!volume.shipment_code && canPrint && (
                    <button className="button button_primary" type="button" onClick={() => { setIndividualGroupId(null); openSingleGeneration(volume); }} disabled={isPrinting}>
                      Gerar etiqueta
                    </button>
                  )}
                  {volume.shipment_code && canReprint && (
                    <button className="button button_primary" type="button" onClick={() => reprintSingle(volume)} disabled={isPrinting}>
                      Reimprimir
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="label-modal__actions">
              <button className="button" type="button" onClick={() => setIndividualGroupId(null)} disabled={isPrinting}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      <LabelGenerationModal
        open={Boolean(generationTarget)}
        details={targetDetails}
        invoiceNumber={invoiceNumber}
        onInvoiceChange={setInvoiceNumber}
        onCancel={closeGenerationModal}
        onConfirm={confirmGeneration}
        onRetryDownload={retryDownload}
        busy={isPrinting}
        downloadFailed={downloadFailed}
      />
    </section>
  );
}
