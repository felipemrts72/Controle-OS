import { useEffect, useRef, useState } from 'react';
import { Save, Trash2, Upload } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { canAccessPermission } from '../../utils/permissions.js';
import './CompanySettingsPage.css';

const fields = [
  'nome_fantasia', 'razao_social', 'cnpj', 'telefone', 'email', 'endereco', 'numero', 'complemento',
  'bairro', 'cidade', 'estado', 'cep', 'nome_representante', 'cpf_representante', 'cargo_representante',
  'delivery_address', 'purchase_response_email', 'purchase_response_whatsapp', 'purchase_responsible_name',
];
const emptyForm = Object.fromEntries(fields.map((field) => [field, '']));

function digits(value, length) {
  return String(value || '').replace(/\D/g, '').slice(0, length);
}

function maskCnpj(value) {
  const number = digits(value, 14);
  return number.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function maskCpf(value) {
  const number = digits(value, 11);
  return number.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function maskCep(value) {
  return digits(value, 8).replace(/(\d{5})(\d)/, '$1-$2');
}

function maskPhone(value) {
  const number = digits(value, 11);
  if (number.length <= 10) return number.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  return number.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

function hydratedForm(data) {
  return Object.fromEntries(fields.map((field) => {
    const value = data?.[field] || '';
    if (field === 'cnpj') return [field, maskCnpj(value)];
    if (field === 'cpf_representante') return [field, maskCpf(value)];
    if (field === 'cep') return [field, maskCep(value)];
    if (field === 'telefone') return [field, maskPhone(value)];
    if (field === 'purchase_response_whatsapp') return [field, maskPhone(value)];
    return [field, value];
  }));
}

export function CompanySettingsPage() {
  const toast = useToast();
  const user = getStoredUser();
  const canEdit = canAccessPermission(user, 'company_settings.edit');
  const [form, setForm] = useState(emptyForm);
  const [logoUrl, setLogoUrl] = useState(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoUrlRef = useRef(null);

  function replaceLogoUrl(nextUrl) {
    if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current);
    logoUrlRef.current = nextUrl;
    setLogoUrl(nextUrl);
  }

  async function loadLogo() {
    const response = await api.get('/company-settings/logo', { responseType: 'blob' });
    replaceLogoUrl(URL.createObjectURL(response.data));
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await api.get('/company-settings');
        if (!active) return;
        setForm(hydratedForm(response.data));
        setHasLogo(Boolean(response.data.logo_url));
        if (response.data.logo_url) await loadLogo();
      } catch (error) {
        if (active) toast.error(error.response?.data?.message || 'Não foi possível carregar as configurações da empresa.');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
      if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current);
      logoUrlRef.current = null;
    };
  }, []);

  function changeField(event) {
    const { name } = event.target;
    let { value } = event.target;
    if (name === 'cnpj') value = maskCnpj(value);
    if (name === 'cpf_representante') value = maskCpf(value);
    if (name === 'cep') value = maskCep(value);
    if (name === 'telefone') value = maskPhone(value);
    if (name === 'purchase_response_whatsapp') value = maskPhone(value);
    if (name === 'estado') value = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const response = await api.put('/company-settings', form);
      setForm(hydratedForm(response.data));
      toast.success('Configurações da empresa atualizadas.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível salvar as configurações da empresa.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const validExtension = file.type === 'image/png' ? extension === 'png' : file.type === 'image/jpeg' && ['jpg', 'jpeg'].includes(extension);
    if (!validExtension) {
      toast.error('Selecione uma imagem PNG ou JPEG com extensão correspondente.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('A logo deve ter no máximo 5 MB.');
      return;
    }
    setUploading(true);
    try {
      await api.put('/company-settings/logo', file, {
        headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) },
      });
      setHasLogo(true);
      await loadLogo();
      toast.success('Logo atualizada.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível atualizar a logo.');
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    if (!canEdit || !hasLogo) return;
    setUploading(true);
    try {
      await api.delete('/company-settings/logo');
      setHasLogo(false);
      replaceLogoUrl(null);
      toast.success('Logo removida.');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Não foi possível remover a logo.');
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <section className="page"><div className="panel">Carregando configurações...</div></section>;

  return (
    <section className="page company-settings-page">
      <div className="page__header">
        <div><h1 className="page__title">Configurações da empresa</h1><p className="page__subtitle">Dados usados nos documentos administrativos.</p></div>
      </div>

      <form onSubmit={save}>
        <div className="panel company-settings-page__logo-panel">
          <div className="company-settings-page__logo-preview">
            {logoUrl ? <img src={logoUrl} alt="Logo atual da empresa" /> : <span>Nenhuma logo cadastrada</span>}
          </div>
          {canEdit && (
            <div className="page__actions">
              <label className="button button_primary company-settings-page__upload">
                <Upload size={17} /> {uploading ? 'Processando...' : 'Enviar logo'}
                <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={uploadLogo} disabled={uploading} />
              </label>
              {hasLogo && <button className="button" type="button" onClick={removeLogo} disabled={uploading}><Trash2 size={17} /> Remover</button>}
            </div>
          )}
          <small>PNG ou JPEG, até 5 MB.</small>
        </div>

        <div className="panel">
          <h2>Identificação</h2>
          <div className="company-settings-page__grid">
            <label className="field"><span className="field__label">Nome fantasia</span><input className="field__input" name="nome_fantasia" value={form.nome_fantasia} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Razão social</span><input className="field__input" name="razao_social" value={form.razao_social} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">CNPJ</span><input className="field__input" name="cnpj" value={form.cnpj} onChange={changeField} inputMode="numeric" placeholder="00.000.000/0000-00" disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Telefone</span><input className="field__input" name="telefone" value={form.telefone} onChange={changeField} inputMode="tel" disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">E-mail</span><input className="field__input" type="email" name="email" value={form.email} onChange={changeField} disabled={!canEdit} /></label>
          </div>
        </div>

        <div className="panel">
          <h2>Endereço</h2>
          <div className="company-settings-page__grid">
            <label className="field company-settings-page__wide"><span className="field__label">Endereço</span><input className="field__input" name="endereco" value={form.endereco} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Número</span><input className="field__input" name="numero" value={form.numero} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Complemento</span><input className="field__input" name="complemento" value={form.complemento} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Bairro</span><input className="field__input" name="bairro" value={form.bairro} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Cidade</span><input className="field__input" name="cidade" value={form.cidade} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Estado</span><input className="field__input" name="estado" value={form.estado} onChange={changeField} maxLength={2} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">CEP</span><input className="field__input" name="cep" value={form.cep} onChange={changeField} inputMode="numeric" placeholder="00000-000" disabled={!canEdit} /></label>
          </div>
        </div>

        <div className="panel">
          <h2>Representante</h2>
          <div className="company-settings-page__grid">
            <label className="field"><span className="field__label">Nome</span><input className="field__input" name="nome_representante" value={form.nome_representante} onChange={changeField} disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">CPF</span><input className="field__input" name="cpf_representante" value={form.cpf_representante} onChange={changeField} inputMode="numeric" placeholder="000.000.000-00" disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Cargo</span><input className="field__input" name="cargo_representante" value={form.cargo_representante} onChange={changeField} disabled={!canEdit} /></label>
          </div>
        </div>

        <div className="panel">
          <h2>Compras e cotações</h2>
          <p className="page__subtitle">Dados sugeridos ao criar uma cotação. Todos podem ser ajustados na própria cotação.</p>
          <div className="company-settings-page__grid">
            <label className="field company-settings-page__wide"><span className="field__label">Endereço padrão de entrega</span><input className="field__input" name="delivery_address" value={form.delivery_address} onChange={changeField} placeholder="Em branco, usa o endereço principal da empresa" disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">E-mail para resposta</span><input className="field__input" type="email" name="purchase_response_email" value={form.purchase_response_email} onChange={changeField} placeholder="Em branco, usa o e-mail principal" disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">WhatsApp para resposta</span><input className="field__input" name="purchase_response_whatsapp" value={form.purchase_response_whatsapp} onChange={changeField} inputMode="tel" placeholder="Em branco, usa o telefone principal" disabled={!canEdit} /></label>
            <label className="field"><span className="field__label">Responsável por compras</span><input className="field__input" name="purchase_responsible_name" value={form.purchase_responsible_name} onChange={changeField} placeholder="Em branco, usa o representante" disabled={!canEdit} /></label>
          </div>
        </div>

        {canEdit && <div className="page__actions"><button className="button button_primary" type="submit" disabled={saving}><Save size={17} /> {saving ? 'Salvando...' : 'Salvar configurações'}</button></div>}
      </form>
    </section>
  );
}
