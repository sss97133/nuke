/**
 * Universal Inline Field Editor
 * Click any field to edit - auto-saves after brief pause
 * Subtle inline UX with no layout shifts
 */

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

interface UniversalFieldEditorProps {
  vehicleId: string;
  fieldName: string;
  fieldLabel: string;
  currentValue: any;
  canEdit: boolean;
  fieldType?: 'text' | 'number' | 'select' | 'checkbox';
  options?: string[];  // For select fields
  placeholder?: string;
  validator?: (value: any) => string | null;  // Returns error message or null
  onSaved?: (newValue: any) => void;
  tableName?: string;  // 'vehicles' or 'vehicle_nomenclature'
}

export const UniversalFieldEditor: React.FC<UniversalFieldEditorProps> = ({
  vehicleId,
  fieldName,
  fieldLabel,
  currentValue,
  canEdit,
  fieldType = 'text',
  options = [],
  placeholder,
  validator,
  onSaved,
  tableName = 'vehicles'
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState(currentValue || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  // Auto-save with debounce
  useEffect(() => {
    if (!isEditing || editedValue === currentValue) return;
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Set new timeout (1.5 seconds after typing stops)
    saveTimeoutRef.current = setTimeout(() => {
      handleSave();
    }, 1500);
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editedValue, isEditing]);

  const handleSave = async () => {
    // Skip system/generated columns
    const systemColumns = ['id', 'user_id', 'created_at', 'updated_at', 'uploaded_by'];
    if (systemColumns.includes(fieldName)) {
      setError('System field');
      return;
    }

    // Validate
    if (validator) {
      const validationError = validator(editedValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    // Don't save if unchanged
    if (editedValue === currentValue) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError('Login required');
        setSaving(false);
        return;
      }

      // Update the field
      const updateData: any = {};
      updateData[fieldName] = editedValue || null;

      const { error: updateError } = await supabase
        .from(tableName)
        .update(updateData)
        .eq(tableName === 'vehicles' ? 'id' : 'vehicle_id', vehicleId);

      if (updateError) throw updateError;

      // Log the edit in history (fire and forget)
      supabase.rpc('log_vehicle_edit', {
        p_vehicle_id: vehicleId,
        p_field_name: `${tableName}.${fieldName}`,
        p_old_value: currentValue?.toString() || null,
        p_new_value: editedValue?.toString() || null,
        p_user_id: user.id,
        p_source: 'inline_edit',
        p_change_reason: 'User correction'
      }).catch(console.error);

      // Track in field_sources (fire and forget)
      supabase
        .from('vehicle_field_sources')
        .upsert({
          vehicle_id: vehicleId,
          field_name: `${tableName}.${fieldName}`,
          source_type: 'user_input',
          source_user_id: user.id,
          confidence_score: 100,
          entered_at: new Date().toISOString()
        }, {
          onConflict: 'vehicle_id,field_name'
        }).catch(console.error);

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.(editedValue);
      
    } catch (err: any) {
      console.error('Error saving field:', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleBlur = () => {
    // Close edit mode after a delay (allows clicking elsewhere)
    setTimeout(() => {
      if (!saving) {
        setIsEditing(false);
        setEditedValue(currentValue || '');
      }
    }, 200);
  };

  // Display mode
  if (!isEditing) {
    const displayValue = currentValue || 'Not specified';
    const isEmpty = !currentValue;
    
    return (
      <div
        onClick={canEdit ? () => setIsEditing(true) : undefined}
        style={{
          padding: '6px 8px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: canEdit ? 'pointer' : 'default',
          transition: 'all 0.12s ease',
          background: canEdit ? 'var(--white)' : 'transparent'
        }}
        onMouseEnter={(e) => {
          if (canEdit) {
            e.currentTarget.style.background = 'var(--grey-50)';
          }
        }}
        onMouseLeave={(e) => {
          if (canEdit) {
            e.currentTarget.style.background = 'var(--white)';
          }
        }}
      >
        <span className="text text-small text-muted">{fieldLabel}</span>
        <span 
          className="text text-small"
          style={{ 
            fontWeight: isEmpty ? 'normal' : 'bold',
            color: isEmpty ? 'var(--text-muted)' : 'var(--text)',
            textDecoration: canEdit ? 'underline' : 'none'
          }}
        >
          {displayValue}
        </span>
      </div>
    );
  }

  // Edit mode - inline, subtle, auto-saves
  return (
    <div style={{
      padding: '6px 8px',
      borderBottom: '1px solid var(--border-light)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: 'var(--white)',
      position: 'relative'
    }}>
      <span className="text text-small text-muted">{fieldLabel}</span>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, maxWidth: '60%' }}>
        {fieldType === 'select' ? (
          <select
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            value={editedValue}
            onChange={(e) => {
              setEditedValue(e.target.value);
              if (error) setError('');
            }}
            onBlur={handleBlur}
            autoFocus
            style={{
              width: '100%',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif',
              border: '1px solid var(--border)',
              borderRadius: '0px',
              padding: '2px 4px'
            }}
          >
            <option value="">Select...</option>
            {options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : fieldType === 'checkbox' ? (
          <input
            type="checkbox"
            checked={editedValue}
            onChange={(e) => {
              setEditedValue(e.target.checked);
              handleSave();
            }}
            style={{ width: '16px', height: '16px' }}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={fieldType}
            value={editedValue}
            onChange={(e) => {
              setEditedValue(fieldType === 'number' ? Number(e.target.value) : e.target.value);
              if (error) setError('');
            }}
            onBlur={handleBlur}
            placeholder={placeholder}
            autoFocus
            style={{
              width: '100%',
              fontSize: '8pt',
              fontFamily: '"MS Sans Serif", sans-serif',
              border: `1px solid ${error ? 'var(--error)' : 'var(--border)'}`,
              borderRadius: '0px',
              padding: '2px 4px',
              fontWeight: 'bold',
              textAlign: 'right'
            }}
          />
        )}
        
        {/* Status indicator */}
        <span style={{
          fontSize: '7pt',
          color: saving ? 'var(--warning)' : saved ? 'var(--success)' : error ? 'var(--error)' : 'transparent',
          whiteSpace: 'nowrap',
          minWidth: '40px'
        }}>
          {saving ? 'saving...' : saved ? 'saved' : error ? 'error' : ''}
        </span>
      </div>
      
      {/* Error tooltip */}
      {error && (
        <div style={{
          position: 'absolute',
          right: '8px',
          top: '100%',
          background: 'var(--error)',
          color: 'var(--white)',
          padding: '4px 8px',
          fontSize: '7pt',
          borderRadius: '2px',
          whiteSpace: 'nowrap',
          zIndex: 1000,
          marginTop: '2px'
        }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default UniversalFieldEditor;

