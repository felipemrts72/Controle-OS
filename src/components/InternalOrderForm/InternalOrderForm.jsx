import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import './InternalOrderForm.css';

export function InternalOrderForm({ initialOrder, onSubmit, submitLabel = 'Criar Ordem de Serviço Interna' }) {
  const toast = useToast();
  const [form, setForm] = useState(() => initialOrder ? {
    sale_number: initialOrder.sale_number || '',
    customer_name: initialOrder.customer_name || '',
    customer_phone: initialOrder.customer_phone || '',
    promised_date: initialOrder.promised_date?.slice(0, 10) || '',
    delivery_type: initialOrder.delivery_type || 'transportadora',
    carrier_name: initialOrder.carrier_name || '',
    destination_city: initialOrder.destination_city || '',
    destination_uf: initialOrder.destination_uf || '',
  } : {
    sale_number: '',
    customer_name: '',
    customer_phone: '',
    promised_date: '',
    delivery_type: 'transportadora',
    carrier_name: '',
    destination_city: '',
    destination_uf: '',
  });
  const [itemForm, setItemForm] = useState({ quantity: 1 });
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [includeSpareParts, setIncludeSpareParts] = useState(false);
  const [highlightedProductId, setHighlightedProductId] = useState('');
  const [hasSearchedProducts, setHasSearchedProducts] = useState(false);
  const [items, setItems] = useState(() => (initialOrder?.items || []).map((item) => ({
    id: item.id,
    product_id: item.product_id,
    quantity: item.quantity,
    is_spare_part: item.is_spare_part,
    product: {
      id: item.product_id,
      name: item.product_name_snapshot,
      type: item.product_type,
      default_volume_quantity: item.default_volume_quantity,
      default_total_weight_kg: item.default_total_weight_kg,
    },
  })));
  const [message, setMessage] = useState('');
  const quantityInputRef = useRef(null);

  useEffect(() => {
    if (selectedProduct && productSearch !== selectedProduct.name) {
      setSelectedProduct(null);
    }
  }, [productSearch, selectedProduct]);

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function changeItem(event) {
    setItemForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function searchProducts() {
    if (productSearch.trim().length < 3) {
      toast.error('Digite ao menos 3 caracteres para buscar.');
      return;
    }
    const response = await api.get('/products/search', {
      params: {
        q: productSearch.trim(),
        include_spare_parts: includeSpareParts,
      },
    });
    const results = response.data;
    setProductResults(results);
    setHighlightedProductId(results[0]?.id || '');
    setHasSearchedProducts(true);
    setMessage('');
    if (!results.length) toast.error('Nenhum produto encontrado.');
  }

  function selectProduct(product) {
    setSelectedProduct(product);
    setProductSearch(product.name);
    setHighlightedProductId(product.id);
    setProductResults([]);
    setHasSearchedProducts(false);
    setMessage('');
    window.setTimeout(() => quantityInputRef.current?.focus(), 0);
  }

  function selectHighlightedProduct() {
    const product = productResults.find((currentProduct) => currentProduct.id === highlightedProductId) || productResults[0];
    if (product) selectProduct(product);
  }

  function moveHighlightedProduct(direction) {
    if (!productResults.length) return;
    const currentIndex = productResults.findIndex((product) => product.id === highlightedProductId);
    const nextIndex = (currentIndex + direction + productResults.length) % productResults.length;
    setHighlightedProductId(productResults[nextIndex].id);
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (hasSearchedProducts && productResults.length) selectHighlightedProduct();
      else searchProducts();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlightedProduct(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlightedProduct(-1);
    }
  }

  function handleQuantityKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addItem();
    }
  }

  function addItem() {
    const quantity = Number(itemForm.quantity);
    if (!selectedProduct) {
      setMessage('Selecione um produto antes de adicionar');
      toast.error('Selecione um produto antes de adicionar.');
      return;
    }
    if (quantity < 1) {
      setMessage('Informe uma quantidade maior que zero.');
      toast.error('Informe uma quantidade válida.');
      return;
    }
    setItems((current) => [...current, { product_id: selectedProduct.id, quantity, is_spare_part: includeSpareParts, product: selectedProduct }]);
    setItemForm({ quantity: 1 });
    setProductSearch('');
    setProductResults([]);
    setSelectedProduct(null);
    setHighlightedProductId('');
    setHasSearchedProducts(false);
    setMessage('');
    toast.success('Item adicionado à OS.');
  }

  function removeItem(index) {
    setItems((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function submit(event) {
    event.preventDefault();
    if (!items.length) {
      setMessage('Adicione ao menos um item na OS.');
      return;
    }
    onSubmit({
      sale_number: form.sale_number,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      promised_date: form.promised_date,
      delivery_type: form.delivery_type || 'transportadora',
      carrier_name: form.delivery_type === 'retirada' ? '' : form.carrier_name,
      destination_city: form.delivery_type === 'retirada' ? '' : form.destination_city,
      destination_uf: form.delivery_type === 'retirada' ? '' : form.destination_uf,
      items: items.map((item) => ({ id: item.id, product_id: item.product_id, quantity: item.quantity, is_spare_part: item.is_spare_part })),
    });
  }

  return (
    <form className="internal-order-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Número da Venda</span>
          <input className="field__input" name="sale_number" value={form.sale_number} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Cliente</span>
          <input className="field__input" name="customer_name" value={form.customer_name} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Telefone</span>
          <input className="field__input" name="customer_phone" value={form.customer_phone} onChange={change} />
        </label>
        <label className="field">
          <span className="field__label">Data de Entrega</span>
          <input className="field__input" type="date" name="promised_date" value={form.promised_date} onChange={change} required />
        </label>
      </div>

      <div className="internal-order-form__items">
        <div className="internal-order-form__section-header">
          <h3>Entrega</h3>
        </div>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Tipo de entrega</span>
            <select className="field__input" name="delivery_type" value={form.delivery_type} onChange={change}>
              <option value="transportadora">Transportadora</option>
              <option value="retirada">Retirada</option>
              <option value="frota_propria">Frota propria</option>
            </select>
          </label>
          {form.delivery_type !== 'retirada' && (
            <>
              {form.delivery_type === 'transportadora' && (
                <label className="field">
                  <span className="field__label">Nome da transportadora</span>
                  <input className="field__input" name="carrier_name" value={form.carrier_name} onChange={change} />
                </label>
              )}
              <label className="field">
                <span className="field__label">Cidade destino</span>
                <input className="field__input" name="destination_city" value={form.destination_city} onChange={change} />
              </label>
              <label className="field">
                <span className="field__label">UF</span>
                <input className="field__input" name="destination_uf" value={form.destination_uf} onChange={change} maxLength="2" />
              </label>
            </>
          )}
        </div>
      </div>

      <div className="internal-order-form__items">
        <div className="internal-order-form__section-header">
          <h3>Itens da OS</h3>
        </div>
        <div className="internal-order-form__item-fields">
          <div className="field internal-order-form__search-field">
            <span className="field__label">Buscar produto</span>
            <div className="internal-order-form__search-row">
              <input
                className="field__input"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <button className="button internal-order-form__search-button" type="button" onClick={searchProducts} title="Buscar produto">
                <Search size={18} />
              </button>
            </div>
            <label className="internal-order-form__spare-toggle">
              <input type="checkbox" checked={includeSpareParts} onChange={(event) => setIncludeSpareParts(event.target.checked)} />
              Peças de reposição
            </label>
            {hasSearchedProducts && (
              <div className="internal-order-form__product-results">
                {productResults.length === 0 && <p>Nenhum produto encontrado</p>}
                {productResults.map((product) => (
                  <button
                    className={`internal-order-form__product-result ${highlightedProductId === product.id ? 'internal-order-form__product-result_active' : ''}`}
                    key={product.id}
                    type="button"
                    onClick={() => setHighlightedProductId(product.id)}
                    onDoubleClick={() => selectProduct(product)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        selectProduct(product);
                      }
                    }}
                  >
                    <strong>{product.name}</strong>
                    <span>{product.type_name || (product.type === 'manufactured' ? 'Fabricado' : product.type === 'material_prima' ? 'Matéria-prima' : 'Revenda')}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedProduct && (
              <p className="internal-order-form__selected-product">
                <span>Produto selecionado:</span>
                <strong>{selectedProduct.name}</strong>
              </p>
            )}
          </div>
          <label className="field">
            <span className="field__label">Quantidade</span>
            <input
              ref={quantityInputRef}
              className="field__input"
              type="number"
              min="1"
              name="quantity"
              value={itemForm.quantity}
              onChange={changeItem}
              onKeyDown={handleQuantityKeyDown}
            />
          </label>
        </div>
        <button className="button button_primary" type="button" onClick={addItem}>Adicionar item</button>
        {message && <p className="internal-order-form__message">{message}</p>}
        <div className="internal-order-form__item-list">
          {items.map((item, index) => (
            <div className="internal-order-form__item" key={`${item.product_id}-${index}`}>
              <strong>{item.product.name}</strong>
              <span>{item.product.type_name || (item.product.type === 'manufactured' ? 'Fabricado' : item.product.type === 'material_prima' ? 'Matéria-prima' : 'Revenda')}</span>
              <span>Qtd {item.quantity}</span>
              <span>{item.product.default_volume_quantity} volumes</span>
              <span>{item.product.default_total_weight_kg} kg</span>
              <span>{item.is_spare_part ? 'Peça de reposição' : '-'}</span>
              <button className="button button_danger" type="button" onClick={() => removeItem(index)}>Remover</button>
            </div>
          ))}
        </div>
      </div>
      <button className="button button_primary internal-order-form__button" type="submit">{submitLabel}</button>
    </form>
  );
}
