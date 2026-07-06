import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './EmployeesPage.css';

const emptyForm = {
  full_name: '',
  cpf: '',
  ctps_number: '',
  ctps_series: '',
  ctps_state: '',
  zip_code: '',
  street: '',
  address_number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  current_salary: '',
  meal_allowance: '',
};

export function EmployeeQuickCreatePage() {
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'employees.create');
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  if (!canCreate) return <Navigate to="/acesso-negado" replace />;

  function setField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await api.post('/employees/quick', form);
      setCreated(response.data);
      toast.success('Funcionário cadastrado. A ficha cadastral pode ser completada posteriormente.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar o cadastro rápido.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page employees-page">
      <div className="page__header">
        <h1 className="page__title">Cadastro rápido</h1>
        <Link className="button" to="/funcionarios">Cancelar</Link>
      </div>

      {created ? (
        <div className="panel employees-page__success">
          <h2>Funcionário cadastrado</h2>
          <p>A ficha cadastral pode ser completada posteriormente.</p>
          <div className="page__actions">
            <button className="button button_primary" type="button" onClick={() => navigate(`/funcionarios/${created.id}`)}>Ver funcionário</button>
            <button className="button" type="button" onClick={() => navigate(`/funcionarios/${created.id}?complete=1`)}>Completar ficha cadastral</button>
          </div>
        </div>
      ) : (
        <form className="panel employees-page__form" onSubmit={save}>
          <section className="employees-page__section">
            <h2>Dados básicos</h2>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Nome completo <span className="employees-page__required">*</span></span>
                <input className="field__input" name="full_name" value={form.full_name} onChange={setField} required />
              </label>
              <label className="field">
                <span className="field__label">CPF <span className="employees-page__required">*</span></span>
                <input className="field__input" name="cpf" value={form.cpf} onChange={setField} required />
              </label>
            </div>
          </section>

          <section className="employees-page__section">
            <h2>Adicionar outros dados agora</h2>
            <p className="employees-page__hint">Opcional. A ficha cadastral pode ser completada posteriormente.</p>
          </section>

          <section className="employees-page__section">
            <h2>Carteira de Trabalho</h2>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Número da CTPS</span>
                <input className="field__input" name="ctps_number" value={form.ctps_number} onChange={setField} />
              </label>
              <label className="field">
                <span className="field__label">Série da CTPS</span>
                <input className="field__input" name="ctps_series" value={form.ctps_series} onChange={setField} />
              </label>
              <label className="field">
                <span className="field__label">UF da CTPS</span>
                <input className="field__input" name="ctps_state" value={form.ctps_state} onChange={setField} maxLength={2} />
              </label>
            </div>
          </section>

          <section className="employees-page__section">
            <h2>Endereço</h2>
            <div className="form-grid">
              {[
                ['zip_code', 'CEP'],
                ['street', 'Rua / logradouro'],
                ['address_number', 'Número'],
                ['complement', 'Complemento'],
                ['neighborhood', 'Bairro'],
                ['city', 'Cidade'],
                ['state', 'UF'],
              ].map(([name, label]) => (
                <label className="field" key={name}>
                  <span className="field__label">{label}</span>
                  <input className="field__input" name={name} value={form[name]} onChange={setField} maxLength={name === 'state' ? 2 : undefined} />
                </label>
              ))}
            </div>
          </section>

          <section className="employees-page__section">
            <h2>Financeiro</h2>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Salário atual</span>
                <input className="field__input" name="current_salary" type="number" step="0.01" min="0" value={form.current_salary} onChange={setField} />
              </label>
              <label className="field">
                <span className="field__label">Valor do vale alimentação</span>
                <input className="field__input" name="meal_allowance" type="number" step="0.01" min="0" value={form.meal_allowance} onChange={setField} />
              </label>
            </div>
          </section>

          <div className="employees-page__form-actions">
            <Link className="button" to="/funcionarios">Cancelar</Link>
            <button className="button button_primary" type="submit" disabled={saving}>
              <Save size={18} />
              <span>{saving ? 'Salvando...' : 'Salvar cadastro rápido'}</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
