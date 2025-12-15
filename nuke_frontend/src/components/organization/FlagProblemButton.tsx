import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  orgVehicleId: string;
  vehicleId: string;
  userId: string;
  currentFlag?: string | null;
  onFlagged?: () => void;
}

const PROBLEM_FLAGS = [
  { value: 'duplicate', label: 'Duplicate', description: 'This is a duplicate entry' },
  { value: 'wrong_org', label: 'Wrong Organization', description: 'Linked to wrong org' },
  { value: 'incomplete', label: 'Incomplete Data', description: 'Missing critical info' },
  { value: 'spam', label: 'Spam/Junk', description: 'Low quality or spam' },
];

const FlagProblemButton: React.FC<Props> = ({ orgVehicleId, vehicleId, userId, currentFlag, onFlagged }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFlag = async (flag: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organization_vehicles')
        .update({
          quality_flag: flag,
          flagged_by_user_id: userId,
          flagged_at: new Date().toISOString(),
          hidden_from_public: true, // Hide from public when flagged
          updated_at: new Date().toISOString()
        })
        .eq('id', orgVehicleId);

      if (error) throw error;

      alert('✅ Flagged successfully - hidden from public view');
      setShowMenu(false);
      onFlagged?.();
    } catch (err) {
      console.error('Error flagging:', err);
      alert('Failed to flag: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUnflag = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organization_vehicles')
        .update({
          quality_flag: null,
          flagged_by_user_id: null,
          flagged_at: null,
          hidden_from_public: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', orgVehicleId);

      if (error) throw error;

      alert('✅ Flag removed - visible to public again');
      setShowMenu(false);
      onFlagged?.();
    } catch (err) {
      console.error('Error unflagging:', err);
      alert('Failed to unflag');
    } finally {
      setSaving(false);
    }
  };

  if (currentFlag) {
    return (
      <button
        onClick={() => handleUnflag()}
        className="button button-secondary"
        style={{
          fontSize: '8pt',
          padding: '4px 8px',
          background: 'var(--warning-dim)',
          border: '1px solid var(--warning)',
          color: 'var(--warning)'
        }}
        disabled={saving}
      >
        {saving ? 'Unflagging...' : 'UNFLAG'}
      </button>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="button button-secondary"
        style={{
          fontSize: '8pt',
          padding: '4px 8px',
          whiteSpace: 'nowrap'
        }}
        disabled={saving}
      >
        Flag Issue
      </button>

      {showMenu && (
        <>
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 999
            }}
            onClick={() => setShowMenu(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1000,
              minWidth: '200px'
            }}
          >
            {PROBLEM_FLAGS.map(flag => (
              <div
                key={flag.value}
                onClick={() => handleFlag(flag.value)}
                style={{
                  padding: '10px 12px',
                  fontSize: '8pt',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border-light)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ fontWeight: 700, marginBottom: '2px' }}>
                  {flag.label}
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {flag.description}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default FlagProblemButton;

