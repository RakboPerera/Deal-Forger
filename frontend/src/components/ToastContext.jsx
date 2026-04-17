import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const ToastContext = createContext({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const COLORS = {
  success: { bg: '#10b981', icon: CheckCircle2 },
  error:   { bg: '#ef4444', icon: AlertCircle },
  info:    { bg: '#2563eb', icon: Info },
};

export default function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((message, type = 'info', durationMs = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setItems(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id));
    }, durationMs);
  }, []);

  const dismiss = (id) => setItems(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxWidth: 360,
        }}
      >
        {items.map(t => {
          const cfg = COLORS[t.type] || COLORS.info;
          const Icon = cfg.icon;
          return (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 10,
                background: cfg.bg, color: '#fff',
                fontSize: '0.85rem', fontWeight: 500,
                boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
                animation: 'toast-in 0.2s ease-out',
              }}
            >
              <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                style={{
                  background: 'none', border: 'none', color: '#fff',
                  opacity: 0.8, cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center',
                }}
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}
