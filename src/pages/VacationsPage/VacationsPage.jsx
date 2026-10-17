import { Component, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { resolveVacationView } from './vacationPageState.js';
import './VacationsPage.css';

const format = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
const message = (error) => error.response?.data?.message || 'Não foi possível concluir a operação.';
const absenceFields = { occurrence_date: '', quantity: '1', classification: 'injustificada', notes: '' };
const leaveFields = { start_date: '', end_date: '', notice_date: '', notes: '', calendar_review_note: '', employee_agreed: false, calendar_confirmed: false };
const statuses = ['PENDENTE DE CONFERÊNCIA', 'EM AQUISIÇÃO', 'DISPONÍVEL', 'PROGRAMADO', 'PARCIALMENTE GOZADO', 'QUITADO', 'PRÓXIMO DO VENCIMENTO', 'PRAZO CONCESSIVO VENCIDO'];

class VacationRenderBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('Falha ao renderizar Férias:', error); }
  render() {
    if (this.state.failed) return <section className="page vacations"><div className="panel vacations__fallback" role="alert"><h1>Não foi possível mostrar este histórico</h1><p>Volte à listagem e tente novamente. Nenhum lançamento foi realizado.</p><Link className="button button_primary" to="/ferias">Voltar para Férias</Link><button className="button" onClick={() => window.location.reload()}>Tentar novamente</button></div></section>;
    return this.props.children;
  }
}

function VacationModal({ title, submit, close, busy, confirm = 'Salvar', children }) {
  return <div className="vacations__overlay"><form className="panel vacations__dialog" onSubmit={(event) => { event.preventDefault(); submit(); }}>
    <h2>{title}</h2>{children}<div className="vacations__actions"><button className="button button_primary" disabled={busy}>{confirm}</button><button type="button" className="button" onClick={close}>Fechar</button></div>
  </form></div>;
}

function VacationContent({ employeeId }) {
  const routeKey = employeeId || 'list';
  const requestId = useRef(0);
  const user = getStoredUser();
  const can = (code) => canAccessPermission(user, code);
  const [resource, setResource] = useState({ key: null, data: null, error: '' });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [absence, setAbsence] = useState(null);
  const [leave, setLeave] = useState(null);
  const [review, setReview] = useState(null);
  const [historical, setHistorical] = useState(null);
  const [confirmedCorrection, setConfirmedCorrection] = useState(null);

  async function load() {
    const currentRequest = ++requestId.current;
    const key = routeKey;
    setResource({ key, data: null, error: '' });
    try {
      const response = await api.get(employeeId ? `/vacations/employees/${employeeId}` : '/vacations', { params: employeeId ? undefined : { search } });
      if (currentRequest === requestId.current) setResource({ key, data: response.data, error: '' });
    } catch (failure) {
      if (currentRequest === requestId.current) setResource({ key, data: null, error: message(failure) });
    }
  }
  useEffect(() => { void load(); return () => { requestId.current += 1; }; }, [employeeId]);
  async function act(operation) {
    setBusy(true); setActionError('');
    try {
      await operation();
      setAbsence(null); setLeave(null); setReview(null); setHistorical(null); setConfirmedCorrection(null);
      await load();
    } catch (failure) { setActionError(message(failure)); }
    finally { setBusy(false); }
  }

  const view = resolveVacationView(routeKey, resource);
  if (view.kind === 'loading' || view.kind === 'error') return <section className="page vacations"><header className="page__header"><div>{employeeId && <Link to="/ferias">← Férias</Link>}<h1 className="page__title">Férias</h1></div></header><div className="panel vacations__state" role={view.kind === 'error' ? 'alert' : undefined}><p>{view.kind === 'error' ? view.message : 'Carregando férias...'}</p>{view.kind === 'error' && <button className="button" onClick={() => load()}>Tentar novamente</button>}</div></section>;

  if (view.kind === 'list') {
    const data = view.data;
    const rows = data.employees.filter((item) => !filter || item.periods?.some((period) => period.status === filter));
    const indicators = [['Funcionários ativos', data.indicators.active], ['Férias disponíveis', data.indicators.available], ['Próximas do vencimento', data.indicators.near_due], ['Prazo vencido', data.indicators.overdue], ['Atualmente de férias', data.indicators.on_leave], ['Períodos a conferir', data.indicators.pending]];
    return <section className="page vacations"><header className="page__header"><div><h1 className="page__title">Férias</h1><p className="vacations__muted">Acompanhe períodos, faltas e programações por funcionário.</p></div></header>
      <div className="vacations__indicators">{indicators.map(([label, value]) => <article className="panel vacations__metric" key={label}><span>{label}</span><strong>{value ?? 0}</strong></article>)}</div>
      <form className="panel vacations__filters" onSubmit={(event) => { event.preventDefault(); load(); }}><label><span>Funcionário</span><input aria-label="Pesquisar funcionário" placeholder="Pesquisar por nome" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><span>Situação</span><select aria-label="Filtrar situação" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Todas as situações</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><button className="button button_primary" type="submit">Pesquisar</button></form>
      <div className="vacations__list-heading"><h2>Funcionários</h2><span>{rows.length} exibido(s)</span></div>
      {rows.length === 0 ? <div className="panel vacations__empty">Nenhum funcionário encontrado para os filtros selecionados.</div> : <div className="vacations__grid">{rows.map((item) => {
        const periods = item.periods || [];
        const current = periods[0];
        const due = periods.filter((period) => period.balance > 0).sort((a, b) => String(a.concession_end).localeCompare(String(b.concession_end)))[0];
        const pending = periods.some((period) => period.status === 'PENDENTE DE CONFERÊNCIA') || !item.admission_date;
        return <Link to={`/ferias/${item.id}`} className="panel vacations__employee" key={item.id}>
          <div className="vacations__employee-top"><h3>{item.full_name}</h3><span className="vacations__badge">{current?.status || 'PENDENTE DE CONFERÊNCIA'}</span></div>
          <dl><div><dt>Admissão</dt><dd>{format(item.admission_date)}</dd></div><div><dt>Próximo prazo</dt><dd>{due ? format(due.concession_end) : 'A conferir'}</dd></div><div><dt>Saldo confirmado</dt><dd>{due ? `${due.balance} dias` : 'A conferir'}</dd></div></dl>
          <div className="vacations__employee-foot">{pending && <span className="vacations__pending">Histórico pendente</span>}<strong>Ver histórico <span aria-hidden="true">→</span></strong></div>
        </Link>;
      })}</div>}
    </section>;
  }

  const data = view.data;
  const periods = [...data.periods].sort((a, b) => b.ordinal - a.ordinal);
  const selected = periods.find((period) => period.id === selectedId) || periods[0];
  const confirmed = periods.filter((period) => period.balance !== null && period.balance !== undefined);
  const confirmedBalance = confirmed.length ? confirmed.reduce((sum, period) => sum + Number(period.balance || 0), 0) : null;
  return <section className="page vacations">
    <header className="page__header vacations__detail-header"><div><Link to="/ferias">← Voltar para Férias</Link><h1 className="page__title">{data.employee.full_name}</h1><p className="vacations__muted">Admissão: {format(data.employee.admission_date)} · Situação: {data.employee.employment_status || 'A conferir'}</p></div></header>
    <div className="panel vacations__employee-summary"><div><span>Períodos aquisitivos</span><strong>{periods.length}</strong></div><div><span>Saldo confirmado</span><strong>{confirmedBalance === null ? 'A conferir' : `${confirmedBalance} dias`}</strong></div><div><span>Histórico</span><strong>{periods.some((period) => period.status === 'PENDENTE DE CONFERÊNCIA') ? 'Pendente de conferência' : 'Consulte os períodos'}</strong></div></div>
    {!data.employee.admission_date && <div className="panel vacations__empty">Informe a data de admissão no cadastro do funcionário para calcular os períodos aquisitivos.</div>}
    {periods.length > 0 && <><div className="vacations__section-title"><h2>Períodos aquisitivos</h2><p>Selecione um período para ver faltas, férias e saldo.</p></div><div className="vacations__period-list">{periods.map((period) => <button type="button" key={period.id} className={`panel vacations__period-choice ${selected.id === period.id ? 'vacations__period-choice_active' : ''}`} aria-pressed={selected.id === period.id} onClick={() => setSelectedId(period.id)}><span className="vacations__period-choice-top"><strong>Período {period.ordinal}</strong><span className="vacations__badge">{period.status}</span></span><span>{format(period.acquisition_start)} a {format(period.acquisition_end)}</span><span>Prazo: {format(period.concession_end)}</span><span>Saldo: {period.balance ?? 'A conferir'}{period.balance !== null && period.balance !== undefined ? ' dias' : ''}</span></button>)}</div></>}
    {selected && <article className="panel vacations__selected-period" key={selected.id}>
      <div className="vacations__selected-header"><div><span className="vacations__eyebrow">PERÍODO {selected.ordinal}</span><h2>{selected.status}</h2></div><span className="vacations__badge">{format(selected.acquisition_start)} a {format(selected.acquisition_end)}</span></div>
      <div className="vacations__dates"><div><span>Aquisitivo</span><strong>{format(selected.acquisition_start)} a {format(selected.acquisition_end)}</strong></div><div><span>Concessivo</span><strong>{format(selected.concession_start)} a {format(selected.concession_end)}</strong></div></div>
      <div className="vacations__stats"><div><span>Direito</span><strong>{selected.entitlement ?? 'A conferir'}</strong></div><div><span>Programados</span><strong>{selected.planned}</strong></div><div><span>Gozados</span><strong>{selected.taken}</strong></div><div><span>Saldo</span><strong>{selected.balance ?? 'A conferir'}</strong></div></div>
      <div className="vacations__actions">{can('vacations.review') && <button className="button" onClick={() => setHistorical({ periodId: selected.id, start_date: '', end_date: '', notes: '' })}>Regularizar férias anteriores</button>}{can('vacations.review') && !selected.reviewed_at && <button className="button" onClick={() => setReview({ periodId: selected.id, note: '' })}>Conferir histórico</button>}{can('vacations.schedule') && can('vacations.review') && selected.entitlement !== null && <button className="button button_primary" onClick={() => setLeave({ periodId: selected.id, ...leaveFields })}>Programar férias</button>}</div>
      <details className="vacations__section" open><summary>Faltas mensais <small>{selected.absences.length} ocorrência(s)</small></summary><p className="vacations__muted">Integrais injustificadas: {selected.full_unjustified} · Meias injustificadas: {selected.half_unjustified} · Justificadas: {selected.justified} · Pendentes: {selected.pending}</p><div className="vacations__months">{selected.months.map((month) => <div className="vacations__month" key={month.month}><div><strong>{new Date(`${month.month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong><small>{format(month.start)} a {format(month.end)}</small></div><span>{month.absences.length} ocorrência(s)</span>{can('vacations.absences.create') && <button className="button" onClick={() => setAbsence({ periodId: selected.id, ...absenceFields, occurrence_date: month.start })}>+ Lançar falta</button>}{month.absences.map((item) => <div className="vacations__record" key={item.id}><div>{format(item.occurrence_date)} · {item.quantity} dia · {item.classification}{item.notes && <p>{item.notes}</p>}</div><div className="vacations__actions">{can('vacations.absences.edit') && <button className="button" onClick={() => setAbsence({ ...item, periodId: selected.id, occurrence_date: String(item.occurrence_date).slice(0, 10) })}>Editar</button>}{can('vacations.correct') && <button className="button" onClick={() => act(() => api.delete(`/vacations/employees/${employeeId}/absences/${item.id}`))}>Cancelar</button>}</div></div>)}</div>)}</div></details>
      <details className="vacations__section"><summary>Férias programadas e gozadas <small>{selected.leaves.length} registro(s)</small></summary>{selected.leaves.length === 0 && <p className="vacations__muted">Sem lançamentos neste período.</p>}{selected.leaves.map((item) => <div className="vacations__leave" key={item.id}><div><strong>{format(item.start_date)} a {format(item.end_date)}</strong><p>{item.days} dias · {item.status}</p>{item.status === 'programada' && <p>Pagamento até {format(item.payment_due_date)} · confirmação de pagamento não registrada</p>}</div><div className="vacations__actions">{item.status === 'programada' && <>{can('vacations.confirm') && <button className="button" onClick={() => act(() => api.post(`/vacations/employees/${employeeId}/leaves/${item.id}/confirm`))}>Confirmar gozo / dar baixa</button>}{can('vacations.correct') && <button className="button" onClick={() => act(() => api.post(`/vacations/employees/${employeeId}/leaves/${item.id}/cancel`))}>Cancelar</button>}</>}{['gozada', 'historica'].includes(item.status) && can('vacations.confirmed.correct') && <button className="button" onClick={() => setConfirmedCorrection({ leaveId: item.id, version: item.version, start_date: String(item.start_date).slice(0, 10), end_date: String(item.end_date).slice(0, 10), reason: '', action: 'correct' })}>Corrigir baixa</button>}</div></div>)}</details>
    </article>}
    <details className="panel vacations__audit"><summary>Histórico e auditoria</summary>{data.audit.length === 0 ? <p className="vacations__muted">Nenhuma alteração registrada.</p> : data.audit.map((entry) => <p key={entry.id}>{format(entry.created_at)} · {entry.actor_name || 'Usuário'} · {entry.entity_type} · {entry.action}{entry.reason ? ` · Motivo: ${entry.reason}` : ''}</p>)}</details>
    {actionError && <p role="alert" className="vacations__error">{actionError}</p>}
    {absence && <VacationModal title={absence.id ? 'Editar falta' : 'Lançar falta'} busy={busy} close={() => setAbsence(null)} submit={() => act(() => absence.id ? api.put(`/vacations/employees/${employeeId}/absences/${absence.id}`, absence) : api.post(`/vacations/employees/${employeeId}/absences`, absence))}><label>Data<input type="date" required value={absence.occurrence_date} onChange={(event) => setAbsence({ ...absence, occurrence_date: event.target.value })} /></label><label>Quantidade<select value={absence.quantity} onChange={(event) => setAbsence({ ...absence, quantity: event.target.value })}><option value="1">1 dia</option><option value="0.5">0,5 dia</option></select></label><label>Classificação<select value={absence.classification} onChange={(event) => setAbsence({ ...absence, classification: event.target.value })}><option value="injustificada">Injustificada</option><option value="justificada">Justificada</option><option value="pendente">Pendente de análise</option></select></label><label>Motivo / observação<textarea value={absence.notes || ''} onChange={(event) => setAbsence({ ...absence, notes: event.target.value })} /></label></VacationModal>}
    {leave && <VacationModal title="Programar férias" confirm="Programar" busy={busy} close={() => setLeave(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/periods/${leave.periodId}/leaves`, leave))}><label>Início<input type="date" required value={leave.start_date} onChange={(event) => setLeave({ ...leave, start_date: event.target.value })} /></label><label>Término<input type="date" required value={leave.end_date} onChange={(event) => setLeave({ ...leave, end_date: event.target.value })} /></label><label>Data do aviso escrito<input type="date" required value={leave.notice_date} onChange={(event) => setLeave({ ...leave, notice_date: event.target.value })} /></label><label>Observações<textarea value={leave.notes} onChange={(event) => setLeave({ ...leave, notes: event.target.value })} /></label><label><input type="checkbox" checked={leave.employee_agreed} onChange={(event) => setLeave({ ...leave, employee_agreed: event.target.checked })} /> Concordância do empregado confirmada</label><label><input type="checkbox" checked={leave.calendar_confirmed} onChange={(event) => setLeave({ ...leave, calendar_confirmed: event.target.checked })} /> Feriados locais e escala de repouso conferidos por administrador</label><label>Calendário, localidade e escala conferidos<textarea required minLength={10} value={leave.calendar_review_note} onChange={(event) => setLeave({ ...leave, calendar_review_note: event.target.value })} /></label></VacationModal>}
    {review && <VacationModal title="Conferir período histórico" confirm="Confirmar conferência" busy={busy} close={() => setReview(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/periods/${review.periodId}/review`, { confirmed: true, note: review.note }))}><p>Verifique férias anteriores, faltas e afastamentos nos documentos antes de confirmar. Esta ação será auditada.</p><label>Justificativa<textarea required value={review.note} onChange={(event) => setReview({ ...review, note: event.target.value })} /></label></VacationModal>}
    {historical && <VacationModal title="Regularizar férias anteriores" confirm="Registrar" busy={busy} close={() => setHistorical(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/periods/${historical.periodId}/historical-leaves`, historical))}><label>Início<input type="date" required value={historical.start_date} onChange={(event) => setHistorical({ ...historical, start_date: event.target.value })} /></label><label>Término<input type="date" required value={historical.end_date} onChange={(event) => setHistorical({ ...historical, end_date: event.target.value })} /></label><label>Fonte documental / observação<textarea required value={historical.notes} onChange={(event) => setHistorical({ ...historical, notes: event.target.value })} /></label></VacationModal>}
    {confirmedCorrection && <VacationModal title="Corrigir baixa confirmada" confirm="Confirmar correção" busy={busy} close={() => setConfirmedCorrection(null)} submit={() => act(() => api.post(`/vacations/employees/${employeeId}/leaves/${confirmedCorrection.leaveId}/correct-confirmed`, confirmedCorrection))}><label>Ação<select value={confirmedCorrection.action} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, action: event.target.value })}><option value="correct">Corrigir datas</option><option value="cancel">Cancelar baixa</option></select></label>{confirmedCorrection.action === 'correct' && <><label>Início<input type="date" required value={confirmedCorrection.start_date} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, start_date: event.target.value })} /></label><label>Término<input type="date" required value={confirmedCorrection.end_date} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, end_date: event.target.value })} /></label></>}<label>Motivo da correção<textarea required minLength={10} value={confirmedCorrection.reason} onChange={(event) => setConfirmedCorrection({ ...confirmedCorrection, reason: event.target.value })} /></label><p>A alteração ficará registrada com os dados anteriores e novos.</p></VacationModal>}
  </section>;
}

export function VacationsPage() {
  const { employeeId } = useParams();
  return <VacationRenderBoundary key={employeeId || 'list'}><VacationContent employeeId={employeeId} /></VacationRenderBoundary>;
}
