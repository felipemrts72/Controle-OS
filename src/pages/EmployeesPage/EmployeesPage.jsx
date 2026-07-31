import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus, Search, Zap } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [pendingReportModalOpen, setPendingReportModalOpen] = useState(false);
  const [pendingReportEmployees, setPendingReportEmployees] = useState([]);
  const [loadingPendingReport, setLoadingPendingReport] = useState(false);
  const [downloadingPendingReport, setDownloadingPendingReport] = useState(false);
  const [filters, setFilters] = useState({ search: '', cpf: '', status: '', job_title: '', sector_id: '' });

  async function load() {
    setLoading(true);
    try {
      const response = await api.get('/employees', { params: filters });
      setEmployees(response.data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível carregar funcionários.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const jobTitles = useMemo(() => [...new Set(employees.map((employee) => employee.job_title).filter(Boolean))].sort(), [employees]);
  const sectors = useMemo(() => [...new Map(employees.filter((employee) => employee.sector_id).map((employee) => [
    employee.sector_id,
    `${employee.sector_name || 'Não informado'}${employee.sector_is_active === false ? ' — inativo' : ''}`,
  ])).entries()], [employees]);

  function changeFilter(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function submitFilters(event) {
    event.preventDefault();
    load();
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

  async function downloadPendingReport(selections) {
    setDownloadingPendingReport(true);
    try {
      await downloadAuthenticatedFile('/employees/incomplete-report-pdf', 'pendencias-cadastrais-funcionarios.pdf', {
        method: 'post',
        data: { selections },
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
            {sectors.map(([sectorId, sectorName]) => <option key={sectorId} value={sectorId}>{sectorName}</option>)}
          </select>
        </label>
        <button className="button button_primary employees-page__filter-button" type="submit">
          <Search size={18} />
          <span>Filtrar</span>
        </button>
      </form>

      <div className="panel">
        {loading ? <p>Carregando funcionários...</p> : <DataTable columns={columns} rows={employees} emptyText="Nenhum funcionário encontrado." />}
      </div>

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
