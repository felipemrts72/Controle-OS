import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { VolumeEditor } from '../../components/VolumeEditor/VolumeEditor.jsx';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './InternalOrderDetailPage.css';

export function InternalOrderDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const user = getStoredUser();
  const canEdit = canAccessPermission(user, 'orders.edit');
  const canCompleteServices = canAccessPermission(user, 'services.complete');
  const canPrintLabels = canAccessPermission(user, 'labels.print');
  const canMarkWithoutLabel = canAccessPermission(user, 'labels.mark_without_label');
  const [order, setOrder] = useState(null);
  const [modalVolumeIds, setModalVolumeIds] = useState([]);

  async function load() {
    const response = await api.get(`/internal-orders/${id}`);
    setOrder(response.data);
    return response.data;
  }

  useEffect(() => { load(); }, [id]);

  const readyVolumes = useMemo(() => order?.volumes?.filter((volume) => volume.label_status === 'released_for_label') || [], [order]);

  async function markReady(taskId) {
    if (!canCompleteServices) return;
    try {
      await api.patch(`/tasks/${taskId}/ready`);
      const nextOrder = await load();
      const nextReadyVolumes = nextOrder.volumes.filter((volume) => volume.label_status === 'released_for_label');
      toast.success('Tarefa marcada como pronta.');
      if (nextReadyVolumes.length > readyVolumes.length) {
        toast.success('Item liberado para etiqueta.');
        setModalVolumeIds(nextReadyVolumes.map((volume) => volume.id));
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
      toast.success('Ordem de Serviço atualizada.');
    } catch {
      toast.error('Não foi possível atualizar a Ordem de Serviço.');
    }
  }

  async function generateModalLabels() {
    if (!canPrintLabels) return;
    for (const volumeId of modalVolumeIds) await api.post(`/labels/${volumeId}/generate`);
    setModalVolumeIds([]);
    await load();
  }

  async function markModalWithoutLabel() {
    if (!canMarkWithoutLabel) return;
    for (const volumeId of modalVolumeIds) await api.post(`/labels/${volumeId}/without-label`);
    setModalVolumeIds([]);
    await load();
  }

  if (!order) return <div className="panel">Carregando...</div>;

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
          <h1 className="page__title">Ordem de Serviço Interna {order.sale_number}</h1>
          <p className="internal-order-detail-page__subtitle">{order.customer_name} · {order.customer_phone || '-'}</p>
        </div>
        <div className="page__actions">
          {canEdit && <Link className="button" to={`/os/${order.id}/editar`}>Editar OS</Link>}
          <StatusBadge value={order.status} />
        </div>
      </div>

      <div className="panel internal-order-detail-page__summary">
        <span>Data de Entrega: {new Date(order.promised_date).toLocaleDateString('pt-BR')}</span>
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
          {canEdit && <button className="button button_primary" type="button" onClick={saveVolumes}>Salvar volumes</button>}
        </div>
        <VolumeEditor volumes={order.volumes} onChange={(volumes) => setOrder({ ...order, volumes })} />
      </div>

      <ConfirmModal
        open={modalVolumeIds.length > 0}
        title="Todas as tarefas deste item foram concluídas."
        onCancel={() => setModalVolumeIds([])}
        actions={(
          <>
            {canPrintLabels && <button className="button button_primary" type="button" onClick={generateModalLabels}>Gerar Etiquetas em PDF</button>}
            {canMarkWithoutLabel && <button className="button" type="button" onClick={markModalWithoutLabel}>Marcar Pronto sem Etiqueta</button>}
          </>
        )}
      >
        Deseja gerar as etiquetas dos volumes?
      </ConfirmModal>
    </section>
  );
}
