import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { SectorForm } from '../../components/SectorForm/SectorForm.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './SectorsPage.css';

export function SectorsPage() {
  const toast = useToast();
  const [sectors, setSectors] = useState([]);

  async function load() {
    const response = await api.get('/sectors');
    setSectors(response.data);
  }

  useEffect(() => { load(); }, []);

  async function create(payload) {
    try {
      await api.post('/sectors', payload);
      await load();
      toast.success('Setor criado com sucesso.');
    } catch {
      toast.error('Não foi possível criar o setor.');
    }
  }

  async function deactivate(id) {
    try {
      await api.patch(`/sectors/${id}/deactivate`);
      await load();
      toast.success('Setor desativado.');
    } catch {
      toast.error('Não foi possível desativar o setor.');
    }
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
