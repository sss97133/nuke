import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  amount?: number;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'danger' | 'warning' | 'info';
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  amount,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  type = 'info'
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const getColors = () => {
    switch (type) {
      case 'danger':
        return { accent: 'var(--error)', accentDim: 'var(--error-dim)' };
      case 'warning':
        return { accent: 'var(--warning)', accentDim: 'var(--warning-dim)' };
      default:
        return { accent: 'var(--accent)', accentDim: 'var(--accent-dim)' };
    }
  };

  const colors = getColors();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '16px'
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)', padding: '20px',
          maxWidth: '400px',
          width: '100%'}}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '12px'
        }}>
          <span style={{
            fontSize: '16px',
            color: colors.accent
          }}>
            {type === 'danger' ? '⚠' : type === 'warning' ? '⚠' : 'ℹ'}
          </span>
          <h3 style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--text)',
            margin: 0
          }}>
            {title}
          </h3>
        </div>

        {/* Message */}
        <p style={{
          fontSize: '10px',
          color: 'var(--text)',
          lineHeight: 1.5,
          marginBottom: '16px'
        }}>
          {message}
        </p>

        {/* Amount Display */}
        {amount !== undefined && (
          <div style={{
            background: colors.accentDim,
            border: `2px solid ${colors.accent}`, padding: '12px',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '8px',
              color: 'var(--text-secondary)',
              marginBottom: '4px'
            }}>
              Transaction Amount
            </div>
            <div style={{
              fontSize: '14px',
              fontWeight: 600,
              color: colors.accent
            }}>
              ${(amount / 100).toFixed(2)}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={onCancel}
            style={{
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              cursor: 'pointer', transition: '0.12s'
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              border: `2px solid ${colors.accent}`,
              background: colors.accentDim,
              color: colors.accent,
              padding: '6px 12px',
              fontSize: '9px',
              fontWeight: 600,
              cursor: 'pointer', transition: '0.12s'
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

