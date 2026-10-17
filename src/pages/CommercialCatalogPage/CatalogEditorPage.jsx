import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Plus, Save, Send, Trash2 } from 'lucide-react';
import { api, apiErrorMessage, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './CommercialCatalog.css';
import { CatalogImage } from './CatalogImage.jsx';
import { QuickOperationalProductModal } from './QuickOperationalProductModal.jsx';

const blankVersion = (title = '') => ({ commercial_title: title, subtitle: '', presentation_text: '', applications_text: '', additional_text: '', notes: '', specifications: [], included_items: [], images: [] });
const CATALOG_REQUEST_TIMEOUT_MS = 15000;
const versionPayload = (v) => Object.fromEntries(['commercial_title', 'subtitle', 'presentation_text', 'applications_text', 'additional_text', 'notes', 'specifications', 'included_items'].map((key) => [key, v[key]]));

export function CatalogEditorPage() {
  const { commercialProductId } = useParams();
  const creating = !commercialProductId;
  const navigate = useNavigate();
  const toast = useToast();
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'commercial.catalog.create');
  const canEdit = canAccessPermission(user, 'commercial.catalog.edit');
  const canViewSop = canAccessPermission(user, 'commercial.catalog.sop.view');
  const canEditSop = canAccessPermission(user, 'commercial.catalog.sop.edit');
  const canPublish = canAccessPermission(user, 'commercial.catalog.publish');
  const [catalog, setCatalog] = useState(creating ? { configured: false, catalog_configured: false, versions: [] } : null);
  const [base, setBase] = useState({ name: '', commercial_code: '', is_active: true, operational_product_id: '', reference_price: '', commercial_description: '', sop_discount_type: '', sop_discount_value: '' });
  const [version, setVersion] = useState(blankVersion());
  const [operationalProducts, setOperationalProducts] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [sectors, setSectors] = useState([]);
  const [manufacturingSector, setManufacturingSector] = useState('');
  const [duplicateCandidates, setDuplicateCandidates] = useState([]);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [quickProduct, setQuickProduct] = useState(false);
  const [loading, setLoading] = useState(!creating);
  const [loadError, setLoadError] = useState('');

  async function load() {
    if (creating) return;
    try {
      setLoading(true);
      setLoadError('');
      const response = await api.get(`/commercial/catalog/products/${commercialProductId}`, { timeout: CATALOG_REQUEST_TIMEOUT_MS });
      const value = response.data;
      setCatalog(value);
      setBase({ name: value.commercial_name || value.product_name || '', commercial_code: value.commercial_code || '', is_active: value.is_active !== false, operational_product_id: value.operational_product_id || '', reference_price: value.reference_price ?? '', commercial_description: value.commercial_description || '', sop_discount_type: value.sop_discount_type || '', sop_discount_value: value.sop_discount_value ?? '' });
      if (value.operational_product_id) {
        setOperationalProducts((current) => current.some((product) => product.id === value.operational_product_id) ? current : [...current, {
          id: value.operational_product_id,
          name: value.operational_product_name,
          internal_code: value.operational_product_code,
        }]);
      }
      const chosen = value.versions?.find((item) => item.id === selectedVersionId) || value.versions?.[0];
      setSelectedVersionId(chosen?.id || '');
      setVersion(chosen ? { ...chosen } : blankVersion(value.product_name));
    } catch (error) {
      const message = apiErrorMessage(error, 'Não foi possível carregar o Catálogo.');
      setLoadError(message);
      toast.error(message);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [commercialProductId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/commercial/catalog/operational-products').then((response) => setOperationalProducts((current) => [...response.data, ...current.filter((product) => !response.data.some((option) => option.id === product.id))])).catch(() => {}); }, []);

  useEffect(() => {
    api.get('/commercial/catalog/manufacturing-sectors').then(({ data }) => {
      const active = data.filter((sector) => sector.is_active);
      setSectors(active);
      const solda = active.filter((sector) => sector.name.trim().toLocaleLowerCase('pt-BR') === 'solda');
      setManufacturingSector((current) => current || (solda.length === 1 ? solda[0].id : ''));
    }).catch((error) => toast.error(apiErrorMessage(error, 'Não foi possível carregar os setores.')));
  }, []);

  const minimum = useMemo(() => {
    const price = Number(base.reference_price); const discount = Number(base.sop_discount_value);
    if (!base.reference_price || !base.sop_discount_type || base.sop_discount_value === '') return null;
    return base.sop_discount_type === 'amount' ? Math.max(0, price - discount) : Math.max(0, price * (1 - discount / 100));
  }, [base]);
  const editableVersion = !creating && canEdit && !version.is_used;

  function chooseVersion(id) {
    setSelectedVersionId(id);
    const chosen = catalog.versions.find((item) => item.id === id);
    setVersion({ ...chosen });
  }
  function updateSpec(index, field, value) { setVersion((current) => ({ ...current, specifications: current.specifications.map((item, i) => i === index ? { ...item, [field]: value } : item) })); }
  function updateIncluded(index, field, value) { setVersion((current) => ({ ...current, included_items: current.included_items.map((item, i) => i === index ? { ...item, [field]: value } : item) })); }

  async function refreshUsage() {
    const current = (await api.get(`/commercial/catalog/products/${commercialProductId}`)).data;
    setCatalog(current);
    const fresh = current.versions.find((item) => item.id === version.id);
    setVersion((pending) => ({ ...pending, is_used: fresh?.is_used ?? true }));
  }
  function moveRow(field, index, direction) {
    setVersion((current) => {
      const items = [...current[field]]; const target = index + direction;
      if (target < 0 || target >= items.length) return current;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, [field]: items };
    });
  }
  function rowActions(field, index) {
    return editableVersion && <div className="catalog-editor__row-actions">
      <button className="button" type="button" aria-label="Subir item" disabled={index === 0 || saving} onClick={() => moveRow(field, index, -1)}>↑</button>
      <button className="button" type="button" aria-label="Descer item" disabled={index === version[field].length - 1 || saving} onClick={() => moveRow(field, index, 1)}>↓</button>
      <button className="button button_danger" type="button" aria-label="Remover item" disabled={saving} onClick={() => setVersion((c) => ({ ...c, [field]: c[field].filter((_, i) => i !== index) }))}><Trash2 size={16} /> Remover</button>
    </div>;
  }
  async function removeVersion() {
    setSaving(true);
    try { await api.delete(`/commercial/catalog/versions/${version.id}`); await load(); toast.success('Versão não utilizada excluída.'); }
    catch (error) { toast.error(apiErrorMessage(error)); if (error.response?.status === 409) await refreshUsage(); }
    finally { setSaving(false); }
  }
  async function saveBeforeImages() {
    if (version.id && editableVersion) await api.put(`/commercial/catalog/versions/${version.id}`, versionPayload(version));
  }
  async function previewPdf() {
    try {
      const response = await api.get(`/commercial/catalog/versions/${version.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = `catalogo-tecnico-v${version.version_number}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { toast.error('Não foi possível gerar o PDF da versão salva.'); }
  }

  async function saveAll(event) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const basePayload = { name: base.name, commercial_code: base.commercial_code || null, is_active: base.is_active,
        operational_product_id: base.operational_product_id || null, reference_price: base.reference_price, commercial_description: base.commercial_description,
        ...(canEditSop ? { sop_discount_type: base.sop_discount_type || null, sop_discount_value: base.sop_discount_type ? base.sop_discount_value : null } : {}) };
      if (creating) {
        if (!canCreate) throw new Error('Você não possui permissão para criar Produto Comercial.');
        const response = await api.post('/commercial/catalog/products', basePayload);
        toast.success('Produto Comercial criado. Complete o Catálogo Técnico quando desejar.');
        navigate(`/comercial/catalogo/${response.data.commercial_product_id}`, { replace: true });
        return;
      } else {
        if (!canEdit) throw new Error('Você não possui permissão para editar a ficha comercial.');
        await api.put(`/commercial/catalog/products/${commercialProductId}`, basePayload);
        if (version.id && editableVersion) await api.put(`/commercial/catalog/versions/${version.id}`, versionPayload(version));
        if (!version.id) { await createTechnicalCatalog(); return; }
        const current = (await api.get(`/commercial/catalog/products/${commercialProductId}`)).data;
        setCatalog(current); setBase((previous) => ({ ...previous, operational_product_id: current.operational_product_id || '' })); const selected = current.versions?.find((item) => item.id === version.id) || current.versions?.[0]; setVersion(selected || blankVersion(current.product_name)); setSelectedVersionId(selected?.id || '');
      }
      toast.success('Alterações salvas.');
    } catch (error) { toast.error(apiErrorMessage(error, 'Não foi possível salvar o Catálogo.')); if (error.response?.status === 409) await refreshUsage(); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function createTechnicalCatalog() {
    try {
      const response = await api.post('/commercial/catalog', {
        commercial_product_id: commercialProductId, operational_product_id: base.operational_product_id || null,
        manufacturing_sector_id: manufacturingSector || null, allow_duplicate_operational_product: allowDuplicate,
        reference_price: base.reference_price, commercial_description: base.commercial_description,
        ...(canEditSop ? { sop_discount_type: base.sop_discount_type || null, sop_discount_value: base.sop_discount_type ? base.sop_discount_value : null } : {}),
        version: { ...version, commercial_title: version.commercial_title || base.name },
      });
      const value = response.data;
      setCatalog(value);
      setBase((current) => ({ ...current, operational_product_id: value.operational_product_id || '' }));
      if (value.operational_product_id) setOperationalProducts((current) => current.some((p) => p.id === value.operational_product_id) ? current : [...current, { id: value.operational_product_id, name: value.operational_product_name, internal_code: value.operational_product_code }]);
      setDuplicateCandidates([]); setAllowDuplicate(false);
      const item = value.versions[0]; setVersion(item); setSelectedVersionId(item.id);
      toast.success('Catálogo Técnico criado em rascunho.');
    } catch (error) {
      if (error.response?.data?.code === 'OPERATIONAL_PRODUCT_NAME_EXISTS') setDuplicateCandidates(error.response.data.details?.candidates || []);
      toast.error(apiErrorMessage(error, 'Não foi possível criar o Catálogo Técnico.'));
    }
  }

  async function newVersion() { try { const response = await api.post(`/commercial/catalog/${catalog.id}/versions`, { source_version_id: version.id }); setCatalog(response.data); const item = response.data.versions[0]; setVersion(item); setSelectedVersionId(item.id); toast.success(`Versão ${item.version_number} criada em rascunho.`); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível criar versão.'); } }
  async function publish() { setSaving(true); try { const response = await api.post(`/commercial/catalog/versions/${version.id}/publish`, { version: versionPayload(version) }); setCatalog(response.data); const item = response.data.versions.find((entry) => entry.id === version.id); setVersion(item); toast.success('Versão publicada e ativada.'); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível publicar.'); if (error.response?.status === 409) await refreshUsage(); } finally { setSaving(false); } }
  async function upload(event) { const file = event.target.files?.[0]; if (!file) return; try { await saveBeforeImages(); await api.post(`/commercial/catalog/versions/${version.id}/images`, await file.arrayBuffer(), { headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } }); await load(); toast.success('Imagem adicionada.'); } catch (error) { toast.error(error.response?.data?.message || 'Falha no upload.'); } event.target.value = ''; }
  async function imageAction(image, action) { try { await saveBeforeImages(); if (action === 'delete') await api.delete(`/commercial/catalog/images/${image.id}`); else await api.patch(`/commercial/catalog/images/${image.id}`, { caption: image.caption, position: image.position, is_primary: true }); await load(); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível alterar a imagem.'); } }
  async function moveImage(index, direction) { const otherIndex = index + direction; if (otherIndex < 0 || otherIndex >= version.images.length) return; const current = version.images[index]; const other = version.images[otherIndex]; try { await saveBeforeImages(); await api.patch(`/commercial/catalog/images/${current.id}`, { caption: current.caption, position: other.position, is_primary: current.is_primary }); await api.patch(`/commercial/catalog/images/${other.id}`, { caption: other.caption, position: current.position, is_primary: other.is_primary }); await load(); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível reordenar as imagens.'); } }
  function updateImageCaption(index, value) { setVersion((current) => ({ ...current, images: current.images.map((image, i) => i === index ? { ...image, caption: value } : image) })); }
  async function saveImageCaption(image) { try { await api.patch(`/commercial/catalog/images/${image.id}`, { caption: image.caption, position: image.position, is_primary: image.is_primary }); toast.success('Legenda salva.'); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível salvar a legenda.'); } }

  if (loading && !catalog) return <section className="page"><div className="panel">Carregando...</div></section>;
  if (!catalog) return <section className="page"><div className="panel commercial-catalog__feedback commercial-catalog__feedback_error"><p>{loadError || 'Não foi possível carregar o Catálogo.'}</p><button className="button" type="button" onClick={load}>Tentar novamente</button></div></section>;
  return <form className="page catalog-editor" onSubmit={saveAll}>
    {quickProduct && <QuickOperationalProductModal name={base.name} commercialProductId={commercialProductId} onClose={() => setQuickProduct(false)} onCreated={(product) => { setOperationalProducts((items) => [product, ...items]); setBase((current) => ({ ...current, operational_product_id: product.id })); setQuickProduct(false); toast.success('Produto criado e selecionado. Pendente de revisão.'); }} />}
    <header className="page__header"><div><h1 className="page__title">{creating ? 'Novo produto comercial' : base.name}</h1><p>{creating ? 'Cadastro simples e independente do Estoque/Produção' : `Código comercial ${catalog.commercial_number || '—'} · ${catalog.operational_product_name ? `Produto interno vinculado: ${catalog.operational_product_name}` : 'Sem Produto interno vinculado'}`}</p></div><Link className="button" to="/comercial/catalogo"><ArrowLeft size={17} /> Voltar</Link></header>
    <section className="panel catalog-editor__section"><h2>Ficha comercial</h2><div className="form-grid"><label className="field"><span className="field__label">Nome comercial *</span><input className="field__input" value={base.name} onChange={(e) => setBase((c) => ({ ...c, name: e.target.value }))} disabled={!creating && !canEdit} required /></label><label className="field"><span className="field__label">Código comercial</span><input className="field__input" value={catalog?.commercial_number || 'Atribuído ao criar'} readOnly />{base.commercial_code && base.commercial_code !== String(catalog?.commercial_number) && <small>Referência anterior: {base.commercial_code}</small>}</label><label className="field"><span className="field__label">Preço de referência (R$)</span><input className="field__input" type="number" min="0" step="0.01" value={base.reference_price} onChange={(e) => setBase((c) => ({ ...c, reference_price: e.target.value }))} disabled={!creating && !canEdit} /></label><label className="field"><span className="field__label">Produto do Estoque <small>(opcional)</small></span><span className="catalog-editor__operational"><select className="field__input" value={base.operational_product_id} onChange={(e) => setBase((c) => ({ ...c, operational_product_id: e.target.value }))} disabled={!creating && !canEdit}><option value="">Nenhum</option>{operationalProducts.map((product) => <option key={product.id} value={product.id}>{product.internal_code ? `${product.internal_code} — ` : ''}{product.name}</option>)}</select>{(creating ? canCreate : canEdit) && canAccessPermission(user, 'products.create') && <button className="button" type="button" aria-label="Criar Produto do Estoque" onClick={() => setQuickProduct(true)}><Plus size={18} /></button>}</span></label><label className="field catalog-editor__wide"><span className="field__label">Descrição comercial</span><textarea className="field__input" value={base.commercial_description} onChange={(e) => setBase((c) => ({ ...c, commercial_description: e.target.value }))} disabled={!creating && !canEdit} /></label><label className="catalog-editor__active"><input type="checkbox" checked={base.is_active} onChange={(e) => setBase((c) => ({ ...c, is_active: e.target.checked }))} disabled={!creating && !canEdit} /> Produto Comercial ativo</label></div>
      {canViewSop && <div className="catalog-editor__sop"><h3>SOP Comercial <small>informação interna</small></h3><div className="form-grid"><label className="field"><span className="field__label">Tipo de limite</span><select className="field__input" value={base.sop_discount_type} onChange={(e) => setBase((c) => ({ ...c, sop_discount_type: e.target.value, sop_discount_value: '' }))} disabled={!canEditSop}><option value="">Sem limite definido</option><option value="amount">Valor máximo em reais</option><option value="percentage">Percentual máximo</option></select></label><label className="field"><span className="field__label">Desconto máximo</span><input className="field__input" type="number" min="0" step={base.sop_discount_type === 'percentage' ? '0.01' : '0.01'} value={base.sop_discount_value} onChange={(e) => setBase((c) => ({ ...c, sop_discount_value: e.target.value }))} disabled={!canEditSop || !base.sop_discount_type} /></label><div className="catalog-editor__minimum"><span>Preço mínimo dentro da SOP</span><strong>{minimum == null ? 'Não definido' : minimum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div></div></div>}
    </section>
    {!creating && !version.id && !base.operational_product_id && <section className="panel catalog-editor__section">
      <p>Como nenhum produto do estoque foi selecionado, criaremos um automaticamente ao salvar o Catálogo.</p>
      <label className="field"><span className="field__label">Setor responsável pela fabricação</span><select className="field__input" value={manufacturingSector} onChange={(event) => setManufacturingSector(event.target.value)} required disabled={saving || !canEdit}><option value="">Selecionar setor</option>{sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
      {duplicateCandidates.length > 0 && <div role="alert"><p>Já existe um produto no Estoque com este nome.</p>{duplicateCandidates.filter((p) => p.is_active).map((product) => <button className="button" type="button" key={product.id} onClick={() => { setOperationalProducts((current) => current.some((p) => p.id === product.id) ? current : [...current, product]); setBase((current) => ({ ...current, operational_product_id: product.id })); setDuplicateCandidates([]); setAllowDuplicate(false); }}>Selecionar existente: {product.internal_code} — {product.name}</button>)}<label className="field"><span><input type="checkbox" checked={allowDuplicate} onChange={(event) => setAllowDuplicate(event.target.checked)} /> Criar novo mesmo assim</span></label></div>}
    </section>}
    <section className="panel catalog-editor__section">
      <div className="catalog-editor__version-head">
        <div><h2>Catálogo Técnico</h2>{catalog.catalog_configured && <select aria-label="Versão do catálogo" className="field__input" value={selectedVersionId} onChange={(e) => chooseVersion(e.target.value)}>{catalog.versions.map((item) => <option key={item.id} value={item.id}>Versão {item.version_number} · {item.status === 'draft' ? 'Rascunho' : item.id === catalog.active_version_id ? 'Publicada / ativa' : 'Histórica'}</option>)}</select>}</div>
        <div>{version.id && <button className="button" type="button" disabled={saving} onClick={previewPdf}>PDF da versão salva</button>}{version.is_used && canEdit && <button className="button button_primary" type="button" disabled={saving} onClick={newVersion}><Plus size={17} /> Criar nova versão</button>}
          {version.id && !version.is_used && canEdit && <button className="button" type="button" disabled={saving} onClick={removeVersion}><Trash2 size={17} /> Excluir versão</button>}
          {version.id && version.status === 'draft' && canPublish && editableVersion && <button className="button button_primary" type="button" disabled={saving} onClick={publish}><Send size={17} /> Salvar e publicar</button>}</div>
      </div>
      {version.id && <p className="catalog-editor__immutable" role="status">{version.is_used ? 'Esta versão já foi utilizada e está protegida. Crie uma nova versão para realizar mudanças.' : 'Não utilizada — você pode salvar alterações nesta mesma versão.'}</p>}
      <div className="form-grid catalog-editor__main-fields">
        <label className="field"><span className="field__label">01 — Título comercial</span><input className="field__input" value={version.commercial_title || ''} onChange={(e) => setVersion((c) => ({ ...c, commercial_title: e.target.value }))} disabled={!editableVersion || saving} /></label>
        <label className="field"><span className="field__label">02 — Subtítulo</span><textarea rows={2} className="field__input catalog-editor__short-text" value={version.subtitle || ''} onChange={(e) => setVersion((c) => ({ ...c, subtitle: e.target.value }))} disabled={!editableVersion || saving} /></label>
        <label className="field catalog-editor__wide"><span className="field__label">03 — Apresentação</span><textarea className="field__input" value={version.presentation_text || ''} onChange={(e) => setVersion((c) => ({ ...c, presentation_text: e.target.value }))} disabled={!editableVersion || saving} /></label>
      </div>
      <h2>04 — Especificações</h2>
      {version.specifications.map((item, index) => <div className="catalog-editor__technical-row" key={item.id || index}>
        <label className="field"><span className="field__label">Característica</span><input className="field__input" value={item.name} onChange={(e) => updateSpec(index, 'name', e.target.value)} disabled={!editableVersion || saving} /></label>
        <label className="field"><span className="field__label">Valor</span><input className="field__input" value={item.value} onChange={(e) => updateSpec(index, 'value', e.target.value)} disabled={!editableVersion || saving} />{item.unit && <small>Unidade existente: {item.unit}</small>}</label>
        {rowActions('specifications', index)}
      </div>)}
      {editableVersion && <button className="button catalog-editor__add" type="button" disabled={saving} onClick={() => setVersion((c) => ({ ...c, specifications: [...c.specifications, { name: '', value: '' }] }))}><Plus size={17} /> Adicionar especificação</button>}
      <h2>05 — Itens inclusos</h2>
      {version.included_items.map((item, index) => <div className="catalog-editor__technical-row catalog-editor__technical-row_included" key={item.id || index}>
        <label className="field"><span className="field__label">Descrição do item</span><textarea rows={2} className="field__input catalog-editor__short-text" value={item.description} onChange={(e) => updateIncluded(index, 'description', e.target.value)} disabled={!editableVersion || saving} /></label>
        {rowActions('included_items', index)}
      </div>)}
      {editableVersion && <button className="button catalog-editor__add" type="button" disabled={saving} onClick={() => setVersion((c) => ({ ...c, included_items: [...c.included_items, { description: '' }] }))}><Plus size={17} /> Adicionar item incluso</button>}
      <label className="field"><span className="field__label">06 — Aplicações</span><textarea className="field__input" placeholder="Onde e como este equipamento é aplicado" value={version.applications_text || ''} onChange={(e) => setVersion((c) => ({ ...c, applications_text: e.target.value }))} disabled={!editableVersion || saving} /></label>
      <label className="field"><span className="field__label">07 — Observações</span><textarea className="field__input" placeholder="Informações complementares da ficha" value={version.additional_text || ''} onChange={(e) => setVersion((c) => ({ ...c, additional_text: e.target.value }))} disabled={!editableVersion || saving} /></label>
      {version.notes && <label className="field"><span className="field__label">Observações complementares existentes</span><textarea className="field__input" value={version.notes} onChange={(e) => setVersion((c) => ({ ...c, notes: e.target.value }))} disabled={!editableVersion || saving} /></label>}
    </section>
    <section className="panel catalog-editor__section"><div className="catalog-editor__version-head"><h2>Imagens comerciais</h2>{version.id && editableVersion && <label className="button"><ImagePlus size={17} /> Adicionar imagem<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} /></label>}</div><div className="catalog-editor__image-list">{(version.images || []).map((image, index) => <div key={image.id}><CatalogImage imageId={image.id} alt={image.caption || image.original_name} /><div className="catalog-editor__image-content"><strong>{image.original_name}{image.is_primary ? ' · principal' : ''}</strong><input className="field__input" placeholder="Legenda" value={image.caption || ''} onChange={(event) => updateImageCaption(index, event.target.value)} disabled={!editableVersion} /></div>{editableVersion && <div><button className="button" type="button" disabled={index === 0} onClick={() => moveImage(index, -1)}>↑</button><button className="button" type="button" disabled={index === version.images.length - 1} onClick={() => moveImage(index, 1)}>↓</button><button className="button" type="button" onClick={() => saveImageCaption(image)}>Salvar legenda</button><button className="button" type="button" onClick={() => imageAction(image, 'primary')}>Principal</button><button className="button button_danger" type="button" onClick={() => imageAction(image, 'delete')}><Trash2 size={15} /></button></div>}</div>)}{!(version.images || []).length && <p>Sem imagens comerciais.</p>}</div></section>
    {(creating ? canCreate : canEdit) && <button className="button button_primary catalog-editor__save" type="submit" disabled={saving}><Save size={18} /> {saving ? 'Salvando...' : creating ? 'Criar Produto Comercial' : !version.id ? 'Criar primeira versão' : version.is_used ? 'Salvar ficha comercial' : 'Salvar alterações'}</button>}
  </form>;
}
