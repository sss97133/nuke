import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface MergeProposal {
  id: string;
  primary_vehicle_id: string;
  duplicate_vehicle_id: string;
  confidence_score: number;
  reasons: string[];
  status: string;
  created_at: string;
  primary_vehicle?: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    image_count?: number;
  };
  duplicate_vehicle?: {
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    image_count?: number;
  };
}

interface Props {
  userId: string;
}

const VehicleMergeInterface: React.FC<Props> = ({ userId }) => {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<MergeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);

  useEffect(() => {
    loadProposals();
  }, [userId]);

  const loadProposals = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_merge_proposals')
        .select(`
          *,
          primary_vehicle:vehicles!primary_vehicle_id(year, make, model, trim, vin),
          duplicate_vehicle:vehicles!duplicate_vehicle_id(year, make, model, trim, vin)
        `)
        .eq('proposed_by', userId)
        .eq('status', 'pending')
        .order('confidence_score', { ascending: false });

      if (error) throw error;

      // Get image counts for each vehicle
      const proposalsWithCounts = await Promise.all(
        (data || []).map(async (p) => {
          const [primaryCount, duplicateCount] = await Promise.all([
            supabase
              .from('vehicle_images')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', p.primary_vehicle_id),
            supabase
              .from('vehicle_images')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', p.duplicate_vehicle_id)
          ]);

          return {
            ...p,
            primary_vehicle: {
              ...p.primary_vehicle,
              image_count: primaryCount.count || 0
            },
            duplicate_vehicle: {
              ...p.duplicate_vehicle,
              image_count: duplicateCount.count || 0
            }
          };
        })
      );

      setProposals(proposalsWithCounts);
    } catch (err) {
      console.error('Error loading merge proposals:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (proposalId: string, primaryId: string, duplicateId: string) => {
    if (!confirm('This will merge the duplicate vehicle into the primary vehicle. All images, events, and data from the duplicate will be transferred. This action cannot be undone. Continue?')) {
      return;
    }

    setMerging(proposalId);
    try {
      // Call merge function
      const { data, error } = await supabase.rpc('merge_duplicate_vehicles', {
        p_primary_id: primaryId,
        p_duplicate_id: duplicateId,
        p_user_id: userId
      });

      if (error) throw error;

      // Update proposal status
      await supabase
        .from('vehicle_merge_proposals')
        .update({ status: 'merged', resolved_at: new Date().toISOString() })
        .eq('id', proposalId);

      alert('Vehicles merged successfully!');
      loadProposals();
    } catch (err) {
      console.error('Error merging vehicles:', err);
      alert('Failed to merge vehicles: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setMerging(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    try {
      await supabase
        .from('vehicle_merge_proposals')
        .update({ status: 'rejected', resolved_at: new Date().toISOString() })
        .eq('id', proposalId);

      loadProposals();
    } catch (err) {
      console.error('Error rejecting proposal:', err);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          Loading merge proposals...
        </div>
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '11pt', fontWeight: 600, marginBottom: '8px' }}>
            No duplicate vehicles detected
          </div>
          <div style={{ fontSize: '9pt' }}>
            When potential duplicates are found, they'll appear here for review and merging.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {proposals.map((proposal) => (
        <div key={proposal.id} className="card">
          <div className="card-header" style={{
            fontSize: '10pt',
            fontWeight: 700,
            background: 'var(--warning-dim)',
            borderBottom: '2px solid var(--warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>Potential Duplicate Detected</span>
            <span style={{
              padding: '4px 8px',
              background: 'var(--warning)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '8pt'
            }}>
              {proposal.confidence_score}% Match
            </span>
          </div>

          <div className="card-body" style={{ padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'start' }}>
              {/* Primary Vehicle */}
              <div
                style={{
                  padding: '12px',
                  border: '2px solid var(--success)',
                  borderRadius: '4px',
                  background: 'var(--success-dim)',
                  cursor: 'pointer'
                }}
                onClick={() => navigate(`/vehicle/${proposal.primary_vehicle_id}`)}
              >
                <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--success)', marginBottom: '8px' }}>
                  PRIMARY (KEEP)
                </div>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                  {proposal.primary_vehicle?.year} {proposal.primary_vehicle?.make} {proposal.primary_vehicle?.model}
                </div>
                {proposal.primary_vehicle?.trim && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    {proposal.primary_vehicle.trim}
                  </div>
                )}
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {proposal.primary_vehicle?.vin ? (
                    <div style={{ fontFamily: 'monospace', marginBottom: '4px' }}>
                      VIN: {proposal.primary_vehicle.vin}
                    </div>
                  ) : (
                    <div style={{ fontStyle: 'italic', marginBottom: '4px' }}>No VIN</div>
                  )}
                  <div>{proposal.primary_vehicle?.image_count || 0} images</div>
                </div>
              </div>

              {/* Arrow */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24pt',
                color: 'var(--text-muted)'
              }}>
                ←
              </div>

              {/* Duplicate Vehicle */}
              <div
                style={{
                  padding: '12px',
                  border: '2px solid var(--error)',
                  borderRadius: '4px',
                  background: 'var(--error-dim)',
                  cursor: 'pointer'
                }}
                onClick={() => navigate(`/vehicle/${proposal.duplicate_vehicle_id}`)}
              >
                <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--error)', marginBottom: '8px' }}>
                  DUPLICATE (MERGE INTO PRIMARY)
                </div>
                <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '4px' }}>
                  {proposal.duplicate_vehicle?.year} {proposal.duplicate_vehicle?.make} {proposal.duplicate_vehicle?.model}
                </div>
                {proposal.duplicate_vehicle?.trim && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    {proposal.duplicate_vehicle.trim}
                  </div>
                )}
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {proposal.duplicate_vehicle?.vin ? (
                    <div style={{ fontFamily: 'monospace', marginBottom: '4px' }}>
                      VIN: {proposal.duplicate_vehicle.vin}
                    </div>
                  ) : (
                    <div style={{ fontStyle: 'italic', marginBottom: '4px' }}>No VIN</div>
                  )}
                  <div>{proposal.duplicate_vehicle?.image_count || 0} images</div>
                </div>
              </div>
            </div>

            {/* Reasons */}
            {proposal.reasons && proposal.reasons.length > 0 && (
              <div style={{
                marginTop: '16px',
                padding: '12px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px'
              }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                  Match Reasons:
                </div>
                <ul style={{ fontSize: '8pt', margin: 0, paddingLeft: '20px' }}>
                  {proposal.reasons.filter(Boolean).map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div style={{
              marginTop: '16px',
              display: 'flex',
              gap: '8px',
              paddingTop: '16px',
              borderTop: '1px solid var(--border-light)'
            }}>
              <button
                onClick={() => handleReject(proposal.id)}
                className="button button-secondary"
                style={{ flex: 1, fontSize: '9pt' }}
                disabled={merging === proposal.id}
              >
                Not a Duplicate
              </button>
              <button
                onClick={() => handleMerge(
                  proposal.id,
                  proposal.primary_vehicle_id,
                  proposal.duplicate_vehicle_id
                )}
                className="button button-primary"
                style={{ flex: 1, fontSize: '9pt' }}
                disabled={merging === proposal.id}
              >
                {merging === proposal.id ? 'Merging...' : 'Merge Vehicles'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VehicleMergeInterface;

