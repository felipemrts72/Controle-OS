import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { ConfirmModal } from '../ConfirmModal/ConfirmModal.jsx';
import './ProductTreeEditor.css';

const key = () => crypto.randomUUID();
const fresh = () => ({ version: 0, request_id: key(), nodes: [{ key: key(), parent_key: null, product_id: null,
  new_product: { name: '', type: '' }, unit_code: '', quantity: '1', note: '' }] });
const nameOf = (node) => node.new_product?.name || node.name || 'Produto principal';

export function ProductTreeEditor({ productId }) {
  const user = getStoredUser();
  const canCreate = canAccessPermission(user, 'products.create');
  const canSave = productId ? canAccessPermission(user, 'products.edit') : canCreate;
  const storageKey = `olimen:product-tree:v1:${user?.id}:${productId || 'new'}`;
  const navigate = useNavigate();
  const [tree, setTree] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [types, setTypes] = useState([]);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [collapsed, setCollapsed] = useState(new Set());
  const [adding, setAdding] = useState(null);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let active = true;
    Promise.all([productId ? api.get(`/products/${productId}/tree`) : Promise.resolve({ data: fresh() }), api.get('/products/types'), api.get('/measurement-units')])
      .then(([saved, availableTypes, availableUnits]) => {
        if (!active) return;
        setTree({ ...saved.data, request_id: key() });
        setTypes(availableTypes.data.filter((t) => t.is_active)); setUnits(availableUnits.data);
        try {
          const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
          if (stored?.nodes?.length && stored.request_id && Number.isInteger(stored.version)) setDraft(stored);
        } catch { setNotice('Não foi possível ler o rascunho temporário deste navegador.'); }
      }).catch((e) => { if (active) setError(e.response?.data?.message || 'Não foi possível carregar a árvore. Recarregue a página.'); });
    return () => { active = false; };
  }, [productId, storageKey]);

  useEffect(() => {
    if (!dirty || !tree) return;
    try { localStorage.setItem(storageKey, JSON.stringify(tree)); }
    catch { setNotice('O navegador não permitiu preservar o rascunho. Mantenha esta página aberta até salvar.'); }
    const unload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, tree, storageKey]);

  useEffect(() => {
    setResults([]); setCursor(0);
    if (!adding || !search.trim()) { setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/products/search', { params: { q: search.trim(), component_candidates: true }, signal: controller.signal });
        if (!controller.signal.aborted) setResults(data);
      } catch (e) { if (!controller.signal.aborted) setError('Falha ao pesquisar produtos. Tente novamente.'); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [adding, search]);

  function change(nodes) {
    setTree((current) => ({ ...current, nodes, request_id: key() })); setDirty(true); setNotice(''); setError('');
  }

  useEffect(() => {
    if (adding && results[cursor]) document.getElementById(`tree-result-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, results, adding]);
  function patchRoot(field, value) {
    change(tree.nodes.map((node) => node.parent_key ? node : field === 'unit_code' ? { ...node, unit_code: value }
      : { ...node, new_product: { ...node.new_product, [field]: value } }));
  }
  function begin(parent) { setAdding(parent); setSearch(''); setResults([]); setError(''); }
  async function choose(product) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      let children = [];
      const node = { key: key(), parent_key: adding, product_id: product?.id || null,
        name: product?.name, type: product?.type, new_product: product ? undefined : { name: search.trim(), type: '' },
        unit_code: product?.measurement_unit_code || '', quantity: '1', note: '' };
      if (product) {
        const { data } = await api.get(`/products/${product.id}/tree`);
        const root = data.nodes.find((n) => !n.parent_key);
        const remap = new Map(data.nodes.map((n) => [n.key, n === root ? node.key : key()]));
        children = data.nodes.filter((n) => n.parent_key).map((n) => ({ ...n, key: remap.get(n.key), parent_key: remap.get(n.parent_key) }));
      }
      setDetail({ node, children, edit: false }); setDetailError(''); setAdding(null);
    } catch (e) { setError(e.response?.data?.message || 'Não foi possível carregar o componente.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function descendants(id) {
    const ids = new Set([id]); let size;
    do { size = ids.size; for (const n of tree.nodes) if (ids.has(n.parent_key)) ids.add(n.key); } while (size !== ids.size);
    return ids;
  }
  function acceptDetail(event) {
    event.preventDefault();
    const node = detail.node;
    const amount = String(node.quantity).replace(',', '.');
    if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0 || !units.some((u) => u.code === node.unit_code)) {
      setDetailError('Informe uma unidade e uma quantidade positiva com até seis casas decimais.'); return;
    }
    if (node.new_product && (!node.new_product.name.trim() || !types.some((t) => t.code === node.new_product.type))) {
      setDetailError('Informe nome e tipo do novo produto.'); return;
    }
    if (tree.nodes.some((n) => n.key !== node.key && n.parent_key === node.parent_key && (node.product_id ? n.product_id === node.product_id
      : n.new_product?.name.trim().toLocaleLowerCase() === node.new_product.name.trim().toLocaleLowerCase()))) {
      setDetailError('Este produto já está neste nível. Altere sua quantidade.'); return;
    }
    const next = detail.edit ? tree.nodes.map((n) => n.key === node.key ? { ...node, quantity: amount } : n)
      : [...tree.nodes, { ...node, quantity: amount }, ...detail.children];
    const byKey = new Map(next.map((n) => [n.key, n]));
    for (const child of next) {
      const seen = new Set([child.key]); const products = new Set(child.product_id ? [child.product_id] : []);
      let ancestor = byKey.get(child.parent_key);
      while (ancestor) {
        if (seen.has(ancestor.key) || (ancestor.product_id && products.has(ancestor.product_id))) { setDetailError('Não é possível criar uma referência circular.'); return; }
        seen.add(ancestor.key); if (ancestor.product_id) products.add(ancestor.product_id); ancestor = byKey.get(ancestor.parent_key);
      }
    }
    change(next); setCollapsed((current) => { const next = new Set(current); next.delete(node.parent_key); return next; }); setDetail(null);
  }
  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    // Mesmo request_id é mantido em falhas de rede para recuperar a resposta sem duplicar cadastros.
    try {
      const { data } = await (productId ? api.put(`/products/${productId}/tree`, tree) : api.post('/products/tree', tree));
      setDirty(false); setTree({ ...data, request_id: key() });
      try { localStorage.removeItem(storageKey); } catch { /* Salvamento confirmado no servidor. */ }
      setNotice('Árvore salva com sucesso. Os novos produtos agora estão cadastrados no estoque.');
      if (!productId) navigate(`/produtos/${data.product_id}`, { replace: true });
    } catch (e) { setError(e.response?.data?.message || 'Não foi possível confirmar o salvamento. O rascunho foi preservado; tente novamente.'); }
    finally { saving.current = false; setBusy(false); }
  }

  const root = tree?.nodes.find((n) => !n.parent_key);
  function renderNode(node) {
    const children = tree.nodes.filter((n) => n.parent_key === node.key);
    return <li key={node.key}>
      <article className={`product-tree__node ${!node.parent_key ? 'product-tree__root' : ''}`}>
        <strong>{nameOf(node)}</strong>
        <small>{node.new_product ? 'Novo · rascunho' : 'Produto do estoque'}</small>
        {node.parent_key && <span>{node.quantity} {node.unit_code}</span>}
        {node.note && <small>{node.note}</small>}
        <div className="product-tree__node-actions">
          {canSave && <button type="button" className="button" aria-label={`Adicionar componente a ${nameOf(node)}`} onClick={() => begin(node.key)}>+</button>}
          {canSave && node.parent_key && <>
            <button type="button" className="button" onClick={() => { setDetail({ node: structuredClone(node), edit: true, children: [] }); setDetailError(''); }}>Editar</button>
            <button type="button" className="button" onClick={() => {
              if (!window.confirm(`Remover ${nameOf(node)} e seus componentes desta árvore? Os produtos do estoque serão preservados.`)) return;
              const removed = descendants(node.key); change(tree.nodes.filter((n) => !removed.has(n.key)));
            }}>Remover</button>
          </>}
          {children.length > 0 && <button type="button" className="button" aria-expanded={!collapsed.has(node.key)} onClick={() => setCollapsed((current) => {
            const next = new Set(current); next.has(node.key) ? next.delete(node.key) : next.add(node.key); return next;
          })}>{collapsed.has(node.key) ? `Expandir (${children.length})` : 'Recolher'}</button>}
        </div>
        {adding === node.key && <div className="product-tree__search">
          <label>Pesquisar ou criar produto<input autoFocus className="field__input" role="combobox" aria-autocomplete="list"
            aria-expanded={Boolean(search)} aria-controls="product-tree-results" aria-activedescendant={results[cursor] ? `tree-result-${cursor}` : undefined}
            value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((i) => Math.max(0, Math.min(i + 1, results.length - 1))); }
              if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((i) => Math.max(0, i - 1)); }
              if (event.key === 'Enter') { event.preventDefault(); if (!searching && results[cursor]) choose(results[cursor]); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setAdding(null); }
            }} /></label>
          <button type="button" className="button" title="Abrir detalhes" disabled={!search.trim() || searching || (!results[cursor] && !canCreate)} onClick={() => choose(results[cursor] || null)}>Detalhes</button>
          {searching && <small>Pesquisando…</small>}
          <div role="listbox" id="product-tree-results" aria-label="Produtos encontrados">
            {results.map((product, i) => <button type="button" role="option" id={`tree-result-${i}`} aria-selected={i === cursor} className="product-tree__result" key={product.id}
              onMouseEnter={() => setCursor(i)} onClick={() => choose(product)}>{product.name}<small>{product.internal_code} · {product.type_name}</small></button>)}
          </div>
          {!searching && search.trim() && canCreate && <button type="button" className="button" onClick={() => choose(null)}>Criar novo produto: {search.trim()}</button>}
          <button type="button" className="button" onClick={() => setAdding(null)}>Cancelar</button>
        </div>}
      </article>
      {children.length > 0 && !collapsed.has(node.key) && <ul>{children.map(renderNode)}</ul>}
    </li>;
  }

  return <section className="product-tree panel" aria-label="Árvore do Produto">
    <div className="product-tree__heading"><div><h2>Árvore do Produto</h2><p>Monte a composição e salve tudo ao final.</p></div>
      <span>{dirty ? 'Rascunho não salvo' : tree?.version ? `Composição salva · versão ${tree.version}` : 'Composição em preparação'}</span></div>
    {error && <p className="product-tree__error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {draft && <div className="product-tree__draft"><strong>Há um rascunho temporário neste navegador.</strong><p>Ele ainda não é a composição oficial.</p>
      <button className="button" type="button" onClick={() => { setTree(draft); setDirty(true); setDraft(null); }}>Continuar rascunho</button>
      <button className="button" type="button" onClick={() => { try { localStorage.removeItem(storageKey); } catch { /* local storage unavailable */ } setDraft(null); }}>Descartar rascunho</button></div>}
    {!tree && !error && <p>Carregando composição…</p>}
    {tree && !draft && <fieldset disabled={busy} className="product-tree__workspace">
      {root?.new_product && <div className="product-tree__identity">
        <label className="field">Nome do produto principal<input className="field__input" maxLength={220} value={root.new_product.name} onChange={(e) => patchRoot('name', e.target.value)} /></label>
        <label className="field">Tipo do produto principal<select className="field__input" value={root.new_product.type} onChange={(e) => patchRoot('type', e.target.value)}><option value="">Selecione</option>{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
        <label className="field">Unidade do produto principal<select className="field__input" value={root.unit_code} onChange={(e) => patchRoot('unit_code', e.target.value)}><option value="">Selecione</option>{units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}</select></label>
      </div>}
      {root && !root.new_product && !root.unit_code && <label className="field">Unidade da composição<select className="field__input" value={root.unit_code} onChange={(e) => patchRoot('unit_code', e.target.value)}><option value="">Selecione</option>{units.map((u) => <option key={u.code} value={u.code}>{u.name}</option>)}</select></label>}
      <div className="product-tree__toolbar"><span>{tree.nodes.length} item(ns)</span>
        <button type="button" className="button" onClick={() => setCollapsed(new Set())}>Expandir tudo</button>
        <button type="button" className="button" aria-label="Diminuir árvore" onClick={() => setZoom((z) => Math.max(.5, z - .1))}>−</button>
        <button type="button" className="button" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className="button" aria-label="Ampliar árvore" onClick={() => setZoom((z) => Math.min(1.5, z + .1))}>+</button></div>
      <div className="product-tree__canvas" tabIndex={0} aria-label="Composição visual"><ul className="product-tree__branches" style={{ zoom }}>{root && renderNode(root)}</ul></div>
      {canSave && <button type="button" className="button button_primary" onClick={save}>{busy ? 'Salvando…' : 'Salvar árvore do produto'}</button>}
    </fieldset>}
    {detail && <ConfirmModal open title={detail.edit ? 'Editar componente' : 'Detalhes do componente'} onCancel={() => setDetail(null)} contentClassName="product-tree__modal" showCancel={false}>
      <form onSubmit={acceptDetail} className="product-tree__detail">
        {detailError && <p role="alert" className="product-tree__error">{detailError}</p>}
        <label className="field">Nome do produto<input className="field__input" required maxLength={220} disabled={!detail.node.new_product} value={detail.node.new_product ? detail.node.new_product.name : detail.node.name} onChange={(e) => setDetail({ ...detail, node: { ...detail.node, new_product: { ...detail.node.new_product, name: e.target.value } } })} /></label>
        <label className="field">Tipo<select className="field__input" required disabled={!detail.node.new_product} value={detail.node.new_product?.type || detail.node.type || ''} onChange={(e) => setDetail({ ...detail, node: { ...detail.node, new_product: { ...detail.node.new_product, type: e.target.value } } })}><option value="">Selecione</option>{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></label>
        <label className="field">Unidade de medida<select className="field__input" required value={detail.node.unit_code} onChange={(e) => setDetail({ ...detail, node: { ...detail.node, unit_code: e.target.value } })}><option value="">Selecione</option>{units.map((u) => <option key={u.code} value={u.code}>{u.code} — {u.name}</option>)}</select></label>
        <label className="field">Quantidade necessária<input className="field__input" required inputMode="decimal" value={detail.node.quantity} onChange={(e) => setDetail({ ...detail, node: { ...detail.node, quantity: e.target.value } })} /></label>
        <label className="field">Observação<textarea className="field__input" maxLength={1000} value={detail.node.note} onChange={(e) => setDetail({ ...detail, node: { ...detail.node, note: e.target.value } })} /></label>
        {detail.edit && <label className="field">Componente pai<select className="field__input" value={detail.node.parent_key} onChange={(e) => setDetail({ ...detail, node: { ...detail.node, parent_key: e.target.value } })}>{tree.nodes.filter((n) => !descendants(detail.node.key).has(n.key)).map((n) => <option key={n.key} value={n.key}>{nameOf(n)}</option>)}</select></label>}
        {detail.children.length > 0 && <small>A composição cadastrada será incluída neste rascunho. Alterações aqui não alteram a árvore original do componente.</small>}
        <div className="product-tree__toolbar"><button className="button" type="button" onClick={() => setDetail(null)}>Cancelar</button><button className="button button_primary" type="submit">{detail.edit ? 'Aplicar ao rascunho' : 'Adicionar à árvore'}</button></div>
      </form>
    </ConfirmModal>}
  </section>;
}
