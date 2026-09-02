import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Eye, FilePlus2, Pencil, Search, SlidersHorizontal } from 'lucide-react';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, apiErrorMessage, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { formatDate, formatMoney, quoteCommercialLabel, QUOTE_STATUS } from './quoteUi.js';
import './CommercialQuotes.css';

export function QuotesPage() {
  const user = getStoredUser();
  const toast = useToast();
  const canCreate = canAccessPermission(user, 'commercial.quotes.create');
  const canEdit = canAccessPermission(user, 'commercial.quotes.edit');
  const [rows, setRows] = useState([]);
  const [origin, setOrigin] = useState('all');
  const [filters, setFilters] = useState({ search: '', customer: '', status: '', start_date: '', end_date: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [duplicating, setDuplicating] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/commercial/quotes', {
        params: { ...Object.fromEntries(Object.entries(applied).filter(([, value]) => value)), origin, page, limit: 20 },
      });
      if (!Array.isArray(response.data?.items) || !response.data?.pagination) {
        throw new Error('Resposta inválida do servidor ao carregar os orçamentos.');
      }
      setRows(response.data.items);
      setPagination(response.data.pagination);
    } catch (requestError) {
      setError(apiErrorMessage(requestError, 'Não foi possível carregar os orçamentos.'));
    } finally {
      setLoading(false);
    }
  }, [applied, origin, page]);

  useEffect(() => { load(); }, [load]);

  async function duplicate(row) {
    try {
      setDuplicating(row.id);
      const response = await api.post(row.origin_type === 'legacy'
        ? `/commercial/quotes/legacy/${row.id}/duplicate`
        : `/commercial/quotes/${row.id}/duplicate`);
      toast.success(`${quoteCommercialLabel(response.data)} criado como rascunho.`);
      await load();
    } catch (requestError) {
      toast.error(requestError.response?.data?.message || 'Não foi possível duplicar o orçamento.');
    } finally {
      setDuplicating(null);
    }
  }

  const columns = [
    { key: 'number', label: 'Número', render: (row) => <div className="commercial-quotes__identity"><strong>{quoteCommercialLabel(row)}</strong>{row.origin_type === 'legacy' && <span>ERP original #{row.source_legacy_number}</span>}</div> },
    { key: 'customer', label: 'Cliente', render: (row) => row.customer_name_snapshot },
    { key: 'date', label: 'Data', render: (row) => formatDate(row.quote_date) },
    { key: 'items', label: 'Itens', render: (row) => `${row.item_count} ${Number(row.item_count) === 1 ? 'item' : 'itens'}` },
    { key: 'validity', label: 'Validade', render: (row) => formatDate(row.valid_until) },
    { key: 'total', label: 'Total', render: (row) => <strong>{formatMoney(row.total)}</strong> },
    {
      key: 'status', label: 'Status', render: (row) => {
        const status = row.origin_type === 'legacy' ? { label: 'ERP antigo', tone: 'muted' } : QUOTE_STATUS[row.status] || { label: row.status, tone: 'neutral' };
        return <span className={`commercial-quotes__status commercial-quotes__status_${status.tone}`}>{status.label}</span>;
      },
    },
    { key: 'responsible', label: 'Responsável', render: (row) => row.responsible_name || '-' },
    {
      key: 'actions', label: 'Ações', render: (row) => (
        <div className="commercial-quotes__actions">
          <Link className="button" to={row.origin_type === 'legacy' ? `/comercial/orcamentos/antigos/${row.id}` : `/comercial/orcamentos/${row.id}`}><Eye size={16} /> Abrir</Link>
          {row.origin_type !== 'legacy' && canEdit && row.status === 'draft' && <Link className="button" to={`/comercial/orcamentos/${row.id}/editar`}><Pencil size={16} /> Editar</Link>}
          {canCreate && <button className="button" type="button" disabled={duplicating === row.id} onClick={() => duplicate(row)}><Copy size={16} /> Duplicar</button>}
        </div>
      ),
    },
  ];

  const advancedFilterCount = [filters.customer, filters.status, filters.start_date, filters.end_date].filter(Boolean).length;

  return (
    <section className="page commercial-quotes">
      <header className="page__header">
        <div>
          <h1 className="page__title">Orçamentos</h1>
          <p className="commercial-quotes__subtitle">Documentos comerciais independentes de Produção, Estoque e Expedição.</p>
        </div>
        {canCreate && <Link className="button button_primary" to="/comercial/orcamentos/novo"><FilePlus2 size={18} /> Novo orçamento</Link>}
      </header>

      <nav className="commercial-quotes__origin-tabs" aria-label="Origem dos orçamentos">
        {[['all', 'Todos'], ['current', 'Atuais'], ['legacy', 'Antigos']].map(([value, label]) => <button
          className={`button ${origin === value ? 'button_primary' : ''}`} type="button" key={value}
          aria-pressed={origin === value} onClick={() => { setOrigin(value); setPage(1); }}
        >{label}</button>)}
      </nav>

      <form className="panel commercial-quotes__filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setApplied(filters); }}>
        <label className="field commercial-quotes__filter-search"><span className="field__label">Busca rápida</span><input className="field__input" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Número, ERP 83 ou cliente" /></label>
        <button className="button commercial-quotes__filters-toggle" type="button" aria-expanded={filtersOpen} aria-controls="quote-advanced-filters" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={17} /> Filtros{advancedFilterCount > 0 && <span>{advancedFilterCount}</span>}</button>
        <div className={`commercial-quotes__advanced-filters ${filtersOpen ? 'is-open' : ''}`} id="quote-advanced-filters">
          <label className="field commercial-quotes__filter-customer"><span className="field__label">Cliente</span><input className="field__input" value={filters.customer} onChange={(event) => setFilters((current) => ({ ...current, customer: event.target.value }))} placeholder="Nome do cliente" /></label>
          <label className="field"><span className="field__label">Status</span><select className="field__input" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option>{Object.entries(QUOTE_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
          <label className="field"><span className="field__label">De</span><input className="field__input" type="date" value={filters.start_date} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))} /></label>
          <label className="field"><span className="field__label">Até</span><input className="field__input" type="date" value={filters.end_date} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))} /></label>
        </div>
        <button className="button button_primary commercial-quotes__search-button" type="submit"><Search size={18} /> Buscar</button>
      </form>

      <div className="panel commercial-quotes__table-panel">
        {loading && <p className="commercial-quotes__feedback">Carregando orçamentos...</p>}
        {!loading && error && <div className="commercial-quotes__feedback commercial-quotes__feedback_error"><p>{error}</p><button className="button" type="button" onClick={load}>Tentar novamente</button></div>}
        {!loading && !error && <><p className="commercial-quotes__summary">{pagination.total} orçamento(s) encontrado(s)</p><DataTable columns={columns} rows={rows} emptyText="Nenhum orçamento encontrado." /><div className="commercial-quotes__cards">{rows.map((row) => { const status = row.origin_type === 'legacy' ? { label: 'ERP antigo', tone: 'muted' } : QUOTE_STATUS[row.status] || { label: row.status, tone: 'neutral' }; const hasMoreActions = (row.origin_type !== 'legacy' && canEdit && row.status === 'draft') || canCreate; const detailPath = row.origin_type === 'legacy' ? `/comercial/orcamentos/antigos/${row.id}` : `/comercial/orcamentos/${row.id}`; return <article className="commercial-quotes__card" key={`${row.origin_type}-${row.id}`}><header><div><strong>{quoteCommercialLabel(row)}</strong>{row.origin_type === 'legacy' && <small>ERP original #{row.source_legacy_number}</small>}</div><span className={`commercial-quotes__status commercial-quotes__status_${status.tone}`}>{status.label}</span></header><p>{row.customer_name_snapshot || 'Cliente não identificado'}</p><dl><div><dt>Data</dt><dd>{formatDate(row.quote_date)}</dd></div><div><dt>Itens</dt><dd>{row.item_count}</dd></div><div><dt>Total</dt><dd><strong>{formatMoney(row.total)}</strong></dd></div></dl><div className="commercial-quotes__card-actions"><Link className="button button_primary" to={detailPath}><Eye size={16} /> Abrir</Link>{hasMoreActions && <details><summary className="button">Mais ações</summary><div>{row.origin_type !== 'legacy' && canEdit && row.status === 'draft' && <Link className="button" to={`/comercial/orcamentos/${row.id}/editar`}><Pencil size={16} /> Editar</Link>}{canCreate && <button className="button" type="button" disabled={duplicating === row.id} onClick={() => duplicate(row)}><Copy size={16} /> Duplicar para novo</button>}</div></details>}</div></article>; })}{rows.length === 0 && <p className="commercial-quotes__feedback">Nenhum orçamento encontrado.</p>}</div>{pagination.total_pages > 1 && <div className="commercial-quotes__pagination"><button className="button" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {pagination.page} de {pagination.total_pages}</span><button className="button" type="button" disabled={page >= pagination.total_pages} onClick={() => setPage((value) => value + 1)}>Próxima</button></div>}</>}
      </div>
    </section>
  );
}
