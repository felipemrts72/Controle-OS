import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, FileText, HandCoins, Layers, Pencil, Plus, RotateCcw, Save, Search, Trash2, XCircle } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission, isSuperAdmin } from '../../utils/permissions.js';
import { formatDate, formatMoney, toDateInput } from '../EmployeesPage/employeeUtils.js';
import { downloadAuthenticatedFile } from '../../utils/downloadAuthenticatedFile.js';
import { AdvanceLimitReview } from './AdvanceLimitReview.jsx';
import './AdvancesPage.css';

const emptyLine = { employee_id: '', amount: '' };
const emptyLimitLookup = { open: false, search: '', results: [], searched: false, loading: false };
const emptyIndividual = { open: false, search: '', results: [], selected: null, amount: '', receipt_at: '', source_bank: '', installments_enabled: false, installments_count: 2, loading: false };
const emptyConvert = { open: false, search: '', results: [], selectedEmployee: null, eligible: [], selectedItem: null, installments_count: 2, loading: false };
const banks = ['Sicoob', 'Sicredi', 'Asaas', 'Itaú'];

function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function statusClass(status) {
  return `advances-page__status advances-page__status_${status}`;
}

function Percent({ value }) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(2).replace('.', ',')}%`;
}

function localDateTimeValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function resultLevelClass(level) {
  return `advances-page__result-card advances-page__result-card_${level || 'normal'}`;
}

function apiErrorMessage(error, fallback = 'Não foi possível concluir a operação.') {
  return error?.response?.data?.message
    || error?.data?.message
    || error?.message
    || fallback;
}

function factClass(name) {
  return ['amount', 'remaining', 'projected'].includes(name) ? `advances-page__fact advances-page__fact_${name}` : 'advances-page__fact';
}

function splitPreview(total, count) {
  const totalCents = Math.round(Number(total || 0) * 100);
  if (!totalCents || !count) return [];
  const base = Math.floor(totalCents / count);
  const values = Array.from({ length: count }, () => base);
  values[count - 1] += totalCents - (base * count);
  return values.map((value) => value / 100);
}

export function AdvancesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const user = getStoredUser();
  const isAdmin = isSuperAdmin(user);
  const canCreate = canAccessPermission(user, 'advances.create') || canAccessPermission(user, 'advances.manage');
  const canReview = canAccessPermission(user, 'advances.review') || canAccessPermission(user, 'advances.manage');
  const canApprove = canAccessPermission(user, 'advances.approve');
  const canCycleCreate = canAccessPermission(user, 'advances.cycles.create') || canAccessPermission(user, 'advances.manage');
  const canCycleClose = canAccessPermission(user, 'advances.cycles.close');
  const canLimitLookup = canAccessPermission(user, 'advances.limit_lookup') || canAccessPermission(user, 'advances.manage');
  const canCreateIndividual = canAccessPermission(user, 'advances.create_individual') || canAccessPermission(user, 'advances.manage');
  const canCreateInstallments = canAccessPermission(user, 'advances.installments.create');
  const canConvertInstallments = canAccessPermission(user, 'advances.installments.convert');
  const canReportsView = canAccessPermission(user, 'advances.reports.view') || canAccessPermission(user, 'advances.manage');
  const canDeleteList = canAccessPermission(user, 'advances.lists.delete');

  const [home, setHome] = useState({ open_cycle: null, lists: [] });
  const [cycles, setCycles] = useState([]);
  const [list, setList] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [newListDate, setNewListDate] = useState(today());
  const [line, setLine] = useState(emptyLine);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [limitLookup, setLimitLookup] = useState(emptyLimitLookup);
  const [individual, setIndividual] = useState(emptyIndividual);
  const [individualResult, setIndividualResult] = useState(null);
  const [convertModal, setConvertModal] = useState(emptyConvert);
  const [deleteListModal, setDeleteListModal] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [closeModal, setCloseModal] = useState(false);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const approvalRequest = useRef(0);
  const approvalInFlight = useRef(false);

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
    setReview(null);
    approvalInFlight.current = false;
    setBusy(false);
    Promise.all([loadList(), loadEmployees()]).catch(() => toast.error('Não foi possível abrir a lista.'));
    return () => { approvalRequest.current += 1; };
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
      toast.error(apiErrorMessage(error, 'Não foi possível iniciar o ciclo.'));
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
      toast.error(apiErrorMessage(error, 'Não foi possível fechar o ciclo.'));
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
      toast.error(apiErrorMessage(error, 'Não foi possível criar a lista.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(itemId, values) {
    const payload = values;
    const request = itemId
      ? () => api.put(`/advances/lists/${id}/items/${itemId}`, payload)
      : () => api.post(`/advances/lists/${id}/items`, payload);
    setBusy(true);
    try {
      const response = await request();
      setList(response.data);
      setLine(emptyLine);
      setEditing(null);
      toast.success('Linha confirmada.');
      await loadHome();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível confirmar a linha.'));
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
      toast.error(apiErrorMessage(error, 'Não foi possível remover o funcionário.'));
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
      toast.error(apiErrorMessage(error, 'Não foi possível salvar a lista.'));
    } finally {
      setBusy(false);
    }
  }

  function cancelReview() {
    if (approvalInFlight.current) return;
    approvalRequest.current += 1;
    setReview(null);
    setReviewError('');
  }

  async function approveList(payload = {}) {
    if (approvalInFlight.current) return;
    approvalInFlight.current = true;
    const requestId = ++approvalRequest.current;
    setBusy(true);
    setReviewError('');
    try {
      const response = await api.post(`/advances/lists/${id}/approve`, payload);
      if (requestId !== approvalRequest.current) return;
      if (response.data.requires_review) {
        // Remount for EVERY new server review, so no previous decision survives.
        setReview({ ...response.data, requestId });
        return;
      }
      setReview(null);
      setList(response.data.requires_edit ? response.data.list : response.data);
      if (response.data.requires_edit) toast.error(response.data.message);
      else toast.success('Lista aprovada.');
      await loadHome();
    } catch (error) {
      if (requestId !== approvalRequest.current) return;
      const message = apiErrorMessage(error, 'Não foi possível aprovar a lista.');
      if (error.response?.data?.code === 'LIST_ALREADY_APPROVED') {
        setReview(null);
        await loadList();
      } else setReviewError(message);
      toast.error(message);
    } finally {
      if (requestId === approvalRequest.current) {
        approvalInFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function openSummary(listId) {
    try {
      await downloadAuthenticatedFile(`/advances/lists/${listId}/summary/pdf`, 'resumo-lista-vales.pdf');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível gerar o resumo da lista.'));
    }
  }

  async function deleteList() {
    if (!deleteListModal) return;
    setBusy(true);
    try {
      await api.delete(`/advances/lists/${deleteListModal.id}`);
      setHome((current) => ({
        ...current,
        lists: current.lists.filter((advanceList) => advanceList.id !== deleteListModal.id),
      }));
      setDeleteConfirmation('');
      setDeleteListModal(null);
      toast.success('Lista excluída com sucesso.');
      await loadHome();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível excluir a lista.'));
    } finally {
      setBusy(false);
    }
  }

  async function searchLimits(event) {
    event?.preventDefault();
    const search = limitLookup.search.trim();
    if (search.length < 3) {
      toast.error('Digite ao menos 3 letras.');
      return;
    }
    setLimitLookup((current) => ({ ...current, loading: true, searched: true }));
    try {
      const response = await api.get('/advances/limit-lookup', { params: { search } });
      setLimitLookup((current) => ({ ...current, results: response.data.results || [] }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível consultar o limite.'));
    } finally {
      setLimitLookup((current) => ({ ...current, loading: false }));
    }
  }

  async function searchIndividualEmployees(event) {
    event?.preventDefault();
    const search = individual.search.trim();
    if (search.length < 3) {
      toast.error('Digite ao menos 3 letras.');
      return;
    }
    setIndividual((current) => ({ ...current, loading: true }));
    try {
      const response = await api.get('/advances/limit-lookup', { params: { search } });
      setIndividual((current) => ({ ...current, results: response.data.results || [] }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível buscar funcionários.'));
    } finally {
      setIndividual((current) => ({ ...current, loading: false }));
    }
  }

  async function searchConvertEmployees(event) {
    event?.preventDefault();
    const search = convertModal.search.trim();
    if (search.length < 3) {
      toast.error('Digite ao menos 3 letras.');
      return;
    }
    setConvertModal((current) => ({ ...current, loading: true }));
    try {
      const response = await api.get('/advances/limit-lookup', { params: { search } });
      setConvertModal((current) => ({ ...current, results: response.data.results || [] }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível buscar funcionários.'));
    } finally {
      setConvertModal((current) => ({ ...current, loading: false }));
    }
  }

  async function selectConvertEmployee(employee) {
    setConvertModal((current) => ({ ...current, selectedEmployee: employee, selectedItem: null, eligible: [], loading: true }));
    try {
      const response = await api.get('/advances/installments/eligible', { params: { employee_id: employee.employee_id } });
      setConvertModal((current) => ({ ...current, eligible: response.data.items || [] }));
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível carregar vales elegíveis.'));
    } finally {
      setConvertModal((current) => ({ ...current, loading: false }));
    }
  }

  function openIndividualModal() {
    setIndividual({ ...emptyIndividual, open: true, receipt_at: localDateTimeValue() });
  }

  function openConvertModal() {
    setConvertModal({ ...emptyConvert, open: true });
  }

  async function saveIndividualAdvance(event) {
    event.preventDefault();
    if (!individual.selected) {
      toast.error('Selecione um funcionário.');
      return;
    }
    setIndividual((current) => ({ ...current, loading: true }));
    try {
      const response = await api.post('/advances/individual', {
        employee_id: individual.selected.employee_id,
        amount: individual.amount,
        receipt_at: individual.receipt_at,
        source_bank: individual.source_bank,
        installments_count: individual.installments_enabled ? individual.installments_count : 1,
      });
      setIndividual(emptyIndividual);
      setIndividualResult(response.data.result);
      await refreshAll();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível lançar o vale individual.'));
    } finally {
      setIndividual((current) => ({ ...current, loading: false }));
    }
  }

  async function convertIndividualAdvance(event) {
    event.preventDefault();
    if (!convertModal.selectedEmployee || !convertModal.selectedItem) {
      toast.error('Selecione funcionário e vale elegível.');
      return;
    }
    setConvertModal((current) => ({ ...current, loading: true }));
    try {
      const response = await api.post(`/advances/individual/${convertModal.selectedItem.id}/installments`, {
        installments_count: convertModal.installments_count,
      });
      setConvertModal(emptyConvert);
      setIndividualResult({ ...response.data.result, converted: true });
      await refreshAll();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível parcelar o vale.'));
    } finally {
      setConvertModal((current) => ({ ...current, loading: false }));
    }
  }

  const ownsCurrentList = list && String(list.created_by) === String(user?.id);
  const canEditCurrentList = list && list.cycle_status === 'open' && !['approved', 'cancelled'].includes(list.status)
    && (canReview || (ownsCurrentList && (canCreate || canAccessPermission(user, 'advances.edit_own_list'))));
  const individualInstallmentPreview = individual.installments_enabled
    ? splitPreview(individual.amount, Number(individual.installments_count))
    : [];
  const convertInstallmentPreview = convertModal.selectedItem
    ? splitPreview(convertModal.selectedItem.amount, Number(convertModal.installments_count))
    : [];
  const deleteNeedsStrongWarning = Boolean(deleteListModal && (deleteListModal.status === 'approved' || deleteListModal.cycle_status === 'closed'));
  const deleteNeedsTypedConfirmation = Boolean(deleteListModal?.status === 'approved');
  const canConfirmDeleteList = !deleteNeedsTypedConfirmation || deleteConfirmation.trim().toUpperCase() === 'EXCLUIR';
  const canShowDeleteList = (advanceList) => {
    if (isAdmin) return true;
    return canDeleteList && advanceList.status === 'draft' && advanceList.cycle_status !== 'closed';
  };

  if (id && !list) return <section className="page"><div className="panel">Carregando lista de vales...</div></section>;

  return (
    <section className="page advances-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Vales</h1>
          <p className="advances-page__subtitle">Listas de vales e adiantamentos por ciclo.</p>
        </div>
        <div className="page__actions">
          {canReportsView && <Link className="button" to="/vales/relatorios"><FileText size={18} /><span>Ir para Relatórios de Vales</span></Link>}
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

          <div className="panel advances-page__quick-actions">
            <div>
              <span className="advances-page__eyebrow">Ações rápidas</span>
              <h2>Operação do ciclo atual</h2>
            </div>
            <div className="advances-page__quick-grid">
              {canLimitLookup && <button className="button" type="button" onClick={() => setLimitLookup({ ...emptyLimitLookup, open: true })}><Search size={18} /><span>Consultar limite</span></button>}
              {canCreateIndividual && <button className="button button_primary" type="button" onClick={openIndividualModal}><HandCoins size={18} /><span>Lançar vale individual</span></button>}
              {canConvertInstallments && <button className="button" type="button" onClick={openConvertModal}><Layers size={18} /><span>Parcelar vale existente</span></button>}
              {canCreate && home.open_cycle && (
                <button className="button" type="button" onClick={createList} disabled={busy}><Plus size={18} /><span>Criar lista de vales</span></button>
              )}
            </div>
          </div>

          <div className="advances-page__grid">
            {home.lists.map((advanceList) => (
              <article className="advances-page__card" key={advanceList.id}>
                <div>
                  <span className="advances-page__eyebrow">{advanceList.card_type === 'individual' ? 'Vale individual' : advanceList.card_type === 'installment' ? 'Parcela de vale' : 'Lista de vales'}</span>
                  <h2>{formatDate(advanceList.list_date)}</h2>
                </div>
                {advanceList.card_type === 'individual' || advanceList.card_type === 'installment' ? (
                  <div className="advances-page__card-metrics advances-page__card-metrics_individual">
                    <span><small>Funcionário</small><strong>{advanceList.single_employee_name || 'Funcionário'}</strong></span>
                    <span><small>Valor</small><strong>{formatMoney(advanceList.total_amount)}</strong></span>
                  </div>
                ) : (
                  <div className="advances-page__card-metrics">
                    <span><small>Funcionários</small><strong>{advanceList.employee_count}</strong></span>
                    <span><small>Total</small><strong>{formatMoney(advanceList.total_amount)}</strong></span>
                  </div>
                )}
                <span className={statusClass(advanceList.status)}>{advanceList.status_label}</span>
                {advanceList.created_by_name && <small>Criada por {advanceList.created_by_name}</small>}
                <div className="advances-page__card-actions">
                  <Link className="button" to={`/vales/${advanceList.id}`}><span>Abrir lista</span></Link>
                  <button className="button" type="button" onClick={() => openSummary(advanceList.id)}><FileText size={16} /><span>Visualizar resumo</span></button>
                  {canShowDeleteList(advanceList) && (
                    <button className="button button_danger" type="button" onClick={() => { setDeleteConfirmation(''); setDeleteListModal(advanceList); }}><Trash2 size={16} /><span>Excluir lista</span></button>
                  )}
                </div>
              </article>
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
            <div className="advances-page__metric"><span className="field__label">Status</span><strong className={statusClass(list.status)}>{list.status_label}</strong></div>
            <div className="advances-page__metric"><span className="field__label">Funcionários</span><strong>{list.employee_count}</strong></div>
            <div className="advances-page__metric"><span className="field__label">Total</span><strong>{formatMoney(list.total_amount)}</strong></div>
          </div>

          <div className="panel advances-page__items">
            <div className="advances-page__items-header">
              <h2>Lançamentos</h2>
              <span>{list.items.length} linhas confirmadas</span>
            </div>

            {list.items.map((item) => (
              <div className={`advances-page__line ${item.limit_review_rejected_at ? 'advances-page__line_rejected' : ''}`} key={item.id}>
                {editing?.id === item.id ? (
                  <>
                    <select className="field__input" value={editing.employee_id} onChange={(event) => setEditing({ ...editing, employee_id: event.target.value })}>
                      <option value={item.employee_id}>{item.employee_name}</option>
                      {employeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                    </select>
                    <input className="field__input" type="number" min="0.01" step="0.01" value={editing.amount} onChange={(event) => setEditing({ ...editing, amount: event.target.value })} />
                    <button className="button button_primary advances-page__confirm-button" title="Confirmar linha" type="button" onClick={() => saveItem(item.id, editing)} disabled={busy}><Check size={18} /><span>Confirmar</span></button>
                  </>
                ) : (
                  <>
                    <div><strong>{item.employee_name}</strong><span>{item.limit_review_rejected_at ? 'REJEITADA · Autorização negada. Edite ou remova esta linha.' : item.override_used ? 'Limite ultrapassado por autorização' : item.threshold_warning_confirmed ? 'Confirmação acima de 40%' : 'Confirmado'}</span></div>
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
                <button className="button button_primary advances-page__confirm-button" title="Confirmar linha" type="button" onClick={() => saveItem(null, line)} disabled={busy}><Check size={18} /><span>Confirmar linha</span></button>
              </div>
            )}
          </div>

          <div className="page__actions advances-page__footer-actions">
            {canEditCurrentList && <button className="button button_primary" type="button" onClick={submitList} disabled={busy}><Save size={18} /><span>Salvar lista</span></button>}
            {canApprove && list.status === 'pending_approval' && <button className="button button_primary" type="button" onClick={() => approveList()} disabled={busy || Boolean(editing || line.employee_id || line.amount)} title={editing || line.employee_id || line.amount ? 'Confirme a linha em edição antes de aprovar' : 'Validar e aprovar a lista'}><Check size={18} /><span>Aprovar lista</span></button>}
          </div>
        </>
      )}

      {limitLookup.open && (
        <div className="advances-page__modal" role="dialog" aria-modal="true">
          <div className="advances-page__modal-content">
            <div className="advances-page__modal-header">
              <h2>Consultar limite</h2>
              <button className="button advances-page__icon-button" type="button" onClick={() => setLimitLookup(emptyLimitLookup)}><XCircle size={18} /></button>
            </div>
            <form className="advances-page__search-form" onSubmit={searchLimits}>
              <label className="field">
                <span className="field__label">Buscar por nome</span>
                <input className="field__input" value={limitLookup.search} onChange={(event) => setLimitLookup((current) => ({ ...current, search: event.target.value }))} placeholder="Digite ao menos 3 letras" autoFocus />
              </label>
              <button className="button button_primary" type="submit" disabled={limitLookup.loading}><Search size={18} /><span>Buscar</span></button>
            </form>

            <div className="advances-page__lookup-table">
              <table>
                <thead>
                  <tr><th>Funcionário</th><th>Valor utilizado</th><th>Valor restante</th></tr>
                </thead>
                <tbody>
                  {limitLookup.results.map((result) => (
                    <tr key={result.employee_id}>
                      <td>{result.employee_name}</td>
                      <td>{formatMoney(result.used_amount)}</td>
                      <td>{formatMoney(result.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="advances-page__lookup-cards">
              {limitLookup.results.map((result) => (
                <article className={resultLevelClass(result.status_level)} key={result.employee_id}>
                  <h3>{result.employee_name}</h3>
                  <dl>
                    <div><dt>Valor utilizado</dt><dd>{formatMoney(result.used_amount)}</dd></div>
                    <div><dt>Valor restante</dt><dd>{formatMoney(result.remaining)}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
            {limitLookup.searched && !limitLookup.loading && !limitLookup.results.length && <p>Nenhum funcionário encontrado.</p>}
          </div>
        </div>
      )}

      {individual.open && (
        <div className="advances-page__modal" role="dialog" aria-modal="true">
          <form className="advances-page__modal-content" onSubmit={saveIndividualAdvance}>
            <div className="advances-page__modal-header">
              <h2>Lançar vale individual</h2>
              <button className="button advances-page__icon-button" type="button" onClick={() => setIndividual(emptyIndividual)}><XCircle size={18} /></button>
            </div>

            {!individual.selected ? (
              <>
                <div className="advances-page__search-form">
                  <label className="field">
                    <span className="field__label">Buscar funcionário</span>
                    <input className="field__input" value={individual.search} onChange={(event) => setIndividual((current) => ({ ...current, search: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') searchIndividualEmployees(event); }} placeholder="Digite ao menos 3 letras" autoFocus />
                  </label>
                  <button className="button button_primary" type="button" onClick={searchIndividualEmployees} disabled={individual.loading}><Search size={18} /><span>Buscar</span></button>
                </div>
                <div className="advances-page__results-list">
                  {individual.results.map((result) => (
                    <button className="advances-page__employee-result" type="button" key={result.employee_id} onClick={() => setIndividual((current) => ({ ...current, selected: result }))}>
                      <strong>{result.employee_name}</strong>
                      <span>Utilizado: {formatMoney(result.used_amount)} · Restante: {formatMoney(result.remaining)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="advances-page__selected-employee">
                <div>
                  <span className="field__label">Funcionário selecionado</span>
                  <strong>{individual.selected.employee_name}</strong>
                </div>
                <button className="button" type="button" onClick={() => setIndividual((current) => ({ ...current, selected: null }))}>Trocar</button>
              </div>
            )}

            <div className="advances-page__modal-grid">
              <label className="field">
                <span className="field__label">Valor</span>
                <input className="field__input" type="number" min="0.01" step="0.01" value={individual.amount} onChange={(event) => setIndividual((current) => ({ ...current, amount: event.target.value }))} required />
              </label>
              <label className="field">
                <span className="field__label">Data/hora do comprovante</span>
                <input className="field__input" type="datetime-local" value={individual.receipt_at} onChange={(event) => setIndividual((current) => ({ ...current, receipt_at: event.target.value }))} required />
              </label>
              <label className="field">
                <span className="field__label">Banco de origem</span>
                <select className="field__input" value={individual.source_bank} onChange={(event) => setIndividual((current) => ({ ...current, source_bank: event.target.value }))}>
                  <option value="">Não informado</option>
                  {banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                </select>
              </label>
            </div>

            {canCreateInstallments && (
              <label className="advances-page__checkbox">
                <input type="checkbox" checked={individual.installments_enabled} onChange={(event) => setIndividual((current) => ({ ...current, installments_enabled: event.target.checked }))} />
                <span>Vale parcelado</span>
              </label>
            )}

            {canCreateInstallments && individual.installments_enabled && (
              <div className="advances-page__installment-preview">
                <label className="field">
                  <span className="field__label">Quantidade de parcelas</span>
                  <select className="field__input" value={individual.installments_count} onChange={(event) => setIndividual((current) => ({ ...current, installments_count: Number(event.target.value) }))}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => <option key={count} value={count}>{count} vez{count > 1 ? 'es' : ''}</option>)}
                  </select>
                </label>
                <dl className="advances-page__facts">
                  <div><dt>Valor total</dt><dd>{formatMoney(individual.amount || 0)}</dd></div>
                  <div><dt>Valor aproximado por parcela</dt><dd>{formatMoney(individualInstallmentPreview[0] || 0)}</dd></div>
                  <div><dt>Valor da primeira parcela</dt><dd>{formatMoney(individualInstallmentPreview[0] || 0)}</dd></div>
                  <div><dt>Parcelas futuras</dt><dd>{Math.max(0, Number(individual.installments_count) - 1)}</dd></div>
                </dl>
              </div>
            )}

            <div className="advances-page__modal-actions">
              <button className="button" type="button" onClick={() => setIndividual(emptyIndividual)}>Cancelar</button>
              <button className="button button_primary" type="submit" disabled={individual.loading || !individual.selected}>{individual.loading ? 'Salvando...' : 'Salvar vale'}</button>
            </div>
          </form>
        </div>
      )}

      {convertModal.open && (
        <div className="advances-page__modal" role="dialog" aria-modal="true">
          <form className="advances-page__modal-content" onSubmit={convertIndividualAdvance}>
            <div className="advances-page__modal-header">
              <h2>Parcelar vale existente</h2>
              <button className="button advances-page__icon-button" type="button" onClick={() => setConvertModal(emptyConvert)}><XCircle size={18} /></button>
            </div>

            {!convertModal.selectedEmployee ? (
              <>
                <div className="advances-page__search-form">
                  <label className="field">
                    <span className="field__label">Buscar funcionário</span>
                    <input className="field__input" value={convertModal.search} onChange={(event) => setConvertModal((current) => ({ ...current, search: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') searchConvertEmployees(event); }} placeholder="Digite ao menos 3 letras" autoFocus />
                  </label>
                  <button className="button button_primary" type="button" onClick={searchConvertEmployees} disabled={convertModal.loading}><Search size={18} /><span>Buscar</span></button>
                </div>
                <div className="advances-page__results-list">
                  {convertModal.results.map((result) => (
                    <button className="advances-page__employee-result" type="button" key={result.employee_id} onClick={() => selectConvertEmployee(result)}>
                      <strong>{result.employee_name}</strong>
                      <span>Utilizado: {formatMoney(result.used_amount)} · Restante: {formatMoney(result.remaining)}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="advances-page__selected-employee">
                <div>
                  <span className="field__label">Funcionário selecionado</span>
                  <strong>{convertModal.selectedEmployee.employee_name}</strong>
                </div>
                <button className="button" type="button" onClick={() => setConvertModal((current) => ({ ...current, selectedEmployee: null, selectedItem: null, eligible: [] }))}>Trocar</button>
              </div>
            )}

            {convertModal.selectedEmployee && (
              <>
                <div className="advances-page__results-list">
                  {convertModal.eligible.map((item) => (
                    <button className={`advances-page__employee-result advances-page__eligible-advance ${convertModal.selectedItem?.id === item.id ? 'advances-page__employee-result_selected' : ''}`} type="button" key={item.id} onClick={() => setConvertModal((current) => ({ ...current, selectedItem: item }))}>
                      <strong>{formatMoney(item.amount)}</strong>
                      <dl>
                        <div><dt>Data</dt><dd>{formatDate(item.list_date || item.receipt_at)}</dd></div>
                        <div><dt>Banco</dt><dd>{item.source_bank || 'Não informado'}</dd></div>
                        <div><dt>Situação</dt><dd>{item.status || 'active'}</dd></div>
                        <div><dt>Ciclo</dt><dd>{item.cycle_status === 'open' ? 'Atual aberto' : item.cycle_status || '-'}</dd></div>
                      </dl>
                    </button>
                  ))}
                  {!convertModal.loading && !convertModal.eligible.length && <p>Nenhum vale individual elegível encontrado no ciclo aberto.</p>}
                </div>

                <div className="advances-page__installment-preview">
                  <label className="field">
                    <span className="field__label">Quantidade de parcelas</span>
                    <select className="field__input" value={convertModal.installments_count} onChange={(event) => setConvertModal((current) => ({ ...current, installments_count: Number(event.target.value) }))}>
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => <option key={count} value={count}>{count} vezes</option>)}
                    </select>
                  </label>
                  <dl className="advances-page__facts">
                    <div><dt>Valor original</dt><dd>{formatMoney(convertModal.selectedItem?.amount || 0)}</dd></div>
                    <div><dt>Valor da primeira parcela</dt><dd>{formatMoney(convertInstallmentPreview[0] || 0)}</dd></div>
                    <div><dt>Parcelas futuras</dt><dd>{Math.max(0, Number(convertModal.installments_count) - 1)}</dd></div>
                  </dl>
                </div>
              </>
            )}

            <div className="advances-page__modal-actions">
              <button className="button" type="button" onClick={() => setConvertModal(emptyConvert)}>Cancelar</button>
              <button className="button button_primary" type="submit" disabled={convertModal.loading || !convertModal.selectedItem}>Confirmar parcelamento</button>
            </div>
          </form>
        </div>
      )}

      {individualResult && (
        <div className="advances-page__modal" role="dialog" aria-modal="true">
          <div className="advances-page__modal-content">
            <div className="advances-page__modal-header">
              <h2>Vale lançado</h2>
              <button className="button advances-page__icon-button" type="button" onClick={() => setIndividualResult(null)}><XCircle size={18} /></button>
            </div>
            <article className={resultLevelClass(individualResult.status_level)}>
              <h3>{individualResult.employee_name}</h3>
              <dl>
                {individualResult.converted && <div><dt>Status</dt><dd>Vale parcelado</dd></div>}
                {individualResult.installment ? (
                  <>
                    <div><dt>Valor total do vale</dt><dd>{formatMoney(individualResult.installment.original_amount)}</dd></div>
                    <div><dt>Parcelamento</dt><dd>{individualResult.installment.current_installment_number} de {individualResult.installment.installments_count}</dd></div>
                    <div><dt>Valor lançado neste ciclo</dt><dd>{formatMoney(individualResult.posted_amount)}</dd></div>
                    <div><dt>Parcelas restantes</dt><dd>{individualResult.installment.remaining_installments}</dd></div>
                  </>
                ) : (
                  <div><dt>Valor lançado</dt><dd>{formatMoney(individualResult.amount)}</dd></div>
                )}
                <div><dt>Total utilizado no ciclo</dt><dd>{formatMoney(individualResult.total_used)}</dd></div>
                <div><dt>Valor restante</dt><dd>{formatMoney(individualResult.remaining)}</dd></div>
                <div><dt>Percentual utilizado</dt><dd><Percent value={individualResult.used_percentage} /></dd></div>
                {individualResult.exceeded && <div><dt>Status</dt><dd>Limite ultrapassado</dd></div>}
              </dl>
            </article>
            <div className="advances-page__modal-actions">
              <button className="button button_primary" type="button" onClick={() => setIndividualResult(null)}>Entendi</button>
            </div>
          </div>
        </div>
      )}

      {review && <AdvanceLimitReview key={review.requestId} review={review} busy={busy} error={reviewError}
        onCancel={cancelReview} onConfirm={approveList} />}

      <ConfirmModal
        open={Boolean(deleteListModal)}
        title="Excluir lista de vales?"
        onCancel={() => { setDeleteConfirmation(''); setDeleteListModal(null); }}
        cancelLabel="Cancelar"
        actions={<button className="button button_danger" type="button" onClick={deleteList} disabled={busy || !canConfirmDeleteList}>Excluir lista</button>}
      >
        <p>{deleteNeedsStrongWarning ? 'Esta lista já foi aprovada ou pertence a um ciclo fechado. A exclusão será registrada na auditoria.' : 'Excluir esta lista de vales?'}</p>
        <p>A lista deixará de aparecer nos relatórios e telas operacionais, sem excluir o ciclo ou apagar o histórico de auditoria.</p>
        <dl className="advances-page__facts">
          <div><dt>Data da lista</dt><dd>{formatDate(deleteListModal?.list_date)}</dd></div>
          <div><dt>Funcionários</dt><dd>{deleteListModal?.employee_count || 0}</dd></div>
          <div><dt>Valor total</dt><dd>{formatMoney(deleteListModal?.total_amount || 0)}</dd></div>
          <div><dt>Criador</dt><dd>{deleteListModal?.created_by_name || '-'}</dd></div>
          <div><dt>Status</dt><dd>{deleteListModal?.status_label || '-'}</dd></div>
          <div><dt>Ciclo</dt><dd>{deleteListModal?.cycle_status === 'closed' ? 'Fechado' : deleteListModal?.cycle_status === 'open' ? 'Aberto' : '-'}</dd></div>
        </dl>
        {deleteNeedsTypedConfirmation && (
          <label className="field">
            <span className="field__label">Digite EXCLUIR para confirmar</span>
            <input className="field__input" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
          </label>
        )}
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
