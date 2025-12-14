import React, { useState, useEffect } from 'react';
import { supabase, SUPABASE_URL } from '../../lib/supabase';

interface MergeProposal {
  id: string;
  primary_vehicle_id: string;
  duplicate_vehicle_id: string;
  match_type: string;
  confidence_score: number;
  ai_summary?: string;
  recommendation_reason?: string;
  status: string;
  match_reasoning: any;
  data_comparison: any;
  
  // Enriched data
  primary_vehicle?: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    image_count: number;
    event_count: number;
    discovery_source?: string;
  };
  duplicate_vehicle?: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
    image_count: number;
    event_count: number;
    discovery_source?: string;
  };
}

interface Props {
  vehicleId: string;
  onMergeComplete?: () => void;
}

export default function MergeProposalsPanel({ vehicleId, onMergeComplete }: Props) {
  const [proposals, setProposals] = useState<MergeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);

  useEffect(() => {
    loadProposals();
  }, [vehicleId]);

  const loadProposals = async () => {
    setLoading(true);
    try {
      // Get proposals where this vehicle is either primary or duplicate
      const { data, error } = await supabase
        .from('vehicle_merge_proposals')
        .select('*')
        .or(`primary_vehicle_id.eq.${vehicleId},duplicate_vehicle_id.eq.${vehicleId}`)
        .in('status', ['detected', 'proposed'])
        .order('confidence_score', { ascending: false });

      if (error) throw error;

      // Enrich with vehicle data
      const enriched = await Promise.all(
        (data || []).map(async (proposal) => {
          // Load primary vehicle
          const { data: primary } = await supabase
            .from('vehicles')
            .select('id, year, make, model, trim, vin, discovery_source')
            .eq('id', proposal.primary_vehicle_id)
            .single();

          const { count: primaryImageCount } = await supabase
            .from('vehicle_images')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', proposal.primary_vehicle_id);

          const { count: primaryEventCount } = await supabase
            .from('timeline_events')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', proposal.primary_vehicle_id);

          // Load duplicate vehicle
          const { data: duplicate } = await supabase
            .from('vehicles')
            .select('id, year, make, model, trim, vin, discovery_source')
            .eq('id', proposal.duplicate_vehicle_id)
            .single();

          const { count: dupImageCount } = await supabase
            .from('vehicle_images')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', proposal.duplicate_vehicle_id);

          const { count: dupEventCount } = await supabase
            .from('timeline_events')
            .select('id', { count: 'exact', head: true })
            .eq('vehicle_id', proposal.duplicate_vehicle_id);

          return {
            ...proposal,
            primary_vehicle: {
              ...primary,
              image_count: primaryImageCount || 0,
              event_count: primaryEventCount || 0
            },
            duplicate_vehicle: {
              ...duplicate,
              image_count: dupImageCount || 0,
              event_count: dupEventCount || 0
            }
          };
        })
      );

      setProposals(enriched as MergeProposal[]);
    } catch (error) {
      console.error('Failed to load merge proposals:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (proposalId: string, primaryId: string, duplicateId: string) => {
    if (!confirm('Merge these profiles? This will move all images and events from the duplicate to the primary profile and delete the duplicate.')) {
      return;
    }

    setMerging(proposalId);
    try {
      // Call merge Edge Function
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/merge-vehicles`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({
            proposalId,
            primaryVehicleId: primaryId,
            duplicateVehicleId: duplicateId
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Merge failed');
      }

      const result = await response.json();
      
      // Update proposal status locally
      await supabase
        .from('vehicle_merge_proposals')
        .update({
          status: 'merged',
          merged_at: new Date().toISOString(),
          reviewed_at: new Date().toISOString()
        })
        .eq('id', proposalId);

      alert(`Merge complete! Moved ${result.imagesMoved} images and ${result.eventsMoved} events.`);
      
      // Refresh
      loadProposals();
      onMergeComplete?.();
      
    } catch (error: any) {
      console.error('Merge failed:', error);
      alert(`Merge failed: ${error.message}`);
    } finally {
      setMerging(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    if (!confirm('Mark as not a duplicate? This proposal will be hidden.')) {
      return;
    }

    try {
      await supabase
        .from('vehicle_merge_proposals')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString()
        })
        .eq('id', proposalId);

      loadProposals();
    } catch (error: any) {
      alert(`Failed to reject: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Checking for duplicate profiles...
      </div>
    );
  }

  if (proposals.length === 0) {
    return null; // No duplicates, don't show anything
  }

  return (
    <div className="card" style={{ marginBottom: '16px', border: '2px solid #f59e0b' }}>
      <div className="card-header" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: '#fffbeb',
        borderBottom: '1px solid #f59e0b'
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span style={{ fontSize: '10pt', fontWeight: 700, color: '#92400e' }}>
          Duplicate Profiles Detected ({proposals.length})
        </span>
      </div>

      <div className="card-body" style={{ padding: '16px', background: '#fffbeb' }}>
        <div style={{ fontSize: '8pt', color: '#78350f', marginBottom: '16px' }}>
          AI detected potential duplicate vehicle profiles. Review and merge to consolidate your data.
        </div>

        {proposals.map(proposal => {
          const primary = proposal.primary_vehicle!;
          const duplicate = proposal.duplicate_vehicle!;
          const isPrimaryFake = primary.vin?.startsWith('VIVA-');
          const isDupFake = duplicate.vin?.startsWith('VIVA-');

          return (
            <div
              key={proposal.id}
              style={{
                border: '1px solid #d97706',
                borderRadius: '4px',
                padding: '12px',
                marginBottom: '12px',
                background: 'white'
              }}
            >
              {/* Confidence badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <div style={{
                  background: proposal.confidence_score >= 90 ? '#10b981' : '#f59e0b',
                  color: 'white',
                  padding: '3px 8px',
                  borderRadius: '2px',
                  fontSize: '7pt',
                  fontWeight: 700
                }}>
                  {proposal.confidence_score}% MATCH
                </div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                  {proposal.match_type.replace(/_/g, ' ').toUpperCase()}
                </div>
              </div>

              {/* Comparison */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                gap: '12px',
                marginBottom: '12px'
              }}>
                {/* PRIMARY (Keep) */}
                <div style={{
                  padding: '10px',
                  border: '2px solid #10b981',
                  borderRadius: '3px',
                  background: '#ecfdf5'
                }}>
                  <div style={{
                    fontSize: '7pt',
                    fontWeight: 700,
                    color: '#059669',
                    marginBottom: '4px'
                  }}>
                    PRIMARY (KEEP)
                  </div>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '6px' }}>
                    {primary.year} {primary.make} {primary.model}
                  </div>
                  {primary.trim && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {primary.trim}
                    </div>
                  )}
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>
                    VIN: {primary.vin || 'None'}
                    {isPrimaryFake && <span style={{ color: '#dc2626' }}> (auto-generated)</span>}
                  </div>
                  <div style={{ fontSize: '7pt', fontWeight: 600, color: '#059669' }}>
                    {primary.image_count} photos • {primary.event_count} events
                  </div>
                  {primary.discovery_source && (
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Source: {primary.discovery_source}
                    </div>
                  )}
                </div>

                {/* Arrow */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </div>

                {/* DUPLICATE (Merge) */}
                <div style={{
                  padding: '10px',
                  border: '2px solid #dc2626',
                  borderRadius: '3px',
                  background: '#fef2f2'
                }}>
                  <div style={{
                    fontSize: '7pt',
                    fontWeight: 700,
                    color: '#dc2626',
                    marginBottom: '4px'
                  }}>
                    DUPLICATE (MERGE)
                  </div>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '6px' }}>
                    {duplicate.year} {duplicate.make} {duplicate.model}
                  </div>
                  {duplicate.trim && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {duplicate.trim}
                    </div>
                  )}
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '2px' }}>
                    VIN: {duplicate.vin || 'None'}
                    {isDupFake && <span style={{ color: '#dc2626' }}> (auto-generated)</span>}
                  </div>
                  <div style={{ fontSize: '7pt', fontWeight: 600, color: '#dc2626' }}>
                    {duplicate.image_count} photos • {duplicate.event_count} events
                  </div>
                  {duplicate.discovery_source && (
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Source: {duplicate.discovery_source}
                    </div>
                  )}
                </div>
              </div>

              {/* Reasoning */}
              {proposal.recommendation_reason && (
                <div style={{
                  padding: '8px',
                  background: '#f3f4f6',
                  border: '1px solid #d1d5db',
                  borderRadius: '3px',
                  fontSize: '8pt',
                  color: 'var(--text-secondary)',
                  marginBottom: '12px'
                }}>
                  <strong>Why:</strong> {proposal.recommendation_reason}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleReject(proposal.id)}
                  disabled={merging !== null}
                  className="button button-secondary button-small"
                  style={{ fontSize: '8pt' }}
                >
                  Not a Duplicate
                </button>
                <button
                  onClick={() => handleMerge(
                    proposal.id,
                    proposal.primary_vehicle_id,
                    proposal.duplicate_vehicle_id
                  )}
                  disabled={merging !== null}
                  className="button button-primary button-small"
                  style={{
                    fontSize: '8pt',
                    background: merging === proposal.id ? '#6b7280' : undefined
                  }}
                >
                  {merging === proposal.id ? 'Merging...' : 'Merge Profiles'}
                </button>
              </div>
            </div>
          );
        })}

        {/* Help text */}
        <div style={{
          marginTop: '16px',
          padding: '12px',
          background: 'white',
          border: '1px solid #d1d5db',
          borderRadius: '3px',
          fontSize: '8pt',
          color: 'var(--text-muted)'
        }}>
          <strong>How merging works:</strong> All images, timeline events, and data from the duplicate profile will be moved to the primary profile. The duplicate will then be deleted. This action cannot be undone.
        </div>
      </div>
    </div>
  );
}

