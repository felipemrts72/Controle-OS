import { useMemo, useState } from 'react';
import './ProductComponentsEditor.css';

export function ProductComponentsEditor({ components, materialProducts = [], sectors, onChange }) {
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState(null);

  const results = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch.length < 3) return [];
    return materialProducts.filter((product) => product.name.toLowerCase().includes(normalizedSearch)).slice(0, 12);
  }, [materialProducts, search]);

  function update(index, field, value) {
    const next = components.map((component, currentIndex) => currentIndex === index ? { ...component, [field]: value } : component);
    onChange(next);
  }

  function addSelected() {
    if (!selectedMaterial) {
      setMessage('Selecione uma matéria-prima antes de adicionar.');
      return;
    }
    if (!selectedMaterial.sector_id) {
      setMessage('A matéria-prima selecionada não possui setor responsável cadastrado. Edite o produto antes de adicioná-lo como componente.');
      return;
    }
    if (Number(quantity) < 1) {
      setMessage('Informe uma quantidade maior que zero.');
      return;
    }
    onChange([
      ...components,
      {
        material_product_id: selectedMaterial.id,
        component_name: selectedMaterial.name,
        sector_id: selectedMaterial.sector_id,
        quantity: Number(quantity),
        is_required: true,
      },
    ]);
    setSearch('');
    setQuantity(1);
    setSelectedMaterial(null);
    setMessage('');
  }

  function remove(index) {
    onChange(components.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="product-components-editor">
      <div className="product-components-editor__header">
        <h3>Componentes</h3>
      </div>
      <div className="product-components-editor__search">
        <div className="field">
          <span className="field__label">Buscar matéria-prima</span>
          <input className="field__input" value={search} onChange={(event) => {
            setSearch(event.target.value);
            setSelectedMaterial(null);
            setMessage('');
          }} placeholder="Digite ao menos 3 caracteres" />
          {search.trim().length >= 3 && (
            <div className="product-components-editor__results">
              {results.length === 0 && <p>Nenhuma matéria-prima encontrada.</p>}
              {results.map((product) => (
                <button
                  className={`product-components-editor__result ${selectedMaterial?.id === product.id ? 'product-components-editor__result_active' : ''}`}
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setSelectedMaterial(product);
                    setSearch(product.name);
                    setMessage('');
                  }}
                >
                  <strong>{product.name}</strong>
                  <span>{product.sector_name || 'Sem setor responsável'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <label className="field">
          <span className="field__label">Quantidade</span>
          <input className="field__input" type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
        </label>
        <button className="button" type="button" onClick={addSelected}>Adicionar componente</button>
      </div>
      {message && <p className="product-components-editor__message">{message}</p>}
      {components.map((component, index) => (
        <div className="product-components-editor__row" key={index}>
          <strong>{component.component_name}</strong>
          <span>{sectors.find((sector) => sector.id === component.sector_id)?.name || component.sector_name || 'Sem setor'}</span>
          <select className="field__input" value={component.sector_id} onChange={(event) => update(index, 'sector_id', event.target.value)} required disabled={Boolean(component.material_product_id)}>
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
