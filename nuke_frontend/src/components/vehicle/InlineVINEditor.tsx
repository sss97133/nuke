/**
 * Inline VIN Editor
 * Click-to-edit VIN for collaborators/owners
 * Tracks attribution: who added/corrected the VIN
 */

import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface InlineVINEditorProps {
  vehicleId: string;
  currentVIN?: string;
  canEdit: boolean;
  onVINUpdated?: (newVIN: string) => void;
}

export const InlineVINEditor: React.FC<InlineVINEditorProps> = ({
  vehicleId,
  currentVIN,
  canEdit,
  onVINUpdated
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedVIN, setEditedVIN] = useState(currentVIN || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const validateVIN = (vin: string): boolean => {
    // VIN must be 17 characters, alphanumeric, no I/O/Q
    if (!vin || vin.length !== 17) return false;
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) return false;
    return true;
  };

  const handleSave = async () => {
    const vinUpper = editedVIN.toUpperCase().trim();
    
    if (!validateVIN(vinUpper)) {
      setError('Invalid VIN format. Must be 17 characters, no I/O/Q.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setError('You must be logged in');
        setSaving(false);
        return;
      }

      // Update vehicle VIN
      const { error: updateError } = await supabase
        .from('vehicles')
        .update({ vin: vinUpper })
        .eq('id', vehicleId);

      if (updateError) throw updateError;

      // Track the VIN correction in field_sources
      await supabase
        .from('vehicle_field_sources')
        .upsert({
          vehicle_id: vehicleId,
          field_name: 'vin',
          source_type: 'user_input',
          source_user_id: user.id,
          confidence_score: 100,
          entered_at: new Date().toISOString()
        }, {
          onConflict: 'vehicle_id,field_name'
        });

      // Create timeline event for VIN correction
      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicleId,
          user_id: user.id,
          event_type: 'vin_added',
          source: 'manual_edit',
          title: 'VIN corrected',
          event_date: new Date().toISOString(),
          metadata: {
            old_vin: currentVIN || 'none',
            new_vin: vinUpper,
            correction_reason: 'user_input'
          }
        });

      setIsEditing(false);
      onVINUpdated?.(vinUpper);
      
    } catch (err: any) {
      console.error('Error saving VIN:', err);
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedVIN(currentVIN || '');
    setIsEditing(false);
    setError('');
  };

  // Display mode
  if (!isEditing) {
    const displayVIN = currentVIN || 'No VIN';
    const isFakeVIN = currentVIN?.startsWith('VIVA-') || !currentVIN;
    
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '8px 12px',
        border: `2px solid ${isFakeVIN ? 'var(--warning)' : 'var(--border)'}`,
        borderRadius: '0px',
        background: 'var(--white)',
        transition: 'all 0.12s ease'
      }}>
        <div style={{ flex: 1 }}>
          <div className="text text-small text-bold text-muted" style={{ marginBottom: '2px' }}>
            VIN
          </div>
          <div style={{ 
            fontSize: '10pt', 
            fontFamily: 'monospace',
            color: isFakeVIN ? 'var(--warning)' : 'var(--text)'
          }}>
            {displayVIN}
          </div>
          {isFakeVIN && (
            <div className="text text-tiny" style={{ color: 'var(--warning)', marginTop: '2px' }}>
              Placeholder - click to correct
            </div>
          )}
        </div>
        
        {canEdit && (
          <button
            onClick={() => setIsEditing(true)}
            className="button button-small"
            style={{
              background: isFakeVIN ? 'var(--warning)' : 'var(--accent)',
              color: 'var(--white)',
              border: '2px outset var(--white)'
            }}
          >
            {isFakeVIN ? 'CORRECT' : 'EDIT'}
          </button>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="card" style={{
      border: '2px solid var(--accent)',
      background: 'var(--grey-50)'
    }}>
      <div className="card-body">
        <div className="text text-bold" style={{ marginBottom: 'var(--space-2)' }}>
          Edit VIN
        </div>
        
        <input
          type="text"
          value={editedVIN}
          onChange={(e) => {
            const val = e.target.value.toUpperCase().trim();
            setEditedVIN(val);
            if (error) setError('');
          }}
          maxLength={17}
          placeholder="Enter 17-character VIN"
          autoFocus
          className="form-input"
          style={{
            width: '100%',
            fontFamily: 'monospace',
            border: `2px solid ${error ? 'var(--error)' : 'var(--border)'}`,
            borderRadius: '0px',
            marginBottom: 'var(--space-2)'
          }}
        />
        
        {error && (
          <div className="card" style={{ 
            marginBottom: 'var(--space-2)',
            border: '2px solid var(--error)',
            background: 'var(--white)'
          }}>
            <div className="card-body">
              <div className="text text-small" style={{ color: 'var(--error)' }}>
                {error}
              </div>
            </div>
          </div>
        )}
        
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            onClick={handleSave}
            disabled={saving || !editedVIN}
            className="button button-primary"
            style={{
              flex: 1,
              background: saving ? 'var(--grey-400)' : 'var(--success)',
              border: '2px outset var(--white)',
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'SAVING...' : 'SAVE VIN'}
          </button>
          
          <button
            onClick={handleCancel}
            disabled={saving}
            className="button button-secondary"
            style={{
              border: '2px outset var(--border)',
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            CANCEL
          </button>
        </div>
        
        <div className="text text-tiny text-muted" style={{ 
          marginTop: 'var(--space-2)',
          lineHeight: '1.4'
        }}>
          Format: 17 alphanumeric characters (no I, O, or Q)
        </div>
      </div>
    </div>
  );
};

export default InlineVINEditor;

