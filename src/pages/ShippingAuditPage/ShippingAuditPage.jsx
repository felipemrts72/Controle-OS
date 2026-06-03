import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge.jsx';
import './ShippingAuditPage.css';

function formatDateTime(date) {
  return date ? new Date(date).toLocaleString('pt-BR') : '-';
}

export function ShippingAuditPage() {
  const [records, setRecords] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const response = await api.get('/shipping/audit');
        setRecords(response.data);
        setError('');
      } catch {
        setError('Não foi possível carregar a auditoria de expedições.');
      }
    }

    load();
  }, []);

  return (
    <section className="page shipping-audit-page">
      <div className="page__header">
        <h1 className="page__title">Auditoria de Expedições</h1>
      </div>

      {error && <p className="shipping-audit-page__error">{error}</p>}

      <div className="panel">
        <DataTable
          columns={[
            { key: 'shipment_code', label: 'Código' },
            { key: 'sale_number', label: 'Venda' },
            { key: 'customer_name', label: 'Cliente' },
            { key: 'product_name', label: 'Produto' },
            { key: 'volume', label: 'Volume', render: (row) => `${row.volume_number}/${row.total_volumes}` },
            { key: 'weight_kg', label: 'Peso', render: (row) => `${Number(row.weight_kg).toLocaleString('pt-BR')} kg` },
            { key: 'shipped_at', label: 'Data/hora', render: (row) => formatDateTime(row.shipped_at) },
            { key: 'shipped_by_name', label: 'Usuário', render: (row) => row.shipped_by_name || '-' },
            { key: 'shipped_by_role', label: 'Perfil', render: (row) => row.shipped_by_role || '-' },
            { key: 'confirmation_origin', label: 'Origem' },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
          ]}
          rows={records}
        />
        {records.length === 0 && <p className="shipping-audit-page__empty">Nenhuma expedição registrada.</p>}
      </div>
    </section>
  );
}
