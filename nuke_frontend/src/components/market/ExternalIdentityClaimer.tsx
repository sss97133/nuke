/**
 * External Identity Claimer
 * Tool to help users claim their BaT usernames and other external identities
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ExternalIdentity {
  id: string;
  platform: string;
  handle: string;
  profile_url: string;
  display_name: string;
  claimed_by_user_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  metadata: any;
}

export const ExternalIdentityClaimer: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [identities, setIdentities] = useState<ExternalIdentity[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  const searchIdentities = async () => {
    if (!searchTerm.trim()) {
      setError('Please enter a search term');
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const { data, error: searchError } = await supabase
        .from('external_identities')
        .select('*')
        .or(`handle.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%`)
        .order('last_seen_at', { ascending: false })
        .limit(20);

      if (searchError) throw searchError;
      setIdentities(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to search identities');
    } finally {
      setSearching(false);
    }
  };

  const claimIdentity = async (identityId: string) => {
    if (!user) {
      setError('Please log in to claim an identity');
      return;
    }

    setClaiming(identityId);
    setError(null);

    try {
      // Update identity to claim it
      const { error: claimError } = await supabase
        .from('external_identities')
        .update({
          claimed_by_user_id: user.id,
          claimed_at: new Date().toISOString(),
          claim_confidence: 100, // User-initiated claim
        })
        .eq('id', identityId);

      if (claimError) throw claimError;

      // Backfill profile stats
      await supabase.rpc('backfill_user_profile_stats', {
        p_user_id: user.id,
      });

      // Refresh identities
      await searchIdentities();

      alert('Identity claimed successfully! Your profile stats have been updated.');
    } catch (err: any) {
      setError(err.message || 'Failed to claim identity');
    } finally {
      setClaiming(null);
    }
  };

  const unclaimIdentity = async (identityId: string) => {
    setClaiming(identityId);
    setError(null);

    try {
      const { error: unclaimError } = await supabase
        .from('external_identities')
        .update({
          claimed_by_user_id: null,
          claimed_at: null,
          claim_confidence: 0,
        })
        .eq('id', identityId);

      if (unclaimError) throw unclaimError;

      // Refresh identities
      await searchIdentities();
    } catch (err: any) {
      setError(err.message || 'Failed to unclaim identity');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
    }}>
      <h3 style={{ fontSize: '10pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-3)' }}>
        Claim External Identity
      </h3>
      <p style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
        Search for and claim your BaT username or other external identities to link your activity across platforms.
      </p>

      {!user && (
        <div style={{
          padding: 'var(--space-2)',
          background: 'var(--warning-light)',
          border: '1px solid var(--warning)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--warning)',
          marginBottom: 'var(--space-3)',
        }}>
          Please log in to claim identities
        </div>
      )}

      <div style={{ marginBottom: 'var(--space-3)' }}>
        <label style={{ display: 'block', fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
          Search by Username or Display Name
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && searchIdentities()}
            placeholder="e.g., wob, username123"
            style={{
              flex: 1,
              padding: 'var(--space-2)',
              fontSize: '8pt',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: 'var(--surface-hover)',
            }}
          />
          <button
            onClick={searchIdentities}
            disabled={searching || !searchTerm.trim()}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: '8pt',
              fontWeight: 'bold',
              background: searching ? 'var(--text-muted)' : 'var(--accent)',
              color: 'var(--white)',
              border: 'none',
              borderRadius: '4px',
              cursor: searching ? 'not-allowed' : 'pointer',
            }}
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: 'var(--space-2)',
          background: 'var(--danger-light)',
          border: '1px solid var(--danger)',
          borderRadius: '4px',
          fontSize: '8pt',
          color: 'var(--danger)',
          marginBottom: 'var(--space-3)',
        }}>
          {error}
        </div>
      )}

      {identities.length > 0 && (
        <div>
          <h4 style={{ fontSize: '9pt', fontWeight: 'bold', margin: 0, marginBottom: 'var(--space-2)' }}>
            Found {identities.length} Identit{identities.length !== 1 ? 'ies' : 'y'}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {identities.map((identity) => (
              <div
                key={identity.id}
                style={{
                  padding: 'var(--space-3)',
                  background: identity.claimed_by_user_id === user?.id ? 'var(--success-light)' : 'var(--surface-hover)',
                  border: `1px solid ${identity.claimed_by_user_id === user?.id ? 'var(--success)' : 'var(--border)'}`,
                  borderRadius: '4px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-2)' }}>
                  <div>
                    <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '4px' }}>
                      {identity.display_name || identity.handle}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      Platform: {identity.platform.toUpperCase()} | Handle: {identity.handle}
                    </div>
                    {identity.profile_url && (
                      <a
                        href={identity.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '7pt', color: 'var(--accent)' }}
                      >
                        View Profile →
                      </a>
                    )}
                  </div>
                  {identity.claimed_by_user_id === user?.id ? (
                    <button
                      onClick={() => unclaimIdentity(identity.id)}
                      disabled={claiming === identity.id}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        fontSize: '7pt',
                        background: 'var(--danger)',
                        color: 'var(--white)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {claiming === identity.id ? 'Unclaiming...' : 'Unclaim'}
                    </button>
                  ) : (
                    <button
                      onClick={() => claimIdentity(identity.id)}
                      disabled={!user || claiming === identity.id || !!identity.claimed_by_user_id}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        fontSize: '7pt',
                        background: identity.claimed_by_user_id ? 'var(--text-muted)' : 'var(--success)',
                        color: 'var(--white)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: identity.claimed_by_user_id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {claiming === identity.id ? 'Claiming...' : identity.claimed_by_user_id ? 'Claimed by Another' : 'Claim'}
                    </button>
                  )}
                </div>
                {identity.metadata && (
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                    Activity: {identity.metadata.listings || 0} listings, {identity.metadata.comments || 0} comments
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

