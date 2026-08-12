import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import './ProductComponentsEditor.css';

const typeLabels = {
  manufactured: 'Fabricado',
  resale: 'Revenda',
  material_prima: 'Matéria-prima',
};

export function ProductComponentsEditor({ components, productId = null, sectors, onChange }) {
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const normalizedSearch = search.trim();
    if (normalizedSearch.length < 3 || selectedProduct?.name === normalizedSearch) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await api.get('/products/search', {
          params: { q: normalizedSearch, component_candidates: true },
          signal: controller.signal,
        });
        const usedIds = new Set(components.map((component) => component.material_product_id).filter(Boolean));
        setResults(response.data.filter((product) => product.id !== productId && !usedIds.has(product.id)).slice(0, 12));
      } catch (error) {
        if (error.code !== 'ERR_CANCELED') setMessage('Não foi possível buscar Produtos.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [components, productId, search, selectedProduct]);

  function update(index, field, value) {
    const next = components.map((component, currentIndex) => currentIndex === index ? { ...component, [field]: value } : component);
    onChange(next);
  }

  function addSelected() {
    if (!selectedProduct) {
      setMessage('Selecione um Produto antes de adicionar.');
      return;
    }
    if (selectedProduct.id === productId) {
      setMessage('Um Produto não pode ser componente dele mesmo.');
      return;
    }
    if (components.some((component) => component.material_product_id === selectedProduct.id)) {
      setMessage('Este Produto já foi adicionado como componente.');
      return;
    }
    if (!selectedProduct.sector_id) {
      setMessage('O Produto selecionado não possui setor responsável cadastrado. Edite o Produto antes de adicioná-lo como componente.');
      return;
    }
    if (Number(quantity) < 1) {
      setMessage('Informe uma quantidade maior que zero.');
      return;
    }
    onChange([
      ...components,
      {
        material_product_id: selectedProduct.id,
        component_name: selectedProduct.name,
        sector_id: selectedProduct.sector_id,
        quantity: Number(quantity),
        is_required: true,
        material_product_type: selectedProduct.type,
        material_product_type_name: selectedProduct.type_name,
        material_product_is_active: selectedProduct.is_active,
      },
    ]);
    setSearch('');
    setQuantity(1);
    setSelectedProduct(null);
    setResults([]);
    setMessage('');
  }

  function remove(index) {
    onChange(components.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="product-components-editor">
      <div className="product-components-editor__header"><h3>Componentes</h3></div>
      <div className="product-components-editor__search">
        <div className="field">
          <span className="field__label">Buscar componente</span>
          <input className="field__input" value={search} onChange={(event) => {
            setSearch(event.target.value);
            setSelectedProduct(null);
            setMessage('');
          }} placeholder="Digite ao menos 3 caracteres" />
          {search.trim().length >= 3 && !selectedProduct && (
            <div className="product-components-editor__results">
              {loading && <p>Buscando...</p>}
              {!loading && results.length === 0 && <p>Nenhum Produto ativo encontrado.</p>}
              {results.map((product) => (
                <button className="product-components-editor__result" key={product.id} type="button" onClick={() => {
                  setSelectedProduct(product);
                  setSearch(product.name);
                  setResults([]);
                  setMessage('');
                  }}>
                  <strong>{product.name}</strong>
                  <span>{product.type_name || typeLabels[product.type] || product.type} • {product.sector_name || 'Sem setor'}</span>
                  {product.internal_code && <span>Código: {product.internal_code}</span>}
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
        <div className="product-components-editor__row" key={component.id || component.material_product_id || index}>
          <div>
            <strong>{component.component_name}</strong>
            <span className="product-components-editor__type">{component.material_product_type_name || typeLabels[component.material_product_type] || ''}{component.material_product_is_active === false ? ' · Inativo (histórico)' : ''}</span>
          </div>
          <span>{sectors.find((sector) => sector.id === component.sector_id)?.name || component.sector_name || 'Sem setor'}</span>
          <select className="field__input" value={component.sector_id} onChange={(event) => update(index, 'sector_id', event.target.value)} required disabled={Boolean(component.material_product_id)}>
            <option value="">Setor responsável</option>
            {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
          </select>
          <input className="field__input" type="number" min="1" value={component.quantity} onChange={(event) => update(index, 'quantity', Number(event.target.value))} />
          <label className="product-components-editor__check">
            <input type="checkbox" checked={component.is_required} onChange={(event) => update(index, 'is_required', event.target.checked)} /> Obrigatório
          </label>
          <button className="button button_danger" type="button" onClick={() => remove(index)}>Remover</button>
        </div>
      ))}
    </div>
  );
}
