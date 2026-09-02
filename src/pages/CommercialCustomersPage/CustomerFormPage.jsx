import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Save } from 'lucide-react';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import './CommercialCustomers.css';

const emptyCustomer = {
  person_type: '', name: '', trade_name: '', tax_id: '', phone: '', whatsapp: '', email: '',
  zip_code: '', address: '', address_number: '', complement: '', neighborhood: '', city: '', state: '', notes: '',
};

function onlyDigits(value, limit) {
  return value.replace(/\D/g, '').slice(0, limit);
}

export function CustomerFormPage({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const user = getStoredUser();
  const isCreate = mode === 'create';
  const isReadOnly = mode === 'view';
  const canEdit = canAccessPermission(user, 'commercial.customers.edit');
  const [form, setForm] = useState(emptyCustomer);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isCreate) return;
    let active = true;
    api.get(`/commercial/customers/${id}`)
      .then((response) => {
        if (!active) return;
        setForm(Object.fromEntries(Object.keys(emptyCustomer).map((key) => [key, response.data[key] ?? ''])));
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || 'Não foi possível carregar o cliente.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, isCreate]);

  function change(event) {
    const { name, value } = event.target;
    let nextValue = value;
    if (name === 'tax_id') nextValue = onlyDigits(value, 14);
    if (name === 'zip_code') nextValue = onlyDigits(value, 8);
    if (name === 'state') nextValue = value.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 2);
    setForm((current) => ({ ...current, [name]: nextValue }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    try {
      setSaving(true);
      setError('');
      const response = isCreate
        ? await api.post('/commercial/customers', form)
        : await api.put(`/commercial/customers/${id}`, form);
      toast.success(isCreate ? 'Cliente cadastrado.' : 'Cliente atualizado.');
      navigate(`/comercial/clientes/${response.data.id}`, { replace: true });
    } catch (requestError) {
      const message = requestError.response?.data?.message || 'Não foi possível salvar o cliente.';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="page"><div className="panel">Carregando cliente...</div></section>;
  if (error && isReadOnly) {
    return <section className="page"><div className="panel commercial-customers__feedback_error"><p>{error}</p><Link className="button" to="/comercial/clientes">Voltar</Link></div></section>;
  }

  const disabled = isReadOnly || saving;
  const title = isCreate ? 'Novo cliente' : isReadOnly ? form.name || 'Cliente' : 'Editar cliente';
  const field = (name, label, options = {}) => (
    <label className={`field ${options.wide ? 'commercial-customer-form__wide' : ''}`}>
      <span className="field__label">{label}</span>
      {options.textarea ? (
        <textarea className="field__input commercial-customer-form__textarea" name={name} value={form[name]} onChange={change} disabled={disabled} maxLength={options.maxLength} />
      ) : (
        <input className="field__input" name={name} type={options.type || 'text'} value={form[name]} onChange={change} disabled={disabled} required={options.required} maxLength={options.maxLength} />
      )}
    </label>
  );

  return (
    <section className="page commercial-customer-form">
      <header className="page__header">
        <div>
          <h1 className="page__title">{title}</h1>
          <p className="commercial-customers__subtitle">Os dados pertencem ao cadastro mestre usado também pela Produção.</p>
        </div>
        <div className="page__actions">
          <Link className="button" to="/comercial/clientes"><ArrowLeft size={18} /> Clientes</Link>
          {isReadOnly && canEdit && <Link className="button button_primary" to={`/comercial/clientes/${id}/editar`}><Pencil size={18} /> Editar</Link>}
        </div>
      </header>

      <form className="commercial-customer-form__content" onSubmit={submit} noValidate>
        <section className="panel commercial-customer-form__section">
          <h2>Identificação</h2>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Tipo de pessoa</span>
              <select className="field__input" name="person_type" value={form.person_type} onChange={change} disabled={disabled}>
                <option value="">Não informado</option>
                <option value="individual">Pessoa física</option>
                <option value="legal">Pessoa jurídica</option>
              </select>
            </label>
            {field('name', form.person_type === 'legal' ? 'Razão social' : 'Nome', { required: true, maxLength: 180 })}
            {field('trade_name', 'Nome fantasia', { maxLength: 180 })}
            {field('tax_id', 'CPF/CNPJ', { maxLength: 14 })}
          </div>
        </section>

        <section className="panel commercial-customer-form__section">
          <h2>Contato</h2>
          <div className="form-grid">
            {field('phone', 'Telefone', { maxLength: 20 })}
            {field('whatsapp', 'WhatsApp', { maxLength: 20 })}
            {field('email', 'E-mail', { type: 'email', maxLength: 180 })}
          </div>
        </section>

        <section className="panel commercial-customer-form__section">
          <h2>Endereço</h2>
          <div className="form-grid">
            {field('zip_code', 'CEP', { maxLength: 8 })}
            {field('address', 'Logradouro', { maxLength: 180 })}
            {field('address_number', 'Número', { maxLength: 30 })}
            {field('complement', 'Complemento', { maxLength: 120 })}
            {field('neighborhood', 'Bairro', { maxLength: 120 })}
            {field('city', 'Cidade', { maxLength: 120 })}
            {field('state', 'UF', { maxLength: 2 })}
          </div>
        </section>

        <section className="panel commercial-customer-form__section">
          <h2>Observações</h2>
          <div className="form-grid">{field('notes', 'Observações comerciais', { textarea: true, wide: true, maxLength: 5000 })}</div>
        </section>

        {!isReadOnly && (
          <div className="commercial-customer-form__footer">
            {error && <p className="commercial-customers__feedback_error">{error}</p>}
            <button className="button button_primary" type="submit" disabled={saving}><Save size={18} /> {saving ? 'Salvando...' : 'Salvar cliente'}</button>
          </div>
        )}
      </form>
    </section>
  );
}
