import { Component, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { resolveVacationView } from './vacationPageState.js';
import './VacationsPage.css';

const format = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const message = (error) => error.response?.data?.message || 'Não foi possível concluir a operação.';
const absenceFields = { occurrence_date: '', quantity: '1', classification: 'injustificada', notes: '' };
const leaveFields = { start_date: '', end_date: '', notice_date: '', notes: '', calendar_review_note: '', employee_agreed: false, calendar_confirmed: false, bonus_days: 0, bonus_requested_at: '' };
const statuses = ['PENDENTE DE CONFERÊNCIA', 'EM AQUISIÇÃO', 'DISPONÍVEL', 'PROGRAMADO', 'PARCIALMENTE GOZADO', 'QUITADO', 'PRÓXIMO DO VENCIMENTO', 'PRAZO CONCESSIVO VENCIDO'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba' }).format(new Date());
const daysInclusive = (start, end) => start && end && end >= start ? Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1 : 0;
const documentTypes = { signed_receipt: 'Recibo de férias', notice: 'Aviso de férias', bonus_request: 'Solicitação de abono pecuniário', payment_proof: 'Comprovante de pagamento', other: 'Outro documento' };
const documentBase = (employeeId, periodId, leaveId) => `/vacations/employees/${employeeId}/periods/${periodId}/leaves/${leaveId}/documents`;
const sendDocument = (base, item) => api.post(base, item.file, { headers: { 'Content-Type': item.file.type, 'x-document-type': item.type, 'x-original-name': item.file.name } });

function VacationDocuments({ employeeId, periodId, leave, can }) {
  const base = documentBase(employeeId, periodId, leave.id);
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { setDocuments((await api.get(base)).data); setError(''); } catch (failure) { setError(message(failure)); } };
  useEffect(() => { if (can('vacations.documents.view')) void reload(); }, [employeeId, periodId, leave.id]);
  const download = async (item, inline = false) => {
    try { const response = await api.get(`${base}/${item.id}`, { params: inline ? {} : { download: '1' }, responseType: 'blob' }); const url = URL.createObjectURL(response.data); if (inline) window.open(url, '_blank', 'noopener'); else { const link = document.createElement('a'); link.href = url; link.download = item.original_name; link.click(); } window.setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (failure) { setError(message(failure)); }
  };
  const upload = async () => { setBusy(true); setError(''); try { await sendDocument(base, form); setForm(null); await reload(); } catch (failure) { setError(message(failure)); } finally { setBusy(false); } };
  if (!can('vacations.documents.view') && !can('vacations.documents.manage')) return null;
  return <details className="vacations__documents"><summary>Documentos do lançamento · {documents.length}</summary>
    {['gozada', 'historica'].includes(leave.status) && can('vacations.documents.view') && !documents.some((item) => item.document_type === 'signed_receipt') && <p className="vacations__pending">Recibo assinado pendente</p>}
    {error && <p role="alert" className="vacations__error">{error}</p>}
    {documents.length === 0 && <p>Nenhum documento anexado.</p>}
    {documents.map((item) => <div className="vacations__document" key={item.id}><span><strong>{item.original_name}</strong><small>{documentTypes[item.document_type]} · {new Date(item.created_at).toLocaleDateString('pt-BR')} · {item.size_bytes < 1024 ? '<1' : (item.size_bytes / 1024).toFixed(0)} KB</small></span><div className="vacations__actions">{can('vacations.documents.view') && <><button type="button" className="button" onClick={() => download(item, true)}>Visualizar</button><button type="button" className="button" onClick={() => download(item)}>Baixar</button></>}{can('vacations.documents.manage') && <button type="button" className="button" onClick={async () => { try { await api.delete(`${base}/${item.id}`); await reload(); } catch (failure) { setError(message(failure)); } }}>Excluir</button>}</div></div>)}
    {can('vacations.documents.manage') && (form ? <form className="vacations__document-form" onSubmit={(event) => { event.preventDefault(); void upload(); }}><label>Tipo<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{Object.entries(documentTypes).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Arquivo<input type="file" required accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] || null })} /></label><label>Descrição<input maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><div className="vacations__actions"><button className="button button_primary" disabled={busy || !form.file}>Enviar</button><button type="button" className="button" onClick={() => setForm(null)}>Cancelar</button></div></form> : <button type="button" className="button" onClick={() => setForm({ type: 'signed_receipt', file: null, description: '' })}>+ Anexar documento</button>)}
  </details>;
}

function VacationAgenda() {
  const [filters, setFilters] = useState({ start_date: today(), end_date: '', employee: '', sector: '', status: '' });
  const [result, setResult] = useState({ items: [], error: '', loading: false });
  const search = async () => {
    setResult((current) => ({ ...current, loading: true, error: '' }));
    try { const response = await api.get('/vacations/agenda', { params: filters }); setResult({ items: response.data.items, loading: false, error: '' }); }
    catch (error) { setResult({ items: [], loading: false, error: message(error) }); }
  };
  useEffect(() => { void search(); }, []);
  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  return <section id="agenda-ferias" className="panel vacations__agenda"><h2>Agenda de férias</h2><form className="vacations__agenda-filters" onSubmit={(event) => { event.preventDefault(); void search(); }}><label>De<input type="date" value={filters.start_date} onChange={set('start_date')} /></label><label>Até<input type="date" value={filters.end_date} onChange={set('end_date')} /></label><label>Funcionário<input placeholder="Nome" value={filters.employee} onChange={set('employee')} /></label><label>Setor<input placeholder="Nome do setor" value={filters.sector} onChange={set('sector')} /></label><label>Situação<select value={filters.status} onChange={set('status')}><option value="">Todas</option><option value="programada">Programadas</option><option value="em_andamento">Em andamento</option><option value="gozada">Gozadas</option><option value="historica">Históricas</option><option value="cancelada">Canceladas</option></select></label><button className="button button_primary">Filtrar</button></form>
    {result.error && <p role="alert">{result.error}</p>}{result.loading ? <p>Carregando agenda...</p> : result.items.length === 0 ? <p className="vacations__muted">Nenhuma ausência no intervalo.</p> : <div className="vacations__agenda-list">{result.items.map((item) => <article className="vacations__agenda-row" key={item.id}><div><strong>{item.employee_name}</strong><span>{item.sector_name || 'Sem setor'} · {format(item.start_date)} a {format(item.end_date)} · {item.days} dias</span><span>{item.status === 'programada' && item.temporal_status === 'em andamento' ? 'Em andamento · gozo pendente de confirmação' : item.status}{item.sector_overlap ? ' · Sobreposição no setor' : ''}</span></div><Link to={`/ferias/${item.employee_id}?period=${item.period_id}&leave=${item.id}`}>Abrir lançamento</Link></article>)}</div>}
  </section>;
}

class VacationRenderBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Falha ao renderizar Férias:', error); }
  render() {
    if (this.state.failed) return <section className="page vacations vacations__compact-fields"><div className="panel vacations__fallback" role="alert"><h1>Não foi possível mostrar este histórico</h1><p>Volte à listagem e tente novamente. Nenhum lançamento foi realizado.</p><Link className="button button_primary" to="/ferias">Voltar para Férias</Link><button className="button" onClick={() => window.location.reload()}>Tentar novamente</button></div></section>;
    return this.props.children;
  }
}

function VacationModal({ title, submit, close, busy, confirm = 'Salvar', children }) {
  return <div className="vacations__overlay"><form className="panel vacations__dialog" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <h2>{title}</h2>{children}<div className="vacations__actions"><button className="button button_primary" disabled={busy}>{confirm}</button><button type="button" className="button" onClick={close}>Fechar</button></div>
  </form></div>;
}

function VacationContent({ employeeId, initialPeriodId, initialLeaveId, initialLaunch }) {
  const routeKey = employeeId || 'list';
  const requestId = useRef(0);
  const launchHandled = useRef(false);
  const user = getStoredUser();
  const can = (code) => canAccessPermission(user, code);
  const [resource, setResource] = useState({ key: null, data: null, error: '' });
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(initialPeriodId);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [absence, setAbsence] = useState(null);
  const [leave, setLeave] = useState(null);
  const [review, setReview] = useState(null);
  const [historical, setHistorical] = useState(null);
  const [confirmedCorrection, setConfirmedCorrection] = useState(null);
  const [launch, setLaunch] = useState(null);
  const [pendingDocuments, setPendingDocuments] = useState([]);
  const [createdLaunch, setCreatedLaunch] = useState(null);

  async function load() {
    const currentRequest = ++requestId.current;
    const key = routeKey;
    setResource({ key, data: null, error: '' });
    try {
      const response = await api.get(employeeId ? `/vacations/employees/${employeeId}` : '/vacations', { params: employeeId ? undefined : { search: appliedSearch, filter, status, page } });
      if (currentRequest === requestId.current) setResource({ key, data: response.data, error: '' });
    } catch (failure) {
      if (currentRequest === requestId.current) setResource({ key, data: null, error: message(failure) });
    }
  }
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [employeeId, appliedSearch, filter, status, page]);
  useEffect(() => { if (employeeId && initialLaunch && resource.data && !launchHandled.current) { launchHandled.current = true; setLaunch({ periodId: initialPeriodId || resource.data.periods?.[0]?.id || '', type: 'historical', ...leaveFields }); } }, [employeeId, initialLaunch, initialPeriodId, resource.data]);
  useEffect(() => { if (initialLeaveId && resource.data) window.setTimeout(() => document.getElementById(`leave-${initialLeaveId}`)?.scrollIntoView({ block: 'center' }), 100); }, [initialLeaveId, resource.data]);
  async function act(operation) {
    setBusy(true); setActionError('');
    try {
      await operation();
      setAbsence(null); setLeave(null); setReview(null); setHistorical(null); setConfirmedCorrection(null); setLaunch(null);
      await load();
    } catch (failure) { setActionError(message(failure)); }
    finally { setBusy(false); }
  }
  async function saveLaunch() {
    if (!launch || busy) return;
    setBusy(true); setActionError('');
    try {
      const saved = createdLaunch || (await api.post(`/vacations/employees/${employeeId}/periods/${launch.periodId}/${launch.type === 'historical' ? 'historical-leaves' : 'leaves'}`, launch)).data;
      setCreatedLaunch(saved);
      const base = documentBase(employeeId, launch.periodId, saved.id);
      const remaining = [];
      for (const item of pendingDocuments) {
        try { await sendDocument(base, item); }
        catch (failure) { remaining.push({ ...item, error: message(failure) }); }
      }
      setPendingDocuments(remaining);
      if (remaining.length) { setActionError(`Lançamento salvo. ${remaining.length} documento(s) não enviado(s). Tente novamente.`); }
      else { setLaunch(null); setCreatedLaunch(null); await load(); }
    } catch (failure) { setActionError(message(failure)); }
    finally { setBusy(false); }
  }
  const closeLaunch = () => { if (busy) return; setLaunch(null); setPendingDocuments([]); setCreatedLaunch(null); if (createdLaunch) void load(); };

  const view = resolveVacationView(routeKey, resource);
  if (view.kind === 'loading' || view.kind === 'error') return <section className="page vacations vacations__compact-fields"><header className="page__header"><div>{employeeId && <Link to="/ferias">← Férias</Link>}<h1 className="page__title">Férias</h1></div></header><div className="panel vacations__state" role={view.kind === 'error' ? 'alert' : undefined}><p>{view.kind === 'error' ? view.message : 'Carregando férias...'}</p>{view.kind === 'error' && <button className="button" onClick={() => load()}>Tentar novamente</button>}</div></section>;

  if (view.kind === 'list') {
    const data = view.data;
    const rows = data.employees;
    const selectFilter = (value) => { setFilter(value); setPage(1); };
    const cards = [['acquired', 'Período adquirido', data.indicators.acquired], ['due_soon', 'Vencem em 4 meses', data.indicators.due_soon]];
    return <section className="page vacations vacations__compact-fields"><header className="page__header"><div><h1 className="page__title">Férias</h1><p className="vacations__muted">Acompanhe períodos, faltas e programações por funcionário.</p></div><a className="button" href="#agenda-ferias">Agenda de férias ↓</a></header>
      <div className="vacations__indicators">{cards.map(([key, label, value]) => <button type="button" className={`panel vacations__metric vacations__metric-button ${key === 'due_soon' ? 'vacations__metric-urgent' : ''} ${filter === key ? 'vacations__metric-active' : ''}`} aria-pressed={filter === key} key={key} onClick={() => selectFilter(key)}><span>{label}</span><strong>{value ?? 0}</strong></button>)}</div>
      <form className="panel vacations__filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search); }}><label><span>Funcionário</span><input aria-label="Pesquisar funcionário" placeholder="Pesquisar por nome" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><span>Situação</span><select aria-label="Filtrar situação" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Todas as situações</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label><button className="button button_primary" type="submit">Pesquisar</button></form>
      <div className="vacations__tabs" role="group" aria-label="Filtrar períodos de férias">{[['all', 'Todos'], ['acquired', 'Período adquirido'], ['due_soon', 'Vencem em 4 meses'], ['overdue', 'Vencidas']].map(([key, label]) => <button type="button" className={`button ${filter === key ? 'button_primary' : ''}`} aria-pressed={filter === key} key={key} onClick={() => selectFilter(key)}>{label}</button>)}</div>
      <div className="vacations__list-heading"><h2>Funcionários</h2><span>{data.total} encontrado(s)</span></div>
      {rows.length === 0 ? <div className="panel vacations__empty">Nenhum funcionário encontrado para os filtros selecionados.</div> : <div className="vacations__grid">{rows.map((item) => {
        const periods = item.periods || [];
        const current = periods[0];
        const relevant = periods.filter((period) => filter === 'all' ? period.alert?.acquired : period.alert?.[filter]).filter((period) => !status || period.status === status).sort((a, b) => String(a.concession_end).localeCompare(String(b.concession_end)));
        const pending = periods.some((period) => period.status === 'PENDENTE DE CONFERÊNCIA') || !item.admission_date;
        return <article className="panel vacations__employee" key={item.id}>
          <div className="vacations__employee-top"><h3>{item.full_name}</h3><span className="vacations__badge">{relevant[0]?.status || current?.status || 'PENDENTE DE CONFERÊNCIA'}</span></div>
          <p className="vacations__muted">Admissão: {format(item.admission_date)}</p>
          {relevant.map((period) => <div className={`vacations__alert-period ${period.alert.overdue ? 'vacations__alert-period-overdue' : ''}`} key={period.id}>
            <strong>Período {period.ordinal}: {format(period.acquisition_start)} a {format(period.acquisition_end)}</strong>
            <span>Conclusão: {format(period.acquisition_end)} · Prazo: {format(period.concession_end)}</span>
            {(filter === 'due_soon' || filter === 'overdue') && <span>{period.alert.days_remaining < 0 ? `${Math.abs(period.alert.days_remaining)} dia(s) em atraso` : `${period.alert.days_remaining} dia(s) restantes`}</span>}
            <span>Saldo: {period.alert.needs_review ? 'Conferência necessária' : `${period.balance} dias`}</span>
            {period.alert.planned_before_due > 0 && <span>{period.alert.planned_before_due} dia(s) programados antes do prazo{period.alert.planned_may_clear ? ' — podem quitar o saldo' : ''}</span>}
            <Link to={`/ferias/${item.id}?period=${period.id}`}>Abrir período →</Link>
          </div>)}
          <div className="vacations__employee-foot">{pending && <span className="vacations__pending">Histórico pendente</span>}{(can('vacations.review') || can('vacations.schedule')) && <Link to={`/ferias/${item.id}?launch=1`}>+ Lançar férias</Link>}<Link to={`/ferias/${item.id}`}>Ver histórico →</Link></div>
        </article>;
      })}</div>}
      {data.total > data.page_size && <nav className="vacations__pagination" aria-label="Paginação de férias"><button className="button" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {Math.ceil(data.total / data.page_size)}</span><button className="button" type="button" disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(page + 1)}>Próxima</button></nav>}
      <VacationAgenda />
    </section>;
  }

  const data = view.data;
  const periods = [...data.periods].sort((a, b) => b.ordinal - a.ordinal);
  const selected = periods.find((period) => period.id === selectedId) || periods[0];
  const confirmed = periods.filter((period) => period.balance !== null && period.balance !== undefined);
  const confirmedBalance = confirmed.length ? confirmed.reduce((sum, period) => sum + Number(period.balance || 0), 0) : null;
  return <section className="page vacations vacations__compact-fields">
    <header className="page__header vacations__detail-header"><div><Link to="/ferias">← Voltar para Férias</Link><h1 className="page__title">{data.employee.full_name}</h1><p className="vacations__muted">Admissão: {format(data.employee.admission_date)} · Situação: {data.employee.employment_status || 'A conferir'}</p></div>{(can('vacations.review') || can('vacations.schedule')) && <button className="button button_primary" onClick={() => setLaunch({ periodId: selected?.id || '', type: 'historical', start_date: '', end_date: '', notes: '', ...leaveFields })}>+ Lançar férias</button>}</header>
    <div className="panel vacations__employee-summary"><div><span>Períodos aquisitivos</span><strong>{periods.length}</strong></div><div><span>Saldo confirmado</span><strong>{confirmedBalance === null ? 'A conferir' : `${confirmedBalance} dias`}</strong></div><div><span>Histórico</span><strong>{periods.some((period) => period.status === 'PENDENTE DE CONFERÊNCIA') ? 'Pendente de conferência' : 'Consulte os períodos'}</strong></div></div>
    {!data.employee.admission_date && <div className="panel vacations__empty">Informe a data de admissão no cadastro do funcionário para calcular os períodos aquisitivos.</div>}
    {periods.length > 0 && <><div className="vacations__section-title"><h2>Períodos aquisitivos</h2><p>Selecione um período para ver faltas, férias e saldo.</p></div><div className="vacations__period-list">{periods.map((period) => <button type="button" key={period.id} className={`panel vacations__period-choice ${selected.id === period.id ? 'vacations__period-choice_active' : ''}`} aria-pressed={selected.id === period.id} onClick={() => setSelectedId(period.id)}><span className="vacations__period-choice-top"><strong>Período {period.ordinal}</strong><span className="vacations__badge">{period.status}</span></span><span>{format(period.acquisition_start)} a {format(period.acquisition_end)}</span><span>Prazo: {format(period.concession_end)}</span><span>Saldo: {period.balance ?? 'A conferir'}{period.balance !== null && period.balance !== undefined ? ' dias' : ''}</span></button>)}</div></>}
    {selected && <article className="panel vacations__selected-period" key={selected.id}>
      <div className="vacations__selected-header"><div><span className="vacations__eyebrow">PERÍODO {selected.ordinal}</span><h2>{selected.status}</h2></div><span className="vacations__badge">{format(selected.acquisition_start)} a {format(selected.acquisition_end)}</span></div>
      <div className="vacations__dates"><div><span>Aquisitivo</span><strong>{format(selected.acquisition_start)} a {format(selected.acquisition_end)}</strong></div><div><span>Concessivo</span><strong>{format(selected.concession_start)} a {format(selected.concession_end)}</strong></div></div>
      <div className="vacations__stats"><div><span>Direito adquirido</span><strong>{selected.entitlement ?? 'A conferir'}</strong></div><div><span>Gozados</span><strong>{selected.taken}</strong></div><div><span>Programados</span><strong>{selected.planned}</strong></div><div><span>Abono pecuniário</span><strong>{selected.bonus || 0}</strong></div><div><span>Não gozados</span><strong>{selected.balance ?? 'A conferir'}</strong></div><div><span>Livre para programar</span><strong>{selected.free_balance ?? 'A conferir'}</strong></div></div>
      <div className="vacations__actions">{can('vacations.review') && <button className="button" onClick={() => setHistorical({ periodId: selected.id, start_date: '', end_date: '', notes: '' })}>Regularizar férias anteriores</button>}{can('vacations.review') && !selected.reviewed_at && <button className="button" onClick={() => setReview({ periodId: selected.id, note: '' })}>Conferir histórico</button>}{can('vacations.schedule') && can('vacations.review') && selected.entitlement !== null && <button className="button button_primary" onClick={() => setLeave({ periodId: selected.id, ...leaveFields })}>Programar férias</button>}{can('vacations.documents.view') && <button className="button" onClick={async () => { try { const response = await api.get(`/vacations/employees/${employeeId}/periods/${selected.id}/documents.zip`, { responseType: 'blob' }); const url = URL.createObjectURL(response.data); const link = document.createElement('a'); link.href = url; link.download = `ferias-periodo-${selected.ordinal}.zip`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (failure) { setActionError(message(failure)); } }}>Baixar documentos do período</button>}</div>
      <details className="vacations__section" open><summary>Faltas mensais <small>{selected.absences.length} ocorrência(s)</small></summary><p className="vacations__muted">Integrais injustificadas: {selected.full_unjustified} · Meias injustificadas: {selected.half_unjustified} · Justificadas: {selected.justified} · Pendentes: {selected.pending}</p><div className="vacations__months">{selected.months.map((month) => <div className="vacations__month" key={month.month}><div><strong>{new Date(`${month.month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong><small>{format(month.start)} a {format(month.end)}</small></div><span>{month.absences.length} ocorrência(s)</span>{can('vacations.absences.create') && <button className="button" onClick={() => setAbsence({ periodId: selected.id, ...absenceFields, occurrence_date: month.start })}>+ Lançar falta</button>}{month.absences.map((item) => <div className="vacations__record" key={item.id}><div>{format(item.occurrence_date)} · {item.quantity} dia · {item.classification}{item.notes && <p>{item.notes}</p>}</div><div className="vacations__actions">{can('vacations.absences.edit') && <button className="button" onClick={() => setAbsence({ ...item, periodId: selected.id, occurrence_date: String(item.occurrence_date).slice(0, 10) })}>Editar</button>}{can('vacations.correct') && <button className="button" onClick={() => act(() => api.delete(`/vacations/employees/${employeeId}/absences/${item.id}`))}>Cancelar</button>}</div></div>)}</div>)}</div></details>
      <details className="vacations__section" open={Boolean(initialLeaveId)}><summary>Férias programadas e gozadas <small>{selected.leaves.length} registro(s)</small></summary>{selected.leaves.length === 0 && <p className="vacations__muted">Sem lançamentos neste período.</p>}{selected.leaves.map((item) => <div className="vacations__leave" id={`leave-${item.id}`} key={item.id}><div><strong>{format(item.start_date)} a {format(item.end_date)}</strong><p>{item.days} dias · {item.status === 'programada' && item.temporal_status === 'em andamento' ? 'Em andamento (gozo a confirmar)' : item.status}</p>{item.notes && <p>{item.notes}</p>}{item.compliance_warnings?.map((warning) => <p className="vacations__pending" key={warning}>{warning}</p>)}{item.status === 'programada' && <p>Pagamento até {format(item.payment_due_date)} · confirmação de pagamento não registrada</p>}</div><div className="vacations__actions">{item.status === 'programada' && <>{can('vacations.confirm') && <button className="button" onClick={() => act(() => api.post(`/vacations/employees/${employeeId}/leaves/${item.id}/confirm`))}>Confirmar gozo / dar baixa</button>}{can('vacations.correct') && <button className="button" onClick={() => act(() => api.post(`/vacations/employees/${employeeId}/leaves/${item.id}/cancel`))}>Cancelar</button>}</>}{['gozada', 'historica'].includes(item.status) && can('vacations.confirmed.correct') && <button className="button" onClick={() => setConfirmedCorrection({ leaveId: item.id, version: item.version, start_date: String(item.start_date).slice(0, 10), end_date: String(item.end_date).slice(0, 10), reason: '', action: 'correct' })}>Corrigir baixa</button>}</div><VacationDocuments employeeId={employeeId} periodId={selected.id} leave={item} can={can} />{item.status === 'programada' && can('vacations.view') && <button type="button" className="button" onClick={async () => { try { const response = await api.get(`/vacations/employees/${employeeId}/periods/${selected.id}/leaves/${item.id}/accounting.pdf`, { responseType: 'blob' }); const url = URL.createObjectURL(response.data); const link = document.createElement('a'); link.href = url; link.download = `Ferias_Contabilidade_${data.employee.full_name.replace(/[^a-zA-Z0-9]+/g, '_')}_${String(item.start_date).slice(0, 10)}.pdf`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (failure) { setActionError(message(failure)); } }}>Gerar PDF para contabilidade</button>}</div>)}</details>
      {selected.leaves.filter((item) => item.status === 'programada').length > 0 && <div className="vacations__actions">{selected.leaves.filter((item) => item.status === 'programada').map((item) => can('vacations.correct') && <button key={item.id} className="button" onClick={() => setLeave({ ...item, periodId: selected.id, start_date: String(item.start_date).slice(0, 10), end_date: String(item.end_date).slice(0, 10), calendar_confirmed: false, calendar_review_note: '' })}>Editar programação de {format(item.start_date)}</button>)}</div>}
    </article>}
    <details className="panel vacations__audit"><summary>Histórico e auditoria</summary>{data.audit.length === 0 ? <p className="vacations__muted">Nenhuma alteração registrada.</p> : data.audit.map((entry) => <p key={entry.id}>{format(entry.created_at)} · {entry.actor_name || 'Usuário'} · {entry.entity_type} · {entry.action}{entry.reason ? ` · Motivo: ${entry.reason}` : ''}</p>)}</details>
    {actionError && <p role="alert" className="vacations__error">{actionError}</p>}
    {launch && <VacationModal title="Lançar férias" confirm={createdLaunch ? 'Tentar uploads novamente' : 'Registrar'} busy={busy} close={closeLaunch} submit={saveLaunch}>
      <label>Funcionário<input value={data.employee.full_name} readOnly /></label>
      <label>Período aquisitivo<select required value={launch.periodId} onChange={(event) => setLaunch({ ...launch, periodId: event.target.value })}>{periods.map((period) => <option key={period.id} value={period.id}>{format(period.acquisition_start)} a {format(period.acquisition_end)} · {period.balance == null ? 'saldo a conferir' : `${period.balance} dias disponíveis`}</option>)}</select></label>
      <label>Tipo do lançamento<select value={launch.type} onChange={(event) => setLaunch({ ...launch, type: event.target.value })}><option value="historical">Férias já gozadas</option><option value="scheduled">Programação futura</option></select></label>
      <label>Início<input type="date" required value={launch.start_date} onChange={(event) => setLaunch({ ...launch, start_date: event.target.value })} /></label><label>Término<input type="date" required value={launch.end_date} onChange={(event) => setLaunch({ ...launch, end_date: event.target.value })} /></label>
      <p>{daysInclusive(launch.start_date, launch.end_date)} dias corridos · Situação: {launch.type === 'historical' ? 'Gozadas' : 'Programadas'}</p>
      <p>Direito: {periods.find((p) => p.id === launch.periodId)?.entitlement ?? 'A conferir'} · Gozados: {periods.find((p) => p.id === launch.periodId)?.taken ?? 0} · Programados: {periods.find((p) => p.id === launch.periodId)?.planned ?? 0} · Abono: {periods.find((p) => p.id === launch.periodId)?.bonus ?? 0}</p>{launch.type === 'scheduled' && <><label>Abono pecuniário (dias)<input type="number" min="0" step="1" max={Math.floor((periods.find((p) => p.id === launch.periodId)?.entitlement || 0) / 3)} value={launch.bonus_days ?? 0} onChange={(event) => setLaunch({ ...launch, bonus_days: event.target.value })} /></label>{Number(launch.bonus_days) > 0 && <><label>Data do pedido de abono<input type="date" value={launch.bonus_requested_at || ''} onChange={(event) => setLaunch({ ...launch, bonus_requested_at: event.target.value })} /></label><p className="vacations__pending">Conferir pedido até 15 dias antes do fim do período aquisitivo.</p></>}<p>Saldo disponível: {(periods.find((p) => p.id === launch.periodId)?.free_balance ?? 0) - daysInclusive(launch.start_date, launch.end_date) - (Number(launch.bonus_days) || 0)} dias</p></>}<label>{launch.type === 'historical' ? 'Fonte documental / observação' : 'Observação'}<textarea required={launch.type === 'historical'} value={launch.notes} onChange={(event) => setLaunch({ ...launch, notes: event.target.value })} /></label>
      {launch.type === 'scheduled' && <><p className="vacations__muted">O período deve estar conferido. Aviso inferior a 30 dias será sinalizado.</p><label>Data do aviso escrito<input type="date" value={launch.notice_date} onChange={(event) => setLaunch({ ...launch, notice_date: event.target.value })} /></label><label><input type="checkbox" checked={launch.employee_agreed} onChange={(event) => setLaunch({ ...launch, employee_agreed: event.target.checked })} /> Concordância do empregado confirmada</label><label><input type="checkbox" checked={launch.calendar_confirmed} onChange={(event) => setLaunch({ ...launch, calendar_confirmed: event.target.checked })} /> Feriados locais e escala conferidos</label><label>Registro da conferência do calendário<textarea required minLength={10} value={launch.calendar_review_note} onChange={(event) => setLaunch({ ...launch, calendar_review_note: event.target.value })} /></label></>}
      {can('vacations.documents.manage') && <section className="vacations__pending-documents"><h3>Documentos do lançamento</h3><label>Tipo documental<select id="launch-document-type" defaultValue="signed_receipt">{Object.entries(documentTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="button vacations__file-button">Anexar documento<input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={(event) => { const type = document.getElementById('launch-document-type').value; setPendingDocuments((items) => [...items, ...Array.from(event.target.files || []).map((file) => ({ file, type }))]); event.target.value = ''; }} /></label>{pendingDocuments.length === 0 && <p>Nenhum documento anexado.</p>}{pendingDocuments.map((item, index) => <div className="vacations__pending-file" key={index}><span>{item.file.name} · {documentTypes[item.type]}{item.error && <strong role="alert"> · {item.error}</strong>}</span><button type="button" className="button" onClick={() => setPendingDocuments((items) => items.filter((_, position) => position !== index))}>Remover</button></div>)}</section>}
      {createdLaunch && <p role="status">Lançamento salvo. Os documentos pendentes podem ser enviados novamente.</p>}
    </VacationModal>}
    {absence && <VacationModal title={absence.id ? 'Editar falta' : 'Lançar falta'} busy={busy} close={() => setAbsence(null)} submit={() => act(() => absence.id ? api.put(`/vacations/employees/${employeeId}/absences/${absence.id}`, absence) : api.post(`/vacations/employees/${employeeId}/absences`, absence))}><label>Data<input type="date" required value={absence.occurrence_date} onChange={(event) => setAbsence({ ...absence, occurrence_date: event.target.value })} /></label><label>Quantidade<select value={absence.quantity} onChange={(event) => setAbsence({ ...absence, quantity: event.target.value })}><option value="1">1 dia</option><option value="0.5">0,5 dia</option></select></label><label>Classificação<select value={absence.classification} onChange={(event) => setAbsence({ ...absence, classification: event.target.value })}><option value="injustificada">Injustificada</option><option value="justificada">Justificada</option><option value="pendente">Pendente de análise</option></select></label><label>Motivo / observação<textarea value={absence.notes || ''} onChange={(event) => setAbsence({ ...absence, notes: event.target.value })} /></label></VacationModal>}
    {leave && <VacationModal title={leave.id ? 'Editar programação' : 'Programar férias'} confirm="Salvar" busy={busy} close={() => setLeave(null)} submit={() => act(() => leave.id ? api.put(`/vacations/employees/${employeeId}/leaves/${leave.id}`, leave) : api.post(`/vacations/employees/${employeeId}/periods/${leave.periodId}/leaves`, leave))}><p>Período aquisitivo: {format(selected.acquisition_start)} a {format(selected.acquisition_end)}</p><p>Direito adquirido: {selected.entitlement ?? 'A conferir'} · Gozados: {selected.taken} · Programados: {selected.planned} · Abono: {selected.bonus || 0}</p><label>Abono pecuniário (dias)<input type="number" min="0" max={Math.floor((selected.entitlement || 0) / 3)} step="1" value={leave.bonus_days ?? 0} onChange={(event) => setLeave({ ...leave, bonus_days: event.target.value })} /></label>{Number(leave.bonus_days) > 0 && <><label>Data do pedido de abono<input type="date" value={leave.bonus_requested_at ? String(leave.bonus_requested_at).slice(0, 10) : ''} onChange={(event) => setLeave({ ...leave, bonus_requested_at: event.target.value })} /></label><p className="vacations__pending">Pedido deve ser comprovado até 15 dias antes do fim do período aquisitivo. Sem data, conferir elegibilidade.</p></>}<p>Saldo disponível após programação: {selected.entitlement == null ? 'A conferir' : selected.entitlement - selected.taken - selected.planned - (selected.bonus || 0) - daysInclusive(leave.start_date, leave.end_date) - (Number(leave.bonus_days) || 0) + (leave.id ? Number(leave.days) + Number(leave.bonus_days || 0) : 0)} dias</p><label>Início do gozo<input type="date" required value={leave.start_date} onChange={(event) => setLeave({ ...leave, start_date: event.target.value })} /></label><label>Término do gozo<input type="date" required value={leave.end_date} onChange={(event) => setLeave({ ...leave, end_date: event.target.value })} /></label><p>Dias corridos calculados: {daysInclusive(leave.start_date, leave.end_date)}</p>{!leave.id && <><label>Data do aviso escrito<input type="date" value={leave.notice_date} onChange={(event) => setLeave({ ...leave, notice_date: event.target.value })} /></label><label><input type="checkbox" checked={leave.employee_agreed} onChange={(event) => setLeave({ ...leave, employee_agreed: event.target.checked })} /> Concordância do empregado confirmada</label><label><input type="checkbox" checked={leave.calendar_confirmed} onChange={(event) => setLeave({ ...leave, calendar_confirmed: event.target.checked })} /> Feriados locais e escala conferidos</label><label>Conferência do calendário<textarea required minLength={10} value={leave.calendar_review_note} onChange={(event) => setLeave({ ...leave, calendar_review_note: event.target.value })} /></label></>}{leave.id && <><label><input type="checkbox" checked={leave.calendar_confirmed} onChange={(event) => setLeave({ ...leave, calendar_confirmed: event.target.checked })} /> Calendário e escala das novas datas conferidos</label><label>Conferência das novas datas<textarea required minLength={10} value={leave.calendar_review_note || ''} onChange={(event) => setLeave({ ...leave, calendar_review_note: event.target.value })} /></label></>}<label>Observações<textarea value={leave.notes || ''} onChange={(event) => setLeave({ ...leave, notes: event.target.value })} /></label></VacationModal>}
    {review && <VacationModal title="Conferir período histórico" confirm="Confirmar conferência" busy={busy} close={() => setReview(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/periods/${review.periodId}/review`, { confirmed: true, note: review.note }))}><p>Verifique férias anteriores, faltas e afastamentos nos documentos antes de confirmar. Esta ação será auditada.</p><label>Justificativa<textarea required value={review.note} onChange={(event) => setReview({ ...review, note: event.target.value })} /></label></VacationModal>}
    {historical && <VacationModal title="Regularizar férias anteriores" confirm="Registrar" busy={busy} close={() => setHistorical(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/periods/${historical.periodId}/historical-leaves`, historical))}><label>Início<input type="date" required value={historical.start_date} onChange={(event) => setHistorical({ ...historical, start_date: event.target.value })} /></label><label>Término<input type="date" required value={historical.end_date} onChange={(event) => setHistorical({ ...historical, end_date: event.target.value })} /></label><label>Fonte documental / observação<textarea required value={historical.notes} onChange={(event) => setHistorical({ ...historical, notes: event.target.value })} /></label></VacationModal>}
    {confirmedCorrection && <VacationModal title="Corrigir baixa confirmada" confirm="Confirmar correção" busy={busy} close={() => setConfirmedCorrection(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/leaves/${confirmedCorrection.leaveId}/correct-confirmed`, confirmedCorrection))}><label>Ação<select value={confirmedCorrection.action} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, action: event.target.value })}><option value="correct">Corrigir datas</option><option value="cancel">Cancelar baixa</option></select></label>{confirmedCorrection.action === 'correct' && <><label>Início<input type="date" required value={confirmedCorrection.start_date} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, start_date: event.target.value })} /></label><label>Término<input type="date" required value={confirmedCorrection.end_date} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, end_date: event.target.value })} /></label></>}<label>Motivo da correção<textarea required minLength={10} value={confirmedCorrection.reason} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, reason: event.target.value })} /></label><p>A alteração ficará registrada com os dados anteriores e novos.</p></VacationModal>}
  </section>;
}

export function VacationsPage() {
  const { employeeId } = useParams();
  const [params] = useSearchParams();
  return <VacationRenderBoundary key={employeeId || 'list'}><VacationContent employeeId={employeeId} initialPeriodId={params.get('period')} initialLeaveId={params.get('leave')} initialLaunch={params.get('launch') === '1'} /></VacationRenderBoundary>;
}
