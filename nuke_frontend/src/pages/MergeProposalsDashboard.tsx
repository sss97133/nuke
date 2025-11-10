import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface MergeProposal {
  id: string;
  match_type: string;
  confidence_score: number;
  status: string;
  ai_summary?: string;
  created_at: string;
  
  primary_vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin?: string;
    image_count: number;
    event_count: number;
  };
  
  duplicate_vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin?: string;
    image_count: number;
    event_count: number;
  };
}

export default function MergeProposalsDashboard() {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<MergeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    needs_review: 0,
    high_confidence: 0,
    merged: 0
  });

  useEffect(() => {
    loadProposals();
  }, []);

  const loadProposals = async () => {
    setLoading(true);
    try {
      // Load all proposals with enriched vehicle data
      const { data, error } = await supabase
        .rpc('get_merge_proposals_with_details');

      if (error) {
        console.error('Failed to load proposals:', error);
        
        // Fallback: manual query
        const { data: proposalsData } = await supabase
          .from('vehicle_merge_proposals')
          .select('*')
          .order('confidence_score', { ascending: false });

        if (proposalsData) {
          // Enrich manually
          const enriched = await Promise.all(
            proposalsData.map(async (p) => {
              const [primary, duplicate] = await Promise.all([
                supabase.from('vehicles').select('id, year, make, model, vin').eq('id', p.primary_vehicle_id).single(),
                supabase.from('vehicles').select('id, year, make, model, vin').eq('id', p.duplicate_vehicle_id).single()
              ]);

              const [primaryImages, primaryEvents, dupImages, dupEvents] = await Promise.all([
                supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.primary_vehicle_id),
                supabase.from('timeline_events').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.primary_vehicle_id),
                supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.duplicate_vehicle_id),
                supabase.from('timeline_events').select('id', { count: 'exact', head: true }).eq('vehicle_id', p.duplicate_vehicle_id)
              ]);

              return {
                ...p,
                primary_vehicle: {
                  ...primary.data,
                  image_count: primaryImages.count || 0,
                  event_count: primaryEvents.count || 0
                },
                duplicate_vehicle: {
                  ...duplicate.data,
                  image_count: dupImages.count || 0,
                  event_count: dupEvents.count || 0
                }
              };
            })
          );

          setProposals(enriched as MergeProposal[]);
        }
      } else {
        setProposals(data || []);
      }

      // Calculate stats
      const { data: statsData } = await supabase
        .from('vehicle_merge_proposals')
        .select('status, confidence_score');

      if (statsData) {
        setStats({
          total: statsData.length,
          needs_review: statsData.filter(p => ['detected', 'proposed'].includes(p.status)).length,
          high_confidence: statsData.filter(p => p.confidence_score >= 90).length,
          merged: statsData.filter(p => p.status === 'merged').length
        });
      }

    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMatchTypeBadge = (matchType: string) => {
    const colors: any = {
      'vin_exact': '#10b981',
      'year_make_model_exact': '#3b82f6',
      'year_make_model_fuzzy': '#f59e0b',
      'dropbox_duplicate': '#ef4444'
    };

    return (
      <div style={{
        background: colors[matchType] || '#6b7280',
        color: 'white',
        padding: '2px 8px',
        borderRadius: '2px',
        fontSize: '7pt',
        fontWeight: 700
      }}>
        {matchType.replace(/_/g, ' ').toUpperCase()}
      </div>
    );
  };

  if (loading) {
    return <div style={{ padding: '32px', textAlign: 'center' }}>Loading merge proposals...</div>;
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '18pt', fontWeight: 700, marginBottom: '8px' }}>
          Vehicle Merge Proposals
        </h1>
        <p style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
          AI-detected duplicate vehicle profiles requiring owner review
        </p>
      </div>

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
        marginBottom: '24px'
      }}>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '24pt', fontWeight: 700, color: '#3b82f6' }}>{stats.total}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Total Proposals</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '24pt', fontWeight: 700, color: '#f59e0b' }}>{stats.needs_review}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Needs Review</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '24pt', fontWeight: 700, color: '#10b981' }}>{stats.high_confidence}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>High Confidence</div>
        </div>
        <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '24pt', fontWeight: 700, color: '#6b7280' }}>{stats.merged}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Already Merged</div>
        </div>
      </div>

      {/* Proposals List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {proposals.filter(p => ['detected', 'proposed'].includes(p.status)).map(proposal => {
          const primary = proposal.primary_vehicle;
          const duplicate = proposal.duplicate_vehicle;

          return (
            <div key={proposal.id} className="card" style={{ padding: '16px' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                {getMatchTypeBadge(proposal.match_type)}
                <div style={{
                  background: proposal.confidence_score >= 90 ? '#10b981' : '#f59e0b',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '2px',
                  fontSize: '7pt',
                  fontWeight: 700
                }}>
                  {proposal.confidence_score}% MATCH
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  Detected {new Date(proposal.created_at).toLocaleDateString()}
                </div>
              </div>

              {/* Comparison */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                gap: '16px',
                marginBottom: '12px'
              }}>
                {/* Primary */}
                <div style={{
                  padding: '12px',
                  border: '2px solid #10b981',
                  borderRadius: '3px',
                  background: '#ecfdf5'
                }}>
                  <div style={{ fontSize: '7pt', fontWeight: 700, color: '#059669', marginBottom: '6px' }}>
                    PRIMARY (KEEP)
                  </div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '6px' }}>
                    {primary.year} {primary.make} {primary.model}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    VIN: {primary.vin || 'None'}
                    {primary.vin?.startsWith('VIVA-') && <span style={{ color: '#dc2626' }}> (auto)</span>}
                  </div>
                  <div style={{ fontSize: '8pt', fontWeight: 600, color: '#059669' }}>
                    {primary.image_count} photos • {primary.event_count} events
                  </div>
                  <button
                    onClick={() => navigate(`/vehicle/${primary.id}`)}
                    className="button button-small button-secondary"
                    style={{ marginTop: '8px', fontSize: '7pt', width: '100%' }}
                  >
                    View Profile
                  </button>
                </div>

                {/* Arrow */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </div>

                {/* Duplicate */}
                <div style={{
                  padding: '12px',
                  border: '2px solid #dc2626',
                  borderRadius: '3px',
                  background: '#fef2f2'
                }}>
                  <div style={{ fontSize: '7pt', fontWeight: 700, color: '#dc2626', marginBottom: '6px' }}>
                    DUPLICATE (MERGE)
                  </div>
                  <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '6px' }}>
                    {duplicate.year} {duplicate.make} {duplicate.model}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    VIN: {duplicate.vin || 'None'}
                    {duplicate.vin?.startsWith('VIVA-') && <span style={{ color: '#dc2626' }}> (auto)</span>}
                  </div>
                  <div style={{ fontSize: '8pt', fontWeight: 600, color: '#dc2626' }}>
                    {duplicate.image_count} photos • {duplicate.event_count} events
                  </div>
                  <button
                    onClick={() => navigate(`/vehicle/${duplicate.id}`)}
                    className="button button-small button-secondary"
                    style={{ marginTop: '8px', fontSize: '7pt', width: '100%' }}
                  >
                    View Profile
                  </button>
                </div>
              </div>

              {/* AI Summary */}
              {proposal.ai_summary && (
                <div style={{
                  padding: '10px',
                  background: '#f9fafb',
                  border: '1px solid #d1d5db',
                  borderRadius: '3px',
                  fontSize: '8pt',
                  color: 'var(--text-secondary)',
                  marginBottom: '12px'
                }}>
                  {proposal.ai_summary}
                </div>
              )}

              {/* Action hint */}
              <div style={{
                padding: '8px',
                background: '#dbeafe',
                border: '1px solid #3b82f6',
                borderRadius: '3px',
                fontSize: '8pt',
                color: '#1e40af'
              }}>
                <strong>Owner Action Required:</strong> The verified owner must review this proposal on their vehicle profile page.
              </div>
            </div>
          );
        })}

        {proposals.filter(p => ['detected', 'proposed'].includes(p.status)).length === 0 && (
          <div className="card" style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '8px' }}>
              No Pending Merge Proposals
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              All detected duplicates have been reviewed or merged.
            </div>
          </div>
        )}
      </div>

      {/* Merged History */}
      {stats.merged > 0 && (
        <div style={{ marginTop: '32px' }}>
          <h2 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '16px' }}>
            Merge History ({stats.merged} completed)
          </h2>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Historical merge data will appear here
          </div>
        </div>
      )}
    </div>
  );
}

