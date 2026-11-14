import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export function useToasts(): {
  toasts: ToastItem[];
  notify: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-4), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4600);
    },
    [dismiss],
  );

  return { toasts, notify, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }): React.JSX.Element {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          {toast.kind === 'success' ? (
            <CheckCircle2 />
          ) : toast.kind === 'error' ? (
            <XCircle />
          ) : (
            <Info />
          )}
          <span>{toast.message}</span>
          <button className="icon-btn toast-close" type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
