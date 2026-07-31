import { useEffect, useState } from 'react';
import './SectorForm.css';

export function SectorForm({ sector, onSubmit, formId = 'sector-form' }) {
  const [name, setName] = useState(sector?.name || '');

  useEffect(() => setName(sector?.name || ''), [sector]);

  function submit(event) {
    event.preventDefault();
    onSubmit({ name });
  }

  return (
    <form className="sector-form" id={formId} onSubmit={submit}>
      <label className="field">
        <span className="field__label">Nome do setor</span>
        <input className="field__input" name="name" placeholder="Ex.: Solda" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus required />
      </label>
      <p className="sector-form__hint">O identificador técnico é gerado automaticamente e permanece estável após a criação.</p>
    </form>
  );
}
