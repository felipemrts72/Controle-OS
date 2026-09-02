import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PackagePlus, Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from '../../components/ToastProvider/ToastProvider.jsx';
import { api, getStoredUser } from '../../services/api.js';
import { canAccessPermission } from '../../utils/permissions.js';
import { calculatePreview, formatMoney, PAYMENT_TYPES, quoteCommercialLabel, todayInput } from './quoteUi.js';
import './CommercialQuotes.css';

const emptyPayment = () => ({ method_type: 'pix', description: 'PIX', calculation_type: 'amount', amount: '', percentage: '', installment_count: 1, first_due_date: '', notes: '' });
const manualItem = () => ({ item_type: 'manual', product_id: null, commercial_product_id: null, code: '', name: '', unit: 'UN', description: '', quantity: 1, unit_price: '', discount_amount: 0, save_product: true });

function editableNumber(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function sopState(item) {
  if ((!item.product_id && !item.commercial_product_id) || item.sop_minimum_price == null) return null;
  const quantity = Number(item.quantity) || 0;
  const effective = quantity > 0 ? Math.max(0, ((Number(item.unit_price) || 0) * quantity - (Number(item.discount_amount) || 0)) / quantity) : 0;
  return { effective, outside: effective + 0.001 < Number(item.sop_minimum_price) };
}

export function QuoteFormPage({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canCreateCustomer = canAccessPermission(getStoredUser(), 'commercial.customers.create');
  const editing = mode === 'edit';
  const formRef = useRef(null);
  const productInputRef = useRef(null);
  const customerAutocompleteRef = useRef(null);
  const productAutocompleteRef = useRef(null);
  const [form, setForm] = useState({ customer_id: '', quote_date: todayInput(), valid_until: '', discount_amount: 0, freight_amount: 0, notes: '', internal_notes: '' });
  const [customer, setCustomer] = useState(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [customerActive, setCustomerActive] = useState(-1);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [productActive, setProductActive] = useState(-1);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([emptyPayment()]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    (async () => {
      try {
        const quote = (await api.get(`/commercial/quotes/${id}`)).data;
        if (quote.status !== 'draft') {
          toast.error('Somente orçamentos em rascunho podem ser editados.');
          navigate(`/comercial/orcamentos/${id}`, { replace: true });
          return;
        }
        setForm({ customer_id: quote.customer_id || '', quote_date: String(quote.quote_date).slice(0, 10), valid_until: quote.valid_until ? String(quote.valid_until).slice(0, 10) : '', discount_amount: editableNumber(quote.discount_amount), freight_amount: editableNumber(quote.freight_amount), notes: quote.notes || '', internal_notes: quote.internal_notes || '' });
        setCustomer(quote.customer_id ? { id: quote.customer_id, name: quote.customer_name_snapshot, trade_name: quote.customer_snapshot?.trade_name } : null);
        setCustomerQuery(quote.customer_name_snapshot === 'Cliente não identificado' ? '' : quote.customer_name_snapshot || '');
        setItems(quote.items.map((item) => ({ item_type: item.item_type, product_id: item.product_id, commercial_product_id: item.commercial_product_id, code: item.commercial_product_code_snapshot || item.product_code_snapshot || '', name: item.commercial_product_name_snapshot || item.product_name_snapshot, unit: item.measurement_unit_snapshot || '', description: item.commercial_description_snapshot || item.description_snapshot || '', quantity: editableNumber(item.quantity), unit_price: editableNumber(item.unit_price), discount_amount: editableNumber(item.discount_amount), reference_price: item.reference_price_snapshot, sop_discount_type: item.sop_discount_type_snapshot, sop_discount_value: item.sop_discount_value_snapshot, sop_minimum_price: item.sop_minimum_price_snapshot, catalog_configured: Boolean(item.product_catalog_id), save_product: item.save_product_requested !== false })));
        setPayments(quote.payment_methods.length ? quote.payment_methods.map((method) => ({ method_type: method.method_type, description: method.description, calculation_type: method.calculation_type, percentage: editableNumber(method.percentage), amount: editableNumber(method.amount), installment_count: editableNumber(method.installment_count), first_due_date: method.first_due_date ? String(method.first_due_date).slice(0, 10) : '', notes: method.notes || '' })) : [emptyPayment()]);
      } catch (requestError) { toast.error(requestError.response?.data?.message || 'Não foi possível carregar o orçamento.'); }
      finally { setLoading(false); }
    })();
  }, [editing, id, navigate, toast]);

  useEffect(() => {
    if (customer || !customerQuery.trim()) { setCustomerResults([]); setCustomerActive(-1); return undefined; }
    const timer = window.setTimeout(async () => {
      try { setCustomerResults((await api.get('/commercial/quotes/customers', { params: { q: customerQuery } })).data); setCustomerActive(-1); }
      catch { setCustomerResults([]); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [customer, customerQuery]);

  useEffect(() => {
    if (!productQuery.trim()) { setProductResults([]); setProductActive(-1); return undefined; }
    const timer = window.setTimeout(async () => {
      try { setProductResults((await api.get('/commercial/quotes/products', { params: { q: productQuery } })).data); setProductActive(-1); }
      catch { setProductResults([]); }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [productQuery]);

  useEffect(() => {
    function closeAutocompletes(event) {
      if (!customerAutocompleteRef.current?.contains(event.target)) { setCustomerResults([]); setCustomerActive(-1); }
      if (!productAutocompleteRef.current?.contains(event.target)) { setProductResults([]); setProductActive(-1); }
    }
    document.addEventListener('pointerdown', closeAutocompletes);
    return () => document.removeEventListener('pointerdown', closeAutocompletes);
  }, []);

  const preview = useMemo(() => calculatePreview(items, form.discount_amount, form.freight_amount), [items, form.discount_amount, form.freight_amount]);
  const focusItem = (index, field) => window.setTimeout(() => formRef.current?.querySelector(`[data-item-index="${index}"][data-field="${field}"]`)?.focus(), 0);

  function selectCustomer(item) {
    setCustomer(item); setCustomerQuery(item.name); setForm((current) => ({ ...current, customer_id: item.id }));
    setCustomerResults([]); setCustomerActive(-1); window.setTimeout(() => productInputRef.current?.focus(), 0);
  }
  function changeCustomerQuery(value) {
    setCustomerQuery(value); if (customer) setCustomer(null); setForm((current) => ({ ...current, customer_id: '' }));
  }
  function customerKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCustomerActive((current) => Math.min(customerResults.length - 1, current + 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setCustomerActive((current) => Math.max(0, current - 1)); return; }
    if (event.key === 'Escape') { event.preventDefault(); setCustomerResults([]); setCustomerActive(-1); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (customerActive >= 0 && customerResults[customerActive]) selectCustomer(customerResults[customerActive]); else { setCustomerResults([]); setCustomerActive(-1); productInputRef.current?.focus(); } }
  }

  function addProduct(product) {
    const index = items.length;
    setItems((current) => [...current, { item_type: 'product', product_id: product.product_id, commercial_product_id: product.commercial_product_id, code: product.code || '', name: product.name, unit: product.unit || 'UN', description: product.description || product.name, quantity: 1, unit_price: product.reference_price || '', discount_amount: 0, reference_price: product.reference_price, sop_discount_type: product.sop_discount_type, sop_discount_value: product.sop_discount_value, sop_minimum_price: product.sop_minimum_price, catalog_configured: product.catalog_configured, catalog_version_number: product.catalog_version_number, origin_type: product.origin_type }]);
    setProductResults([]); setProductActive(-1); setProductQuery(''); focusItem(index, 'quantity');
  }
  function productKeyDown(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setProductActive((current) => Math.min(productResults.length - 1, current + 1)); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setProductActive((current) => Math.max(0, current - 1)); return; }
    if (event.key === 'Escape') { event.preventDefault(); setProductResults([]); setProductActive(-1); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (productActive >= 0 && productResults[productActive]) addProduct(productResults[productActive]); }
  }
  function addManual() { const index = items.length; setItems((current) => [...current, manualItem()]); focusItem(index, 'name'); }
  function updateItem(index, field, value) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item)); }
  function updatePayment(index, field, value) {
    setPayments((current) => current.map((payment, paymentIndex) => {
      if (paymentIndex !== index) return payment;
      const next = { ...payment, [field]: value };
      if (field === 'method_type') next.description = PAYMENT_TYPES.find(([type]) => type === value)?.[1] || 'Outra condição';
      if (field === 'calculation_type') { next.amount = value === 'amount' ? next.amount : ''; next.percentage = value === 'percentage' ? next.percentage : ''; }
      return next;
    }));
  }
  function keyboardNavigate(event) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Enter' || event.target.tagName === 'TEXTAREA' || event.target.type === 'checkbox' || event.target.closest('[role="listbox"]')) return;
    if (!event.target.matches('[data-keyboard-field]')) return;
    event.preventDefault();
    const fields = [...formRef.current.querySelectorAll('[data-keyboard-field]:not([disabled])')].filter((field) => field.offsetParent !== null);
    const current = fields.indexOf(event.target);
    fields[current + (event.shiftKey ? -1 : 1)]?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    if (!items.length) return toast.error('Adicione pelo menos um item.');
    const payload = { ...form, customer_id: customer?.id || null, customer_name: customer ? customer.name : customerQuery,
      items: items.map((item) => item.commercial_product_id
        ? { commercial_product_id: item.commercial_product_id, unit: item.unit, description: item.description, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount }
        : item.product_id
          ? { product_id: item.product_id, description: item.description, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount }
          : { name: item.name, code: item.code, unit: item.unit, description: item.description, quantity: item.quantity, unit_price: item.unit_price, discount_amount: item.discount_amount, save_product: item.save_product }),
      payment_methods: payments.filter((payment) => payment.amount || payment.percentage).map((payment) => ({ ...payment, amount: payment.calculation_type === 'amount' ? payment.amount : undefined, percentage: payment.calculation_type === 'percentage' ? payment.percentage : undefined })) };
    try {
      setSaving(true);
      const response = editing ? await api.put(`/commercial/quotes/${id}`, payload) : await api.post('/commercial/quotes', payload);
      toast.success(editing ? 'Orçamento atualizado.' : `${quoteCommercialLabel(response.data)} criado.`); navigate(`/comercial/orcamentos/${response.data.id}`);
    } catch (requestError) { toast.error(requestError.response?.data?.message || 'Não foi possível salvar o orçamento.'); }
    finally { setSaving(false); }
  }

  if (loading) return <section className="page"><div className="panel">Carregando orçamento...</div></section>;
  return (
    <form ref={formRef} className="page commercial-quote-form" onSubmit={submit} onKeyDown={keyboardNavigate}>
      <header className="page__header commercial-quote-form__page-header"><div><h1 className="page__title">{editing ? 'Editar orçamento' : 'Novo orçamento'}</h1><p className="commercial-quotes__subtitle">Preencha e avance com Enter. Shift + Enter retorna.</p></div><Link className="button" to={editing ? `/comercial/orcamentos/${id}` : '/comercial/orcamentos'}><ArrowLeft size={18} /> Voltar</Link></header>

      <section className="panel commercial-quote-form__section"><div className="commercial-quote-form__heading"><span>1</span><h2>Cliente <small>opcional</small></h2></div><div className="commercial-quote-form__lookup commercial-quote-form__lookup_customer"><div className="commercial-quote-form__autocomplete" ref={customerAutocompleteRef}><input aria-autocomplete="list" aria-controls="quote-customer-results" aria-expanded={customerResults.length > 0} aria-activedescendant={customerActive >= 0 ? `quote-customer-option-${customerActive}` : undefined} className="field__input" data-keyboard-field role="combobox" value={customerQuery} onChange={(event) => changeCustomerQuery(event.target.value)} onKeyDown={customerKeyDown} placeholder="Digite um nome ou pesquise um cliente" />{customerResults.length > 0 && <div className="commercial-quote-form__results" id="quote-customer-results" role="listbox">{customerResults.map((item, index) => <button className={index === customerActive ? 'is-active' : ''} id={`quote-customer-option-${index}`} type="button" role="option" aria-selected={index === customerActive} key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCustomer(item)}><strong>{item.name}</strong><span>{[item.trade_name, item.tax_id, item.city].filter(Boolean).join(' · ')}</span></button>)}</div>}</div>{canCreateCustomer && <Link aria-label="Cadastrar cliente" className="button commercial-quote-form__add-button" to="/comercial/clientes/novo" target="_blank" title="Cadastrar cliente"><Plus size={19} /></Link>}</div><p className="commercial-quote-form__hint">{customer ? 'Cliente cadastrado selecionado; os dados atuais serão congelados no orçamento.' : customerQuery.trim() ? `Nome avulso: ${customerQuery.trim()}` : 'Sem nome: será exibido como Cliente não identificado.'}</p></section>

      <section className="panel commercial-quote-form__section"><div className="commercial-quote-form__heading"><span>2</span><h2>Itens</h2></div><div className="commercial-quote-form__lookup commercial-quote-form__lookup_product"><div className="commercial-quote-form__autocomplete" ref={productAutocompleteRef}><input ref={productInputRef} aria-autocomplete="list" aria-controls="quote-product-results" aria-expanded={productResults.length > 0} aria-activedescendant={productActive >= 0 ? `quote-product-option-${productActive}` : undefined} className="field__input" role="combobox" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} onKeyDown={productKeyDown} placeholder="Digite código ou nome comercial" />{productResults.length > 0 && <div className="commercial-quote-form__results" id="quote-product-results" role="listbox">{productResults.map((product, index) => <button className={index === productActive ? 'is-active' : ''} id={`quote-product-option-${index}`} type="button" role="option" aria-selected={index === productActive} key={`${product.origin_type}-${product.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => addProduct(product)}><strong>{[product.code, product.name].filter(Boolean).join(' — ')}</strong><span>{[product.origin_type === 'operational_legacy' ? 'Produto legado' : 'Produto comercial', product.reference_price ? formatMoney(product.reference_price) : 'Preço a informar', product.catalog_configured ? `Catálogo${product.catalog_version_number ? ` v${product.catalog_version_number}` : ''}` : 'Sem catálogo técnico', product.sop_minimum_price != null ? `SOP mín. ${formatMoney(product.sop_minimum_price)}` : 'SOP não configurada'].filter(Boolean).join(' · ')}</span></button>)}</div>}</div><button className="button" type="button" onClick={addManual}><PackagePlus size={17} /> Item manual</button></div>
        <div className="commercial-quote-form__items">{items.length === 0 && <p className="commercial-quotes__feedback">Pesquise um Produto Comercial ou adicione um item manual.</p>}{items.map((item, index) => { const registered = Boolean(item.product_id || item.commercial_product_id); return <article className="commercial-quote-form__item" key={`${item.commercial_product_id || item.product_id || 'manual'}-${index}`}><div className="commercial-quote-form__item-title"><strong>{registered ? `${item.code ? `${item.code} — ` : ''}${item.name}` : `Item manual ${index + 1}`}</strong><button aria-label={`Remover item ${index + 1}`} className="button button_danger commercial-quote-form__remove" type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /><span>Remover</span></button></div>
          {!registered && <div className="commercial-quote-form__manual-grid"><label className="field"><span className="field__label">Nome *</span><input className="field__input" data-keyboard-field data-item-index={index} data-field="name" value={item.name} onChange={(event) => updateItem(index, 'name', event.target.value)} /></label><label className="field"><span className="field__label">Código</span><input className="field__input" data-keyboard-field value={item.code} onChange={(event) => updateItem(index, 'code', event.target.value)} /></label><label className="field"><span className="field__label">Unidade</span><input className="field__input" data-keyboard-field value={item.unit} onChange={(event) => updateItem(index, 'unit', event.target.value)} /></label></div>}
          <div className="commercial-quote-form__item-grid"><label className="field commercial-quote-form__description"><span className="field__label">Descrição</span><input className="field__input" data-keyboard-field value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} /></label><label className="field"><span className="field__label">Qtd.</span><input className="field__input" data-keyboard-field data-item-index={index} data-field="quantity" inputMode="decimal" type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} /></label><label className="field"><span className="field__label">Preço unit.</span><input className="field__input" data-keyboard-field inputMode="decimal" type="number" min="0" step="0.01" value={item.unit_price} onChange={(event) => updateItem(index, 'unit_price', event.target.value)} /></label><label className="field"><span className="field__label">Desconto</span><input className="field__input" data-keyboard-field inputMode="decimal" type="number" min="0" step="0.01" value={item.discount_amount} onChange={(event) => updateItem(index, 'discount_amount', event.target.value)} /></label><div className="commercial-quote-form__line-total"><span>Total</span><strong>{formatMoney(preview.rows[index]?.subtotal)}</strong></div></div>
          {!registered && <label className="commercial-quote-form__save-product"><input type="checkbox" checked={item.save_product} onChange={(event) => updateItem(index, 'save_product', event.target.checked)} /> Salvar produto <span>(cria Produto Comercial; nunca cria Produto operacional)</span></label>}
          {registered && (item.catalog_configured ? item.sop_minimum_price != null ? <div className={`commercial-quote-form__sop ${sopState(item)?.outside ? 'is-outside' : 'is-inside'}`}><span>Referência <b>{formatMoney(item.reference_price)}</b></span><span>SOP máx. <b>{item.sop_discount_type === 'percentage' ? `${item.sop_discount_value}%` : formatMoney(item.sop_discount_value)}</b></span><span>Mínimo <b>{formatMoney(item.sop_minimum_price)}</b></span><span>Efetivo <b>{formatMoney(sopState(item)?.effective)}</b></span><strong>{sopState(item)?.outside ? 'Fora da SOP' : 'Dentro da SOP'}</strong></div> : <p className="commercial-quote-form__catalog-note">SOP não configurada.</p> : <p className="commercial-quote-form__catalog-note">Produto sem Catálogo Técnico; informe o preço.</p>)}</article>; })}</div>
      </section>

      <section className="panel commercial-quote-form__section"><div className="commercial-quote-form__heading"><span>3</span><h2>Condições comerciais</h2></div><div className="commercial-quote-form__conditions"><label className="field"><span className="field__label">Data *</span><input className="field__input" data-keyboard-field type="date" value={form.quote_date} onChange={(event) => setForm((current) => ({ ...current, quote_date: event.target.value }))} /></label><label className="field"><span className="field__label">Validade</span><input className="field__input" data-keyboard-field type="date" value={form.valid_until} onChange={(event) => setForm((current) => ({ ...current, valid_until: event.target.value }))} /></label><label className="field"><span className="field__label">Desconto geral</span><input className="field__input" data-keyboard-field inputMode="decimal" type="number" min="0" step="0.01" value={form.discount_amount} onChange={(event) => setForm((current) => ({ ...current, discount_amount: event.target.value }))} /></label><label className="field"><span className="field__label">Frete</span><input className="field__input" data-keyboard-field inputMode="decimal" type="number" min="0" step="0.01" value={form.freight_amount} onChange={(event) => setForm((current) => ({ ...current, freight_amount: event.target.value }))} /></label></div></section>

      <section className="panel commercial-quote-form__section"><div className="commercial-quote-form__heading"><span>4</span><h2>Pagamento</h2></div><div className="commercial-quote-form__payments">{payments.map((payment, index) => <article className="commercial-quote-form__payment" key={index}><header className="commercial-quote-form__payment-header"><strong>Condição {index + 1}</strong></header><div className="commercial-quote-form__payment-grid"><label className="field"><span className="field__label">Forma</span><select className="field__input" data-keyboard-field value={payment.method_type} onChange={(event) => updatePayment(index, 'method_type', event.target.value)}>{PAYMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span className="field__label">Descrição</span><input className="field__input" data-keyboard-field value={payment.description} onChange={(event) => updatePayment(index, 'description', event.target.value)} /></label><label className="field"><span className="field__label">Definir por</span><select className="field__input" data-keyboard-field value={payment.calculation_type} onChange={(event) => updatePayment(index, 'calculation_type', event.target.value)}><option value="amount">Valor</option><option value="percentage">Percentual</option></select></label><label className="field"><span className="field__label">Valor / %</span><input className="field__input" data-keyboard-field inputMode="decimal" type="number" min="0.0001" step={payment.calculation_type === 'amount' ? '0.01' : '0.0001'} value={payment.calculation_type === 'amount' ? payment.amount : payment.percentage} onChange={(event) => updatePayment(index, payment.calculation_type === 'amount' ? 'amount' : 'percentage', event.target.value)} /></label><label className="field"><span className="field__label">Parcelas</span><input className="field__input" data-keyboard-field inputMode="numeric" type="number" min="1" max="120" step="1" value={payment.installment_count} onChange={(event) => updatePayment(index, 'installment_count', event.target.value)} /></label><label className="field"><span className="field__label">1º vencimento</span><input className="field__input" data-keyboard-field type="date" value={payment.first_due_date} onChange={(event) => updatePayment(index, 'first_due_date', event.target.value)} /></label></div><button aria-label={`Remover condição ${index + 1}`} className="button button_danger commercial-quote-form__payment-remove" type="button" onClick={() => setPayments((current) => current.filter((_, paymentIndex) => paymentIndex !== index))}><Trash2 size={16} /><span>Remover condição</span></button></article>)}</div><button className="button commercial-quote-form__add-payment" type="button" onClick={() => setPayments((current) => [...current, emptyPayment()])}><Plus size={17} /> Adicionar condição</button></section>

      <section className="panel commercial-quote-form__section"><div className="commercial-quote-form__heading"><span>5</span><h2>Observações</h2></div><div className="commercial-quote-form__notes"><label className="field"><span className="field__label">Observações comerciais</span><textarea className="field__input commercial-quote-form__textarea" rows="2" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label><label className="field"><span className="field__label">Observações internas <small>nunca aparecem no PDF</small></span><textarea className="field__input commercial-quote-form__textarea" rows="2" value={form.internal_notes} onChange={(event) => setForm((current) => ({ ...current, internal_notes: event.target.value }))} /></label></div></section>

      <section className="panel commercial-quote-form__summary"><div><span>Bruto</span><strong>{formatMoney(preview.gross)}</strong></div><div><span>Descontos dos itens</span><strong>- {formatMoney(preview.itemDiscount)}</strong></div><div><span>Subtotal</span><strong>{formatMoney(preview.subtotal)}</strong></div><div><span>Desconto geral</span><strong>- {formatMoney(preview.generalDiscount)}</strong></div><div><span>Frete</span><strong>{formatMoney(preview.freight)}</strong></div><div className="commercial-quote-form__summary-total"><span>Total</span><strong>{formatMoney(preview.total)}</strong></div></section>
      <footer className="commercial-quote-form__footer"><Link className="button" to={editing ? `/comercial/orcamentos/${id}` : '/comercial/orcamentos'}>Cancelar</Link><button className="button button_primary" type="submit" disabled={saving}><Save size={18} /> {saving ? 'Salvando...' : 'Salvar rascunho'}</button></footer>
    </form>
  );
}
