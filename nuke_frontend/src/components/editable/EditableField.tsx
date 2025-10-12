import React, { useEffect, useMemo, useRef, useState } from 'react';

export type EditableFieldType = 'text' | 'number' | 'date' | 'textarea' | 'toggle';

export interface EditableFieldProps<T = any> {
  label: string;
  name: string;
  value: T;
  type?: EditableFieldType;
  placeholder?: string;
  disabled?: boolean;
  helpText?: string;
  min?: number;
  max?: number;
  step?: number;
  onValidate?: (value: T) => string | null | undefined;
  onSave: (value: T) => Promise<void> | void;
}

export const EditableField: React.FC<EditableFieldProps> = ({
  label,
  name,
  value,
  type = 'text',
  placeholder,
  disabled,
  helpText,
  min,
  max,
  step,
  onValidate,
  onSave,
}) => {
  const [editingValue, setEditingValue] = useState<any>(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setEditingValue(value);
  }, [value]);

  const validate = useMemo(() => onValidate || (() => null), [onValidate]);

  const handleBlurSave = async () => {
    if (disabled) return;
    const err = validate(editingValue as any);
    if (err) { setError(err); return; }
    if (editingValue === value) return;
    try {
      setSaving(true);
      setError(null);
      await onSave(editingValue as any);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const commonProps = {
    id: name,
    name,
    disabled: !!disabled || saving,
    onBlur: handleBlurSave,
    className: 'form-input text-small',
    'aria-label': label,
    placeholder,
  } as const;

  return (
    <div style={{ marginBottom: 'var(--space-2)' }}>
      <label htmlFor={name} className="text-small" style={{ display: 'block', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>{label}</label>
      {type === 'textarea' ? (
        <textarea
          {...(commonProps as any)}
          rows={3}
          value={editingValue || ''}
          onChange={(e) => setEditingValue(e.target.value)}
        />
      ) : type === 'number' ? (
        <input
          {...(commonProps as any)}
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={editingValue ?? ''}
          onChange={(e) => setEditingValue(e.target.value === '' ? null : Number(e.target.value))}
        />
      ) : type === 'date' ? (
        <input
          {...(commonProps as any)}
          type="date"
          value={editingValue || ''}
          onChange={(e) => setEditingValue(e.target.value)}
        />
      ) : type === 'toggle' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input
            id={name}
            name={name}
            type="checkbox"
            checked={!!editingValue}
            onChange={(e) => {
              setEditingValue(e.target.checked);
              // Save immediately for toggles
              onSave(e.target.checked as any);
            }}
            disabled={!!disabled || saving}
          />
          <span className="text-small" style={{ color: 'var(--text-muted)' }}>{editingValue ? 'On' : 'Off'}</span>
        </div>
      ) : (
        <input
          {...(commonProps as any)}
          type="text"
          value={editingValue || ''}
          onChange={(e) => setEditingValue(e.target.value)}
        />
      )}

      {helpText && !error && (
        <div className="text-small" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>{helpText}</div>
      )}
      {saving && (
        <div className="text-small" style={{ color: 'var(--primary)', marginTop: 'var(--space-1)' }}>Saving…</div>
      )}
      {error && (
        <div className="text-small" style={{ color: 'var(--danger)', marginTop: 'var(--space-1)' }}>{error}</div>
      )}
    </div>
  );
};

export default EditableField;
