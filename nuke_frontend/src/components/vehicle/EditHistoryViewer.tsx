/**
 * Edit History Viewer
 * Shows changelog of all edits to vehicle data
 * Click "View Changes" to see who changed what and when
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface EditHistoryViewerProps {
  vehicleId: string;
}

export const EditHistoryViewer: React.FC<EditHistoryViewerProps> = ({ vehicleId }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory, vehicleId]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('vehicle_edit_history')
        .select(`
          *,
          editor:profiles!vehicle_edit_history_edited_by_fkey(full_name, username)
        `)
        .eq('vehicle_id', vehicleId)
        .order('edited_at', { ascending: false })
        .limit(50);

      setHistory(data || []);
    } catch (err) {
      console.error('Error loading edit history:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="heading-3">Edit History</h3>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="button button-small"
        >
          {showHistory ? 'Hide' : 'View'} Changes
        </button>
      </div>

      {showHistory && (
        <div className="card-body">
          {loading && <div className="text text-small text-muted">Loading...</div>}
          
          {!loading && history.length === 0 && (
            <div className="text text-small text-muted">No edit history yet</div>
          )}

          {!loading && history.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {history.map(edit => (
                <div
                  key={edit.id}
                  style={{
                    padding: 'var(--space-2)',
                    border: '2px solid var(--border)',
                    borderRadius: '0px',
                    background: 'var(--white)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                    <span className="text text-small text-bold">
                      {edit.field_name.split('.').pop()}
                    </span>
                    <span className="text text-tiny text-muted">
                      {new Date(edit.edited_at).toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="text text-small" style={{ marginBottom: 'var(--space-1)' }}>
                    <span style={{ textDecoration: 'line-through', color: 'var(--error)' }}>
                      {edit.old_value || '(empty)'}
                    </span>
                    {' → '}
                    <span style={{ fontWeight: 'bold', color: 'var(--success)' }}>
                      {edit.new_value || '(empty)'}
                    </span>
                  </div>

                  <div className="text text-tiny text-muted">
                    By {edit.editor?.full_name || edit.editor?.username || 'unknown'}
                    {edit.change_reason && ` • ${edit.change_reason}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EditHistoryViewer;

