import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Claim {
  id: string;
  external_identity_id: string;
  requested_by_user_id: string;
  proof_type: string;
  proof_url: string | null;
  notes: string | null;
  status: string;
  confidence_score: number | null;
  created_at: string;
  external_identity: {
    platform: string;
    handle: string;
    profile_url: string | null;
  };
  requester: {
    email: string;
  };
}

const PLATFORM_LABELS: Record<string, string> = {
  bat: 'BaT',
  cars_and_bids: 'C&B',
  pcarmarket: 'PCM',
  hagerty: 'Hagerty',
};

export default function AdminIdentityClaims() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [processing, setProcessing] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; claimed: number; pending: number }>({ total: 0, claimed: 0, pending: 0 });

  useEffect(() => {
    loadClaims();
    loadStats();
  }, [filter]);

  const loadStats = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('db-stats');
      if (error) throw error;
      setStats({
        total: data?.details?.identity_claims?.total_external_identities || 0,
        claimed: data?.details?.identity_claims?.claimed_identities || 0,
        pending: data?.details?.identity_claims?.pending_claims || 0,
      });
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  };

  const loadClaims = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('external_identity_claims')
        .select(`
          id,
          external_identity_id,
          requested_by_user_id,
          proof_type,
          proof_url,
          notes,
          status,
          confidence_score,
          created_at,
          external_identity:external_identities (
            platform,
            handle,
            profile_url
          ),
          requester:profiles!requested_by_user_id (
            email
          )
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setClaims((data || []) as any);
    } catch (e) {
      console.error('Failed to load claims:', e);
    } finally {
      setLoading(false);
    }
  };

  const approveClaim = async (claimId: string, confidence: number = 80) => {
    setProcessing(claimId);
    try {
      const { error } = await supabase.rpc('approve_external_identity_claim', {
        p_claim_id: claimId,
        p_confidence: confidence,
      });
      if (error) throw error;
      await loadClaims();
      await loadStats();
    } catch (e: any) {
      console.error('Failed to approve:', e);
      alert(e?.message || 'Failed');
    } finally {
      setProcessing(null);
    }
  };

  const rejectClaim = async (claimId: string) => {
    setProcessing(claimId);
    try {
      const { error } = await supabase
        .from('external_identity_claims')
        .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', claimId);
      if (error) throw error;
      await loadClaims();
    } catch (e: any) {
      console.error('Failed to reject:', e);
      alert(e?.message || 'Failed');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ fontSize: '10pt', fontWeight: 600 }}>Identity Claims</div>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
          Review user identity claims
        </div>
      </div>

      {/* Stats */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3)',
        backgroundColor: 'var(--grey-50)',
        borderRadius: '4px',
        fontSize: '8pt'
      }}>
        <div><strong>{stats.total.toLocaleString()}</strong> total identities</div>
        <div><strong>{stats.claimed}</strong> claimed</div>
        <div><strong>{stats.pending}</strong> pending review</div>
        <div style={{ color: 'var(--text-muted)' }}>
          {((stats.claimed / stats.total) * 100).toFixed(3)}% claimed
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            className={filter === f ? 'button' : 'button button-secondary'}
            onClick={() => setFilter(f)}
            style={{ fontSize: '8pt', padding: '6px 12px' }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button
          className="button button-secondary"
          onClick={() => void loadClaims()}
          disabled={loading}
          style={{ fontSize: '8pt', padding: '6px 12px', marginLeft: 'auto' }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Empty state */}
      {claims.length === 0 && !loading && (
        <div style={{
          padding: 'var(--space-6)',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '9pt'
        }}>
          No {filter === 'all' ? '' : filter} claims
        </div>
      )}

      {/* Claims list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {claims.map((claim) => {
          const identity = claim.external_identity as any;
          const requester = claim.requester as any;

          return (
            <div
              key={claim.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                border: '1px solid var(--border-light)',
                borderRadius: '4px',
                backgroundColor: 'var(--white)',
              }}
            >
              {/* Platform badge */}
              <div style={{
                fontSize: '8pt',
                fontWeight: 600,
                padding: '2px 6px',
                backgroundColor: 'var(--grey-100)',
                borderRadius: '3px',
                minWidth: '40px',
                textAlign: 'center'
              }}>
                {PLATFORM_LABELS[identity?.platform] || identity?.platform}
              </div>

              {/* Handle */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '9pt', fontWeight: 600 }}>{identity?.handle}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {requester?.email || claim.requested_by_user_id.slice(0, 8)}
                </div>
              </div>

              {/* Proof type */}
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {claim.proof_type.replace(/_/g, ' ')}
              </div>

              {/* Confidence */}
              {claim.confidence_score !== null && (
                <div style={{
                  fontSize: '8pt',
                  fontWeight: 600,
                  color: claim.confidence_score >= 70 ? 'var(--success)' : 'var(--text-muted)'
                }}>
                  {claim.confidence_score}%
                </div>
              )}

              {/* Status or actions */}
              {claim.status === 'pending' ? (
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    className="button"
                    onClick={() => approveClaim(claim.id)}
                    disabled={processing === claim.id}
                    style={{ fontSize: '8pt', padding: '4px 8px' }}
                  >
                    Approve
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => rejectClaim(claim.id)}
                    disabled={processing === claim.id}
                    style={{ fontSize: '8pt', padding: '4px 8px' }}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <div style={{
                  fontSize: '8pt',
                  padding: '2px 8px',
                  backgroundColor: claim.status === 'approved' ? 'var(--success-bg)' : '#fef2f2',
                  color: claim.status === 'approved' ? 'var(--success)' : '#dc2626',
                  borderRadius: '3px'
                }}>
                  {claim.status}
                </div>
              )}

              {/* Profile link */}
              {identity?.profile_url && (
                <a
                  href={identity.profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '8pt', color: 'var(--text-muted)' }}
                >
                  View
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
