import { useEffect, useState } from 'react';
import { Pencil, Plus, Power, PowerOff, Search } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { SectorForm } from '../../components/SectorForm/SectorForm.jsx';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './SectorsPage.css';

export function SectorsPage() {
  const toast = useToast();
  const user = getStoredUser();
  const canManage = canAccessPermission(user, 'sectors.manage');
  const [sectors, setSectors] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [statusChange, setStatusChange] = useState(null);

  async function load(nextSearch = search) {
    setLoading(true);
    try {
      const response = await api.get('/sectors', { params: { search: nextSearch } });
      setSectors(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível carregar os setores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(sector) {
    setEditing(sector);
    setFormOpen(true);
  }

  async function save(payload) {
    setSaving(true);
    try {
      if (editing) await api.put(`/sectors/${editing.id}`, payload);
      else await api.post('/sectors', payload);
      setFormOpen(false);
      setEditing(null);
      await load();
      toast.success(editing ? 'Setor atualizado com sucesso.' : 'Setor criado com sucesso.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar o setor.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmStatusChange() {
    if (!statusChange) return;
    const reactivate = statusChange.is_active === false;
    try {
      await api.patch(`/sectors/${statusChange.id}/${reactivate ? 'reactivate' : 'deactivate'}`);
      setStatusChange(null);
      await load();
      toast.success(reactivate ? 'Setor reativado.' : 'Setor desativado.');
    } catch (error) {
      toast.error(error.response?.data?.message || `Não foi possível ${reactivate ? 'reativar' : 'desativar'} o setor.`);
    }
  }

  function submitSearch(event) {
    event.preventDefault();
    load();
  }

  const columns = [
    { key: 'name', label: 'Nome' },
    { key: 'slug', label: 'Identificador', render: (row) => <code>{row.slug}</code> },
    { key: 'employee_count', label: 'Funcionários', render: (row) => Number(row.employee_count || 0) },
    {
      key: 'is_active',
      label: 'Situação',
      render: (row) => <span className={`sectors-page__status sectors-page__status_${row.is_active ? 'active' : 'inactive'}`}>{row.is_active ? 'Setor ativo' : 'Setor inativo'}</span>,
    },
    ...(canManage ? [{
      key: 'actions',
      label: 'Ações',
      render: (row) => (
        <div className="sectors-page__actions">
          <button className="button" type="button" onClick={() => openEdit(row)}><Pencil size={16} />Editar setor</button>
          <button className={row.is_active ? 'button button_danger' : 'button'} type="button" onClick={() => setStatusChange(row)}>
            {row.is_active ? <PowerOff size={16} /> : <Power size={16} />}
            {row.is_active ? 'Desativar setor' : 'Reativar setor'}
          </button>
        </div>
      ),
    }] : []),
  ];

  return (
    <section className="page sectors-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Setores</h1>
          <p className="sectors-page__subtitle">Gerencie os setores usados por funcionários, produtos e produção.</p>
        </div>
        {canManage && <button className="button button_primary" type="button" onClick={openCreate}><Plus size={18} />Novo setor</button>}
      </div>

      <form className="panel sectors-page__search" onSubmit={submitSearch}>
        <label className="field"><span className="field__label">Pesquisar por nome</span><input className="field__input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome do setor" /></label>
        <button className="button button_primary" type="submit"><Search size={17} />Pesquisar</button>
        <button className="button" type="button" onClick={() => { setSearch(''); load(''); }}>Limpar</button>
      </form>

      <div className="panel">
        {loading ? <p>Carregando setores...</p> : <DataTable columns={columns} rows={sectors} emptyText="Nenhum setor encontrado." />}
      </div>

      <ConfirmModal
        open={formOpen}
        title={editing ? 'Editar setor' : 'Novo setor'}
        onCancel={() => { if (!saving) setFormOpen(false); }}
        actions={<button className="button button_primary" type="submit" form="sector-management-form" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar setor'}</button>}
      >
        <SectorForm sector={editing} onSubmit={save} formId="sector-management-form" />
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(statusChange)}
        title={statusChange?.is_active ? 'Desativar setor' : 'Reativar setor'}
        onCancel={() => setStatusChange(null)}
        actions={<button className={statusChange?.is_active ? 'button button_danger' : 'button button_primary'} type="button" onClick={confirmStatusChange}>{statusChange?.is_active ? 'Desativar setor' : 'Reativar setor'}</button>}
      >
        {statusChange?.is_active ? (
          <p>O setor <strong>{statusChange.name}</strong> deixará de aparecer em novas seleções. Os {Number(statusChange.employee_count || 0)} funcionário(s) vinculados e todos os registros históricos serão preservados.</p>
        ) : (
          <p>O setor <strong>{statusChange?.name}</strong> voltará a aparecer nas seleções de novos cadastros.</p>
        )}
      </ConfirmModal>
    </section>
  );
}
