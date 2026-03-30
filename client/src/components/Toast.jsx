import { useState, useCallback, useRef } from 'react';

let globalShowToast = null;

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const show = useCallback((message, type = 'info', duration = 3000) => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  globalShowToast = show;
  return { toasts, show };
}

export function showToast(message, type = 'info', duration = 3000) {
  globalShowToast?.(message, type, duration);
}

export function ToastContainer({ toasts }) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
      zIndex: 10000, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
      pointerEvents: 'none', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'error' ? '#da3633' : t.type === 'success' ? '#238636' : '#30363d',
          color: '#fff', padding: '10px 20px', borderRadius: 8,
          fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          animation: 'toast-in 0.3s ease', pointerEvents: 'auto',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
