import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { downloadAuthenticatedFile } from '../../utils/downloadAuthenticatedFile.js';
import { canAccessPermission } from '../../utils/permissions.js';
import './AwardsPage.css';

const emptyFilters = { search: '', sector: '', from: '', to: '' };

function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyForm() {
  return { employee_id: '', amount: '', award_date: localToday(), performance_description: '' };
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : '-';
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
}

function moneyInputFromValue(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '';
}

function maskMoneyInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 12);
  if (!digits) return '';
  return `R$ ${(Number(digits) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function apiErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function summary(text, length = 90) {
  const value = String(text || '');
  return value.length > length ? `${value.slice(0, length).trim()}…` : value;
}

export function AwardsPage() {
  const toast = useToast();
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'awards.create');
  const canEdit = canAccessPermission(user, 'awards.edit');
  const canDelete = canAccessPermission(user, 'awards.delete');
  const canPdf = canAccessPermission(user, 'awards.pdf');
  const [awards, setAwards] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  async function loadAwards(nextFilters = filters) {
    setLoading(true);
    try {
      const response = await api.get('/awards', { params: nextFilters });
      setAwards(response.data || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível carregar os prêmios.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAwards(emptyFilters);
  }, []);

  const sectorOptions = useMemo(
    () => [...new Set(awards.map((award) => award.sector_name_snapshot).filter(Boolean))].sort(),
    [awards],
  );

  async function searchEmployees(event, initial = false) {
    event?.preventDefault();
    const search = employeeSearch.trim();
    if (!initial && search.length > 0 && search.length < 2) {
      toast.warning('Digite ao menos 2 letras para pesquisar.');
      return;
    }
    setEmployeesLoading(true);
    try {
      const response = await api.get('/awards/employees', { params: { search } });
      setEmployees(response.data || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível buscar funcionários.'));
    } finally {
      setEmployeesLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setEmployees([]);
    setFormOpen(true);
    window.setTimeout(() => searchEmployees(null, true), 0);
  }

  function openEdit(award) {
    setEditing(award);
    setForm({
      employee_id: award.employee_id,
      amount: moneyInputFromValue(award.amount),
      award_date: String(award.award_date).slice(0, 10),
      performance_description: award.performance_description,
    });
    setSelectedEmployee({
      id: award.employee_id,
      full_name: award.employee_name_snapshot,
      job_title: award.job_title_snapshot,
      sector_name: award.sector_name_snapshot,
    });
    setEmployeeSearch('');
    setEmployees([]);
    setFormOpen(true);
  }

  function selectEmployee(employee) {
    setSelectedEmployee(employee);
    setForm((current) => ({ ...current, employee_id: employee.id }));
    setEmployees([]);
    setEmployeeSearch('');
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
  }

  async function downloadTerm(award) {
    setDownloadingId(award.id);
    try {
      await downloadAuthenticatedFile(`/awards/${award.id}/pdf`, `termo-premio-${award.employee_name_snapshot}.pdf`);
      toast.success('Termo de prêmio baixado.');
    } catch {
      toast.error('Não foi possível baixar o termo de prêmio.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function saveAward(downloadAfter = false) {
    if (!form.employee_id) {
      toast.error('Selecione um funcionário.');
      return;
    }
    if (!form.amount) {
      toast.error('Informe o valor do prêmio.');
      return;
    }
    if (!form.award_date) {
      toast.error('Informe a data do prêmio.');
      return;
    }
    if (form.performance_description.trim().length < 10) {
      toast.error('Descreva o desempenho com pelo menos 10 caracteres.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, performance_description: form.performance_description.trim() };
      const response = editing
        ? await api.put(`/awards/${editing.id}`, payload)
        : await api.post('/awards', payload);
      const saved = response.data;
      toast.success(editing ? 'Prêmio atualizado.' : 'Prêmio registrado.');
      setFormOpen(false);
      setEditing(null);
      await loadAwards();
      if (downloadAfter) await downloadTerm(saved);
      else setDetail(saved);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível salvar o prêmio.'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await api.delete(`/awards/${pendingDelete.id}`);
      toast.success('Prêmio excluído do histórico ativo.');
      setPendingDelete(null);
      await loadAwards();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Não foi possível excluir o prêmio.'));
    }
  }

  function submitFilters(event) {
    event.preventDefault();
    loadAwards();
  }

  function clearFilters() {
    setFilters(emptyFilters);
    loadAwards(emptyFilters);
  }

  const columns = [
    { key: 'employee', label: 'Funcionário', render: (row) => <strong>{row.employee_name_snapshot}</strong> },
    { key: 'sector', label: 'Setor', render: (row) => row.sector_name_snapshot || 'Não informado' },
    { key: 'amount', label: 'Valor', render: (row) => formatMoney(row.amount) },
    { key: 'award_date', label: 'Data', render: (row) => formatDate(row.award_date) },
    { key: 'description', label: 'Desempenho', render: (row) => <span title={row.performance_description}>{summary(row.performance_description)}</span> },
    { key: 'created_by', label: 'Cadastrado por', render: (row) => row.created_by_name || '-' },
    {
      key: 'actions',
      label: 'Ações',
      render: (row) => (
        <div className="awards-page__row-actions">
          <button className="button" type="button" onClick={() => setDetail(row)} title="Visualizar"><Eye size={16} /></button>
          {canEdit && <button className="button" type="button" onClick={() => openEdit(row)} title="Editar"><Pencil size={16} /></button>}
          {canPdf && <button className="button" type="button" onClick={() => downloadTerm(row)} disabled={downloadingId === row.id} title="Baixar termo"><Download size={16} /></button>}
          {canDelete && <button className="button button_danger" type="button" onClick={() => setPendingDelete(row)} title="Excluir"><Trash2 size={16} /></button>}
        </div>
      ),
    },
  ];

  return (
    <section className="page awards-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Prêmios</h1>
          <p className="awards-page__subtitle">Registre reconhecimentos por desempenho especial e gere o termo para assinatura.</p>
        </div>
        {canCreate && <button className="button button_primary" type="button" onClick={openCreate}><Plus size={18} /><span>Novo prêmio</span></button>}
      </div>

      <form className="panel awards-page__filters" onSubmit={submitFilters}>
        <label className="field"><span className="field__label">Busca</span><input className="field__input" type="search" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Funcionário ou desempenho" /></label>
        <label className="field"><span className="field__label">Setor</span><select className="field__input" value={filters.sector} onChange={(event) => setFilters((current) => ({ ...current, sector: event.target.value }))}><option value="">Todos</option>{sectorOptions.map((sector) => <option key={sector} value={sector}>{sector}</option>)}</select></label>
        <label className="field"><span className="field__label">De</span><input className="field__input" type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
        <label className="field"><span className="field__label">Até</span><input className="field__input" type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
        <div className="awards-page__filter-actions"><button className="button button_primary" type="submit"><Search size={17} />Filtrar</button><button className="button" type="button" onClick={clearFilters}>Limpar</button></div>
      </form>

      <div className="panel">
        {loading ? <p>Carregando prêmios...</p> : <DataTable columns={columns} rows={awards} emptyText="Nenhum prêmio encontrado." />}
      </div>

      <ConfirmModal
        open={formOpen}
        title={editing ? 'Editar prêmio' : 'Novo prêmio'}
        onCancel={closeForm}
        actions={(
          <>
            <button className="button button_primary" type="button" disabled={saving} onClick={() => saveAward(false)}>{saving ? 'Salvando...' : 'Salvar'}</button>
            {canPdf && <button className="button" type="button" disabled={saving} onClick={() => saveAward(true)}>Salvar e baixar termo</button>}
          </>
        )}
      >
        <div className="awards-page__form">
          <div className="awards-page__employee-picker">
            <span className="field__label">Funcionário *</span>
            {selectedEmployee ? (
              <div className="awards-page__selected-employee"><div><strong>{selectedEmployee.full_name}</strong><span>Cargo: {selectedEmployee.job_title || 'Não informado'}</span><span>Setor: {selectedEmployee.sector_name || 'Não informado'}</span></div><button className="button" type="button" onClick={() => { setSelectedEmployee(null); setForm((current) => ({ ...current, employee_id: '' })); searchEmployees(null, true); }}>Trocar</button></div>
            ) : (
              <>
                <form className="awards-page__employee-search" onSubmit={searchEmployees}><input className="field__input" type="search" value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Pesquisar funcionário ativo" /><button className="button" type="submit" disabled={employeesLoading}><Search size={17} />Buscar</button></form>
                <div className="awards-page__employee-results">
                  {employeesLoading && <span>Buscando...</span>}
                  {!employeesLoading && employees.map((employee) => <button type="button" key={employee.id} onClick={() => selectEmployee(employee)}><strong>{employee.full_name}</strong><span>{employee.job_title || 'Cargo não informado'} · {employee.sector_name || 'Setor não informado'}</span></button>)}
                  {!employeesLoading && !employees.length && <span>Nenhum funcionário ativo encontrado.</span>}
                </div>
              </>
            )}
          </div>
          <div className="awards-page__form-grid">
            <label className="field"><span className="field__label">Valor *</span><input className="field__input" inputMode="numeric" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: maskMoneyInput(event.target.value) }))} placeholder="R$ 0,00" /></label>
            <label className="field"><span className="field__label">Data do prêmio *</span><input className="field__input" type="date" value={form.award_date} onChange={(event) => setForm((current) => ({ ...current, award_date: event.target.value }))} /></label>
          </div>
          <label className="field"><span className="field__label">Descrição do desempenho *</span><textarea className="field__input awards-page__description" value={form.performance_description} maxLength={10000} onChange={(event) => setForm((current) => ({ ...current, performance_description: event.target.value }))} placeholder="Descreva de forma clara o desempenho especial que motivou o prêmio." /><small>{form.performance_description.trim().length}/10000 caracteres</small></label>
        </div>
      </ConfirmModal>

      <ConfirmModal open={Boolean(detail)} title="Detalhes do prêmio" onCancel={() => setDetail(null)} showCancel={false} actions={<>{canPdf && <button className="button button_primary" type="button" onClick={() => downloadTerm(detail)} disabled={downloadingId === detail?.id}><Download size={17} />Baixar termo</button>}<button className="button" type="button" onClick={() => setDetail(null)}>Fechar</button></>}>
        {detail && <div className="awards-page__detail"><div><span>Funcionário</span><strong>{detail.employee_name_snapshot}</strong></div><div><span>Cargo</span><strong>{detail.job_title_snapshot || 'Não informado'}</strong></div><div><span>Setor</span><strong>{detail.sector_name_snapshot || 'Não informado'}</strong></div><div><span>Valor</span><strong>{formatMoney(detail.amount)}</strong></div><div><span>Data</span><strong>{formatDate(detail.award_date)}</strong></div><div><span>Cadastrado por</span><strong>{detail.created_by_name || '-'}</strong></div><article><span>Descrição do desempenho</span><p>{detail.performance_description}</p></article></div>}
      </ConfirmModal>

      <ConfirmModal open={Boolean(pendingDelete)} title="Excluir prêmio" onCancel={() => setPendingDelete(null)} actions={<button className="button button_danger" type="button" onClick={confirmDelete}>Confirmar exclusão</button>}>
        <p>O prêmio de <strong>{pendingDelete?.employee_name_snapshot}</strong> será removido da listagem, mantendo o histórico físico e a auditoria.</p>
      </ConfirmModal>
    </section>
  );
}
