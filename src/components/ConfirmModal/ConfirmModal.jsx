import './ConfirmModal.css';

export function ConfirmModal({ open, title, children, onCancel, actions }) {
  if (!open) return null;
  return (
    <div className="confirm-modal">
      <div className="confirm-modal__content">
        <h2 className="confirm-modal__title">{title}</h2>
        <div className="confirm-modal__body">{children}</div>
        <div className="confirm-modal__actions">
          {actions}
          <button className="button" type="button" onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
