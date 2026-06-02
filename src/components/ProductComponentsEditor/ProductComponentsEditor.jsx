import './ProductComponentsEditor.css';

export function ProductComponentsEditor({ components, sectors, onChange }) {
  function update(index, field, value) {
    const next = components.map((component, currentIndex) => currentIndex === index ? { ...component, [field]: value } : component);
    onChange(next);
  }

  function add() {
    onChange([...components, { component_name: '', sector_id: '', quantity: 1, is_required: true }]);
  }

  function remove(index) {
    onChange(components.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="product-components-editor">
      <div className="product-components-editor__header">
        <h3>Componentes</h3>
        <button className="button" type="button" onClick={add}>Adicionar componente</button>
      </div>
      {components.map((component, index) => (
        <div className="product-components-editor__row" key={index}>
          <input className="field__input" placeholder="Nome do componente" value={component.component_name} onChange={(event) => update(index, 'component_name', event.target.value)} />
          <select className="field__input" value={component.sector_id} onChange={(event) => update(index, 'sector_id', event.target.value)}>
            <option value="">Setor responsável</option>
            {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
          </select>
          <input className="field__input" type="number" min="1" value={component.quantity} onChange={(event) => update(index, 'quantity', Number(event.target.value))} />
          <label className="product-components-editor__check">
            <input type="checkbox" checked={component.is_required} onChange={(event) => update(index, 'is_required', event.target.checked)} />
            Obrigatório
          </label>
          <button className="button button_danger" type="button" onClick={() => remove(index)}>Remover</button>
        </div>
      ))}
    </div>
  );
}
