import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../../services/api.js';
import { useToast } from '../ToastProvider/ToastProvider.jsx';
import './InternalOrderForm.css';

export function InternalOrderForm({ onSubmit }) {
  const toast = useToast();
  const [form, setForm] = useState({ sale_number: '', customer_name: '', customer_phone: '', promised_date: '' });
  const [itemForm, setItemForm] = useState({ quantity: 1 });
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [highlightedProductId, setHighlightedProductId] = useState('');
  const [hasSearchedProducts, setHasSearchedProducts] = useState(false);
  const [items, setItems] = useState([]);
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
    const response = await api.get('/products/search?type=manufactured,resale');
    const normalizedSearch = productSearch.trim().toLowerCase();
    const results = response.data.filter((product) => product.name.toLowerCase().includes(normalizedSearch));
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
    setItems((current) => [...current, { product_id: selectedProduct.id, quantity, product: selectedProduct }]);
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
      items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
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
                    <span>{product.type === 'manufactured' ? 'Fabricado' : 'Revenda'}</span>
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
              <span>{item.product.type === 'manufactured' ? 'Fabricado' : 'Revenda'}</span>
              <span>Qtd {item.quantity}</span>
              <span>{item.product.default_volume_quantity} volumes</span>
              <span>{item.product.default_total_weight_kg} kg</span>
              <button className="button button_danger" type="button" onClick={() => removeItem(index)}>Remover</button>
            </div>
          ))}
        </div>
      </div>
      <button className="button button_primary internal-order-form__button" type="submit">Criar Ordem de Serviço Interna</button>
    </form>
  );
}
