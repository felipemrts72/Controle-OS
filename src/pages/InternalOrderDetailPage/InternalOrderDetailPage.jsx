import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api.js';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { VolumeEditor } from '../../components/VolumeEditor/VolumeEditor.jsx';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import './InternalOrderDetailPage.css';

export function InternalOrderDetailPage() {
  const { id } = useParams();
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
    await api.patch(`/tasks/${taskId}/ready`);
    const nextOrder = await load();
    const nextReadyVolumes = nextOrder.volumes.filter((volume) => volume.label_status === 'released_for_label');
    if (nextReadyVolumes.length > readyVolumes.length) {
      setModalVolumeIds(nextReadyVolumes.map((volume) => volume.id));
    }
  }

  async function saveVolumes() {
    await api.put(`/internal-orders/${id}`, order);
    await load();
  }

  async function generateModalLabels() {
    for (const volumeId of modalVolumeIds) await api.post(`/labels/${volumeId}/generate`);
    setModalVolumeIds([]);
    await load();
  }

  async function markModalWithoutLabel() {
    for (const volumeId of modalVolumeIds) await api.post(`/labels/${volumeId}/without-label`);
    setModalVolumeIds([]);
    await load();
  }

  if (!order) return <div className="panel">Carregando...</div>;

  return (
    <section className="page internal-order-detail-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de Serviço Interna {order.sale_number}</h1>
          <p className="internal-order-detail-page__subtitle">{order.customer_name} · {order.customer_phone || '-'}</p>
        </div>
        <StatusBadge value={order.status} />
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
        <DataTable
          columns={[
            { key: 'task_name', label: 'Tarefa' },
            { key: 'sector_name', label: 'Setor' },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
            { key: 'actions', label: 'Ações', render: (row) => row.status === 'pending' ? <button className="button button_primary" type="button" onClick={() => markReady(row.id)}>Marcar pronto</button> : <button className="button" type="button" onClick={() => api.patch(`/tasks/${row.id}/pending`).then(load)}>Voltar pendente</button> },
          ]}
          rows={order.tasks}
        />
      </div>

      <div className="panel">
        <div className="internal-order-detail-page__section-header">
          <h2>Volumes de expedição</h2>
          <button className="button button_primary" type="button" onClick={saveVolumes}>Salvar volumes</button>
        </div>
        <VolumeEditor volumes={order.volumes} onChange={(volumes) => setOrder({ ...order, volumes })} />
      </div>

      <ConfirmModal
        open={modalVolumeIds.length > 0}
        title="Todas as tarefas deste item foram concluídas."
        onCancel={() => setModalVolumeIds([])}
        actions={(
          <>
            <button className="button button_primary" type="button" onClick={generateModalLabels}>Gerar Etiquetas em PDF</button>
            <button className="button" type="button" onClick={markModalWithoutLabel}>Marcar Pronto sem Etiqueta</button>
          </>
        )}
      >
        Deseja gerar as etiquetas dos volumes?
      </ConfirmModal>
    </section>
  );
}
