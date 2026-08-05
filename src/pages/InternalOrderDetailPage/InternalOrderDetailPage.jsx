import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { VolumeEditor } from '../../components/VolumeEditor/VolumeEditor.jsx';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { LabelGenerationModal } from '../../components/LabelGenerationModal/LabelGenerationModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import { createSoldItemLabels, downloadSoldItemLabels, generateThenDownloadLabels, labelErrorMessage } from '../../utils/labelWorkflow.js';
import './InternalOrderDetailPage.css';

const availableForLabels = (volume) => ['released_for_label', 'ready_without_label', 'label_generated'].includes(volume.label_status)
  || (volume.label_status === 'shipped' && (volume.shipment_code || volume.was_ready_without_label));

export function InternalOrderDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const user = getStoredUser();
  const canEdit = canAccessPermission(user, 'orders.edit');
  const canCompleteServices = canAccessPermission(user, 'services.complete');
  const canPrintLabels = canAccessPermission(user, 'labels.print');
  const canMarkWithoutLabel = canAccessPermission(user, 'labels.mark_without_label');
  const [order, setOrder] = useState(null);
  const [completionVolumeIds, setCompletionVolumeIds] = useState([]);
  const [labelVolumeIds, setLabelVolumeIds] = useState([]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [labelBusy, setLabelBusy] = useState(false);
  const [downloadRetryGroups, setDownloadRetryGroups] = useState(null);

  async function load() {
    const response = await api.get(`/internal-orders/${id}`);
    setOrder(response.data);
    return response.data;
  }

  useEffect(() => { load(); }, [id]);

  const readyVolumes = useMemo(
    () => order?.volumes?.filter((volume) => volume.label_status === 'released_for_label') || [],
    [order],
  );

  async function markReady(taskId) {
    if (!canCompleteServices) return;
    try {
      await api.patch(`/tasks/${taskId}/ready`);
      const nextOrder = await load();
      const nextReadyVolumes = nextOrder.volumes.filter((volume) => volume.label_status === 'released_for_label');
      toast.success('Tarefa marcada como pronta.');
      if (nextReadyVolumes.length > readyVolumes.length) {
        toast.success('Item liberado para etiqueta.');
        setCompletionVolumeIds(nextReadyVolumes.map((volume) => volume.id));
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível marcar a tarefa como pronta.');
    }
  }

  async function saveVolumes() {
    if (!canEdit) return;
    try {
      await api.put(`/internal-orders/${id}`, order);
      await load();
      toast.success('Ordem de produção atualizada.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar a ordem de produção.');
    }
  }

  function closeLabelModal() {
    setLabelVolumeIds([]);
    setInvoiceNumber('');
    setDownloadRetryGroups(null);
  }

  function openLabelModal(volumeIds) {
    if (!volumeIds.length) {
      toast.error('Os volumes precisam ser salvos antes de gerar as etiquetas.');
      return;
    }
    setCompletionVolumeIds([]);
    setLabelVolumeIds(volumeIds);
    setInvoiceNumber(order.invoice_number || '');
    setDownloadRetryGroups(null);
  }

  async function generateModalLabels() {
    if (!canPrintLabels) return;
    const nextInvoiceNumber = invoiceNumber.trim();
    if (!nextInvoiceNumber) {
      toast.error('Informe a Nota Fiscal antes de gerar as etiquetas.');
      return;
    }

    const selectedVolumes = order.volumes.filter((volume) => labelVolumeIds.includes(volume.id));
    const groups = [...new Set(selectedVolumes.map((volume) => volume.sold_item_id))].map((soldItemId) => ({
      soldItemId,
      saleNumber: order.sale_number,
      needsCreation: selectedVolumes.some((volume) => volume.sold_item_id === soldItemId && !volume.shipment_code),
    }));
    if (!groups.length) {
      toast.error('Os volumes precisam ser salvos antes de gerar as etiquetas.');
      return;
    }

    setLabelBusy(true);
    try {
      const outcome = await generateThenDownloadLabels({
        create: async () => {
          for (const group of groups.filter((entry) => entry.needsCreation)) {
            await createSoldItemLabels(group.soldItemId, nextInvoiceNumber);
          }
          return groups;
        },
        refresh: load,
        download: async () => {
          for (const group of groups) await downloadSoldItemLabels(group.soldItemId, group.saleNumber, '15x10');
        },
      });
      if (outcome.status === 'download_failed') {
        setDownloadRetryGroups(groups);
        toast.error('As etiquetas foram geradas, mas o PDF não pôde ser baixado.');
      } else {
        toast.success('Etiquetas geradas e PDF baixado.');
        closeLabelModal();
      }
    } catch (error) {
      toast.error(labelErrorMessage(error, 'Não foi possível gerar as etiquetas.'));
    } finally {
      setLabelBusy(false);
    }
  }

  async function retryModalDownload() {
    if (!downloadRetryGroups?.length) return;
    setLabelBusy(true);
    try {
      for (const group of downloadRetryGroups) await downloadSoldItemLabels(group.soldItemId, group.saleNumber, '15x10');
      toast.success('PDF baixado com as etiquetas já geradas.');
      closeLabelModal();
    } catch {
      toast.error('Não foi possível baixar o PDF. As etiquetas existentes foram preservadas.');
    } finally {
      setLabelBusy(false);
    }
  }

  async function markModalWithoutLabel() {
    if (!canMarkWithoutLabel) return;
    try {
      for (const volumeId of completionVolumeIds) await api.post(`/labels/${volumeId}/without-label`);
      setCompletionVolumeIds([]);
      await load();
      toast.success('Item liberado sem etiqueta. As etiquetas poderão ser geradas posteriormente.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível liberar o item sem etiqueta.');
    }
  }

  if (!order) return <div className="panel">Carregando...</div>;

  const selectedLabelVolumes = order.volumes.filter((volume) => labelVolumeIds.includes(volume.id));
  const availableLabelVolumes = order.volumes.filter(availableForLabels);
  const pendingLabelVolumes = availableLabelVolumes.filter((volume) => !volume.shipment_code);
  const selectedProducts = [...new Set(selectedLabelVolumes
    .map((volume) => order.items.find((item) => item.id === volume.sold_item_id)?.product_name_snapshot)
    .filter(Boolean))];
  const labelModalDetails = selectedLabelVolumes.length ? {
    sale_number: order.sale_number,
    customer_name: order.customer_name,
    product_name: selectedProducts.join(', '),
    total: selectedLabelVolumes.length,
    delivery_type: order.delivery_type,
    destination_city: order.destination_city,
    destination_uf: order.destination_uf,
    contains_ready_without_label: selectedLabelVolumes.some((volume) => volume.label_status === 'ready_without_label'),
  } : null;

  const taskColumns = [
    { key: 'task_name', label: 'Tarefa' },
    { key: 'sector_name', label: 'Setor' },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    {
      key: 'waiting_dependencies',
      label: 'Liberação',
      render: (row) => {
        const waiting = row.waiting_dependencies || [];
        if (row.is_released || row.status === 'ready') return 'Liberada';
        if (waiting.length === 1) return `Aguardando: ${waiting[0].name}`;
        return `Aguardando ${waiting.length} etapas: ${waiting.map((dependency) => dependency.name).join(', ')}`;
      },
    },
    ...(canCompleteServices ? [{
      key: 'actions',
      label: 'Ações',
      render: (row) => row.status === 'pending'
        ? <button className="button button_primary" type="button" disabled={row.is_released === false} onClick={() => markReady(row.id)}>Marcar pronto</button>
        : <button className="button" type="button" onClick={() => api.patch(`/tasks/${row.id}/pending`).then(load)}>Voltar pendente</button>,
    }] : []),
  ];

  return (
    <section className="page internal-order-detail-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de produção {order.sale_number}</h1>
          <p className="internal-order-detail-page__subtitle">{order.customer_name} · {order.customer_phone || '-'}</p>
        </div>
        <div className="page__actions">
          {canEdit && <Link className="button" to={`/os/${order.id}/editar`}>Editar ordem de produção</Link>}
          <StatusBadge value={order.status} />
        </div>
      </div>

      <div className="panel internal-order-detail-page__summary">
        <span>Data de entrega: {new Date(order.promised_date).toLocaleDateString('pt-BR')}</span>
        <span>Status: <StatusBadge value={order.status} /></span>
      </div>

      <div className="panel">
        <h2>Itens vendidos</h2>
        <DataTable
          columns={[
            { key: 'product_name_snapshot', label: 'Produto' },
            { key: 'quantity', label: 'Quantidade' },
            { key: 'is_spare_part', label: 'Contexto', render: (row) => row.is_spare_part ? 'Peça de reposição' : '-' },
            { key: 'total_volumes', label: 'Volumes totais' },
            { key: 'total_weight_kg', label: 'Peso total', render: (row) => `${Number(row.total_weight_kg).toLocaleString('pt-BR')} kg` },
            { key: 'default_volume_quantity', label: 'Volumes por unidade' },
            { key: 'default_total_weight_kg', label: 'Peso por unidade', render: (row) => `${Number(row.default_total_weight_kg).toLocaleString('pt-BR')} kg` },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
          ]}
          rows={order.items}
        />
      </div>

      <div className="panel">
        <h2>Tarefas internas</h2>
        <DataTable columns={taskColumns} rows={order.tasks} />
      </div>

      <div className="panel">
        <div className="internal-order-detail-page__section-header">
          <h2>Volumes de expedição</h2>
          <div className="page__actions">
            {canPrintLabels && availableLabelVolumes.length > 0 && (
              <button className="button" type="button" onClick={() => openLabelModal(availableLabelVolumes.map((volume) => volume.id))}>
                {pendingLabelVolumes.length > 0 ? 'Gerar etiquetas agora' : 'Baixar etiquetas novamente'}
              </button>
            )}
            {canEdit && <button className="button button_primary" type="button" onClick={saveVolumes}>Salvar volumes</button>}
          </div>
        </div>
        <VolumeEditor volumes={order.volumes} onChange={(volumes) => setOrder({ ...order, volumes })} />
      </div>

      <ConfirmModal
        open={completionVolumeIds.length > 0}
        title="Todas as tarefas deste item foram concluídas."
        onCancel={() => setCompletionVolumeIds([])}
        actions={(
          <>
            {canPrintLabels && <button className="button button_primary" type="button" onClick={() => openLabelModal(completionVolumeIds)}>Gerar etiquetas</button>}
            {canMarkWithoutLabel && <button className="button" type="button" onClick={markModalWithoutLabel}>Marcar pronto sem etiqueta</button>}
          </>
        )}
      >
        Deseja gerar as etiquetas dos volumes agora?
      </ConfirmModal>

      <LabelGenerationModal
        open={labelVolumeIds.length > 0}
        details={labelModalDetails}
        invoiceNumber={invoiceNumber}
        onInvoiceChange={setInvoiceNumber}
        onCancel={closeLabelModal}
        onConfirm={generateModalLabels}
        onRetryDownload={retryModalDownload}
        busy={labelBusy}
        downloadFailed={Boolean(downloadRetryGroups)}
      />
    </section>
  );
}
