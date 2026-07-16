import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface MergeRecord {
  id: string;
  primary_vehicle_id: string;
  duplicate_vehicle_id: string;
  merge_journal: any;
  merged_at: string;
  match_type: string;
  dup_year?: number;
  dup_make?: string;
  dup_model?: string;
}

interface Props {
  vehicleId: string;
  onUnmergeComplete?: () => void;
}

export default function MergeHistoryBanner({ vehicleId, onUnmergeComplete }: Props) {
  const [merges, setMerges] = useState<MergeRecord[]>([]);
  const [unmerging, setUnmerging] = useState<string | null>(null);

  useEffect(() => {
    loadMerges();
  }, [vehicleId]);

  const loadMerges = async () => {
    // Find merges where this vehicle was the primary (i.e., received rows)
    const { data } = await supabase
      .from('vehicle_merge_proposals')
      .select('id, primary_vehicle_id, duplicate_vehicle_id, merge_journal, merged_at, match_type')
      .eq('primary_vehicle_id', vehicleId)
      .eq('status', 'merged')
      .not('merge_journal', 'is', null)
      .order('merged_at', { ascending: false })
      .limit(10);

    if (!data || data.length === 0) {
      setMerges([]);
      return;
    }

    // Enrich with dup vehicle names
    const dupIds = data.map(d => d.duplicate_vehicle_id);
    const { data: dupVehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .in('id', dupIds);

    const dupMap = new Map((dupVehicles || []).map(v => [v.id, v]));

    setMerges(data.map(m => {
      const dup = dupMap.get(m.duplicate_vehicle_id);
      return {
        ...m,
        dup_year: dup?.year,
        dup_make: dup?.make,
        dup_model: dup?.model,
      };
    }));
  };

  const handleUnmerge = async (proposalId: string) => {
    if (!confirm('Undo this merge? Rows that came from the duplicate will be moved back, and the duplicate vehicle will be reactivated.')) {
      return;
    }

    setUnmerging(proposalId);
    try {
      const { data, error } = await supabase.rpc('unmerge_vehicle', {
        p_proposal_id: proposalId,
      });

      if (error) throw error;

      if (data?.error) {
        alert(`Unmerge failed: ${data.message || data.error}`);
        return;
      }

      const r = data;
      alert(
        `Unmerge complete. Returned ${r.images_returned} images, ${r.comments_returned} comments, ${r.events_returned} events, ${r.observations_returned} observations. Restored ${r.archived_restored} archived rows.`
      );

      loadMerges();
      onUnmergeComplete?.();
    } catch (err: any) {
      console.error('Unmerge failed:', err);
      alert(`Unmerge failed: ${err.message}`);
    } finally {
      setUnmerging(null);
    }
  };

  if (merges.length === 0) return null;

  return (
    <div style={{ padding: '0 var(--space-4)', maxWidth: '1600px', margin: 'var(--space-2) auto 0' }}>
      {merges.map(merge => {
        const journal = merge.merge_journal || {};
        const totalMoved =
          (journal.images_moved_ids?.length || 0) +
          (journal.comments_moved_ids?.length || 0) +
          (journal.observations_moved_ids?.length || 0) +
          (journal.events_moved_ids?.length || 0) +
          (journal.obs_disc_moved_ids?.length || 0);
        const totalDeleted =
          (journal.bat_deleted_count || 0) +
          (journal.comment_disc_deleted_count || 0) +
          (journal.desc_disc_deleted_count || 0);

        const dupLabel = merge.dup_year
          ? `${merge.dup_year} ${merge.dup_make || ''} ${merge.dup_model || ''}`.trim()
          : merge.duplicate_vehicle_id.slice(0, 8);

        const mergedDate = merge.merged_at
          ? new Date(merge.merged_at).toLocaleDateString()
          : 'unknown date';

        return (
          <div
            key={merge.id}
            className="card"
            style={{
              border: '2px solid var(--accent)',
              background: 'var(--surface)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <div className="card-body" style={{ fontSize: '12px', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <span style={{ fontWeight: 700 }}>Merged from:</span>{' '}
                  <span style={{ fontFamily: "'Courier New', monospace" }}>{dupLabel}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '11px' }}>
                    {mergedDate} &middot; {totalMoved} rows moved, {totalDeleted} archived
                  </span>
                </div>
                <button
                  onClick={() => handleUnmerge(merge.id)}
                  disabled={unmerging !== null}
                  className="button button-small button-secondary"
                  style={{
                    fontSize: '10px',
                    whiteSpace: 'nowrap',
                    border: '1px solid var(--error)',
                    color: unmerging === merge.id ? 'var(--text-muted)' : 'var(--error)',
                  }}
                >
                  {unmerging === merge.id ? 'Undoing...' : 'Undo Merge'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
