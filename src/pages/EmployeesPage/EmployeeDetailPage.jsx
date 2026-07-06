import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, Printer, Save, Upload } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import { documentTypes, formatCpf, formatDate, formatMoney, maritalStatusOptions, statusLabels, toDateInput } from './employeeUtils.js';
import './EmployeesPage.css';

const tabs = ['Resumo', 'Dados pessoais', 'Endereço', 'Dados trabalhistas', 'Dependentes', 'Documentos', 'Histórico salarial', 'Histórico de vale alimentação', 'Auditoria'];

const editableFields = [
  'full_name', 'birth_date', 'cpf', 'rg', 'rg_issuer', 'rg_state', 'rg_issue_date', 'phone', 'alternate_phone', 'email',
  'marital_status', 'spouse_name', 'zip_code', 'street', 'address_number', 'complement', 'neighborhood', 'city', 'state',
  'admission_date', 'job_title', 'current_salary', 'meal_allowance', 'employment_status', 'notes', 'ctps_number', 'ctps_series',
  'ctps_state', 'pis_pasep', 'voter_registration', 'voter_zone', 'voter_section', 'military_certificate',
];

function emptyEmployeeForm() {
  return Object.fromEntries(editableFields.map((field) => [field, '']));
}

function SectionFields({ form, setField, disabled, fields }) {
  return (
    <div className="form-grid">
      {fields.map((field) => (
        <label className="field" key={field.name}>
          <span className="field__label">{field.label}</span>
          {field.type === 'select' ? (
            <select className="field__input" name={field.name} value={form[field.name] || ''} onChange={setField} disabled={disabled}>
              <option value="">Selecione</option>
              {field.options.map((option) => <option key={option.value || option} value={option.value || option}>{option.label || option}</option>)}
            </select>
          ) : field.type === 'textarea' ? (
            <textarea className="field__input" name={field.name} rows={4} value={form[field.name] || ''} onChange={setField} disabled={disabled} />
          ) : (
            <input className="field__input" name={field.name} type={field.type || 'text'} maxLength={field.maxLength} value={form[field.name] || ''} onChange={setField} disabled={disabled} />
          )}
        </label>
      ))}
    </div>
  );
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const user = getStoredUser();
  const canEdit = canAccessPermission(user, 'employees.edit') || canAccessPermission(user, 'employees.manage');
  const canSalaryView = canAccessPermission(user, 'employees.salary.view');
  const canSalaryManage = canAccessPermission(user, 'employees.salary.manage') || canAccessPermission(user, 'employees.manage');
  const canMealView = canAccessPermission(user, 'employees.meal_allowance.view');
  const canMealManage = canAccessPermission(user, 'employees.meal_allowance.manage') || canAccessPermission(user, 'employees.manage');
  const canDependentsView = canAccessPermission(user, 'employees.dependents.view');
  const canDependentsManage = canAccessPermission(user, 'employees.dependents.manage') || canAccessPermission(user, 'employees.manage');
  const canDocumentsView = canAccessPermission(user, 'employees.documents.view');
  const canDocumentsManage = canAccessPermission(user, 'employees.documents.manage') || canAccessPermission(user, 'employees.manage');
  const canPrint = canAccessPermission(user, 'employees.profile.print');
  const canAudit = canEdit;

  const [activeTab, setActiveTab] = useState(searchParams.get('complete') ? 'Dados pessoais' : 'Resumo');
  const [completeMode, setCompleteMode] = useState(Boolean(searchParams.get('complete')));
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState(emptyEmployeeForm());
  const [saving, setSaving] = useState(false);
  const [salaryHistory, setSalaryHistory] = useState([]);
  const [mealHistory, setMealHistory] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [audit, setAudit] = useState([]);
  const [dependentForm, setDependentForm] = useState({ full_name: '', birth_date: '', cpf: '', relationship: '', notes: '' });
  const [salaryForm, setSalaryForm] = useState({ salary: '', effective_from: '', reason: '' });
  const [mealForm, setMealForm] = useState({ amount: '', effective_from: '', reason: '' });
  const [documentForm, setDocumentForm] = useState({ document_type: 'RG', dependent_id: '', file: null });
  const [printPayload, setPrintPayload] = useState(null);

  async function loadEmployee() {
    const response = await api.get(`/employees/${id}`);
    setEmployee(response.data);
    setForm({
      ...emptyEmployeeForm(),
      ...Object.fromEntries(editableFields.map((field) => [field, ['birth_date', 'rg_issue_date', 'admission_date'].includes(field) ? toDateInput(response.data[field]) : response.data[field] ?? ''])),
    });
    setSalaryForm((current) => ({ ...current, salary: response.data.current_salary ?? '' }));
    setMealForm((current) => ({ ...current, amount: response.data.meal_allowance ?? '' }));
  }

  async function loadRelated() {
    const calls = [];
    if (canSalaryView) calls.push(api.get(`/employees/${id}/salary-history`).then((response) => setSalaryHistory(response.data)));
    if (canMealView) calls.push(api.get(`/employees/${id}/meal-allowance-history`).then((response) => setMealHistory(response.data)));
    if (canDependentsView) calls.push(api.get(`/employees/${id}/dependents`).then((response) => setDependents(response.data)));
    if (canDocumentsView) calls.push(api.get(`/employees/${id}/documents`).then((response) => setDocuments(response.data)));
    if (canAudit) calls.push(api.get(`/employees/${id}/audit`).then((response) => setAudit(response.data)));
    await Promise.all(calls);
  }

  useEffect(() => {
    Promise.all([loadEmployee(), loadRelated()]).catch(() => toast.error('Não foi possível carregar a ficha do funcionário.'));
  }, [id]);

  function setField(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }

  function buildEmployeePayload() {
    const payload = { ...form };
    if (!canSalaryManage) delete payload.current_salary;
    if (!canMealManage) delete payload.meal_allowance;
    return payload;
  }

  async function saveEmployee(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.put(`/employees/${id}`, buildEmployeePayload());
      setEmployee(response.data);
      toast.success('Alterações salvas.');
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar a ficha.');
    } finally {
      setSaving(false);
    }
  }

  async function completeProfile(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.post(`/employees/${id}/complete-profile`, buildEmployeePayload());
      setEmployee(response.data);
      setCompleteMode(false);
      toast.success('Ficha cadastral concluída.');
      await loadEmployee();
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível concluir a ficha.');
    } finally {
      setSaving(false);
    }
  }

  async function saveSalary(event) {
    event.preventDefault();
    try {
      await api.post(`/employees/${id}/salary`, salaryForm);
      toast.success('Salário atualizado com histórico.');
      await loadEmployee();
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar o salário.');
    }
  }

  async function saveMeal(event) {
    event.preventDefault();
    try {
      await api.post(`/employees/${id}/meal-allowance`, mealForm);
      toast.success('Vale alimentação atualizado com histórico.');
      await loadEmployee();
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar o vale alimentação.');
    }
  }

  async function saveDependent(event) {
    event.preventDefault();
    try {
      await api.post(`/employees/${id}/dependents`, dependentForm);
      setDependentForm({ full_name: '', birth_date: '', cpf: '', relationship: '', notes: '' });
      toast.success('Dependente adicionado.');
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar o dependente.');
    }
  }

  async function removeDependent(dependentId) {
    try {
      await api.delete(`/employees/${id}/dependents/${dependentId}`);
      toast.success('Dependente removido.');
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível remover o dependente.');
    }
  }

  async function uploadDoc(event) {
    event.preventDefault();
    if (!documentForm.file) return;
    try {
      await api.post(`/employees/${id}/documents`, documentForm.file, {
        headers: {
          'Content-Type': documentForm.file.type,
          'X-Document-Type': documentForm.document_type,
          'X-Original-Name': encodeURIComponent(documentForm.file.name),
          ...(documentForm.dependent_id ? { 'X-Dependent-Id': documentForm.dependent_id } : {}),
        },
      });
      setDocumentForm({ document_type: 'RG', dependent_id: '', file: null });
      toast.success('Documento anexado com segurança.');
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível anexar o documento.');
    }
  }

  async function removeDoc(documentId) {
    try {
      await api.delete(`/employees/${id}/documents/${documentId}`);
      toast.success('Documento removido.');
      await loadRelated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível remover o documento.');
    }
  }

  async function openDoc(document) {
    try {
      const response = await api.get(`/employees/${id}/documents/${document.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível abrir o documento.');
    }
  }

  async function printProfile() {
    try {
      const response = await api.get(`/employees/${id}/profile-print-data`);
      setPrintPayload(response.data);
      setTimeout(() => window.print(), 80);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível gerar a ficha para impressão.');
    }
  }

  const visibleTabs = useMemo(() => tabs.filter((tab) => {
    if (tab === 'Dependentes') return canDependentsView;
    if (tab === 'Documentos') return canDocumentsView;
    if (tab === 'Histórico salarial') return canSalaryView;
    if (tab === 'Histórico de vale alimentação') return canMealView;
    if (tab === 'Auditoria') return canAudit;
    return true;
  }), [canAudit, canDependentsView, canDocumentsView, canMealView, canSalaryView]);

  const missingForCompletion = useMemo(() => {
    const required = [
      ['full_name', 'Nome completo'],
      ['birth_date', 'Data de nascimento'],
      ['cpf', 'CPF'],
      ['phone', 'Telefone celular'],
      ['marital_status', 'Estado civil'],
      ['zip_code', 'CEP'],
      ['street', 'Logradouro'],
      ['address_number', 'Número'],
      ['neighborhood', 'Bairro'],
      ['city', 'Cidade'],
      ['state', 'UF'],
      ['admission_date', 'Data de admissão'],
      ['job_title', 'Cargo'],
      ['current_salary', 'Salário atual'],
      ['meal_allowance', 'Vale alimentação informado'],
      ['employment_status', 'Situação funcional'],
      ['ctps_number', 'CTPS número'],
      ['pis_pasep', 'PIS/PASEP'],
      ['voter_registration', 'Título de eleitor'],
      ['voter_zone', 'Zona eleitoral'],
      ['voter_section', 'Seção eleitoral'],
    ];
    const missing = required.filter(([field]) => form[field] === null || form[field] === undefined || String(form[field]).trim() === '').map(([, label]) => label);
    if ((form.marital_status === 'casado' || form.marital_status === 'união estável') && !form.spouse_name) missing.push('Nome do cônjuge');
    const documentTypesForEmployee = documents.map((document) => String(document.document_type || '').toLowerCase());
    const hasIdentity = documentTypesForEmployee.some((type) => type === 'rg' || type === 'cnh') || (form.rg && form.rg_issuer && form.rg_state);
    const hasAddress = documentTypesForEmployee.some((type) => type.includes('comprovante') && type.includes('endereço'));
    if (!hasIdentity) missing.push('RG completo ou documento RG/CNH anexado');
    if (!hasAddress) missing.push('Comprovante de endereço anexado');
    return missing;
  }, [documents, form]);

  if (!employee) return <section className="page"><div className="panel">Carregando ficha...</div></section>;

  return (
    <section className="page employees-page">
      <div className="page__header employees-page__detail-header">
        <div>
          <Link className="employees-page__back" to="/funcionarios">Funcionários</Link>
          <h1 className="page__title">{employee.full_name}</h1>
          <div className="employees-page__meta">
            <span className={`employees-page__status employees-page__status_${employee.employment_status}`}>{statusLabels[employee.employment_status] || employee.employment_status}</span>
            {!employee.profile_completed && <span className="employees-page__badge">Ficha incompleta</span>}
          </div>
        </div>
        <div className="page__actions">
          {!employee.profile_completed && canEdit && <button className="button" type="button" onClick={() => { setCompleteMode(true); setActiveTab('Dados pessoais'); }}>Completar ficha cadastral</button>}
          {canPrint && employee.profile_completed && <button className="button button_primary" type="button" onClick={printProfile}><Printer size={18} /><span>Imprimir ficha cadastral</span></button>}
          {canPrint && !employee.profile_completed && <button className="button" type="button" disabled><Printer size={18} /><span>Ficha incompleta</span></button>}
        </div>
      </div>

      {completeMode && !employee.profile_completed && (
        <div className="panel employees-page__completion">
          <h2>Faltam {missingForCompletion.length} itens para concluir a ficha</h2>
          {missingForCompletion.length ? (
            <ul>
              {missingForCompletion.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <p>Todos os requisitos aparentes foram preenchidos. Confirme para validar no servidor.</p>
          )}
          <button className="button button_primary" type="button" onClick={completeProfile} disabled={saving}>
            {saving ? 'Validando...' : 'Concluir ficha cadastral'}
          </button>
        </div>
      )}

      <div className="employees-page__tabs" role="tablist">
        {visibleTabs.map((tab) => (
          <button key={tab} className={activeTab === tab ? 'employees-page__tab employees-page__tab_active' : 'employees-page__tab'} type="button" onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Resumo' && (
        <div className="panel employees-page__summary">
          <div><span>CPF</span><strong>{formatCpf(employee.cpf)}</strong></div>
          <div><span>Cargo</span><strong>{employee.job_title || '-'}</strong></div>
          <div><span>Admissão</span><strong>{formatDate(employee.admission_date)}</strong></div>
          <div><span>Salário atual</span><strong>{formatMoney(employee.current_salary)}</strong></div>
          <div><span>Vale alimentação</span><strong>{formatMoney(employee.meal_allowance)}</strong></div>
          <div><span>Endereço</span><strong>{[employee.street, employee.address_number, employee.neighborhood, employee.city, employee.state].filter(Boolean).join(', ') || '-'}</strong></div>
        </div>
      )}

      {['Dados pessoais', 'Endereço', 'Dados trabalhistas'].includes(activeTab) && (
        <form className="panel employees-page__form" onSubmit={saveEmployee}>
          {activeTab === 'Dados pessoais' && (
            <SectionFields disabled={!canEdit} form={form} setField={setField} fields={[
              { name: 'full_name', label: 'Nome completo' },
              { name: 'birth_date', label: 'Data de nascimento', type: 'date' },
              { name: 'cpf', label: 'CPF' },
              { name: 'rg', label: 'RG' },
              { name: 'rg_issuer', label: 'Órgão expedidor do RG' },
              { name: 'rg_state', label: 'UF do RG', maxLength: 2 },
              { name: 'rg_issue_date', label: 'Data de emissão do RG', type: 'date' },
              { name: 'phone', label: 'Telefone celular' },
              { name: 'alternate_phone', label: 'Telefone alternativo' },
              { name: 'email', label: 'E-mail' },
              { name: 'marital_status', label: 'Estado civil', type: 'select', options: maritalStatusOptions },
              ...(form.marital_status === 'casado' || form.marital_status === 'união estável' ? [{ name: 'spouse_name', label: 'Nome do cônjuge' }] : []),
            ]} />
          )}
          {activeTab === 'Endereço' && (
            <SectionFields disabled={!canEdit} form={form} setField={setField} fields={[
              { name: 'zip_code', label: 'CEP' },
              { name: 'street', label: 'Logradouro' },
              { name: 'address_number', label: 'Número' },
              { name: 'complement', label: 'Complemento' },
              { name: 'neighborhood', label: 'Bairro' },
              { name: 'city', label: 'Cidade' },
              { name: 'state', label: 'UF', maxLength: 2 },
            ]} />
          )}
          {activeTab === 'Dados trabalhistas' && (
            <>
              <SectionFields disabled={!canEdit} form={form} setField={setField} fields={[
                { name: 'admission_date', label: 'Data de admissão', type: 'date' },
                { name: 'job_title', label: 'Cargo' },
                ...(canSalaryManage ? [{ name: 'current_salary', label: 'SalÃ¡rio atual', type: 'number' }] : []),
                ...(canMealManage ? [{ name: 'meal_allowance', label: 'Vale alimentaÃ§Ã£o', type: 'number' }] : []),
                { name: 'employment_status', label: 'Situação funcional', type: 'select', options: Object.entries(statusLabels).map(([value, label]) => ({ value, label })) },
                { name: 'ctps_number', label: 'CTPS número' },
                { name: 'ctps_series', label: 'CTPS série' },
                { name: 'ctps_state', label: 'CTPS UF', maxLength: 2 },
                { name: 'pis_pasep', label: 'PIS/PASEP' },
                { name: 'voter_registration', label: 'Título de eleitor' },
                { name: 'voter_zone', label: 'Zona eleitoral' },
                { name: 'voter_section', label: 'Seção eleitoral' },
                { name: 'military_certificate', label: 'Certificado militar' },
                { name: 'notes', label: 'Observações', type: 'textarea' },
              ]} />
            </>
          )}
          {canEdit && <button className="button button_primary employees-page__save" type="submit" disabled={saving}><Save size={18} /><span>{saving ? 'Salvando...' : 'Salvar ficha'}</span></button>}
        </form>
      )}

      {activeTab === 'Dependentes' && (
        <div className="panel employees-page__stack">
          {canDependentsManage && (
            <form className="employees-page__inline-form" onSubmit={saveDependent}>
              <input className="field__input" placeholder="Nome completo" value={dependentForm.full_name} onChange={(event) => setDependentForm({ ...dependentForm, full_name: event.target.value })} required />
              <input className="field__input" type="date" value={dependentForm.birth_date} onChange={(event) => setDependentForm({ ...dependentForm, birth_date: event.target.value })} />
              <input className="field__input" placeholder="CPF" value={dependentForm.cpf} onChange={(event) => setDependentForm({ ...dependentForm, cpf: event.target.value })} />
              <input className="field__input" placeholder="Parentesco" value={dependentForm.relationship} onChange={(event) => setDependentForm({ ...dependentForm, relationship: event.target.value })} />
              <button className="button button_primary" type="submit">Adicionar</button>
            </form>
          )}
          {dependents.map((dependent) => (
            <div className="employees-page__row" key={dependent.id}>
              <div><strong>{dependent.full_name}</strong><span>{dependent.relationship || 'Parentesco não informado'} · {formatDate(dependent.birth_date)}</span></div>
              {canDependentsManage && <button className="button button_danger" type="button" onClick={() => removeDependent(dependent.id)}>Remover</button>}
            </div>
          ))}
          {!dependents.length && <p>Nenhum dependente cadastrado.</p>}
        </div>
      )}

      {activeTab === 'Documentos' && (
        <div className="panel employees-page__stack">
          {canDocumentsManage && (
            <form className="employees-page__inline-form" onSubmit={uploadDoc}>
              <select className="field__input" value={documentForm.document_type} onChange={(event) => setDocumentForm({ ...documentForm, document_type: event.target.value })}>
                {documentTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select className="field__input" value={documentForm.dependent_id} onChange={(event) => setDocumentForm({ ...documentForm, dependent_id: event.target.value })}>
                <option value="">Documento do funcionário</option>
                {dependents.map((dependent) => <option key={dependent.id} value={dependent.id}>{dependent.full_name}</option>)}
              </select>
              <input className="field__input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setDocumentForm({ ...documentForm, file: event.target.files?.[0] || null })} required />
              <button className="button button_primary" type="submit"><Upload size={18} /><span>Anexar</span></button>
            </form>
          )}
          {documents.map((document) => (
            <div className="employees-page__row" key={document.id}>
              <div><strong>{document.document_type}</strong><span>{decodeURIComponent(document.original_name)} · {Math.ceil(Number(document.size_bytes) / 1024)} KB</span></div>
              <div className="employees-page__row-actions">
                <button className="button" type="button" onClick={() => openDoc(document)}><Download size={18} /><span>Abrir</span></button>
                {canDocumentsManage && <button className="button button_danger" type="button" onClick={() => removeDoc(document.id)}>Remover</button>}
              </div>
            </div>
          ))}
          {!documents.length && <p>Nenhum documento anexado.</p>}
        </div>
      )}

      {activeTab === 'Histórico salarial' && (
        <div className="panel employees-page__stack">
          {canSalaryManage && (
            <form className="employees-page__inline-form" onSubmit={saveSalary}>
              <input className="field__input" type="number" step="0.01" min="0" value={salaryForm.salary} onChange={(event) => setSalaryForm({ ...salaryForm, salary: event.target.value })} required />
              <input className="field__input" type="date" value={salaryForm.effective_from} onChange={(event) => setSalaryForm({ ...salaryForm, effective_from: event.target.value })} />
              <input className="field__input" placeholder="Motivo" value={salaryForm.reason} onChange={(event) => setSalaryForm({ ...salaryForm, reason: event.target.value })} />
              <button className="button button_primary" type="submit">Atualizar salário</button>
            </form>
          )}
          {salaryHistory.map((item) => <div className="employees-page__row" key={item.id}><div><strong>{formatMoney(item.salary)}</strong><span>Vigência: {formatDate(item.effective_from)} · Anterior: {formatMoney(item.previous_salary)}</span></div></div>)}
        </div>
      )}

      {activeTab === 'Histórico de vale alimentação' && (
        <div className="panel employees-page__stack">
          {canMealManage && (
            <form className="employees-page__inline-form" onSubmit={saveMeal}>
              <input className="field__input" type="number" step="0.01" min="0" value={mealForm.amount} onChange={(event) => setMealForm({ ...mealForm, amount: event.target.value })} required />
              <input className="field__input" type="date" value={mealForm.effective_from} onChange={(event) => setMealForm({ ...mealForm, effective_from: event.target.value })} />
              <input className="field__input" placeholder="Motivo" value={mealForm.reason} onChange={(event) => setMealForm({ ...mealForm, reason: event.target.value })} />
              <button className="button button_primary" type="submit">Atualizar vale</button>
            </form>
          )}
          {mealHistory.map((item) => <div className="employees-page__row" key={item.id}><div><strong>{formatMoney(item.new_amount)}</strong><span>Vigência: {formatDate(item.effective_from)} · Anterior: {formatMoney(item.previous_amount)}</span></div></div>)}
        </div>
      )}

      {activeTab === 'Auditoria' && (
        <div className="panel employees-page__stack">
          {audit.map((item) => (
            <div className="employees-page__row" key={item.id}>
              <div><strong>{item.action}</strong><span>{formatDate(item.created_at)} · {item.user_name || 'Sistema'}</span></div>
            </div>
          ))}
          {!audit.length && <p>Nenhum registro de auditoria encontrado.</p>}
        </div>
      )}

      {printPayload && (
        <div className="employees-page__print">
          <img className="employees-page__print-logo" src="/logo-torneadora-universal.png" alt="Logo Torneadora Universal" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <h1>TORNEADORA UNIVERSAL</h1>
          <h2>FICHA CADASTRAL DE FUNCIONÁRIO</h2>
          <section><h3>1. Dados pessoais</h3><p>Nome: {printPayload.employee.full_name}</p><p>CPF: {formatCpf(printPayload.employee.cpf)} · RG: {printPayload.employee.rg || '-'}</p><p>Nascimento: {formatDate(printPayload.employee.birth_date)} · Telefone: {printPayload.employee.phone || '-'}</p></section>
          <section><h3>2. Endereço</h3><p>{[printPayload.employee.street, printPayload.employee.address_number, printPayload.employee.complement, printPayload.employee.neighborhood, printPayload.employee.city, printPayload.employee.state, printPayload.employee.zip_code].filter(Boolean).join(', ')}</p></section>
          <section><h3>3. Documentação</h3><p>CTPS: {[printPayload.employee.ctps_number, printPayload.employee.ctps_series, printPayload.employee.ctps_state].filter(Boolean).join(' / ') || '-'}</p><p>PIS/PASEP: {printPayload.employee.pis_pasep || '-'} · Título eleitoral: {printPayload.employee.voter_registration || '-'}</p><p>Certificado militar: {printPayload.employee.military_certificate || '-'}</p></section>
          <section><h3>4. Dados trabalhistas</h3><p>Admissão: {formatDate(printPayload.employee.admission_date)} · Cargo: {printPayload.employee.job_title || '-'}</p><p>Situação: {statusLabels[printPayload.employee.employment_status] || '-'}</p></section>
          <section><h3>5. Dependentes</h3>{printPayload.dependents.length ? printPayload.dependents.map((dependent) => <p key={dependent.id}>{dependent.full_name} · {dependent.relationship || '-'} · {formatDate(dependent.birth_date)}</p>) : <p>Sem dependentes cadastrados.</p>}</section>
          <p>Declaro que as informações acima são verdadeiras e autorizo seu uso para fins cadastrais, trabalhistas e administrativos da empresa, conforme aplicável.</p>
          <div className="employees-page__signatures"><span>Local e data: ________________________________</span><span>Assinatura do funcionário: ________________________________</span><span>Assinatura responsável empresa: ________________________________</span></div>
        </div>
      )}
    </section>
  );
}
