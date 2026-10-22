import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus, Search, SlidersHorizontal, Zap } from 'lucide-react';
import { DataTable } from '../../components/DataTable/DataTable.jsx';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { downloadAuthenticatedFile } from '../../utils/downloadAuthenticatedFile.js';
import { formatCpfPartial, formatDate, statusLabels } from './employeeUtils.js';
import { PendingReportModal } from './PendingReportModal.jsx';
import './EmployeesPage.css';

export function EmployeesPage() {
  const toast = useToast();
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'employees.create');
  const canEdit = canAccessPermission(user, 'employees.edit') || canAccessPermission(user, 'employees.manage');
  const canPrint = canAccessPermission(user, 'employees.profile.print');
  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [jobTitles, setJobTitles] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [showDates, setShowDates] = useState(false);
  const [exporting, setExporting] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingReportModalOpen, setPendingReportModalOpen] = useState(false);
  const [pendingReportEmployees, setPendingReportEmployees] = useState([]);
  const [loadingPendingReport, setLoadingPendingReport] = useState(false);
  const [downloadingPendingReport, setDownloadingPendingReport] = useState(false);
  const [filters, setFilters] = useState({ search: '', cpf: '', status: '', job_title: '', sector_id: '', admission_from: '', admission_to: '' });
  const [applied, setApplied] = useState(filters);

  async function load(nextFilters = applied, nextPage = page) {
    setLoading(true);
    try {
      const response = await api.get('/employees', { params: { ...nextFilters, page: nextPage, page_size: 20 } });
      setEmployees(response.data.rows);
      setTotal(response.data.total);
      setJobTitles(response.data.job_titles);
      setSectors(response.data.sectors);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível carregar funcionários.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(filters, 1);
  }, []);

  function changeFilter(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function submitFilters(event) {
    event.preventDefault();
    if (filters.admission_from && filters.admission_to && filters.admission_from > filters.admission_to) {
      toast.error('A data inicial não pode ser posterior à data final.');
      return;
    }
    setApplied({ ...filters });
    setPage(1);
    load(filters, 1);
  }

  function clearFilters() {
    const empty = Object.fromEntries(Object.keys(filters).map((key) => [key, '']));
    setFilters(empty);
    setApplied(empty);
    setPage(1);
    load(empty, 1);
  }

  function changePage(nextPage) {
    setPage(nextPage);
    load(applied, nextPage);
  }

  async function exportReport(kind) {
    setExporting(kind);
    try {
      await downloadAuthenticatedFile(`/employees/report-${kind}`, `relatorio-funcionarios.${kind === 'pdf' ? 'pdf' : 'xlsx'}`, { params: applied });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível gerar o relatório.');
    } finally { setExporting(''); }
  }

  async function openPendingReport() {
    setPendingReportModalOpen(true);
    setLoadingPendingReport(true);
    try {
      const response = await api.get('/employees/incomplete-report');
      setPendingReportEmployees(response.data);
    } catch (error) {
      setPendingReportModalOpen(false);
      toast.error(error.response?.data?.message || 'Não foi possível carregar as pendências cadastrais.');
    } finally {
      setLoadingPendingReport(false);
    }
  }

  async function downloadPendingReport(pendingTypes) {
    setDownloadingPendingReport(true);
    try {
      await downloadAuthenticatedFile('/employees/incomplete-report-pdf', 'pendencias-cadastrais-funcionarios.pdf', {
        method: 'post',
        data: { pending_types: pendingTypes },
      });
      setPendingReportModalOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível gerar o relatório de pendências cadastrais.');
    } finally {
      setDownloadingPendingReport(false);
    }
  }

  const columns = [
    {
      key: 'full_name',
      label: 'Nome',
      render: (row) => (
        <div className="employees-page__name">
          <Link to={`/funcionarios/${row.id}`}>{row.full_name}</Link>
          {!row.profile_completed && <span className="employees-page__badge">Ficha incompleta</span>}
        </div>
      ),
    },
    { key: 'cpf', label: 'CPF', render: (row) => formatCpfPartial(row.cpf) },
    { key: 'job_title', label: 'Cargo', render: (row) => row.job_title || '-' },
    { key: 'sector_name', label: 'Setor', render: (row) => `${row.sector_name || 'Não informado'}${row.sector_is_active === false ? ' — inativo' : ''}` },
    { key: 'employment_status', label: 'Status', render: (row) => <span className={`employees-page__status employees-page__status_${row.employment_status}`}>{statusLabels[row.employment_status] || row.employment_status}</span> },
    { key: 'admission_date', label: 'Admissão', render: (row) => formatDate(row.admission_date) },
    {
      key: 'actions',
      label: 'Ações',
      render: (row) => (
        <div className="employees-page__actions">
          <Link className="button" to={`/funcionarios/${row.id}`}>{canEdit ? 'Abrir / editar' : 'Ver'}</Link>
        </div>
      ),
    },
  ];

  return (
    <section className="page employees-page">
      <div className="page__header">
        <h1 className="page__title">Funcionários</h1>
        <div className="page__actions">
          {canPrint && (
            <button className="button" type="button" onClick={openPendingReport} disabled={loadingPendingReport || downloadingPendingReport}>
              <Download size={18} />
              <span>{loadingPendingReport ? 'Carregando...' : 'Relatório geral de pendências'}</span>
            </button>
          )}
          {canCreate && (
            <Link className="button button_primary" to="/funcionarios/novo">
              <Plus size={18} />
              <span>Novo funcionário</span>
            </Link>
          )}
          {canCreate && (
            <Link className="button" to="/funcionarios/cadastro-rapido">
              <Zap size={18} />
              <span>Cadastro rápido</span>
            </Link>
          )}
        </div>
      </div>

      <form className="panel employees-page__filters" onSubmit={submitFilters}>
        <label className="field">
          <span className="field__label">Buscar por nome</span>
          <input className="field__input" name="search" type="search" value={filters.search} onChange={changeFilter} />
        </label>
        <label className="field">
          <span className="field__label">Buscar por CPF</span>
          <input className="field__input" name="cpf" value={filters.cpf} onChange={changeFilter} />
        </label>
        <label className="field">
          <span className="field__label">Status</span>
          <select className="field__input" name="status" value={filters.status} onChange={changeFilter}>
            <option value="">Todos</option>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Cargo</span>
          <select className="field__input" name="job_title" value={filters.job_title} onChange={changeFilter}>
            <option value="">Todos</option>
            {jobTitles.map((jobTitle) => <option key={jobTitle} value={jobTitle}>{jobTitle}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Setor</span>
          <select className="field__input" name="sector_id" value={filters.sector_id} onChange={changeFilter}>
            <option value="">Todos</option>
            {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}{!sector.is_active ? ' — inativo' : ''}</option>)}
          </select>
        </label>
        <button className="button" type="button" aria-expanded={showDates} onClick={() => setShowDates((current) => !current)}><SlidersHorizontal size={16} /> Filtros</button>
        {showDates && <div className="employees-page__date-filters">
          <label className="field"><span className="field__label">Data de admissão — De</span><input className="field__input" type="date" name="admission_from" value={filters.admission_from} onChange={changeFilter} /></label>
          <label className="field"><span className="field__label">Data de admissão — Até</span><input className="field__input" type="date" name="admission_to" value={filters.admission_to} onChange={changeFilter} min={filters.admission_from || undefined} /></label>
        </div>}
        <button className="button button_primary employees-page__filter-button" type="submit">
          <Search size={18} />
          <span>Aplicar filtros</span>
        </button>
        <button className="button" type="button" onClick={clearFilters}>Limpar filtros</button>
      </form>

      <div className="employees-page__report-actions">
        <strong>{total} funcionário(s) encontrado(s)</strong>
        {canPrint && <div className="employees-page__actions">
          <button className="button" type="button" disabled={Boolean(exporting)} onClick={() => exportReport('pdf')}>Gerar PDF</button>
          <button className="button" type="button" disabled={Boolean(exporting)} onClick={() => exportReport('excel')}>Exportar Excel</button>
        </div>}
      </div>

      <div className="panel">
        {loading ? <p>Carregando funcionários...</p> : <DataTable columns={columns} rows={employees} emptyText="Nenhum funcionário encontrado." />}
      </div>
      {total > 20 && <nav className="employees-page__pagination" aria-label="Paginação de funcionários">
        <button className="button" disabled={loading || page === 1} onClick={() => changePage(page - 1)}>Anterior</button>
        <span>Página {page} de {Math.ceil(total / 20)}</span>
        <button className="button" disabled={loading || page >= Math.ceil(total / 20)} onClick={() => changePage(page + 1)}>Próxima</button>
      </nav>}

      <PendingReportModal
        open={pendingReportModalOpen}
        title="Relatório geral de pendências"
        employees={pendingReportEmployees}
        loading={loadingPendingReport}
        generating={downloadingPendingReport}
        onCancel={() => setPendingReportModalOpen(false)}
        onGenerate={downloadPendingReport}
      />
    </section>
  );
}
