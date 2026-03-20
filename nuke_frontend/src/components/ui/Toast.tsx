import React, { useState, useEffect, createContext, useContext } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type: Toast['type'], duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: Toast['type'], duration = 3000) => {
    const id = Math.random().toString(36).substring(7);
    const toast: Toast = { id, message, type, duration };
    
    setToasts(prev => [...prev, toast]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const getIcon = (type: Toast['type']) => {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '✕';
      case 'warning': return '⚠';
      case 'info': return 'ℹ';
      default: return '•';
    }
  };

  const getColors = (type: Toast['type']) => {
    switch (type) {
      case 'success': return { bg: 'var(--success-dim)', border: 'var(--success)', text: '#166534' };
      case 'error': return { bg: 'var(--error-dim)', border: 'var(--error)', text: '#991b1b' };
      case 'warning': return { bg: 'var(--warning-dim)', border: 'var(--warning)', text: '#92400e' };
      case 'info': return { bg: 'var(--info-dim)', border: 'var(--info)', text: '#1e40af' };
      default: return { bg: 'var(--surface)', border: 'var(--border)', text: 'var(--text)' };
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast Container */}
      <div style={{
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '400px'
      }}>
        {toasts.map(toast => {
          const colors = getColors(toast.type);
          return (
            <div
              key={toast.id}
              style={{
                background: colors.bg,
                border: `2px solid ${colors.border}`, padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '10px',
                color: colors.text,
                fontWeight: 500, animation: 'slideIn 0.12s ease',
                cursor: 'pointer'
              }}
              onClick={() => removeToast(toast.id)}
            >
              <span style={{ fontSize: '12px', fontWeight: 600 }}>
                {getIcon(toast.type)}
              </span>
              <span style={{ flex: 1 }}>{toast.message}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeToast(toast.id);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.text,
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '0 4px',
                  opacity: 0.6,
                  fontWeight: 600
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </ToastContext.Provider>
  );
};

