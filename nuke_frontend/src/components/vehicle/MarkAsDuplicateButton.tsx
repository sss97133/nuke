import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
  userId: string;
  onMarked?: () => void;
}

const MarkAsDuplicateButton: React.FC<Props> = ({ vehicleId, userId, onMarked }) => {
  const [showForm, setShowForm] = useState(false);
  const [duplicateOfId, setDuplicateOfId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!duplicateOfId.trim()) {
      alert('Please enter the primary vehicle ID');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle_merge_proposals')
        .insert({
          primary_vehicle_id: duplicateOfId.trim(),
          duplicate_vehicle_id: vehicleId,
          match_type: 'manual',
          confidence_score: 100,
          match_reasoning: { manual: true, reported_by: userId },
          recommended_primary: duplicateOfId.trim(),
          recommendation_reason: 'Manually marked as duplicate',
          status: 'pending',
          visible_to_user_ids: [userId],
          detected_by: 'manual_user_report',
          detected_at: new Date().toISOString()
        });

      if (error) throw error;

      alert('Duplicate marked successfully! It will appear in your Duplicates section.');
      setShowForm(false);
      setDuplicateOfId('');
      onMarked?.();
    } catch (err) {
      console.error('Error marking duplicate:', err);
      alert('Failed to mark as duplicate: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="button button-secondary"
        style={{
          fontSize: '8pt',
          padding: '4px 8px',
          whiteSpace: 'nowrap'
        }}
      >
        Mark Duplicate
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px'
      }}
      onClick={() => setShowForm(false)}
    >
      <div
        className="card"
        style={{ maxWidth: '400px', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
          Mark as Duplicate
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
            Enter the vehicle ID that this is a duplicate of (the profile you want to keep).
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: '9pt',
              fontWeight: 600,
              marginBottom: '6px'
            }}>
              Primary Vehicle ID
            </label>
            <input
              type="text"
              value={duplicateOfId}
              onChange={(e) => setDuplicateOfId(e.target.value)}
              placeholder="Enter vehicle ID"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontFamily: 'monospace'
              }}
            />
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Tip: Open the primary vehicle profile and copy the ID from the URL
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: '8px',
            marginTop: '8px',
            paddingTop: '12px',
            borderTop: '1px solid var(--border-light)'
          }}>
            <button
              onClick={() => setShowForm(false)}
              className="button button-secondary"
              style={{ flex: 1, fontSize: '9pt' }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="button button-primary"
              style={{ flex: 1, fontSize: '9pt' }}
              disabled={submitting || !duplicateOfId.trim()}
            >
              {submitting ? 'Marking...' : 'Mark as Duplicate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarkAsDuplicateButton;

