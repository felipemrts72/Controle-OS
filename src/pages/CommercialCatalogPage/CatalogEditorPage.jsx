import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Plus, Save, Send, Trash2 } from 'lucide-react';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import './CommercialCatalog.css';
import { CatalogImage } from './CatalogImage.jsx';

const blankVersion = (title = '') => ({ commercial_title: title, subtitle: '', presentation_text: '', applications_text: '', additional_text: '', notes: '', specifications: [], included_items: [], images: [] });

export function CatalogEditorPage() {
  const { commercialProductId } = useParams();
  const creating = commercialProductId === 'novo';
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

  async function load() {
    if (creating) return;
    try {
      const response = await api.get(`/commercial/catalog/products/${commercialProductId}`);
      const value = response.data;
      setCatalog(value);
      setBase({ name: value.commercial_name || value.product_name || '', commercial_code: value.commercial_code || '', is_active: value.is_active !== false, operational_product_id: value.operational_product_id || '', reference_price: value.reference_price ?? '', commercial_description: value.commercial_description || '', sop_discount_type: value.sop_discount_type || '', sop_discount_value: value.sop_discount_value ?? '' });
      const chosen = value.versions?.find((item) => item.id === selectedVersionId) || value.versions?.[0];
      setSelectedVersionId(chosen?.id || '');
      setVersion(chosen ? { ...chosen } : blankVersion(value.product_name));
    } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível carregar o Catálogo.'); }
  }
  useEffect(() => { load(); }, [commercialProductId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/commercial/catalog/operational-products').then((response) => setOperationalProducts(response.data)).catch(() => setOperationalProducts([])); }, []);

  const minimum = useMemo(() => {
    const price = Number(base.reference_price); const discount = Number(base.sop_discount_value);
    if (!base.reference_price || !base.sop_discount_type || base.sop_discount_value === '') return null;
    return base.sop_discount_type === 'amount' ? Math.max(0, price - discount) : Math.max(0, price * (1 - discount / 100));
  }, [base]);
  const editableVersion = catalog?.catalog_configured && canEdit && version.status !== 'published' && version.status !== 'archived';

  function chooseVersion(id) {
    setSelectedVersionId(id);
    const chosen = catalog.versions.find((item) => item.id === id);
    setVersion({ ...chosen });
  }
  function updateSpec(index, field, value) { setVersion((current) => ({ ...current, specifications: current.specifications.map((item, i) => i === index ? { ...item, [field]: value } : item) })); }
  function updateIncluded(index, field, value) { setVersion((current) => ({ ...current, included_items: current.included_items.map((item, i) => i === index ? { ...item, [field]: value } : item) })); }

  async function saveAll(event) {
    event.preventDefault(); setSaving(true);
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
        if (version.id && editableVersion) await api.put(`/commercial/catalog/versions/${version.id}`, version);
        const current = (await api.get(`/commercial/catalog/products/${commercialProductId}`)).data;
        setCatalog(current); const selected = current.versions?.find((item) => item.id === version.id) || current.versions?.[0]; setVersion(selected || blankVersion(current.product_name)); setSelectedVersionId(selected?.id || '');
      }
      toast.success('Ficha comercial salva.');
    } catch (error) { toast.error(error.response?.data?.message || error.message || 'Não foi possível salvar o Catálogo.'); }
    finally { setSaving(false); }
  }

  async function createTechnicalCatalog() { try { const response = await api.post('/commercial/catalog', { commercial_product_id: commercialProductId, reference_price: base.reference_price, commercial_description: base.commercial_description, ...(canEditSop ? { sop_discount_type: base.sop_discount_type || null, sop_discount_value: base.sop_discount_type ? base.sop_discount_value : null } : {}), version: { ...blankVersion(base.name), commercial_title: base.name } }); setCatalog(response.data); const item = response.data.versions[0]; setVersion(item); setSelectedVersionId(item.id); toast.success('Catálogo Técnico criado em rascunho.'); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível criar o Catálogo Técnico.'); } }

  async function newVersion() { try { const response = await api.post(`/commercial/catalog/${catalog.id}/versions`); setCatalog(response.data); const item = response.data.versions[0]; setVersion(item); setSelectedVersionId(item.id); toast.success(`Versão ${item.version_number} criada em rascunho.`); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível criar versão.'); } }
  async function publish() { try { const response = await api.post(`/commercial/catalog/versions/${version.id}/publish`); setCatalog(response.data); const item = response.data.versions.find((entry) => entry.id === version.id); setVersion(item); toast.success('Versão publicada e ativada.'); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível publicar.'); } }
  async function upload(event) { const file = event.target.files?.[0]; if (!file) return; try { await api.post(`/commercial/catalog/versions/${version.id}/images`, await file.arrayBuffer(), { headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) } }); await load(); toast.success('Imagem adicionada.'); } catch (error) { toast.error(error.response?.data?.message || 'Falha no upload.'); } event.target.value = ''; }
  async function imageAction(image, action) { try { if (action === 'delete') await api.delete(`/commercial/catalog/images/${image.id}`); else await api.patch(`/commercial/catalog/images/${image.id}`, { caption: image.caption, position: image.position, is_primary: true }); await load(); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível alterar a imagem.'); } }
  async function moveImage(index, direction) { const otherIndex = index + direction; if (otherIndex < 0 || otherIndex >= version.images.length) return; const current = version.images[index]; const other = version.images[otherIndex]; try { await api.patch(`/commercial/catalog/images/${current.id}`, { caption: current.caption, position: other.position, is_primary: current.is_primary }); await api.patch(`/commercial/catalog/images/${other.id}`, { caption: other.caption, position: current.position, is_primary: other.is_primary }); await load(); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível reordenar as imagens.'); } }
  function updateImageCaption(index, value) { setVersion((current) => ({ ...current, images: current.images.map((image, i) => i === index ? { ...image, caption: value } : image) })); }
  async function saveImageCaption(image) { try { await api.patch(`/commercial/catalog/images/${image.id}`, { caption: image.caption, position: image.position, is_primary: image.is_primary }); toast.success('Legenda salva.'); } catch (error) { toast.error(error.response?.data?.message || 'Não foi possível salvar a legenda.'); } }

  if (!catalog) return <section className="page"><div className="panel">Carregando...</div></section>;
  return <form className="page catalog-editor" onSubmit={saveAll}>
    <header className="page__header"><div><h1 className="page__title">{creating ? 'Novo produto comercial' : base.name}</h1><p>{creating ? 'Cadastro simples e independente do Estoque/Produção' : `${base.commercial_code || 'Sem código comercial'} · ${catalog.operational_product_name ? `Produto interno vinculado: ${catalog.operational_product_name}` : 'Sem Produto interno vinculado'}`}</p></div><Link className="button" to="/comercial/catalogo"><ArrowLeft size={17} /> Voltar</Link></header>
    <section className="panel catalog-editor__section"><h2>Ficha comercial</h2><div className="form-grid"><label className="field"><span className="field__label">Nome comercial *</span><input className="field__input" value={base.name} onChange={(e) => setBase((c) => ({ ...c, name: e.target.value }))} disabled={!creating && !canEdit} required /></label><label className="field"><span className="field__label">Código comercial</span><input className="field__input" value={base.commercial_code} onChange={(e) => setBase((c) => ({ ...c, commercial_code: e.target.value }))} disabled={!creating && !canEdit} /></label><label className="field"><span className="field__label">Preço de referência (R$)</span><input className="field__input" type="number" min="0" step="0.01" value={base.reference_price} onChange={(e) => setBase((c) => ({ ...c, reference_price: e.target.value }))} disabled={!creating && !canEdit} /></label><label className="field"><span className="field__label">Produto interno vinculado <small>(opcional)</small></span><select className="field__input" value={base.operational_product_id} onChange={(e) => setBase((c) => ({ ...c, operational_product_id: e.target.value }))} disabled={!creating && !canEdit}><option value="">Nenhum</option>{operationalProducts.map((product) => <option key={product.id} value={product.id}>{product.internal_code ? `${product.internal_code} — ` : ''}{product.name}</option>)}</select></label><label className="field catalog-editor__wide"><span className="field__label">Descrição comercial</span><textarea className="field__input" value={base.commercial_description} onChange={(e) => setBase((c) => ({ ...c, commercial_description: e.target.value }))} disabled={!creating && !canEdit} /></label><label className="catalog-editor__active"><input type="checkbox" checked={base.is_active} onChange={(e) => setBase((c) => ({ ...c, is_active: e.target.checked }))} disabled={!creating && !canEdit} /> Produto Comercial ativo</label></div>
      {canViewSop && <div className="catalog-editor__sop"><h3>SOP Comercial <small>informação interna</small></h3><div className="form-grid"><label className="field"><span className="field__label">Tipo de limite</span><select className="field__input" value={base.sop_discount_type} onChange={(e) => setBase((c) => ({ ...c, sop_discount_type: e.target.value, sop_discount_value: '' }))} disabled={!canEditSop}><option value="">Sem limite definido</option><option value="amount">Valor máximo em reais</option><option value="percentage">Percentual máximo</option></select></label><label className="field"><span className="field__label">Desconto máximo</span><input className="field__input" type="number" min="0" step={base.sop_discount_type === 'percentage' ? '0.01' : '0.01'} value={base.sop_discount_value} onChange={(e) => setBase((c) => ({ ...c, sop_discount_value: e.target.value }))} disabled={!canEditSop || !base.sop_discount_type} /></label><div className="catalog-editor__minimum"><span>Preço mínimo dentro da SOP</span><strong>{minimum == null ? 'Não definido' : minimum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div></div></div>}
    </section>
    <section className="panel catalog-editor__section"><div className="catalog-editor__version-head"><div><h2>Catálogo Técnico / Versão</h2>{catalog.catalog_configured && <select className="field__input" value={selectedVersionId} onChange={(e) => chooseVersion(e.target.value)}>{catalog.versions.map((item) => <option key={item.id} value={item.id}>v{item.version_number} · {item.status === 'draft' ? 'Rascunho' : item.status === 'published' ? 'Publicada' : 'Histórica'}</option>)}</select>}</div><div>{!creating && !catalog.catalog_configured && canEdit && <button className="button button_primary" type="button" onClick={createTechnicalCatalog}><Plus size={17} /> Criar Catálogo Técnico</button>}{catalog.catalog_configured && canEdit && <button className="button" type="button" onClick={newVersion}><Plus size={17} /> Nova versão</button>}{version.id && version.status === 'draft' && canPublish && <button className="button button_primary" type="button" onClick={publish}><Send size={17} /> Publicar</button>}</div></div>
      {!creating && !catalog.catalog_configured && <p className="catalog-editor__immutable">Produto Comercial válido sem Catálogo Técnico. Crie a primeira versão quando o conteúdo estiver disponível.</p>}
      {!editableVersion && catalog.catalog_configured && <p className="catalog-editor__immutable">Esta versão é imutável. Crie uma nova versão para alterar o conteúdo.</p>}
      <div className="form-grid"><label className="field"><span className="field__label">Título comercial</span><input className="field__input" value={version.commercial_title || ''} onChange={(e) => setVersion((c) => ({ ...c, commercial_title: e.target.value }))} disabled={catalog.configured && !editableVersion} /></label><label className="field"><span className="field__label">Subtítulo</span><input className="field__input" value={version.subtitle || ''} onChange={(e) => setVersion((c) => ({ ...c, subtitle: e.target.value }))} disabled={catalog.configured && !editableVersion} /></label><label className="field catalog-editor__wide"><span className="field__label">Apresentação</span><textarea className="field__input" value={version.presentation_text || ''} onChange={(e) => setVersion((c) => ({ ...c, presentation_text: e.target.value }))} disabled={catalog.configured && !editableVersion} /></label><label className="field catalog-editor__wide"><span className="field__label">Aplicações</span><textarea className="field__input" value={version.applications_text || ''} onChange={(e) => setVersion((c) => ({ ...c, applications_text: e.target.value }))} disabled={catalog.configured && !editableVersion} /></label><label className="field catalog-editor__wide"><span className="field__label">Textos adicionais</span><textarea className="field__input" value={version.additional_text || ''} onChange={(e) => setVersion((c) => ({ ...c, additional_text: e.target.value }))} disabled={catalog.configured && !editableVersion} /></label></div>
    </section>
    <section className="panel catalog-editor__section"><div className="catalog-editor__version-head"><h2>Imagens comerciais</h2>{version.id && editableVersion && <label className="button"><ImagePlus size={17} /> Adicionar imagem<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} /></label>}</div><div className="catalog-editor__image-list">{(version.images || []).map((image, index) => <div key={image.id}><CatalogImage imageId={image.id} alt={image.caption || image.original_name} /><div className="catalog-editor__image-content"><strong>{image.original_name}{image.is_primary ? ' · principal' : ''}</strong><input className="field__input" placeholder="Legenda" value={image.caption || ''} onChange={(event) => updateImageCaption(index, event.target.value)} disabled={!editableVersion} /></div>{editableVersion && <div><button className="button" type="button" disabled={index === 0} onClick={() => moveImage(index, -1)}>↑</button><button className="button" type="button" disabled={index === version.images.length - 1} onClick={() => moveImage(index, 1)}>↓</button><button className="button" type="button" onClick={() => saveImageCaption(image)}>Salvar legenda</button><button className="button" type="button" onClick={() => imageAction(image, 'primary')}>Principal</button><button className="button button_danger" type="button" onClick={() => imageAction(image, 'delete')}><Trash2 size={15} /></button></div>}</div>)}{!(version.images || []).length && <p>Sem imagens comerciais.</p>}</div></section>
    <section className="panel catalog-editor__section"><div className="catalog-editor__version-head"><h2>Especificações</h2>{editableVersion && <button className="button" type="button" onClick={() => setVersion((c) => ({ ...c, specifications: [...c.specifications, { name: '', value: '', unit: '' }] }))}><Plus size={17} /> Adicionar</button>}</div>{version.specifications.map((item, index) => <div className="catalog-editor__row" key={item.id || index}><input className="field__input" placeholder="Nome" value={item.name} onChange={(e) => updateSpec(index, 'name', e.target.value)} disabled={!editableVersion} /><input className="field__input" placeholder="Valor" value={item.value} onChange={(e) => updateSpec(index, 'value', e.target.value)} disabled={!editableVersion} /><input className="field__input" placeholder="Unidade" value={item.unit || ''} onChange={(e) => updateSpec(index, 'unit', e.target.value)} disabled={!editableVersion} />{editableVersion && <button className="button button_danger" type="button" onClick={() => setVersion((c) => ({ ...c, specifications: c.specifications.filter((_, i) => i !== index) }))}><Trash2 size={15} /></button>}</div>)}</section>
    <section className="panel catalog-editor__section"><div className="catalog-editor__version-head"><h2>Itens inclusos</h2>{editableVersion && <button className="button" type="button" onClick={() => setVersion((c) => ({ ...c, included_items: [...c.included_items, { description: '', quantity: '', unit: '', notes: '' }] }))}><Plus size={17} /> Adicionar</button>}</div>{version.included_items.map((item, index) => <div className="catalog-editor__row" key={item.id || index}><input className="field__input" placeholder="Descrição" value={item.description} onChange={(e) => updateIncluded(index, 'description', e.target.value)} disabled={!editableVersion} /><input className="field__input" type="number" placeholder="Qtd." value={item.quantity || ''} onChange={(e) => updateIncluded(index, 'quantity', e.target.value)} disabled={!editableVersion} /><input className="field__input" placeholder="Unidade" value={item.unit || ''} onChange={(e) => updateIncluded(index, 'unit', e.target.value)} disabled={!editableVersion} />{editableVersion && <button className="button button_danger" type="button" onClick={() => setVersion((c) => ({ ...c, included_items: c.included_items.filter((_, i) => i !== index) }))}><Trash2 size={15} /></button>}</div>)}</section>
    {(creating ? canCreate : canEdit) && <button className="button button_primary catalog-editor__save" type="submit" disabled={saving}><Save size={18} /> {saving ? 'Salvando...' : creating ? 'Criar Produto Comercial' : 'Salvar ficha comercial'}</button>}
  </form>;
}
