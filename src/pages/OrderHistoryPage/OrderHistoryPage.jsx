import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './OrderHistoryPage.css';

const filters = [
  { value: 'todos', label: 'Todos' },
  { value: 'andamento', label: 'Em andamento' },
  { value: 'finalizadas', label: 'Finalizadas / expedidas' },
  { value: 'excluidas', label: 'Excluídas' },
];

function formatDate(date) {
  return date ? new Date(date).toLocaleDateString('pt-BR') : '-';
}

function formatDateTime(date) {
  return date ? new Date(date).toLocaleString('pt-BR') : '-';
}

function formatWeight(value) {
  return `${Number(value || 0).toLocaleString('pt-BR')} kg`;
}

export function OrderHistoryPage() {
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('todos');
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  async function loadHistory(nextPage = page, nextStatus = status) {
    try {
      setLoading(true);
      const response = await api.get('/internal-orders/history', {
        params: { page: nextPage, limit: 30, status: nextStatus },
      });
      setOrders(response.data.items);
      setPage(response.data.page);
      setTotalPages(response.data.totalPages);
      setTotal(response.data.total);
    } catch {
      toast.error('Não foi possível carregar o histórico de ordens.');
    } finally {
      setLoading(false);
    }
  }

  async function openOrder(orderId) {
    try {
      const response = await api.get(`/internal-orders/${orderId}`);
      setSelectedOrder(response.data);
    } catch {
      toast.error('Não foi possível carregar os detalhes da OS.');
    }
  }

  useEffect(() => {
    loadHistory(1, status);
  }, [status]);

  const selectedTasks = useMemo(() => selectedOrder?.tasks || [], [selectedOrder]);
  const selectedVolumes = useMemo(() => selectedOrder?.volumes || [], [selectedOrder]);

  return (
    <section className="page order-history-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Histórico de Ordens</h1>
          <p className="order-history-page__subtitle">Consulta e auditoria das Ordens de Serviço.</p>
        </div>
      </div>

      <div className="panel order-history-page__toolbar">
        <label className="order-history-page__filter">
          Status
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            {filters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        <span>{total} ordem(ns) encontrada(s)</span>
      </div>

      <div className="panel">
        <DataTable
          emptyText={loading ? 'Carregando...' : 'Nenhuma ordem encontrada.'}
          columns={[
            { key: 'sale_number', label: 'Venda' },
            { key: 'customer_name', label: 'Cliente' },
            { key: 'promised_date', label: 'Entrega', render: (row) => formatDate(row.promised_date) },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status || 'pending'} /> },
            { key: 'tasks', label: 'Tarefas', render: (row) => `${row.ready_tasks}/${row.total_tasks}` },
            { key: 'volumes', label: 'Volumes expedidos', render: (row) => `${row.shipped_volumes}/${row.total_volumes}` },
            { key: 'created_at', label: 'Criada em', render: (row) => formatDateTime(row.created_at) },
            { key: 'deleted_at', label: 'Excluída em', render: (row) => formatDateTime(row.deleted_at) },
            { key: 'actions', label: 'Detalhes', render: (row) => <button className="button" type="button" onClick={() => openOrder(row.id)}>Ver</button> },
          ]}
          rows={orders}
        />

        <div className="order-history-page__pagination">
          <button className="button" type="button" disabled={page <= 1} onClick={() => loadHistory(page - 1, status)}>Anterior</button>
          <span>Página {page} de {totalPages}</span>
          <button className="button" type="button" disabled={page >= totalPages} onClick={() => loadHistory(page + 1, status)}>Próxima</button>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(selectedOrder)}
        title={`OS ${selectedOrder?.sale_number || ''}`}
        onCancel={() => setSelectedOrder(null)}
        actions={null}
      >
        {selectedOrder && (
          <div className="order-history-page__modal">
            <div className="order-history-page__summary">
              <span><strong>Cliente:</strong> {selectedOrder.customer_name}</span>
              <span><strong>Telefone:</strong> {selectedOrder.customer_phone || '-'}</span>
              <span><strong>Entrega:</strong> {formatDate(selectedOrder.promised_date)}</span>
              <span><strong>Status:</strong> <StatusBadge value={selectedOrder.status || 'pending'} /></span>
              <span><strong>Criada em:</strong> {formatDateTime(selectedOrder.created_at)}</span>
              <span><strong>Criada por:</strong> {selectedOrder.created_by_name || '-'}</span>
              <span><strong>Excluída em:</strong> {formatDateTime(selectedOrder.deleted_at)}</span>
              <span><strong>Excluída por:</strong> {selectedOrder.deleted_by_name || '-'}</span>
            </div>

            <h3>Itens</h3>
            <DataTable
              columns={[
                { key: 'product_name_snapshot', label: 'Produto' },
                { key: 'quantity', label: 'Quantidade' },
                { key: 'total_volumes', label: 'Volumes' },
                { key: 'total_weight_kg', label: 'Peso total', render: (row) => formatWeight(row.total_weight_kg) },
                { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
              ]}
              rows={selectedOrder.items || []}
            />

            <h3>Serviços</h3>
            <DataTable
              columns={[
                { key: 'task_name', label: 'Tarefa' },
                { key: 'sector_name', label: 'Setor' },
                { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
                { key: 'completed_at', label: 'Concluída em', render: (row) => formatDateTime(row.completed_at) },
              ]}
              rows={selectedTasks}
            />

            <h3>Expedição</h3>
            <DataTable
              columns={[
                { key: 'shipment_code', label: 'Código', render: (row) => row.shipment_code || '-' },
                { key: 'volume', label: 'Volume', render: (row) => `${row.volume_number}/${row.total_volumes}` },
                { key: 'weight_kg', label: 'Peso', render: (row) => formatWeight(row.weight_kg) },
                { key: 'label_status', label: 'Status', render: (row) => <StatusBadge value={row.label_status} /> },
                { key: 'shipped_at', label: 'Expedida em', render: (row) => formatDateTime(row.shipped_at) },
                { key: 'shipped_by_name', label: 'Expedida por', render: (row) => row.shipped_by_name || '-' },
              ]}
              rows={selectedVolumes}
            />
          </div>
        )}
      </ConfirmModal>
    </section>
  );
}
