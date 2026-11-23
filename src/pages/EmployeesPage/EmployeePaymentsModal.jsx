import { useEffect, useRef, useState } from 'react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { api } from '../../services/api.js';
import { downloadAuthenticatedFile } from '../../utils/downloadAuthenticatedFile.js';
import { parsePaymentCents } from './paymentAmount.js';

const path = '/employees/payments';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Cuiaba' });
const money = (cents) => currency.format(cents / 100);
const status = (payment) => payment.finalized_at ? 'Finalizado' : 'Rascunho';
const normalizedName = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function EmployeePaymentsModal({ onClose, canManage, canPrint }) {
  const [history, setHistory] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [payment, setPayment] = useState(null);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [review, setReview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event) => {
      if (event.target.closest('a[href]') && !window.confirm('Descartar as alterações que ainda não foram salvas?')) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);

  useEffect(() => {
    let active = true;
    Promise.all([api.get(path), canManage ? api.get(`${path}/employees`) : null])
      .then(([list, candidates]) => {
        if (!active) return;
        setHistory(list.data);
        setEmployees(candidates?.data ?? []);
      })
      .catch((failure) => { if (active) setError(failure.response?.data?.message || 'Não foi possível carregar os pagamentos.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManage]);

  async function run(work) {
    if (pending.current || loading) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); }
    catch (failure) { setError(failure.response?.data?.message || failure.message || 'Não foi possível concluir a operação.'); }
    finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function show(data) {
    setPayment(data);
    setRows((data?.items ?? []).map((row) => ({ ...row, amount: decimal.format(row.amount_cents / 100) })));
    setSearch('');
    setEmployeeId('');
    setAmount('');
    setReview(false);
    setDirty(false);
  }

  function remember(data) {
    setHistory((current) => [data, ...current.filter((item) => item.id !== data.id)].sort((a, b) => b.id - a.id));
  }

  function open(id) {
    run(async () => {
      const { data } = await api.get(`${path}/${id}`);
      show(data);
    });
  }

  const editable = canManage && payment && !payment.finalized_at && !review;
  const candidates = employees.filter((employee) => !rows.some((row) => row.employee_id === employee.id)
    && normalizedName(employee.full_name).includes(normalizedName(search.trim())));
  const total = rows.reduce((sum, row) => sum + parsePaymentCents(row.amount), 0);
  const pixPending = rows.some((row) => !row.pix_key?.trim());
  const selected = employees.find((employee) => employee.id === employeeId);

  function addEmployee(event) {
    event.preventDefault();
    const employee = candidates.find((item) => item.id === employeeId);
    if (!employee || !parsePaymentCents(amount)) {
      setError('Selecione um funcionário e informe um valor positivo com até duas casas decimais.');
      return;
    }
    setRows([...rows, { employee_id: employee.id, full_name: employee.full_name, pix_key: employee.pix_key, amount }]);
    setDirty(true);
    setError('');
    setNotice('');
    setAmount('');
    setSearch('');
    setEmployeeId('');
  }

  function save(prepareReview) {
    run(async () => {
      const items = rows.map((row) => ({ employee_id: row.employee_id, amount_cents: parsePaymentCents(row.amount) }));
      if (!items.length || items.some((item) => !item.amount_cents)) {
        throw new Error('Inclua funcionários e informe valores positivos com até duas casas decimais.');
      }
      const body = { version: payment.version, items };
      const { data } = await (payment.id ? api.put(`${path}/${payment.id}`, body) : api.post(path, body));
      show(data);
      remember(data);
      setReview(prepareReview);
      if (!prepareReview) setNotice('Rascunho salvo.');
    });
  }

  function finalize() {
    run(async () => {
      const { data } = await api.post(`${path}/${payment.id}/finalize`, { version: payment.version });
      show(data);
      remember(data);
      setNotice('Relação preparada e confirmada. Nenhuma transferência Pix ou quitação financeira foi realizada.');
    });
  }

  function leave(action) {
    if (pending.current) return;
    if (!dirty || window.confirm('Descartar as alterações que ainda não foram salvas?')) action();
  }

  return <ConfirmModal open title="Pagamentos de funcionários" onCancel={() => leave(onClose)}
    cancelLabel="Fechar" contentClassName="employee-payments">
    <section className="employees-page__stack" aria-label="Pagamentos de funcionários" aria-busy={loading || busy}>
      {error && <p role="alert" className="employee-payments__warning">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p>Carregando pagamentos…</p>}
      {!loading && !payment && <>
        {canManage && <div className="employee-payments__actions">
          <button type="button" className="button button--primary" disabled={busy} onClick={() => { show({}); setError(''); setNotice(''); }}>Novo pagamento</button>
        </div>}
        {!history.length && !error && <p>Nenhuma relação registrada.</p>}
        {history.map((entry) => <article className="employee-payments__row employee-payments__history" key={entry.id}>
          <div><strong>Pagamento nº {entry.id}</strong><br />{date.format(new Date(entry.finalized_at || entry.created_at))}</div>
          <div>{status(entry)}<br />{entry.employee_count} funcionário(s)</div>
          <strong>{money(entry.total_cents)}</strong>
          <button className="button" type="button" disabled={busy} onClick={() => open(entry.id)} aria-label={`Abrir pagamento nº ${entry.id}`}>Abrir</button>
        </article>)}
      </>}
      {payment && <>
        <div className="employee-payments__actions">
          <button type="button" className="button" disabled={busy} onClick={() => leave(() => { show(null); setError(''); setNotice(''); })}>Voltar ao histórico</button>
          {canPrint && payment.finalized_at && !dirty && <button type="button" className="button" disabled={busy} onClick={() =>
            run(() => downloadAuthenticatedFile(`${path}/${payment.id}/pdf`, `pagamento-${payment.id}.pdf`))}>Gerar PDF</button>}
        </div>
        <h3>{payment.id ? `Pagamento nº ${payment.id} · ${status(payment)}` : 'Nova relação'}</h3>
        {payment.finalized_at && <p>Finalizado em {date.format(new Date(payment.finalized_at))}</p>}
        {editable && <form onSubmit={addEmployee}>
          <fieldset disabled={busy} className="employee-payments__fields">
            <label className="field">Buscar por nome<input className="field__input" type="search" value={search}
              onChange={(event) => { setSearch(event.target.value); setEmployeeId(''); }} /></label>
            <label className="field">Funcionário ativo<select className="field__input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
              <option value="">{candidates.length ? 'Selecione' : 'Nenhum funcionário disponível'}</option>
              {candidates.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
            </select></label>
            <label className="field">Valor em reais<input className="field__input" inputMode="decimal" placeholder="0,00" value={amount}
              onChange={(event) => setAmount(event.target.value)} /></label>
            <button className="button" type="submit">Adicionar funcionário</button>
          </fieldset>
        </form>}
        {editable && selected && <p>{selected.full_name} · Pix: {selected.pix_key?.trim() ? selected.pix_key : 'Chave Pix pendente'}</p>}
        {review && <div role="status"><strong>Confira a relação completa antes de confirmar.</strong>
          <p>A confirmação registra somente a lista preparada. Não transfere Pix nem registra quitação financeira.</p></div>}
        {rows.map((row) => <article className="employee-payments__row" key={row.employee_id}>
          <div><strong>{row.full_name}</strong><br />
            {row.pix_key ? <>Pix {row.pix_key}</> : <span className="employee-payments__warning">Chave Pix pendente</span>}</div>
          {editable ? <>
            <label className="field">Valor em reais<input aria-label={`Valor em reais de ${row.full_name}`} className="field__input" inputMode="decimal"
              disabled={busy} value={row.amount} onChange={(event) => {
                setDirty(true);
                setRows(rows.map((item) => item.employee_id === row.employee_id ? { ...item, amount: event.target.value } : item));
              }} /></label>
            <button type="button" className="button" disabled={busy} aria-label={`Remover ${row.full_name}`} onClick={() => {
              setRows(rows.filter((item) => item.employee_id !== row.employee_id));
              setDirty(true);
            }}>Remover</button>
          </> : <strong>{money(row.amount_cents)}</strong>}
        </article>)}
        <strong className="employee-payments__total">{rows.length} funcionário(s) · Total {money(total)}</strong>
        {pixPending && <p className="employee-payments__warning">Cadastre as chaves Pix pendentes antes de finalizar.</p>}
        {editable && <div className="employee-payments__actions">
          <button type="button" className="button" disabled={busy || !rows.length} onClick={() => save(false)}>Salvar rascunho</button>
          <button type="button" className="button button--primary" disabled={busy || !rows.length} onClick={() => save(true)}>Finalizar pagamento</button>
        </div>}
        {review && <div className="employee-payments__actions">
          <button type="button" className="button" disabled={busy} onClick={() => setReview(false)}>Voltar à edição</button>
          <button type="button" className="button button--primary" disabled={busy || pixPending} onClick={finalize}>Confirmar finalização</button>
        </div>}
      </>}
    </section>
  </ConfirmModal>;
}
