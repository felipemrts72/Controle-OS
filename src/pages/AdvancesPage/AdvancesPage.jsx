import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, FileText, Pencil, Plus, RotateCcw, Save, Trash2, XCircle } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import { formatDate, formatMoney, toDateInput } from '../EmployeesPage/employeeUtils.js';
import './AdvancesPage.css';

const emptyLine = { employee_id: '', amount: '' };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function statusClass(status) {
  return `advances-page__status advances-page__status_${status}`;
}

function Percent({ value }) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(2).replace('.', ',')}%`;
}

function LimitFacts({ details }) {
  if (!details) return null;
  return (
    <dl className="advances-page__facts">
      <div><dt>Funcionário</dt><dd>{details.employee_name || '-'}</dd></div>
      <div><dt>Salário atual</dt><dd>{details.salary ? formatMoney(details.salary) : 'Não cadastrado'}</dd></div>
      {details.maximum_limit !== undefined && <div><dt>Limite máximo</dt><dd>{formatMoney(details.maximum_limit)} {details.maximum_percentage ? `(${details.maximum_percentage}%)` : ''}</dd></div>}
      <div><dt>Já acumulado</dt><dd>{formatMoney(details.accumulated_before)}</dd></div>
      <div><dt>Novo vale</dt><dd>{formatMoney(details.amount)}</dd></div>
      <div><dt>Total projetado</dt><dd>{formatMoney(details.projected_total)}</dd></div>
      {details.projected_percentage !== undefined && <div><dt>Percentual projetado</dt><dd><Percent value={details.projected_percentage} /></dd></div>}
      <div><dt>Restante disponível</dt><dd>{formatMoney(details.remaining)}</dd></div>
    </dl>
  );
}

export function AdvancesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'advances.create') || canAccessPermission(user, 'advances.manage');
  const canReview = canAccessPermission(user, 'advances.review') || canAccessPermission(user, 'advances.manage');
  const canApprove = canAccessPermission(user, 'advances.approve') || canAccessPermission(user, 'advances.manage');
  const canCycleCreate = canAccessPermission(user, 'advances.cycles.create') || canAccessPermission(user, 'advances.manage');
  const canCycleClose = canAccessPermission(user, 'advances.cycles.close') || canAccessPermission(user, 'advances.manage');

  const [home, setHome] = useState({ open_cycle: null, lists: [] });
  const [cycles, setCycles] = useState([]);
  const [list, setList] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [newListDate, setNewListDate] = useState(today());
  const [line, setLine] = useState(emptyLine);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [limitModal, setLimitModal] = useState(null);
  const [closeModal, setCloseModal] = useState(false);
  const [approvalModal, setApprovalModal] = useState(null);

  async function loadHome() {
    const [homeResponse, cyclesResponse] = await Promise.all([
      api.get('/advances'),
      api.get('/advances/cycles'),
    ]);
    setHome(homeResponse.data);
    setCycles(cyclesResponse.data);
  }

  async function loadList() {
    if (!id) {
      setList(null);
      return;
    }
    const response = await api.get(`/advances/lists/${id}`);
    setList(response.data);
  }

  async function loadEmployees() {
    if (!canCreate && !canReview) {
      setEmployees([]);
      return;
    }
    const response = await api.get('/advances/employees');
    setEmployees(response.data);
  }

  useEffect(() => {
    loadHome().catch(() => toast.error('Não foi possível carregar as listas de vales.'));
  }, []);

  useEffect(() => {
    Promise.all([loadList(), loadEmployees()]).catch(() => toast.error('Não foi possível abrir a lista.'));
  }, [id]);

  const employeeOptions = useMemo(() => {
    const used = new Set((list?.items || []).filter((item) => !editing || item.id !== editing.id).map((item) => item.employee_id));
    return employees.filter((employee) => !used.has(employee.id));
  }, [employees, editing, list]);

  async function refreshAll() {
    await Promise.all([loadHome(), loadList()]);
  }

  async function startCycle() {
    setBusy(true);
    try {
      await api.post('/advances/cycles');
      toast.success('Ciclo de vales iniciado.');
      await loadHome();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível iniciar o ciclo.');
    } finally {
      setBusy(false);
    }
  }

  async function closeCycle(startNew = false) {
    if (!home.open_cycle) return;
    setBusy(true);
    try {
      await api.post(`/advances/cycles/${home.open_cycle.id}/close`, { start_new: startNew });
      toast.success(startNew ? 'Ciclo fechado e novo ciclo iniciado.' : 'Ciclo fechado.');
      setCloseModal(false);
      await loadHome();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível fechar o ciclo.');
    } finally {
      setBusy(false);
    }
  }

  async function createList() {
    setBusy(true);
    try {
      const response = await api.post('/advances/lists', { list_date: newListDate });
      toast.success('Lista de vales criada.');
      navigate(`/vales/${response.data.id}`);
      await loadHome();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível criar a lista.');
    } finally {
      setBusy(false);
    }
  }

  function handleLimitError(error, retry) {
    const data = error.response?.data;
    if (!['LIMIT_WARNING', 'LIMIT_OVERRIDE_REQUIRED', 'LIMIT_BLOCKED', 'SALARY_MISSING'].includes(data?.code)) return false;
    const blocked = data.code === 'LIMIT_BLOCKED' || data.code === 'SALARY_MISSING';
    setLimitModal({
      title: data.code === 'LIMIT_WARNING' ? 'ATENÇÃO' : blocked ? 'Limite máximo atingido' : 'Override de limite',
      message: data.message,
      details: data.details,
      confirmLabel: data.code === 'LIMIT_WARNING' ? 'Continuar mesmo assim' : 'Confirmar override',
      blocked,
      onConfirm: data.code === 'LIMIT_WARNING'
        ? () => retry({ threshold_warning_confirmed: true })
        : () => retry({ override_confirmed: true, threshold_warning_confirmed: true }),
    });
    return true;
  }

  async function saveItem(itemId, values, flags = {}) {
    const payload = { ...values, ...flags };
    const request = itemId
      ? () => api.put(`/advances/lists/${id}/items/${itemId}`, payload)
      : () => api.post(`/advances/lists/${id}/items`, payload);
    setBusy(true);
    try {
      const response = await request();
      setList(response.data);
      setLine(emptyLine);
      setEditing(null);
      setLimitModal(null);
      toast.success('Linha confirmada.');
      await loadHome();
    } catch (error) {
      if (!handleLimitError(error, (nextFlags) => saveItem(itemId, values, nextFlags))) {
        toast.error(error.response?.data?.message || 'Não foi possível confirmar a linha.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId) {
    setBusy(true);
    try {
      const response = await api.delete(`/advances/lists/${id}/items/${itemId}`);
      setList(response.data);
      toast.success('Funcionário removido da lista.');
      await loadHome();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível remover o funcionário.');
    } finally {
      setBusy(false);
    }
  }

  async function submitList() {
    setBusy(true);
    try {
      const response = await api.post(`/advances/lists/${id}/submit`);
      setList(response.data);
      toast.success('Lista salva e enviada para aprovação.');
      await loadHome();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar a lista.');
    } finally {
      setBusy(false);
    }
  }

  async function approveList(flags = {}) {
    setBusy(true);
    try {
      const response = await api.post(`/advances/lists/${id}/approve`, flags);
      setList(response.data);
      setApprovalModal(null);
      toast.success('Lista aprovada.');
      await loadHome();
    } catch (error) {
      if (!handleLimitError(error, (nextFlags) => approveList(nextFlags))) {
        toast.error(error.response?.data?.message || 'Não foi possível aprovar a lista.');
      }
    } finally {
      setBusy(false);
    }
  }

  function openSummary(listId) {
    window.open(`/vales/${listId}/resumo`, '_blank', 'noopener,noreferrer');
  }

  const ownsCurrentList = list && String(list.created_by) === String(user?.id);
  const canEditCurrentList = list && list.cycle_status === 'open' && !['approved', 'cancelled'].includes(list.status)
    && (canReview || (ownsCurrentList && (canCreate || canAccessPermission(user, 'advances.edit_own_list'))));

  if (id && !list) return <section className="page"><div className="panel">Carregando lista de vales...</div></section>;

  return (
    <section className="page advances-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Vales</h1>
          <p className="advances-page__subtitle">Listas de vales e adiantamentos por ciclo.</p>
        </div>
        <div className="page__actions">
          {id && <Link className="button" to="/vales"><RotateCcw size={18} /><span>Listas</span></Link>}
          {list && <button className="button" type="button" onClick={() => openSummary(list.id)}><FileText size={18} /><span>Visualizar resumo</span></button>}
          {home.open_cycle && canCycleClose && <button className="button button_danger" type="button" onClick={() => setCloseModal(true)}><XCircle size={18} /><span>Fechar ciclo</span></button>}
        </div>
      </div>

      {!id && (
        <>
          <div className="panel advances-page__cycle">
            {home.open_cycle ? (
              <>
                <div>
                  <span className="advances-page__eyebrow">Ciclo aberto</span>
                  <strong>Aberto em {formatDate(home.open_cycle.opened_at)}</strong>
                  <p>{home.open_cycle.list_count} listas · {home.open_cycle.item_count} lançamentos · {formatMoney(home.open_cycle.total_amount)}</p>
                </div>
                {canCreate && (
                  <div className="advances-page__new-list">
                    <input className="field__input" type="date" value={newListDate} onChange={(event) => setNewListDate(event.target.value)} />
                    <button className="button button_primary" type="button" onClick={createList} disabled={busy}><Plus size={18} /><span>Nova lista de vales</span></button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <span className="advances-page__eyebrow">Sem ciclo aberto</span>
                  <strong>Inicie um ciclo para lançar vales.</strong>
                  <p>O acumulado começa em zero no novo ciclo e o histórico anterior permanece preservado.</p>
                </div>
                {canCycleCreate && <button className="button button_primary" type="button" onClick={startCycle} disabled={busy}>Iniciar ciclo de vales</button>}
              </>
            )}
          </div>

          <div className="advances-page__grid">
            {home.lists.map((advanceList) => (
              <Link className="advances-page__card" to={`/vales/${advanceList.id}`} key={advanceList.id}>
                <div>
                  <span className="advances-page__eyebrow">Lista de vales</span>
                  <h2>{formatDate(advanceList.list_date)}</h2>
                </div>
                <div className="advances-page__card-metrics">
                  <span>{advanceList.employee_count} funcionários</span>
                  <strong>{formatMoney(advanceList.total_amount)}</strong>
                </div>
                <span className={statusClass(advanceList.status)}>{advanceList.status_label}</span>
                {advanceList.created_by_name && <small>Criada por {advanceList.created_by_name}</small>}
              </Link>
            ))}
            {!home.lists.length && <div className="panel">Nenhuma lista de vales cadastrada.</div>}
          </div>

          <div className="panel advances-page__cycles">
            <h2>Ciclos</h2>
            {cycles.map((cycle) => (
              <div className="advances-page__cycle-row" key={cycle.id}>
                <div>
                  <strong>{cycle.status === 'open' ? 'Ciclo aberto' : 'Ciclo fechado'}</strong>
                  <span>Aberto em {formatDate(cycle.opened_at)}{cycle.closed_at ? ` · Fechado em ${formatDate(cycle.closed_at)}` : ''}</span>
                </div>
                <div>{cycle.list_count} listas · {formatMoney(cycle.total_amount)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {list && (
        <>
          <div className="panel advances-page__detail-head">
            <label className="field">
              <span className="field__label">Data da lista</span>
              <input className="field__input" type="date" value={toDateInput(list.list_date)} disabled={!canEditCurrentList} onChange={async (event) => {
                const response = await api.put(`/advances/lists/${list.id}`, { list_date: event.target.value });
                setList(response.data);
                await loadHome();
              }} />
            </label>
            <div><span className="field__label">Status</span><strong className={statusClass(list.status)}>{list.status_label}</strong></div>
            <div><span className="field__label">Funcionários</span><strong>{list.employee_count}</strong></div>
            <div><span className="field__label">Total</span><strong>{formatMoney(list.total_amount)}</strong></div>
          </div>

          <div className="panel advances-page__items">
            <div className="advances-page__items-header">
              <h2>Lançamentos</h2>
              <span>{list.items.length} linhas confirmadas</span>
            </div>

            {list.items.map((item) => (
              <div className="advances-page__line" key={item.id}>
                {editing?.id === item.id ? (
                  <>
                    <select className="field__input" value={editing.employee_id} onChange={(event) => setEditing({ ...editing, employee_id: event.target.value })}>
                      <option value={item.employee_id}>{item.employee_name}</option>
                      {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                    </select>
                    <input className="field__input" type="number" min="0.01" step="0.01" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: event.target.value })} />
                    <button className="button button_primary advances-page__icon-button" title="Confirmar" type="button" onClick={() => saveItem(item.id, editing)} disabled={busy}><Check size={18} /></button>
                  </>
                ) : (
                  <>
                    <div><strong>{item.employee_name}</strong><span>{item.override_used ? 'Limite ultrapassado por autorização' : item.threshold_warning_confirmed ? 'Confirmação acima de 40%' : 'Confirmado'}</span></div>
                    <strong>{formatMoney(item.amount)}</strong>
                    {canEditCurrentList && (
                      <div className="advances-page__line-actions">
                        <button className="button advances-page__icon-button" title="Editar" type="button" onClick={() => setEditing({ id: item.id, employee_id: item.employee_id, amount: item.amount })}><Pencil size={18} /></button>
                        {canReview && <button className="button button_danger advances-page__icon-button" title="Remover" type="button" onClick={() => removeItem(item.id)}><Trash2 size={18} /></button>}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}

            {canEditCurrentList && (
              <div className="advances-page__line advances-page__line_new">
                <select className="field__input" value={line.employee_id} onChange={(event) => setLine({ ...line, employee_id: event.target.value })}>
                  <option value="">Funcionário</option>
                  {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                </select>
                <input className="field__input" type="number" min="0.01" step="0.01" placeholder="R$ 0,00" value={line.amount} onChange={(event) => setLine({ ...line, amount: event.target.value })} />
                <button className="button button_primary advances-page__icon-button" title="Confirmar" type="button" onClick={() => saveItem(null, line)} disabled={busy}><Check size={18} /></button>
              </div>
            )}
          </div>

          <div className="page__actions advances-page__footer-actions">
            {canEditCurrentList && <button className="button button_primary" type="button" onClick={submitList} disabled={busy}><Save size={18} /><span>Salvar lista</span></button>}
            {canApprove && list.status === 'pending_approval' && <button className="button button_primary" type="button" onClick={() => setApprovalModal(true)}><Check size={18} /><span>Aprovar lista</span></button>}
          </div>
        </>
      )}

      <ConfirmModal
        open={Boolean(limitModal)}
        title={limitModal?.title}
        onCancel={() => setLimitModal(null)}
        showCancel={!limitModal?.blocked}
        cancelLabel="Cancelar"
        actions={!limitModal?.blocked && <button className="button button_primary" type="button" onClick={limitModal?.onConfirm}>{limitModal?.confirmLabel}</button>}
      >
        <p>{limitModal?.message}</p>
        <LimitFacts details={limitModal?.details} />
        {limitModal?.blocked && <button className="button button_primary" type="button" onClick={() => setLimitModal(null)}>Entendi</button>}
      </ConfirmModal>

      <ConfirmModal
        open={Boolean(approvalModal)}
        title="Aprovar lista"
        onCancel={() => setApprovalModal(null)}
        actions={<button className="button button_primary" type="button" onClick={() => approveList()}>Aprovar lista</button>}
      >
        <p>O backend vai recalcular todos os itens, checar duplicidades e registrar aprovação com data e usuário.</p>
      </ConfirmModal>

      <ConfirmModal
        open={closeModal}
        title="Fechar ciclo de vales?"
        onCancel={() => setCloseModal(false)}
        actions={(
          <>
            <button className="button" type="button" onClick={() => closeCycle(false)} disabled={busy}>Fechar ciclo</button>
            <button className="button button_primary" type="button" onClick={() => closeCycle(true)} disabled={busy}>Fechar e iniciar novo</button>
          </>
        )}
      >
        <p>Após o fechamento, novos vales serão lançados em um novo ciclo e o cálculo dos limites começará novamente do zero. O histórico anterior será preservado.</p>
        <dl className="advances-page__facts">
          <div><dt>Aberto em</dt><dd>{formatDate(home.open_cycle?.opened_at)}</dd></div>
          <div><dt>Listas</dt><dd>{home.open_cycle?.list_count || 0}</dd></div>
          <div><dt>Lançamentos</dt><dd>{home.open_cycle?.item_count || 0}</dd></div>
          <div><dt>Funcionários distintos</dt><dd>{home.open_cycle?.employee_count || 0}</dd></div>
          <div><dt>Total acumulado</dt><dd>{formatMoney(home.open_cycle?.total_amount || 0)}</dd></div>
        </dl>
      </ConfirmModal>
    </section>
  );
}
