import { useState } from 'react';
import './SectorForm.css';

export function SectorForm({ sector, onSubmit }) {
  const [form, setForm] = useState(sector || { name: '', slug: '', is_active: true });

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit(form);
    if (!sector) setForm({ name: '', slug: '', is_active: true });
  }

  return (
    <form className="sector-form" onSubmit={submit}>
      <input className="field__input" name="name" placeholder="Nome" value={form.name} onChange={change} required />
      <input className="field__input" name="slug" placeholder="Slug" value={form.slug} onChange={change} required />
      <label className="sector-form__toggle">
        <input type="checkbox" name="is_active" checked={form.is_active} onChange={change} />
        Ativo
      </label>
      <button className="button button_primary" type="submit">Salvar setor</button>
    </form>
  );
}
