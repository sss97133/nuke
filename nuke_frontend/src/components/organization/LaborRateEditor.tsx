/**
 * Labor Rate Editor for Organizations
 * Allows shop owners to set/update their hourly labor rate
 */

import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

interface LaborRateEditorProps {
  organizationId: string;
  organizationName: string;
  currentRate?: number | null;
  onSaved: () => void;
  onClose: () => void;
}

export const LaborRateEditor: React.FC<LaborRateEditorProps> = ({
  organizationId,
  organizationName,
  currentRate,
  onSaved,
  onClose
}) => {
  const [laborRate, setLaborRate] = useState(currentRate?.toString() || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const rate = parseFloat(laborRate);
    if (isNaN(rate) || rate <= 0) {
      alert('Please enter a valid labor rate');
      return;
    }

    setSaving(true);

    try {
      const { error } = await supabase
        .from('businesses')
        .update({ labor_rate: rate, updated_at: new Date().toISOString() })
        .eq('id', organizationId);

      if (error) throw error;

      onSaved();
      onClose();
    } catch (error: any) {
      console.error('Error saving labor rate:', error);
      alert(`Failed to save labor rate: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          maxWidth: '500px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header">
          <h3 style={{ fontSize: '11pt', fontWeight: 700, margin: 0 }}>
            Set Labor Rate - {organizationName}
          </h3>
        </div>
        <div className="card-body">
          <form onSubmit={handleSave}>
            <div style={{ marginBottom: '16px' }}>
              <label className="form-label" style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px', display: 'block' }}>
                Hourly Labor Rate ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={laborRate}
                onChange={(e) => setLaborRate(e.target.value)}
                placeholder="e.g. 125.00"
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                required
              />
              <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
                This is your standard hourly labor rate for estimates and work orders.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button
                type="button"
                onClick={onClose}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                style={{ fontSize: '9pt' }}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Labor Rate'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LaborRateEditor;

