import { useEffect, useRef, useState } from 'react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { downloadAuthenticatedFile } from '../../utils/downloadAuthenticatedFile.js';

const money = (value) => value == null ? 'Não cadastrado' : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cuiaba', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const labels = { current_salary: 'salário', meal_allowance: 'vale-alimentação' };
const number = (value) => /^\d+(?:\.\d{3})*(?:,\d{1,2})?$/.test(value.trim()) ? Number(value.replaceAll('.', '').replace(',', '.')) : NaN;

export function CompensationModal({ onClose }) {
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [employee, setEmployee] = useState(null);
  const [checked, setChecked] = useState({});
  const [values, setValues] = useState({});
  const [effective, setEffective] = useState(today);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const confirmationRef = useRef(null);
  const [confirmation, setConfirmation] = useState(null);
  const [month, setMonth] = useState(today().slice(5, 7));
  const [year, setYear] = useState(today().slice(0, 4));
  const [report, setReport] = useState(null);
  const user = getStoredUser();
  const canReport = ['salary', 'meal_allowance'].every((key) => canAccessPermission(user, `employees.${key}.view`));

  useEffect(() => {
    if (confirmation) {
      confirmationRef.current?.scrollIntoView({ block: 'center' });
      confirmationRef.current?.focus({ preventScroll: true });
    }
  }, [confirmation]);

  useEffect(() => {
    let active = true;
    api.get('/employees/compensation/employees').then(({ data }) => { if (active) setEmployees(data); })
      .catch((error) => { if (active) setErrors({ general: error.response?.data?.message || 'Não foi possível carregar funcionários.' }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function select(id) {
    setEmployee(null); setChecked({}); setValues({}); setConfirmation(null); setErrors({}); setMessage('');
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get('/employees/compensation/employees');
      setEmployees(data);
      setEmployee(data.find((row) => row.id === id) || null);
    } catch (error) { setErrors({ general: error.response?.data?.message || 'Não foi possível carregar valores atuais.' }); }
    finally { setLoading(false); }
  }

  function review() {
    const nextErrors = {}, changes = [];
    setMessage('');
    if (effective && (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || !Number.isFinite(Date.parse(effective)) || new Date(effective).toISOString().slice(0, 10) !== effective)) nextErrors.effective_from = 'Informe uma data de vigência válida.';
    for (const field of Object.keys(labels)) {
      if (!checked[field] || !values[field]?.trim()) continue;
      const value = number(values[field]);
      if (!Number.isFinite(value) || value > 9999999999.99) nextErrors[field] = 'Informe um valor válido. Exemplo: 2.800,00.';
      else if (value < Number(employee[field])) nextErrors[field] = 'O novo valor deve ser maior que o atual.';
      else if (value > Number(employee[field])) changes.push({ field, value, previous: Number(employee[field]) });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    if (!changes.length) { setMessage('Nenhuma alteração realizada.'); return; }
    setConfirmation(changes);
  }

  async function save() {
    if (saving.current || !confirmation) return;
    saving.current = true; setBusy(true); setErrors({});
    const body = { effective_from: effective, expected: {} };
    confirmation.forEach(({ field, value, previous }) => { body[field] = value; body.expected[field] = previous; });
    try {
      const { data } = await api.post(`/employees/${employee.id}/compensation`, body);
      setEmployee(data.employee);
      setEmployees((rows) => rows.map((row) => row.id === data.employee.id ? data.employee : row));
      setChecked({}); setValues({}); setConfirmation(null); setReport(null); setMessage(data.message);
    } catch (error) {
      setErrors({ general: error.response?.data?.message || 'Falha ao salvar. Confira os valores antes de tentar novamente.' });
      setConfirmation(null);
    } finally { saving.current = false; setBusy(false); }
  }

  async function loadReport(pdf = false) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setErrors({});
    try {
      const params = { month, year };
      if (pdf) await downloadAuthenticatedFile('/employees/compensation/report-pdf', 'modificacoes-mensais.pdf', { params });
      else setReport((await api.get('/employees/compensation/report', { params })).data);
    } catch (error) { setErrors({ general: error.response?.data?.message || 'Não foi possível gerar o relatório. Confira mês, ano e permissões.' }); }
    finally { saving.current = false; setBusy(false); }
  }

  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return <ConfirmModal open title="Atualização cadastral" onCancel={() => { if (!saving.current) onClose(); }} cancelLabel="Fechar" contentClassName="compensation-modal">
    <div role="region" aria-label="Atualização de remuneração" className="employees-page__stack">
      {errors.general && <p role="alert" className="compensation-error">{errors.general}</p>}
      {message && <p role="status">{message}</p>}
      <fieldset disabled={busy || !!confirmation} className="compensation-fields">
        <label className="field">Buscar funcionário por nome<input className="field__input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="field">Funcionário ativo<select aria-label="Funcionário ativo" className="field__input" value={employee?.id || ''} disabled={loading} onChange={(event) => select(event.target.value)}>
          <option value="">{loading ? 'Carregando...' : 'Selecione um funcionário'}</option>
          {employees.filter((row) => row.id === employee?.id || normalize(row.full_name).includes(normalize(search))).map((row) => <option key={row.id} value={row.id}>{row.full_name}</option>)}
        </select></label>
        {!loading && !employees.length && <p>Nenhum funcionário ativo disponível.</p>}
        {employee && <>
          <div className="compensation-grid">{Object.entries(labels).filter(([field]) => field in employee).map(([field, label]) => {
            const value = number(values[field] || '');
            const difference = value - Number(employee[field]);
            return <div className="compensation-card" key={field}>
              <label className="employees-page__checkline"><input type="checkbox" checked={!!checked[field]} disabled={employee[field] == null} onChange={(event) => setChecked({ ...checked, [field]: event.target.checked })} />Atualizar {label}</label>
              <label className="field">{label === 'salário' ? 'Salário atual' : 'Valor atual'}<input className="field__input" readOnly value={money(employee[field])} /></label>
              {employee[field] == null && <small>Complete este valor na ficha individual.</small>}
              {checked[field] && <>
                <label className="field">Novo {label}<input className="field__input compensation-new" inputMode="decimal" placeholder="0,00" value={values[field] || ''} aria-invalid={!!errors[field]} onChange={(event) => { setValues({ ...values, [field]: event.target.value }); setErrors({ ...errors, [field]: '' }); }} onBlur={() => { if (Number.isFinite(value)) setValues({ ...values, [field]: value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }); }} /></label>
                {errors[field] && <small role="alert" className="compensation-error">{errors[field]}</small>}
                {Number.isFinite(value) && <small>Diferença: {money(difference)}{field === 'current_salary' && Number(employee[field]) > 0 ? ` (${(difference / Number(employee[field]) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)` : ''}</small>}
              </>}
            </div>;
          })}</div>
          <label className="field">Data de vigência<input className="field__input" type="date" value={effective} aria-invalid={!!errors.effective_from} onChange={(event) => setEffective(event.target.value)} />{errors.effective_from && <small role="alert" className="compensation-error">{errors.effective_from}</small>}</label>
          <p className="employees-page__subtitle">O cadastro será atualizado agora. A vigência será registrada no histórico e no relatório; não agenda alterações nem recalcula folhas anteriores.</p>
          <button className="button button_primary" type="button" onClick={review}>Salvar alterações</button>
        </>}
      </fieldset>
      {confirmation && <div ref={confirmationRef} tabIndex={-1} className="compensation-card" role="region" aria-label="Confirmar alterações">
        <h3>Confirme as alterações de {employee.full_name}</h3>
        {confirmation.map(({ field, previous, value }) => <p key={field}>{labels[field]}: {money(previous)} → <strong>{money(value)}</strong><br />Diferença: {money(value - previous)}{field === 'current_salary' && previous > 0 ? ` (${((value - previous) / previous * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)` : ''}</p>)}
        <p>Vigência: {effective ? effective.split('-').reverse().join('/') : 'Data atual'}. Atualização imediata do cadastro.</p>
        <div className="employees-page__actions"><button type="button" className="button button_primary" disabled={busy} onClick={save}>{busy ? 'Salvando...' : 'Confirmar e salvar'}</button><button type="button" className="button" disabled={busy} onClick={() => setConfirmation(null)}>Voltar e revisar</button></div>
      </div>}
      {canReport && <section className="compensation-report">
        <h3>Relatório de modificações do mês</h3>
        <p>Alterações registradas no período, inclusive na ficha individual.</p>
        <div className="compensation-grid">
          <label className="field">Mês<select className="field__input" value={Number(month)} disabled={busy} onChange={(event) => { setMonth(event.target.value); setReport(null); }}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}</select></label>
          <label className="field">Ano<input className="field__input" type="number" min="1900" max="9998" value={year} disabled={busy} onChange={(event) => { setYear(event.target.value); setReport(null); }} /></label>
        </div>
        <div className="employees-page__actions"><button type="button" className="button" disabled={busy} onClick={() => loadReport()}>Consultar alterações</button><button type="button" className="button" disabled={busy} onClick={() => loadReport(true)}>Gerar PDF</button></div>
        {report && <div aria-live="polite">{!report.rows.length ? <p>Nenhuma alteração registrada no mês.</p> : report.rows.map((row, index) => <div className="compensation-card" key={index}><strong>{row.full_name} — {row.type === 'salary' ? 'Salário' : 'Vale-alimentação'}</strong><p>{money(row.previous_value)} → {money(row.new_value)}<br />Diferença: {money(row.difference)}{row.percentage != null ? ` (${Number(row.percentage).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)` : ''}<br />Registro: {row.created_at.slice(0, 10).split('-').reverse().join('/')} · Vigência: {row.effective_from?.split('-').reverse().join('/') || 'Não informada'}</p></div>)}</div>}
      </section>}
    </div>
  </ConfirmModal>;
}
