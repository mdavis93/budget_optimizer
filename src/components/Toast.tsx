import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import clsx from 'clsx';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const styles: Record<ToastType, string> = {
  success: 'bg-success-50 dark:bg-success-900/30 border-success-200 dark:border-success-800 text-success-800 dark:text-success-200',
  error: 'bg-danger-50 dark:bg-danger-900/30 border-danger-200 dark:border-danger-800 text-danger-800 dark:text-danger-200',
  warning: 'bg-warning-50 dark:bg-warning-900/30 border-warning-200 dark:border-warning-800 text-warning-800 dark:text-warning-200',
  info: 'bg-primary-50 dark:bg-primary-900/30 border-primary-200 dark:border-primary-800 text-primary-800 dark:text-primary-200',
};

const iconStyles: Record<ToastType, string> = {
  success: 'text-success-500',
  error: 'text-danger-500',
  warning: 'text-warning-500',
  info: 'text-primary-500',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = icons[toast.type];
  
  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-4 rounded-lg border shadow-lg',
        'animate-in slide-in-from-right fade-in duration-300',
        styles[toast.type]
      )}
      role="alert"
    >
      <Icon className={clsx('w-5 h-5 shrink-0 mt-0.5', iconStyles[toast.type])} />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        onClick={onDismiss}
        className="shrink-0 p-1 rounded-sm hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration = 5000) => {
    const id = Math.random().toString(36).substring(2, 9);
    const toast: Toast = { id, type, message, duration };
    
    setToasts(prev => [...prev, toast]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div
        data-testid="toast-viewport"
        className="fixed right-4 z-50 flex flex-col gap-2 max-w-sm transition-[bottom] duration-200"
        style={{ bottom: 'var(--app-toast-bottom, 1rem)' }}
      >
        {toasts.map(toast => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
