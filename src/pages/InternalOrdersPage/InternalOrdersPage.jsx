import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './InternalOrdersPage.css';

const SHIPPED_PAGE_SIZE = 15;

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
  const canCreate = canAccessPermission(user, 'orders.create');
  const canEdit = canAccessPermission(user, 'orders.edit');
  const canDelete = canAccessPermission(user, 'orders.delete');
  const canViewHistory = canAccessPermission(user, 'orders.history.view');
  const [orders, setOrders] = useState([]);
  const [shippedOrders, setShippedOrders] = useState([]);
  const [shippedPage, setShippedPage] = useState(1);
  const [shippedTotalPages, setShippedTotalPages] = useState(1);
  const [orderToDelete, setOrderToDelete] = useState(null);

  async function load() {
    const response = await api.get('/internal-orders');
    setOrders(response.data);
  }

  async function loadShipped(nextPage = shippedPage) {
    if (!canViewHistory) return;
    const response = await api.get('/internal-orders/history', {
      params: { page: nextPage, limit: SHIPPED_PAGE_SIZE, status: 'finalizadas' },
    });
    setShippedOrders(response.data.items);
    setShippedPage(response.data.page);
    setShippedTotalPages(response.data.totalPages);
  }

  useEffect(() => {
    load();
    if (canViewHistory) loadShipped(1);
  }, []);

  async function deleteOrder() {
    try {
      await api.delete(`/internal-orders/${orderToDelete.id}`);
      setOrderToDelete(null);
      await load();
      await loadShipped(shippedPage);
      toast.success('Ordem de Serviço excluída.');
    } catch {
      toast.error('Não foi possível excluir a Ordem de Serviço.');
    }
  }

  const activeOrders = orders.filter((order) => order.status !== 'shipped');

  return (
    <section className="page internal-orders-page">
      <div className="page__header">
        <h1 className="page__title">Ordens de Serviço</h1>
        {canCreate && <Link className="button button_primary" to="/os/nova">Nova OS</Link>}
      </div>

      <div className="internal-orders-page__list">
        {activeOrders.map((order) => (
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
            {(canEdit || canDelete) && (
              <div className="internal-orders-page__actions">
                {canEdit && <Link className="button" to={`/os/${order.id}`}>Editar/atualizar</Link>}
                {canDelete && <button className="button button_danger" type="button" onClick={() => setOrderToDelete(order)}>Excluir</button>}
              </div>
            )}
          </article>
        ))}
        {activeOrders.length === 0 && <div className="panel">Nenhuma OS encontrada.</div>}
      </div>

      {canViewHistory && <section className="internal-orders-page__shipped">
        <div className="internal-orders-page__section-header">
          <h2>Expedidas</h2>
          <span>{shippedOrders.length} registro(s)</span>
        </div>
        <div className="internal-orders-page__list">
          {shippedOrders.map((order) => (
            <article className="internal-orders-page__card internal-orders-page__card_shipped" key={order.id}>
              <Link className="internal-orders-page__card-content" to={`/os/${order.id}`}>
                <div>
                  <strong>Número {order.sale_number}</strong>
                  <p>{order.customer_name}</p>
                </div>
                <span>{order.customer_phone || '-'}</span>
                <span>{formatDate(order.promised_date)}</span>
                <StatusBadge value={order.status} />
                <ProgressLine label="Tarefas" ready={order.ready_tasks} total={order.total_tasks} />
                <ProgressLine label="Volumes" ready={order.shipped_volumes} total={order.total_volumes} />
              </Link>
            </article>
          ))}
          {shippedOrders.length === 0 && <div className="panel">Nenhuma OS expedida encontrada.</div>}
        </div>
        <div className="internal-orders-page__pagination">
          <button className="button" type="button" disabled={shippedPage <= 1} onClick={() => loadShipped(shippedPage - 1)}>Anterior</button>
          <span>Página {shippedPage} de {shippedTotalPages}</span>
          <button className="button" type="button" disabled={shippedPage >= shippedTotalPages} onClick={() => loadShipped(shippedPage + 1)}>Próxima</button>
        </div>
      </section>}

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
