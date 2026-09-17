import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';

export function PendingReportModal({ open, title, employees, loading, generating, onCancel, onGenerate }) {
  const [selectedTypes, setSelectedTypes] = useState(() => new Set());

  const availableTypes = useMemo(() => [...new Map(employees.flatMap((employee) => (
    employee.pendencies.map((pending) => [pending.type, pending.type_label])
  ))).entries()].map(([type, label]) => ({ type, label })), [employees]);

  const selectedEmployees = useMemo(() => employees.map((employee) => {
    const pendencies = employee.pendencies.filter((pending) => selectedTypes.has(pending.type));
    return { ...employee, pendencies, pending_count: pendencies.length };
  }).filter((employee) => employee.pendencies.length > 0), [employees, selectedTypes]);

  const selectedPendingCount = useMemo(() => selectedEmployees.reduce(
    (total, employee) => total + employee.pendencies.length,
    0,
  ), [selectedEmployees]);

  useEffect(() => {
    if (open) setSelectedTypes(new Set());
  }, [employees, open]);

  function toggle(type) {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function selectAll() {
    setSelectedTypes(new Set(availableTypes.map(({ type }) => type)));
  }

  function clearSelection() {
    setSelectedTypes(new Set());
  }

  function generate() {
    onGenerate([...selectedTypes]);
  }

  return (
    <ConfirmModal
      open={open}
      title={title}
      onCancel={onCancel}
      contentClassName="employees-page__pending-modal"
      actions={(
        <button className="button button_primary" type="button" onClick={generate} disabled={loading || generating || selectedPendingCount === 0}>
          <Download size={18} />
          <span>{generating ? 'Gerando...' : `Gerar relatório (${selectedPendingCount})`}</span>
        </button>
      )}
    >
      {loading ? (
        <p>Carregando pendências...</p>
      ) : availableTypes.length === 0 ? (
        <p>Nenhuma pendência cadastral encontrada.</p>
      ) : (
        <>
          <p>Selecione uma vez os tipos de pendência que devem compor o relatório.</p>
          <div className="employees-page__pending-selection-actions">
            <button className="button" type="button" onClick={selectAll}>Marcar todas</button>
            <button className="button" type="button" onClick={clearSelection} disabled={selectedTypes.size === 0}>Desmarcar todas</button>
          </div>
          <div className="employees-page__pending-types" aria-label="Tipos de pendência">
            {availableTypes.map(({ type, label }) => (
              <label className="employees-page__pending-option" htmlFor={`pending-type-${type}`} key={type}>
                <input
                  id={`pending-type-${type}`}
                  type="checkbox"
                  checked={selectedTypes.has(type)}
                  onChange={() => toggle(type)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {selectedTypes.size > 0 && selectedEmployees.length === 0 && (
            <p>Nenhum funcionário possui as pendências selecionadas.</p>
          )}
          {selectedEmployees.length > 0 && (
            <div className="employees-page__pending-groups">
            {selectedEmployees.map((employee) => (
              <section className="employees-page__pending-group" key={employee.id}>
                <h3>{employee.full_name}</h3>
                <p>{employee.job_title || 'Cargo não informado'} · {employee.sector_name || 'Setor não informado'} · {employee.pending_count} pendência(s)</p>
                <div className="employees-page__pending-options">
                  {employee.pendencies.map((pending) => <div className="employees-page__pending-item" key={`${pending.type}:${pending.label}`}>{pending.label}</div>)}
                </div>
                {employee.warnings?.map((warning) => (
                  <aside className="employees-page__pending-warning" key={warning.type}>
                    <strong>{warning.title}</strong>
                    <span>{warning.message}</span>
                  </aside>
                ))}
              </section>
            ))}
            </div>
          )}
        </>
      )}
    </ConfirmModal>
  );
}
