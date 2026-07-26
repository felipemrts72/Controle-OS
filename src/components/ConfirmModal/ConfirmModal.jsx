import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import './ConfirmModal.css';

export function ConfirmModal({ open, title, children, onCancel, actions, showCancel = true, cancelLabel = 'Cancelar' }) {
  useEscapeKey(open, onCancel);

  if (!open) return null;
  return (
    <div className="confirm-modal">
      <div className="confirm-modal__content">
        <h2 className="confirm-modal__title">{title}</h2>
        <div className="confirm-modal__body">{children}</div>
        <div className="confirm-modal__actions">
          {actions}
          {showCancel && <button className="button" type="button" onClick={onCancel}>{cancelLabel}</button>}
        </div>
      </div>
    </div>
  );
}
