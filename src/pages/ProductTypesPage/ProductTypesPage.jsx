import { useEffect, useState } from 'react';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './ProductTypesPage.css';

export function ProductTypesPage() {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ code: '', name: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await api.get('/products/types');
    setTypes(response.data);
  }

  useEffect(() => { load(); }, []);

  async function createType(event) {
    event.preventDefault();
    try {
      setSaving(true);
      await api.post('/products/types', form);
      setForm({ code: '', name: '' });
      await load();
      toast.success('Tipo de produto criado.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível criar o tipo de produto.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleType(type) {
    if (type.is_system) return;
    try {
      await api.put(`/products/types/${type.id}`, { name: type.name, is_active: !type.is_active });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar o tipo de produto.');
    }
  }

  return (
    <section className="page product-types-page">
      <div className="page__header">
        <h1 className="page__title">Tipos de produto</h1>
      </div>

      <form className="panel product-types-page__form" onSubmit={createType}>
        <label className="field">
          <span className="field__label">Código</span>
          <input className="field__input" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="servico_terceirizado" required />
        </label>
        <label className="field">
          <span className="field__label">Nome</span>
          <input className="field__input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Serviço terceirizado" required />
        </label>
        <button className="button button_primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Criar tipo'}</button>
      </form>

      <div className="panel">
        <DataTable
          columns={[
            { key: 'name', label: 'Nome' },
            { key: 'code', label: 'Código' },
            { key: 'is_system', label: 'Sistema', render: (row) => row.is_system ? 'Sim' : 'Não' },
            { key: 'is_active', label: 'Ativo', render: (row) => row.is_active ? 'Sim' : 'Não' },
            {
              key: 'actions',
              label: 'Ações',
              render: (row) => row.is_system ? 'Protegido' : (
                <button className="button" type="button" onClick={() => toggleType(row)}>
                  {row.is_active ? 'Desativar' : 'Ativar'}
                </button>
              ),
            },
          ]}
          rows={types}
        />
      </div>
    </section>
  );
}
