import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { SectorForm } from '../../components/SectorForm/SectorForm.jsx';
import './SectorsPage.css';

export function SectorsPage() {
  const [sectors, setSectors] = useState([]);

  async function load() {
    const response = await api.get('/sectors');
    setSectors(response.data);
  }

  useEffect(() => { load(); }, []);

  async function create(payload) {
    await api.post('/sectors', payload);
    await load();
  }

  async function deactivate(id) {
    await api.patch(`/sectors/${id}/deactivate`);
    await load();
  }

  return (
    <section className="page sectors-page">
      <div className="page__header">
        <h1 className="page__title">Setores</h1>
      </div>
      <div className="panel">
        <SectorForm onSubmit={create} />
      </div>
      <div className="panel">
        <DataTable
          columns={[
            { key: 'name', label: 'Nome' },
            { key: 'slug', label: 'Slug' },
            { key: 'is_active', label: 'Status', render: (row) => row.is_active ? 'Ativo' : 'Inativo' },
            { key: 'actions', label: 'Ações', render: (row) => row.is_active && <button className="button" type="button" onClick={() => deactivate(row.id)}>Desativar</button> },
          ]}
          rows={sectors}
        />
      </div>
    </section>
  );
}
