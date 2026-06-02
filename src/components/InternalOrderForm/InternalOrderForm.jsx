import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import './InternalOrderForm.css';

export function InternalOrderForm({ onSubmit }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ sale_number: '', customer_name: '', customer_phone: '', promised_date: '', product_id: '', quantity: 1 });

  useEffect(() => {
    api.get('/products/search?type=manufactured,resale').then((response) => setProducts(response.data));
  }, []);

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({
      sale_number: form.sale_number,
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      promised_date: form.promised_date,
      items: [{ product_id: form.product_id, quantity: Number(form.quantity) }],
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
        <label className="field">
          <span className="field__label">Produto</span>
          <select className="field__input" name="product_id" value={form.product_id} onChange={change} required>
            <option value="">Selecione</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Quantidade</span>
          <input className="field__input" type="number" min="1" name="quantity" value={form.quantity} onChange={change} required />
        </label>
      </div>
      <button className="button button_primary internal-order-form__button" type="submit">Criar Ordem de Serviço Interna</button>
    </form>
  );
}
