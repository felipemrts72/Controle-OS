import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { ConfirmModal } from '../../components/ConfirmModal/ConfirmModal.jsx';

export function PendingReportModal({ open, title, employees, loading, generating, onCancel, onGenerate }) {
  const [selected, setSelected] = useState(() => new Set());

  const availableKeys = useMemo(() => employees.flatMap((employee) => (
    employee.pendencies.map((_pending, index) => `${employee.id}:${index}`)
  )), [employees]);

  useEffect(() => {
    if (open) setSelected(new Set());
  }, [employees, open]);

  function toggle(employeeId, pendingIndex) {
    const key = `${employeeId}:${pendingIndex}`;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(availableKeys));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function generate() {
    const selections = employees.map((employee) => ({
      employee_id: employee.id,
      pending_indexes: employee.pendencies
        .map((_pending, index) => index)
        .filter((index) => selected.has(`${employee.id}:${index}`)),
    })).filter((selection) => selection.pending_indexes.length > 0);
    onGenerate(selections);
  }

  return (
    <ConfirmModal
      open={open}
      title={title}
      onCancel={onCancel}
      contentClassName="employees-page__pending-modal"
      actions={(
        <button className="button button_primary" type="button" onClick={generate} disabled={loading || generating || selected.size === 0}>
          <Download size={18} />
          <span>{generating ? 'Gerando...' : `Gerar relatório (${selected.size})`}</span>
        </button>
      )}
    >
      {loading ? (
        <p>Carregando pendências...</p>
      ) : availableKeys.length === 0 ? (
        <p>Nenhuma pendência cadastral encontrada.</p>
      ) : (
        <>
          <p>Marque somente os itens que devem aparecer no relatório.</p>
          <div className="employees-page__pending-selection-actions">
            <button className="button" type="button" onClick={selectAll}>Marcar todas</button>
            <button className="button" type="button" onClick={clearSelection} disabled={selected.size === 0}>Desmarcar todas</button>
          </div>
          <div className="employees-page__pending-groups">
            {employees.map((employee) => (
              <section className="employees-page__pending-group" key={employee.id}>
                <h3>{employee.full_name}</h3>
                <p>{employee.job_title || 'Cargo não informado'} · {employee.sector_name || 'Setor não informado'}</p>
                <div className="employees-page__pending-options">
                  {employee.pendencies.map((pending, index) => {
                    const inputId = `pending-${employee.id}-${index}`;
                    return (
                      <label className="employees-page__pending-option" htmlFor={inputId} key={inputId}>
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={selected.has(`${employee.id}:${index}`)}
                          onChange={() => toggle(employee.id, index)}
                        />
                        <span>{pending}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </ConfirmModal>
  );
}
