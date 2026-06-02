import { Link } from 'react-router-dom';
import { StatusBadge } from '../StatusBadge/StatusBadge.jsx';
import { InternalOrderProgress } from '../InternalOrderProgress/InternalOrderProgress.jsx';
import './InternalOrderCard.css';

export function InternalOrderCard({ order }) {
  return (
    <Link className="internal-order-card" to={`/os/${order.id}`}>
      <div>
        <strong>Venda {order.sale_number}</strong>
        <p className="internal-order-card__customer">{order.customer_name}</p>
      </div>
      <span>{order.customer_phone || '-'}</span>
      <span>{new Date(order.promised_date).toLocaleDateString('pt-BR')}</span>
      <InternalOrderProgress ready={order.ready_tasks} total={order.total_tasks} />
      <StatusBadge value={order.status} />
    </Link>
  );
}
