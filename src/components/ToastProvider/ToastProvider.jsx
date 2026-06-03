import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import './ToastProvider.css';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((type, message) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => removeToast(id), 3800);
  }, [removeToast]);

  const value = useMemo(() => ({
    success: (message) => addToast('success', message),
    error: (message) => addToast('error', message),
    warning: (message) => addToast('warning', message),
    info: (message) => addToast('info', message),
  }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-provider" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast-provider__toast toast-provider__toast_${toast.type}`} key={toast.id}>
            <span>{toast.message}</span>
            <button type="button" onClick={() => removeToast(toast.id)} aria-label="Fechar aviso">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast deve ser usado dentro de ToastProvider.');
  return toast;
}
