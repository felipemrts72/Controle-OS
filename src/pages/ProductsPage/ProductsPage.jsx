import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import './ProductsPage.css';

export function ProductsPage() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api.get('/products').then((response) => setProducts(response.data));
  }, []);

  return (
    <section className="page products-page">
      <div className="page__header">
        <h1 className="page__title">Produtos</h1>
        <Link className="button button_primary" to="/produtos/novo">Novo produto</Link>
      </div>
      <div className="panel">
        <DataTable
          columns={[
            { key: 'name', label: 'Nome', render: (row) => <Link to={`/produtos/${row.id}`}>{row.name}</Link> },
            { key: 'type', label: 'Tipo', render: (row) => <StatusBadge value={row.type} /> },
            { key: 'default_volume_quantity', label: 'Volumes' },
            { key: 'default_total_weight_kg', label: 'Peso total (kg)' },
          ]}
          rows={products}
        />
      </div>
    </section>
  );
}
