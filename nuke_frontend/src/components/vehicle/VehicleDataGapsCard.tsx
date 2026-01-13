import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

type FieldPriority = 'critical' | 'high' | 'medium' | 'low';

type DataGap = {
  id: string;
  field_name: string;
  field_priority: FieldPriority;
  gap_reason: string | null;
  points_reward: number | null;
  is_filled: boolean;
};

function priorityLabel(priority: FieldPriority): string {
  return priority.toUpperCase();
}

function priorityBadgeClass(priority: FieldPriority): string {
  switch (priority) {
    case 'critical':
      return 'badge badge-danger';
    case 'high':
      return 'badge badge-warning';
    case 'medium':
      return 'badge badge-secondary';
    case 'low':
    default:
      return 'badge badge-secondary';
  }
}

function prettyFieldName(fieldName: string): string {
  return String(fieldName || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function VehicleDataGapsCard({ vehicleId, limit = 8 }: { vehicleId: string; limit?: number }) {
  const [loading, setLoading] = useState(true);
  const [gaps, setGaps] = useState<DataGap[]>([]);
  const [openGap, setOpenGap] = useState<DataGap | null>(null);
  const [value, setValue] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [context, setContext] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  const sortedGaps = useMemo(() => {
    const order: Record<FieldPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...gaps].sort((a, b) => {
      const ap = order[a.field_priority] ?? 99;
      const bp = order[b.field_priority] ?? 99;
      if (ap !== bp) return ap - bp;
      const ar = a.points_reward ?? 0;
      const br = b.points_reward ?? 0;
      return br - ar;
    });
  }, [gaps]);

  const loadGaps = async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('data_gaps')
        .select('id, field_name, field_priority, gap_reason, points_reward, is_filled')
        .eq('entity_type', 'vehicle')
        .eq('entity_id', vehicleId)
        .eq('is_filled', false)
        .limit(limit);

      if (error) throw error;
      setGaps((data as any[]) || []);
    } catch (err) {
      console.error('Failed to load vehicle data gaps:', err);
      setGaps([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, limit]);

  const closeModal = () => {
    setOpenGap(null);
    setValue('');
    setEvidenceUrl('');
    setContext('');
    setSubmitting(false);
    setSubmitResult(null);
  };

  const submitEvidence = async () => {
    if (!openGap) return;
    const proposed = value.trim();
    const url = evidenceUrl.trim();
    const ctx = context.trim();
    if (!proposed) return;

    setSubmitting(true);
    setSubmitResult(null);

    try {
      const { data, error } = await supabase.rpc('submit_data_gap_evidence', {
        p_gap_id: openGap.id,
        p_proposed_value: proposed,
        p_evidence_url: url || null,
        p_source_type: null,
        p_context: ctx || null
      });

      if (error) throw error;
      setSubmitResult(data);
      await loadGaps();

      // If the gap is now filled, close. Otherwise keep open and explain it needs more proof/consensus.
      if (data?.gap_filled) {
        closeModal();
      }
    } catch (err: any) {
      console.error('submit_data_gap_evidence failed:', err);
      alert(`Failed to submit proof: ${err?.message || String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="vehicle-proof-tasks" className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span>Proof tasks</span>
          <button
            type="button"
            className="button-win95"
            onClick={() => setShowWhy((v) => !v)}
            title="Why am I seeing this?"
            style={{
              padding: '1px 6px',
              fontSize: '8pt',
              height: '18px',
              minWidth: '18px',
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ?
          </button>
        </span>
        <span className="badge badge-secondary">{sortedGaps.length}</span>
      </div>

      <div className="card-body">
        {showWhy && (
          <div style={{ border: '1px solid var(--border-light)', borderRadius: 6, padding: 10, background: 'var(--grey-50)', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: '9pt', marginBottom: 4 }}>
              Why does this panel show up sometimes?
            </div>
            <div className="text-small text-muted" style={{ lineHeight: 1.4 }}>
              This is a <strong>proof/verification tool</strong>. Owners and “responsible parties” often see extra panels like this because they can submit evidence that updates the profile once confidence is high.
            </div>
          </div>
        )}
        <div className="text-small text-muted" style={{ marginBottom: '12px' }}>
          Missing or low-trust fields. Submit proof; the system only writes to the profile when confidence is high.
        </div>

        {loading ? (
          <div className="text-center text-muted">Loading proof tasks…</div>
        ) : sortedGaps.length === 0 ? (
          <div className="text-center">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No open proof tasks</div>
            <div className="text-small text-muted">This profile has no active data gaps right now.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {sortedGaps.map((gap) => (
              <div
                key={gap.id}
                style={{
                  border: '1px solid var(--border-light)',
                  borderRadius: 6,
                  padding: '10px',
                  background: 'var(--white)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800 }}>{prettyFieldName(gap.field_name)}</div>
                      <span className={priorityBadgeClass(gap.field_priority)}>{priorityLabel(gap.field_priority)}</span>
                      {typeof gap.points_reward === 'number' && gap.points_reward > 0 && (
                        <span className="badge badge-success">+{gap.points_reward} pts</span>
                      )}
                    </div>
                    {gap.gap_reason && (
                      <div className="text-small text-muted" style={{ marginTop: 6 }}>
                        {gap.gap_reason}
                      </div>
                    )}
                  </div>

                  <button
                    className="button button-small button-primary"
                    onClick={() => setOpenGap(gap)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Add proof
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openGap && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="modal-title">Add proof: {prettyFieldName(openGap.field_name)}</div>
                <div className="text-small text-muted">
                  Provide a value + a link to evidence (listing, doc, photo, archive). No “fake values” — proof is the asset.
                </div>
              </div>
              <button className="modal-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'grid', gap: 10 }}>
                <label className="text-small" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Value</div>
                  <input
                    className="input"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={`Enter ${prettyFieldName(openGap.field_name)}`}
                    autoFocus
                  />
                </label>

                <label className="text-small" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Evidence URL (recommended)</div>
                  <input
                    className="input"
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>

                <label className="text-small" style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 700 }}>Context (optional)</div>
                  <textarea
                    className="input"
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Where in the source is it stated? Any notes for reviewers?"
                    rows={3}
                  />
                </label>

                {submitResult && (
                  <div style={{ border: '1px solid var(--border-light)', padding: 10, borderRadius: 6, background: 'var(--surface)' }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                      {submitResult?.gap_filled ? 'Applied to profile' : 'Submitted for consensus'}
                    </div>
                    <div className="text-small text-muted">
                      {submitResult?.gap_filled
                        ? `Confidence met threshold; gap closed${submitResult?.points_awarded ? ` (+${submitResult.points_awarded} pts)` : ''}.`
                        : 'Evidence saved. The gap stays open until confidence is high enough (or an expert verifies).'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', gap: 8 }}>
              <button className="button button-secondary" onClick={closeModal} disabled={submitting}>
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={submitEvidence}
                disabled={submitting || !value.trim()}
                style={{ marginLeft: 'auto' }}
              >
                {submitting ? 'Submitting…' : 'Submit proof'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

