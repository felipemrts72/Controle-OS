import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Plus, Power, Search } from 'lucide-react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import './CommercialCustomers.css';

function formatTaxId(value) {
  const digits = String(value || '');
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value || '-';
}

export function CustomersPage() {
  const toast = useToast();
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'commercial.customers.create');
  const canEdit = canAccessPermission(user, 'commercial.customers.edit');
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusTarget, setStatusTarget] = useState(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/commercial/customers', {
        params: { search: appliedSearch || undefined, status, page, limit: 20 },
      });
      setRows(response.data.items);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Não foi possível carregar os clientes.');
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, page, status]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  function submitSearch(event) {
    event.preventDefault();
    setPage(1);
    setAppliedSearch(search.trim());
  }

  async function confirmStatusChange() {
    if (!statusTarget) return;
    try {
      setSavingStatus(true);
      await api.patch(`/commercial/customers/${statusTarget.id}/active`, { is_active: !statusTarget.is_active });
      toast.success(statusTarget.is_active ? 'Cliente inativado.' : 'Cliente reativado.');
      setStatusTarget(null);
      await loadCustomers();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Não foi possível alterar o status do cliente.');
    } finally {
      setSavingStatus(false);
    }
  }

  const columns = [
    {
      key: 'customer', label: 'Cliente', render: (row) => (
        <div className="commercial-customers__identity">
          <strong>{row.name}</strong>
          {row.trade_name && <span>{row.trade_name}</span>}
        </div>
      ),
    },
    { key: 'tax_id', label: 'CPF/CNPJ', render: (row) => formatTaxId(row.tax_id) },
    { key: 'contact', label: 'Contato', render: (row) => row.whatsapp || row.phone || row.email || '-' },
    { key: 'city', label: 'Cidade/UF', render: (row) => [row.city, row.state].filter(Boolean).join('/') || '-' },
    { key: 'production_order_count', label: 'Produções', render: (row) => row.production_order_count ?? 0 },
    {
      key: 'status', label: 'Status', render: (row) => (
        <span className={`commercial-customers__status commercial-customers__status_${row.is_active ? 'active' : 'inactive'}`}>
          {row.is_active ? 'Ativo' : 'Inativo'}
        </span>
      ),
    },
    {
      key: 'actions', label: 'Ações', render: (row) => (
        <div className="commercial-customers__actions">
          <Link className="button" to={`/comercial/clientes/${row.id}`}><Eye size={16} /> Abrir</Link>
          {canEdit && (
            <button className="button" type="button" onClick={() => setStatusTarget(row)}>
              <Power size={16} /> {row.is_active ? 'Inativar' : 'Reativar'}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="page commercial-customers">
      <header className="page__header">
        <div>
          <h1 className="page__title">Clientes</h1>
          <p className="commercial-customers__subtitle">Cadastro mestre compartilhado entre Comercial e Produção.</p>
        </div>
        {canCreate && <Link className="button button_primary" to="/comercial/clientes/novo"><Plus size={18} /> Novo cliente</Link>}
      </header>

      <form className="panel commercial-customers__filters" onSubmit={submitSearch}>
        <label className="field commercial-customers__search">
          <span className="field__label">Pesquisar</span>
          <input
            className="field__input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome, CPF/CNPJ, e-mail ou cidade"
          />
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select className="field__input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
            <option value="all">Todos</option>
          </select>
        </label>
        <button className="button button_primary" type="submit"><Search size={18} /> Buscar</button>
      </form>

      <div className="panel commercial-customers__table-panel">
        {loading && <p className="commercial-customers__feedback">Carregando clientes...</p>}
        {!loading && error && (
          <div className="commercial-customers__feedback commercial-customers__feedback_error">
            <p>{error}</p>
            <button className="button" type="button" onClick={loadCustomers}>Tentar novamente</button>
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="commercial-customers__summary">{pagination.total} cliente(s) encontrado(s)</div>
            <DataTable columns={columns} rows={rows} emptyText="Nenhum cliente encontrado." />
            {pagination.total_pages > 1 && (
              <div className="commercial-customers__pagination">
                <button className="button" type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</button>
                <span>Página {pagination.page} de {pagination.total_pages}</span>
                <button className="button" type="button" disabled={page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)}>Próxima</button>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        open={Boolean(statusTarget)}
        title={statusTarget?.is_active ? 'Inativar cliente' : 'Reativar cliente'}
        onCancel={() => setStatusTarget(null)}
        actions={(
          <button className={`button ${statusTarget?.is_active ? 'button_danger' : 'button_primary'}`} type="button" disabled={savingStatus} onClick={confirmStatusChange}>
            {savingStatus ? 'Salvando...' : statusTarget?.is_active ? 'Inativar' : 'Reativar'}
          </button>
        )}
      >
        <p>{statusTarget?.is_active
          ? `O cliente ${statusTarget?.name} ficará marcado como inativo. As Produções existentes continuarão vinculadas a ele.`
          : `O cliente ${statusTarget?.name} voltará a ficar ativo.`}</p>
      </ConfirmModal>
    </section>
  );
}
