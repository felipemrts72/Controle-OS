import { useEffect, useState } from 'react';
import { BarChart3, FileSearch, History, Search } from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { formatDate, formatMoney } from '../EmployeesPage/employeeUtils.js';
import './AdvancesPage.css';

const emptyEmployeeSearch = { search: '', results: [], selected: null, loading: false };

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function openReport(path, params) {
  const response = await api.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function apiErrorMessage(error, fallback = 'Não foi possível concluir a operação.') {
  return error?.response?.data?.message
    || error?.data?.message
    || error?.message
    || fallback;
}

export function AdvancesReportsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('reports');
  const [generalMode, setGeneralMode] = useState('current');
  const [generalPeriod, setGeneralPeriod] = useState({ from: today(), to: today() });
  const [individualMode, setIndividualMode] = useState('current');
  const [individualPeriod, setIndividualPeriod] = useState({ from: today(), to: today() });
  const [employeeSearch, setEmployeeSearch] = useState(emptyEmployeeSearch);
  const [cycles, setCycles] = useState([]);
  const [audit, setAudit] = useState([]);
  const [auditFilters, setAuditFilters] = useState({ employee_id: '', user_id: '', action: '', from: '', to: '' });

  async function searchEmployees(event) {
    event?.preventDefault();
    const search = employeeSearch.search.trim();
    if (search.length < 3) {
      toast.error('Digite ao menos 3 letras.');
      return;
    }
    setEmployeeSearch((current) => ({ ...current, loading: true }));
    try {
      const response = await api.get('/advances/employees', { params: { search } });
      setEmployeeSearch((current) => ({ ...current, results: response.data || [] }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Nao foi possivel buscar funcionarios.'));
    } finally {
      setEmployeeSearch((current) => ({ ...current, loading: false }));
    }
  }

  async function loadCycles() {
    try {
      const response = await api.get('/advances/reports/cycles');
      setCycles(response.data || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Nao foi possivel carregar ciclos anteriores.'));
    }
  }

  async function loadAudit(event) {
    event?.preventDefault();
    try {
      const response = await api.get('/advances/audit', { params: auditFilters });
      setAudit(response.data || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Nao foi possivel carregar auditoria.'));
    }
  }

  useEffect(() => {
    if (tab === 'cycles') loadCycles();
    if (tab === 'audit') loadAudit();
  }, [tab]);

  async function generateGeneral() {
    const params = generalMode === 'current'
      ? { mode: 'current' }
      : { mode: 'period', from: generalPeriod.from, to: generalPeriod.to };
    try {
      await openReport('/advances/reports/general/pdf', params);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível gerar o relatório geral.'));
    }
  }

  async function generateIndividual() {
    if (!employeeSearch.selected) {
      toast.error('Selecione um funcionario.');
      return;
    }
    const params = individualMode === 'current'
      ? { mode: 'current' }
      : { mode: 'period', from: individualPeriod.from, to: individualPeriod.to };
    try {
      await openReport(`/advances/reports/individual/${employeeSearch.selected.id}/pdf`, params);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível gerar o extrato individual.'));
    }
  }

  return (
    <section className="page advances-page advances-reports">
      <div className="page__header">
        <div>
          <h1 className="page__title">Relatorios de Vales</h1>
          <p className="advances-page__subtitle">Consultas financeiras, ciclos anteriores e auditoria separados da rotina operacional.</p>
        </div>
      </div>

      <div className="advances-page__tabs">
        <button className={`button ${tab === 'reports' ? 'button_primary' : ''}`} type="button" onClick={() => setTab('reports')}><BarChart3 size={18} /><span>Relatorios</span></button>
        <button className={`button ${tab === 'cycles' ? 'button_primary' : ''}`} type="button" onClick={() => setTab('cycles')}><History size={18} /><span>Ciclos anteriores</span></button>
        <button className={`button ${tab === 'audit' ? 'button_primary' : ''}`} type="button" onClick={() => setTab('audit')}><FileSearch size={18} /><span>Historico e auditoria</span></button>
      </div>

      {tab === 'reports' && (
        <div className="advances-page__report-grid">
          <article className="panel advances-page__report-card">
            <h2>Relatorio Geral de Vales</h2>
            <div className="advances-page__segmented">
              <button className={generalMode === 'current' ? 'button button_primary' : 'button'} type="button" onClick={() => setGeneralMode('current')}>Ciclo atual</button>
              <button className={generalMode === 'period' ? 'button button_primary' : 'button'} type="button" onClick={() => setGeneralMode('period')}>Ver por periodo</button>
            </div>
            {generalMode === 'period' && (
              <div className="advances-page__modal-grid">
                <label className="field"><span className="field__label">De</span><input className="field__input" type="date" value={generalPeriod.from} onChange={(event) => setGeneralPeriod((current) => ({ ...current, from: event.target.value }))} /></label>
                <label className="field"><span className="field__label">Ate</span><input className="field__input" type="date" value={generalPeriod.to} onChange={(event) => setGeneralPeriod((current) => ({ ...current, to: event.target.value }))} /></label>
              </div>
            )}
            <button className="button button_primary" type="button" onClick={generateGeneral}>Gerar relatorio geral</button>
          </article>

          <article className="panel advances-page__report-card">
            <h2>Extrato Individual de Vales</h2>
            {!employeeSearch.selected ? (
              <>
                <form className="advances-page__search-form" onSubmit={searchEmployees}>
                  <label className="field"><span className="field__label">Buscar funcionario</span><input className="field__input" value={employeeSearch.search} onChange={(event) => setEmployeeSearch((current) => ({ ...current, search: event.target.value }))} placeholder="Digite ao menos 3 letras" /></label>
                  <button className="button button_primary" type="submit" disabled={employeeSearch.loading}><Search size={18} /><span>Buscar</span></button>
                </form>
                <div className="advances-page__results-list">
                  {employeeSearch.results.map((employee) => (
                    <button className="advances-page__employee-result" type="button" key={employee.id} onClick={() => setEmployeeSearch((current) => ({ ...current, selected: employee }))}>
                      <strong>{employee.full_name}</strong>
                      <span>{employee.current_salary ? `Salario: ${formatMoney(employee.current_salary)}` : 'Salario nao cadastrado'}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="advances-page__selected-employee">
                <div><span className="field__label">Funcionario selecionado</span><strong>{employeeSearch.selected.full_name}</strong></div>
                <button className="button" type="button" onClick={() => setEmployeeSearch((current) => ({ ...current, selected: null }))}>Trocar</button>
              </div>
            )}
            <div className="advances-page__segmented">
              <button className={individualMode === 'current' ? 'button button_primary' : 'button'} type="button" onClick={() => setIndividualMode('current')}>Ciclo atual</button>
              <button className={individualMode === 'period' ? 'button button_primary' : 'button'} type="button" onClick={() => setIndividualMode('period')}>Ver por periodo</button>
            </div>
            {individualMode === 'period' && (
              <div className="advances-page__modal-grid">
                <label className="field"><span className="field__label">De</span><input className="field__input" type="date" value={individualPeriod.from} onChange={(event) => setIndividualPeriod((current) => ({ ...current, from: event.target.value }))} /></label>
                <label className="field"><span className="field__label">Ate</span><input className="field__input" type="date" value={individualPeriod.to} onChange={(event) => setIndividualPeriod((current) => ({ ...current, to: event.target.value }))} /></label>
              </div>
            )}
            <button className="button button_primary" type="button" onClick={generateIndividual}>Gerar extrato individual</button>
          </article>
        </div>
      )}

      {tab === 'cycles' && (
        <div className="panel advances-page__cycles">
          <h2>Ciclos anteriores</h2>
          {cycles.map((cycle) => (
            <div className="advances-page__cycle-row" key={cycle.id}>
              <div>
                <strong>{formatDate(cycle.opened_at)} a {formatDate(cycle.closed_at)}</strong>
                <span>Aberto por {cycle.opened_by_name || '-'} · Fechado por {cycle.closed_by_name || '-'}</span>
              </div>
              <div>{cycle.employee_count} funcionarios · {formatMoney(cycle.total_amount)}</div>
              <button className="button" type="button" onClick={() => openReport('/advances/reports/general/pdf', { cycle_id: cycle.id }).catch((error) => toast.error(apiErrorMessage(error, 'Não foi possível gerar o relatório do ciclo.')))}>Relatorio do ciclo</button>
            </div>
          ))}
          {!cycles.length && <p>Nenhum ciclo fechado encontrado.</p>}
        </div>
      )}

      {tab === 'audit' && (
        <div className="panel advances-page__report-card">
          <h2>Historico e auditoria</h2>
          <form className="advances-page__modal-grid" onSubmit={loadAudit}>
            <label className="field"><span className="field__label">Funcionário</span><input className="field__input" value={auditFilters.employee_id} onChange={(event) => setAuditFilters((current) => ({ ...current, employee_id: event.target.value }))} placeholder="ID do funcionário" /></label>
            <label className="field"><span className="field__label">Usuário responsável</span><input className="field__input" value={auditFilters.user_id} onChange={(event) => setAuditFilters((current) => ({ ...current, user_id: event.target.value }))} placeholder="ID do usuário" /></label>
            <label className="field"><span className="field__label">Acao</span><input className="field__input" value={auditFilters.action} onChange={(event) => setAuditFilters((current) => ({ ...current, action: event.target.value }))} placeholder="Ex.: installment_plan_convert" /></label>
            <label className="field"><span className="field__label">De</span><input className="field__input" type="date" value={auditFilters.from} onChange={(event) => setAuditFilters((current) => ({ ...current, from: event.target.value }))} /></label>
            <label className="field"><span className="field__label">Ate</span><input className="field__input" type="date" value={auditFilters.to} onChange={(event) => setAuditFilters((current) => ({ ...current, to: event.target.value }))} /></label>
            <button className="button button_primary" type="submit">Filtrar</button>
          </form>
          <div className="advances-page__audit-list">
            {audit.map((entry) => (
              <article className="advances-page__audit-card" key={entry.id}>
                <strong>{entry.action}</strong>
                <span>{formatDate(entry.created_at)} · {entry.user_name || '-'}</span>
                <small>{entry.entity_type}</small>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
