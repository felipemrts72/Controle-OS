import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { InternalOrderCard } from '../../components/InternalOrderCard/InternalOrderCard.jsx';
import './DashboardPage.css';

export function DashboardPage() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    api.get('/dashboard').then((response) => setOrders(response.data));
  }, []);

  return (
    <section className="page dashboard-page">
      <div className="page__header">
        <h1 className="page__title">Dashboard</h1>
      </div>
      <div className="dashboard-page__list">
        {orders.map((order) => <InternalOrderCard key={order.id} order={order} />)}
        {orders.length === 0 && <div className="panel">Nenhuma OS aberta.</div>}
      </div>
    </section>
  );
}
