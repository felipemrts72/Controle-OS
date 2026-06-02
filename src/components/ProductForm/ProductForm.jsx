import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { ProductComponentsEditor } from '../ProductComponentsEditor/ProductComponentsEditor.jsx';
import './ProductForm.css';

export function ProductForm({ initialProduct, onSubmit }) {
  const [sectors, setSectors] = useState([]);
  const [form, setForm] = useState(initialProduct || { name: '', type: 'manufactured', default_volume_quantity: 1, default_total_weight_kg: 1, is_active: true, components: [] });

  useEffect(() => {
    api.get('/sectors').then((response) => setSectors(response.data.filter((sector) => sector.is_active)));
  }, []);

  function change(event) {
    const value = event.target.type === 'number' ? Number(event.target.value) : event.target.value;
    setForm((current) => ({ ...current, [event.target.name]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <form className="product-form panel" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Nome</span>
          <input className="field__input" name="name" value={form.name} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Tipo</span>
          <select className="field__input" name="type" value={form.type} onChange={change}>
            <option value="manufactured">Fabricado</option>
            <option value="resale">Revenda</option>
            <option value="material_prima">Matéria-prima</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Quantidade padrão de volumes</span>
          <input className="field__input" type="number" min="1" name="default_volume_quantity" value={form.default_volume_quantity} onChange={change} required />
        </label>
        <label className="field">
          <span className="field__label">Peso total padrão (kg)</span>
          <input className="field__input" type="number" min="0.01" step="0.01" name="default_total_weight_kg" value={form.default_total_weight_kg} onChange={change} required />
        </label>
      </div>
      <ProductComponentsEditor components={form.components || []} sectors={sectors} onChange={(components) => setForm((current) => ({ ...current, components }))} />
      <button className="button button_primary product-form__button" type="submit">Salvar produto</button>
    </form>
  );
}
