import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Save, Upload } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import { maritalStatusOptions, statusLabels } from './employeeUtils.js';
import './EmployeesPage.css';

const emptyForm = {
  full_name: '',
  birth_date: '',
  cpf: '',
  rg: '',
  rg_issuer: '',
  rg_state: '',
  rg_issue_date: '',
  phone: '',
  alternate_phone: '',
  email: '',
  marital_status: '',
  spouse_name: '',
  zip_code: '',
  street: '',
  address_number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  admission_date: '',
  job_title: '',
  current_salary: '',
  meal_allowance: '0',
  employment_status: 'ativo',
  ctps_number: '',
  ctps_series: '',
  ctps_state: '',
  pis_pasep: '',
  voter_registration: '',
  voter_zone: '',
  voter_section: '',
  military_certificate: '',
  notes: '',
};

function RequiredMark() {
  return <span className="employees-page__required">*</span>;
}

export function EmployeeCreatePage() {
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'employees.create');
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [identityType, setIdentityType] = useState('RG');
  const [identityFile, setIdentityFile] = useState(null);
  const [addressFile, setAddressFile] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!canCreate) return <Navigate to="/acesso-negado" replace />;

  function setField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function uploadDocument(employeeId, file, documentType) {
    await api.post(`/employees/${employeeId}/documents`, file, {
      headers: {
        'Content-Type': file.type,
        'X-Document-Type': documentType,
        'X-Original-Name': encodeURIComponent(file.name),
      },
    });
  }

  async function save(event) {
    event.preventDefault();
    if (!identityFile) {
      toast.error('Anexe RG ou CNH para concluir o cadastro completo.');
      return;
    }
    if (!addressFile) {
      toast.error('Anexe o comprovante de endereço.');
      return;
    }

    setSaving(true);
    let createdEmployee = null;
    try {
      const response = await api.post('/employees', form);
      createdEmployee = response.data;
      await uploadDocument(createdEmployee.id, identityFile, identityType);
      await uploadDocument(createdEmployee.id, addressFile, 'comprovante de endereço');
      await api.post(`/employees/${createdEmployee.id}/complete-profile`, form);
      toast.success('Funcionário cadastrado com ficha completa.');
      navigate(`/funcionarios/${createdEmployee.id}`);
    } catch (error) {
      const suffix = createdEmployee?.id ? ' O funcionário foi salvo como ficha incompleta para evitar perda de dados.' : '';
      toast.error(`${error.response?.data?.message || 'Não foi possível concluir o cadastro completo.'}${suffix}`);
      if (createdEmployee?.id) navigate(`/funcionarios/${createdEmployee.id}?complete=1`);
    } finally {
      setSaving(false);
    }
  }

  const needsSpouse = form.marital_status === 'casado' || form.marital_status === 'união estável';

  return (
    <section className="page employees-page">
      <div className="page__header">
        <div>
          <h1 className="page__title">Novo funcionário</h1>
          <p className="employees-page__subtitle">Preencha a ficha cadastral completa.</p>
        </div>
        <Link className="button" to="/funcionarios">Cancelar</Link>
      </div>

      <form className="panel employees-page__form" onSubmit={save}>
        <section className="employees-page__section">
          <h2>Dados pessoais</h2>
          <div className="form-grid">
            <label className="field"><span className="field__label">Nome completo <RequiredMark /></span><input className="field__input" name="full_name" value={form.full_name} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Data de nascimento <RequiredMark /></span><input className="field__input" name="birth_date" type="date" value={form.birth_date} onChange={setField} required /></label>
            <label className="field"><span className="field__label">CPF <RequiredMark /></span><input className="field__input" name="cpf" value={form.cpf} onChange={setField} required /></label>
            <label className="field"><span className="field__label">RG</span><input className="field__input" name="rg" value={form.rg} onChange={setField} /></label>
            <label className="field"><span className="field__label">Órgão expedidor do RG</span><input className="field__input" name="rg_issuer" value={form.rg_issuer} onChange={setField} /></label>
            <label className="field"><span className="field__label">UF do RG</span><input className="field__input" name="rg_state" value={form.rg_state} onChange={setField} maxLength={2} /></label>
            <label className="field"><span className="field__label">Data de emissão do RG</span><input className="field__input" name="rg_issue_date" type="date" value={form.rg_issue_date} onChange={setField} /></label>
            <label className="field"><span className="field__label">Telefone celular <RequiredMark /></span><input className="field__input" name="phone" value={form.phone} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Telefone alternativo</span><input className="field__input" name="alternate_phone" value={form.alternate_phone} onChange={setField} /></label>
            <label className="field"><span className="field__label">E-mail</span><input className="field__input" name="email" type="email" value={form.email} onChange={setField} /></label>
            <label className="field">
              <span className="field__label">Estado civil <RequiredMark /></span>
              <select className="field__input" name="marital_status" value={form.marital_status} onChange={setField} required>
                <option value="">Selecione</option>
                {maritalStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {needsSpouse && <label className="field"><span className="field__label">Nome do cônjuge <RequiredMark /></span><input className="field__input" name="spouse_name" value={form.spouse_name} onChange={setField} required /></label>}
          </div>
        </section>

        <section className="employees-page__section">
          <h2>Endereço</h2>
          <div className="form-grid">
            <label className="field"><span className="field__label">CEP <RequiredMark /></span><input className="field__input" name="zip_code" value={form.zip_code} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Logradouro <RequiredMark /></span><input className="field__input" name="street" value={form.street} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Número <RequiredMark /></span><input className="field__input" name="address_number" value={form.address_number} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Complemento</span><input className="field__input" name="complement" value={form.complement} onChange={setField} /></label>
            <label className="field"><span className="field__label">Bairro <RequiredMark /></span><input className="field__input" name="neighborhood" value={form.neighborhood} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Cidade <RequiredMark /></span><input className="field__input" name="city" value={form.city} onChange={setField} required /></label>
            <label className="field"><span className="field__label">UF <RequiredMark /></span><input className="field__input" name="state" value={form.state} onChange={setField} maxLength={2} required /></label>
          </div>
        </section>

        <section className="employees-page__section">
          <h2>Dados trabalhistas</h2>
          <div className="form-grid">
            <label className="field"><span className="field__label">Data de admissão <RequiredMark /></span><input className="field__input" name="admission_date" type="date" value={form.admission_date} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Cargo <RequiredMark /></span><input className="field__input" name="job_title" value={form.job_title} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Salário atual <RequiredMark /></span><input className="field__input" name="current_salary" type="number" step="0.01" min="0" value={form.current_salary} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Vale alimentação <RequiredMark /></span><input className="field__input" name="meal_allowance" type="number" step="0.01" min="0" value={form.meal_allowance} onChange={setField} required /></label>
            <label className="field">
              <span className="field__label">Situação funcional <RequiredMark /></span>
              <select className="field__input" name="employment_status" value={form.employment_status} onChange={setField} required>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field"><span className="field__label">CTPS número <RequiredMark /></span><input className="field__input" name="ctps_number" value={form.ctps_number} onChange={setField} required /></label>
            <label className="field"><span className="field__label">CTPS série</span><input className="field__input" name="ctps_series" value={form.ctps_series} onChange={setField} /></label>
            <label className="field"><span className="field__label">CTPS UF</span><input className="field__input" name="ctps_state" value={form.ctps_state} onChange={setField} maxLength={2} /></label>
            <label className="field"><span className="field__label">PIS/PASEP <RequiredMark /></span><input className="field__input" name="pis_pasep" value={form.pis_pasep} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Título de eleitor <RequiredMark /></span><input className="field__input" name="voter_registration" value={form.voter_registration} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Zona eleitoral <RequiredMark /></span><input className="field__input" name="voter_zone" value={form.voter_zone} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Seção eleitoral <RequiredMark /></span><input className="field__input" name="voter_section" value={form.voter_section} onChange={setField} required /></label>
            <label className="field"><span className="field__label">Certificado militar</span><input className="field__input" name="military_certificate" value={form.military_certificate} onChange={setField} /></label>
          </div>
          <label className="field">
            <span className="field__label">Observações</span>
            <textarea className="field__input" name="notes" rows={3} value={form.notes} onChange={setField} />
          </label>
        </section>

        <section className="employees-page__section">
          <h2>Documentos obrigatórios</h2>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Tipo de identificação <RequiredMark /></span>
              <select className="field__input" value={identityType} onChange={(event) => setIdentityType(event.target.value)}>
                <option value="RG">RG</option>
                <option value="CNH">CNH</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Arquivo RG ou CNH <RequiredMark /></span>
              <input className="field__input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setIdentityFile(event.target.files?.[0] || null)} required />
            </label>
            <label className="field">
              <span className="field__label">Comprovante de endereço <RequiredMark /></span>
              <input className="field__input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setAddressFile(event.target.files?.[0] || null)} required />
            </label>
          </div>
          <p className="employees-page__hint"><Upload size={16} /> Os arquivos são enviados para endpoint protegido após a criação do registro.</p>
        </section>

        <div className="employees-page__form-actions">
          <Link className="button" to="/funcionarios">Cancelar</Link>
          <button className="button button_primary" type="submit" disabled={saving}>
            <Save size={18} />
            <span>{saving ? 'Salvando...' : 'Salvar funcionário completo'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}
