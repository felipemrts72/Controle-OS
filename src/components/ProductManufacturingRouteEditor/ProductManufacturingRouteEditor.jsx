import { useMemo, useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import './ProductManufacturingRouteEditor.css';

function createClientId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function emptyStep(dependencyId = '') {
  return {
    client_id: createClientId(),
    name: '',
    sector_id: '',
    quantity: 1,
    sort_order: 1,
    dependency_client_ids: dependencyId ? [dependencyId] : [],
  };
}

export function ProductManufacturingRouteEditor({ steps = [], sectors = [], onChange }) {
  const [editingStep, setEditingStep] = useState(null);
  const [dependencySearch, setDependencySearch] = useState('');

  const orderedSteps = useMemo(() => {
    return [...steps].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }, [steps]);

  const dependencyOptions = useMemo(() => {
    const search = dependencySearch.trim().toLowerCase();
    return orderedSteps.filter((step) => step.client_id !== editingStep?.client_id && (!search || step.name.toLowerCase().includes(search)));
  }, [dependencySearch, editingStep?.client_id, orderedSteps]);

  useEscapeKey(Boolean(editingStep), () => {
    setEditingStep(null);
    setDependencySearch('');
  });

  function saveStep(event) {
    event.preventDefault();
    const normalized = {
      ...editingStep,
      quantity: Number(editingStep.quantity || 1),
      sort_order: Number(editingStep.sort_order || steps.length + 1),
      dependency_client_ids: [...new Set(editingStep.dependency_client_ids || [])],
    };
    const exists = steps.some((step) => step.client_id === normalized.client_id);
    onChange(exists ? steps.map((step) => step.client_id === normalized.client_id ? normalized : step) : [...steps, normalized]);
    setEditingStep(null);
    setDependencySearch('');
  }

  function removeStep(step) {
    const isDependency = steps.some((current) => current.dependency_client_ids?.includes(step.client_id));
    if (isDependency) return;
    onChange(steps.filter((current) => current.client_id !== step.client_id).map((current) => ({
      ...current,
      dependency_client_ids: (current.dependency_client_ids || []).filter((dependencyId) => dependencyId !== step.client_id),
    })));
  }

  function toggleDependency(stepId) {
    const current = editingStep.dependency_client_ids || [];
    setEditingStep({
      ...editingStep,
      dependency_client_ids: current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId],
    });
  }

  function move(step, direction) {
    const sorted = orderedSteps.map((current, index) => ({ ...current, sort_order: index + 1 }));
    const index = sorted.findIndex((current) => current.client_id === step.client_id);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sorted.length) return;
    const next = [...sorted];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next.map((current, currentIndex) => ({ ...current, sort_order: currentIndex + 1 })));
  }

  return (
    <section className="manufacturing-route-editor">
      <div className="manufacturing-route-editor__header">
        <div>
          <h3>Roteiro de fabricação</h3>
          {!orderedSteps.length && <p>Este produto ainda não possui um roteiro de fabricação.</p>}
        </div>
        <button className="button" type="button" onClick={() => setEditingStep({ ...emptyStep(), sort_order: orderedSteps.length + 1 })}>
          {orderedSteps.length ? 'Adicionar etapa' : 'Adicionar primeira etapa'}
        </button>
      </div>

      {orderedSteps.length > 0 && (
        <div className="manufacturing-route-editor__list">
          {orderedSteps.map((step, index) => {
            const dependencyNames = (step.dependency_client_ids || [])
              .map((dependencyId) => orderedSteps.find((current) => current.client_id === dependencyId)?.name)
              .filter(Boolean);
            const isDependency = orderedSteps.some((current) => current.dependency_client_ids?.includes(step.client_id));

            return (
              <article className="manufacturing-route-editor__card" key={step.client_id}>
                <div>
                  <span>{index + 1}. {step.name || 'Etapa sem nome'}</span>
                  <strong>{sectors.find((sector) => sector.id === step.sector_id)?.name || 'Setor não selecionado'}</strong>
                </div>
                <div>
                  <span>Quantidade</span>
                  <strong>{step.quantity || 1}</strong>
                </div>
                <div>
                  <span>Dependências</span>
                  <strong>{dependencyNames.length ? dependencyNames.join(', ') : 'Início imediato'}</strong>
                </div>
                <div className="manufacturing-route-editor__actions">
                  <button className="button" type="button" onClick={() => move(step, -1)}>Subir</button>
                  <button className="button" type="button" onClick={() => move(step, 1)}>Descer</button>
                  <button className="button" type="button" onClick={() => setEditingStep(step)}>Editar</button>
                  <button className="button button_danger" type="button" onClick={() => removeStep(step)} disabled={isDependency}>Remover</button>
                  <button className="button button_primary" type="button" onClick={() => setEditingStep({ ...emptyStep(step.client_id), sort_order: orderedSteps.length + 1 })}>Adicionar próxima etapa</button>
                </div>
                {isDependency && <p className="manufacturing-route-editor__hint">Esta etapa é utilizada como dependência por outras etapas.</p>}
              </article>
            );
          })}
        </div>
      )}

      {editingStep && (
        <div className="manufacturing-route-editor__modal">
          <form className="manufacturing-route-editor__modal-content" onSubmit={saveStep}>
            <div className="manufacturing-route-editor__modal-header">
              <h3>{steps.some((step) => step.client_id === editingStep.client_id) ? 'Editar etapa' : 'Adicionar etapa'}</h3>
              <button className="button" type="button" onClick={() => setEditingStep(null)}>Fechar</button>
            </div>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Nome da etapa</span>
                <input className="field__input" value={editingStep.name} onChange={(event) => setEditingStep({ ...editingStep, name: event.target.value })} required />
              </label>
              <label className="field">
                <span className="field__label">Setor responsável</span>
                <select className="field__input" value={editingStep.sector_id} onChange={(event) => setEditingStep({ ...editingStep, sector_id: event.target.value })} required>
                  <option value="">Selecione</option>
                  {sectors.map((sector) => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Quantidade</span>
                <input className="field__input" type="number" min="1" value={editingStep.quantity} onChange={(event) => setEditingStep({ ...editingStep, quantity: Number(event.target.value) })} required />
              </label>
              <label className="field">
                <span className="field__label">Ordem visual</span>
                <input className="field__input" type="number" min="1" value={editingStep.sort_order} onChange={(event) => setEditingStep({ ...editingStep, sort_order: Number(event.target.value) })} required />
              </label>
            </div>

            <div className="manufacturing-route-editor__dependencies">
              <span className="field__label">Dependências</span>
              <input className="field__input" placeholder="Buscar etapas para selecionar dependências" value={dependencySearch} onChange={(event) => setDependencySearch(event.target.value)} />
              <div className="manufacturing-route-editor__dependency-list">
                {dependencyOptions.length === 0 && <p>Nenhuma etapa disponível.</p>}
                {dependencyOptions.map((step) => (
                  <label className="manufacturing-route-editor__dependency" key={step.client_id}>
                    <input type="checkbox" checked={(editingStep.dependency_client_ids || []).includes(step.client_id)} onChange={() => toggleDependency(step.client_id)} />
                    <span>{step.name || 'Etapa sem nome'}</span>
                  </label>
                ))}
              </div>
            </div>

            <button className="button button_primary" type="submit">Salvar etapa</button>
          </form>
        </div>
      )}
    </section>
  );
}
