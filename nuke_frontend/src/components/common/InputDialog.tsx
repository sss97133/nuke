import React, { useState, useEffect, useRef } from 'react';
import '../../design-system.css';

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
}

const modalStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
};

const panelStyle: React.CSSProperties = {
  width: '400px',
  maxWidth: '95%',
  background: 'var(--surface)',
  border: '1px solid #c0c0c0',
  borderRadius: 2,
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
};

const headerStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #c0c0c0',
  background: '#f3f4f6',
  fontWeight: 700,
  fontSize: '9pt'
};

const bodyStyle: React.CSSProperties = {
  padding: '12px'
};

export const InputDialog: React.FC<InputDialogProps> = ({
  isOpen,
  title,
  message,
  defaultValue = '',
  placeholder,
  onConfirm,
  onCancel,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  required = false
}) => {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      // Focus input after modal opens
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (required && !value.trim()) return;
    onConfirm(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div style={modalStyle} onClick={onCancel}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>{title}</div>
        <div style={bodyStyle}>
          {message && (
            <div style={{ marginBottom: '8px', fontSize: '9pt', color: 'var(--text-muted)' }}>
              {message}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            className="form-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              width: '100%',
              fontSize: '9pt',
              padding: '6px',
              marginBottom: '12px'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
            <button
              className="button button-small button-secondary"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              className="button button-small"
              onClick={handleConfirm}
              disabled={required && !value.trim()}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

