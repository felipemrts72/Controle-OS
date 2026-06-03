import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './InternalOrdersPage.css';

function formatDate(date) {
  return new Date(date).toLocaleDateString('pt-BR');
}

function ProgressLine({ label, ready = 0, total = 0 }) {
  return (
    <div className="internal-orders-page__progress">
      <span>{label}: {ready} de {total}</span>
      <progress max={total || 1} value={total ? ready : 1} />
    </div>
  );
}

export function InternalOrdersPage() {
  const user = getStoredUser();
  const toast = useToast();
  const canManage = ['admin', 'manager'].includes(user?.role);
  const [orders, setOrders] = useState([]);
  const [orderToDelete, setOrderToDelete] = useState(null);

  async function load() {
    const response = await api.get('/internal-orders');
    setOrders(response.data);
  }

  useEffect(() => { load(); }, []);

  async function deleteOrder() {
    try {
      await api.delete(`/internal-orders/${orderToDelete.id}`);
      setOrderToDelete(null);
      await load();
      toast.success('Ordem de Serviço excluída.');
    } catch {
      toast.error('Não foi possível excluir a Ordem de Serviço.');
    }
  }

  return (
    <section className="page internal-orders-page">
      <div className="page__header">
        <h1 className="page__title">Ordens de Serviço</h1>
        {canManage && <Link className="button button_primary" to="/os/nova">Nova OS</Link>}
      </div>

      <div className="internal-orders-page__list">
        {orders.map((order) => (
          <article className="internal-orders-page__card" key={order.id}>
            <Link className="internal-orders-page__card-content" to={`/os/${order.id}`}>
              <div>
                <strong>Número {order.sale_number}</strong>
                <p>{order.customer_name}</p>
              </div>
              <span>{order.customer_phone || '-'}</span>
              <span>{formatDate(order.promised_date)}</span>
              <StatusBadge value={order.status} />
              <ProgressLine label="Tarefas" ready={order.ready_tasks} total={order.total_tasks} />
              <ProgressLine label="Volumes" ready={order.ready_volumes} total={order.total_volumes} />
            </Link>
            {canManage && (
              <div className="internal-orders-page__actions">
                <Link className="button" to={`/os/${order.id}`}>Editar/atualizar</Link>
                <button className="button button_danger" type="button" onClick={() => setOrderToDelete(order)}>Excluir</button>
              </div>
            )}
          </article>
        ))}
        {orders.length === 0 && <div className="panel">Nenhuma OS encontrada.</div>}
      </div>

      <ConfirmModal
        open={Boolean(orderToDelete)}
        title="Excluir Ordem de Serviço"
        onCancel={() => setOrderToDelete(null)}
        actions={<button className="button button_danger" type="button" onClick={deleteOrder}>Excluir</button>}
      >
        Deseja excluir a OS {orderToDelete?.sale_number}? Ela sairá das listagens operacionais, mas ficará preservada no histórico.
      </ConfirmModal>
    </section>
  );
}
