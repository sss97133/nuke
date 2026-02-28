import React from 'react';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface IdentityResult {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  profile_url: string | null;
  first_seen: string | null;
  last_seen: string | null;
  claimed: boolean;
  stats: {
    comments: number;
    bids: number;
    wins: number;
    expertise_score: number;
    trust_score: number;
    active_since: string | null;
    last_active: string | null;
  } | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  bat: 'Bring a Trailer',
  cars_and_bids: 'Cars & Bids',
  pcarmarket: 'PCarMarket',
  hagerty: 'Hagerty',
};

const ClaimExternalIdentity: React.FC = () => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchPlatform, setSearchPlatform] = React.useState<string>('bat');
  const [searchResults, setSearchResults] = React.useState<IdentityResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [selectedIdentity, setSelectedIdentity] = React.useState<IdentityResult | null>(null);
  const [claimId, setClaimId] = React.useState<string | null>(null);
  const [verificationCode, setVerificationCode] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string>('');
  const [importStep, setImportStep] = React.useState<'idle' | 'input' | 'submitting' | 'polling' | 'done'>('idle');
  const [importUrl, setImportUrl] = React.useState('');
  const [importError, setImportError] = React.useState('');
  const [queueItemId, setQueueItemId] = React.useState<string | null>(null);
  const [importLog, setImportLog] = React.useState<{ time: Date; text: string; type?: 'info' | 'success' | 'dim' }[]>([]);
  const [queueStatus, setQueueStatus] = React.useState<string>('pending');
  const [importedMetadata, setImportedMetadata] = React.useState<any>(null);
  const logRef = React.useRef<HTMLDivElement>(null);

  const addLog = React.useCallback((text: string, type: 'info' | 'success' | 'dim' = 'info') => {
    setImportLog(prev => [...prev, { time: new Date(), text, type }]);
  }, []);

  // Auto-scroll log
  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [importLog]);

  // Poll queue status when we have a queue item
  React.useEffect(() => {
    if (!queueItemId || importStep !== 'polling') return;

    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise(r => setTimeout(r, 2000));
        if (cancelled) break;

        try {
          const { data } = await supabase
            .from('user_profile_queue')
            .select('status, error_message, completed_at, attempts')
            .eq('id', queueItemId)
            .single();

          if (!data || cancelled) break;

          if (data.status === 'processing' && queueStatus !== 'processing') {
            setQueueStatus('processing');
            addLog('Extracting profile data from page...', 'info');
          }

          if (data.status === 'complete') {
            setQueueStatus('complete');
            addLog('Extraction complete', 'success');

            // Fetch the enriched identity
            if (selectedIdentity) {
              const { data: enriched } = await supabase
                .from('external_identities')
                .select('metadata')
                .eq('id', selectedIdentity.id)
                .single();

              if (enriched?.metadata) {
                setImportedMetadata(enriched.metadata);
                const m = enriched.metadata;
                if (m.listings_found != null) {
                  addLog(`Found ${m.listings_found} listing${m.listings_found === 1 ? '' : 's'}`, 'success');
                }
                if (m.listing_urls?.length > 0) {
                  addLog(`${m.listing_urls.length} vehicle${m.listing_urls.length === 1 ? '' : 's'} queued for import`, 'success');
                }
              }
            }

            addLog('Ready to claim — your full reputation is attached.', 'success');
            setImportStep('done');
            break;
          }

          if (data.status === 'failed') {
            setQueueStatus('failed');
            addLog(`Extraction failed: ${data.error_message || 'unknown error'}`, 'info');
            addLog('You can still claim — stats will retry automatically.', 'dim');
            setImportStep('done');
            break;
          }
        } catch {
          // network blip, keep polling
        }
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [queueItemId, importStep]);

  // Read URL params on mount
  React.useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const p = url.searchParams.get('platform');
      const h = url.searchParams.get('handle');
      if (p) setSearchPlatform(p);
      if (h) setSearchQuery(h);
    } catch {
      // ignore
    }
  }, []);

  // Auto-search with debounce
  React.useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      search();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchPlatform]);

  const search = async () => {
    if (searchQuery.length < 2) return;
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('search-identities', {
        body: { query: searchQuery, platform: searchPlatform, limit: 10 }
      });
      if (error) throw error;
      setSearchResults(data?.results || []);
    } catch (e) {
      console.error('Search failed:', e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const selectIdentity = (identity: IdentityResult) => {
    setSelectedIdentity(identity);
    setClaimId(null);
    setVerificationCode(null);
    setMessage('');
  };

  const startClaim = async () => {
    if (!selectedIdentity) return;
    setSubmitting(true);
    setMessage('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.user) {
        setMessage('You must be logged in to claim an identity.');
        setSubmitting(false);
        return;
      }

      const { data, error } = await supabase.rpc('request_external_identity_claim', {
        p_platform: selectedIdentity.platform,
        p_handle: selectedIdentity.handle,
        p_profile_url: selectedIdentity.profile_url || null,
        p_proof_type: 'profile_link',
        p_proof_url: null,
        p_notes: null,
      });

      if (error) throw error;

      const claimIdStr = String(data);
      setClaimId(claimIdStr);
      setVerificationCode(`NUKE-${claimIdStr.slice(0, 8).toUpperCase()}`);
      setMessage('Claim started. Add the code below to your profile to verify.');
    } catch (e: any) {
      console.error('Claim failed:', e);
      setMessage(e?.message || 'Failed to start claim.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 900, margin: '0 auto' }}>
      <style>{`@keyframes pulse { 0%,100% { opacity: .3 } 50% { opacity: 1 } }`}</style>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="heading-1" style={{ marginBottom: 'var(--space-2)' }}>Claim Your Identity</h1>
        <div className="text-small" style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
          Find your account. Inherit your reputation.
        </div>
        <div style={{
          display: 'inline-flex',
          gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          backgroundColor: 'var(--grey-100)',
          borderRadius: '4px',
          fontSize: '12px'
        }}>
          <div><strong>443K</strong> BaT identities</div>
          <div><strong>1K</strong> PCarMarket</div>
          <div><strong>758</strong> Cars & Bids</div>
          <div style={{ color: 'var(--text-muted)' }}>waiting to be claimed</div>
        </div>
      </div>

      {/* Search */}
      <div className="card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <select
            className="form-input"
            value={searchPlatform}
            onChange={(e) => setSearchPlatform(e.target.value)}
            style={{ width: 180, fontSize: '13px', padding: '12px' }}
          >
            <option value="bat">Bring a Trailer</option>
            <option value="cars_and_bids">Cars & Bids</option>
            <option value="pcarmarket">PCarMarket</option>
            <option value="hagerty">Hagerty</option>
          </select>
          <input
            className="form-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Your username..."
            autoFocus
            style={{ flex: 1, fontSize: '19px', padding: '12px 16px' }}
          />
          {searching && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>searching...</div>
          )}
        </div>

        {/* Results */}
        {searchResults.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            {searchResults.map((identity) => (
              <div
                key={identity.id}
                onClick={() => selectIdentity(identity)}
                style={{
                  padding: 'var(--space-4)',
                  marginBottom: 'var(--space-2)',
                  border: selectedIdentity?.id === identity.id
                    ? '2px solid var(--primary)'
                    : '1px solid var(--border-light)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  backgroundColor: selectedIdentity?.id === identity.id
                    ? 'var(--grey-50)'
                    : 'var(--white)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '15px' }}>{identity.handle}</div>
                    {identity.profile_url && (
                      <a
                        href={identity.profile_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: '11px', color: 'var(--text-muted)' }}
                      >
                        View on {PLATFORM_LABELS[identity.platform] || identity.platform}
                      </a>
                    )}
                  </div>
                  {identity.stats && (
                    <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <div><strong style={{ color: 'var(--text)' }}>{formatNumber(identity.stats.comments)}</strong> comments</div>
                      <div><strong style={{ color: 'var(--text)' }}>{formatNumber(identity.stats.bids)}</strong> bids</div>
                      {identity.stats.wins > 0 && (
                        <div><strong style={{ color: 'var(--text)' }}>{identity.stats.wins}</strong> wins</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No results — import wizard */}
        {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
          <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: 'var(--space-3)' }}>
              No "{searchQuery}" found on {PLATFORM_LABELS[searchPlatform] || searchPlatform}
            </div>

            {importStep === 'idle' && (
              <div style={{ textAlign: 'center' }}>
                <button
                  className="button button-secondary"
                  onClick={() => { setImportStep('input'); setImportError(''); setImportLog([]); }}
                  style={{ fontSize: '13px' }}
                >
                  Not seeing your profile? Import it
                </button>
              </div>
            )}

            {(importStep === 'input' || importStep === 'submitting') && (
              <div style={{
                padding: 'var(--space-4)',
                border: '1px solid var(--border-light)',
                borderRadius: '6px',
                backgroundColor: 'var(--grey-50)',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  Paste your {PLATFORM_LABELS[searchPlatform] || searchPlatform} profile URL
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <input
                    className="form-input"
                    value={importUrl}
                    onChange={(e) => { setImportUrl(e.target.value); setImportError(''); }}
                    placeholder={
                      searchPlatform === 'bat' ? 'https://bringatrailer.com/member/username/' :
                      searchPlatform === 'cars_and_bids' ? 'https://carsandbids.com/user/username' :
                      searchPlatform === 'pcarmarket' ? 'https://pcarmarket.com/member/username' :
                      'Profile URL'
                    }
                    disabled={importStep === 'submitting'}
                    style={{ flex: 1, fontSize: '13px', padding: '10px 12px' }}
                  />
                  <button
                    className="cursor-button"
                    disabled={importStep === 'submitting' || !importUrl.trim()}
                    style={{ padding: '10px 16px', fontSize: '12px', whiteSpace: 'nowrap' }}
                    onClick={async () => {
                      setImportStep('submitting');
                      setImportError('');
                      setImportLog([]);
                      addLog(`Importing from ${PLATFORM_LABELS[searchPlatform] || searchPlatform}...`);
                      try {
                        const { data: sessionData } = await supabase.auth.getSession();
                        const userId = sessionData?.session?.user?.id || null;

                        const { data, error } = await supabase.functions.invoke('ingest-external-profile', {
                          body: {
                            platform: searchPlatform,
                            profile_url: importUrl.trim(),
                            notify_user_id: userId,
                          },
                        });
                        if (error) throw error;
                        if (!data?.success) throw new Error(data?.error || 'Import failed');

                        addLog(`Identity created: ${data.identity.handle}`, 'success');
                        setSelectedIdentity(data.identity);

                        if (data.queue_item_id) {
                          setQueueItemId(data.queue_item_id);
                          setQueueStatus(data.queue_status || 'pending');
                          addLog('Queued for full profile extraction (priority: high)', 'info');
                          addLog('Waiting for worker to pick up...', 'dim');
                          setImportStep('polling');
                        } else {
                          addLog('Profile ready — claim it now.', 'success');
                          setImportStep('done');
                        }
                      } catch (e: any) {
                        console.error('Import failed:', e);
                        setImportError(e?.message || 'Failed to import profile');
                        addLog(`Error: ${e?.message || 'Failed to import'}`, 'info');
                        setImportStep('input');
                      }
                    }}
                  >
                    {importStep === 'submitting' ? 'IMPORTING...' : 'IMPORT'}
                  </button>
                </div>
                {importError && (
                  <div style={{ fontSize: '11px', color: 'var(--error)', marginTop: 'var(--space-2)' }}>
                    {importError}
                  </div>
                )}
              </div>
            )}

            {/* Live import log */}
            {importLog.length > 0 && (
              <div
                ref={logRef}
                style={{
                  marginTop: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  backgroundColor: '#0a0a0a',
                  borderRadius: '6px',
                  maxHeight: 220,
                  overflowY: 'auto',
                  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace',
                  fontSize: '12px',
                  lineHeight: 1.7,
                }}
              >
                {importLog.map((entry, i) => (
                  <div key={i} style={{
                    color: entry.type === 'success' ? '#4ade80' : entry.type === 'dim' ? '#666' : '#a3a3a3',
                    display: 'flex',
                    gap: 8,
                  }}>
                    <span style={{ color: '#555', flexShrink: 0 }}>
                      {entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span>
                      {entry.type === 'success' && <span style={{ marginRight: 4 }}>&#10003;</span>}
                      {entry.text}
                    </span>
                  </div>
                ))}
                {importStep === 'polling' && (
                  <div style={{ color: '#555', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ flexShrink: 0 }}>
                      {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>
                      &#9679; polling...
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Imported metadata summary */}
            {importStep === 'done' && importedMetadata && (
              <div style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                border: '1px solid #4ade8040',
                borderRadius: '6px',
                backgroundColor: '#4ade8008',
                display: 'flex',
                gap: 'var(--space-4)',
                alignItems: 'center',
                fontSize: '13px',
              }}>
                {importedMetadata.listings_found != null && (
                  <div><strong>{importedMetadata.listings_found}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>listings</span></div>
                )}
                {importedMetadata.listing_urls?.length > 0 && (
                  <div><strong>{importedMetadata.listing_urls.length}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>vehicles queued</span></div>
                )}
              </div>
            )}

            {/* Claim anyway fallback */}
            {importStep !== 'done' && importStep !== 'polling' && importStep !== 'submitting' && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
                <button
                  className="button button-secondary"
                  style={{ fontSize: '11px', opacity: 0.7 }}
                  onClick={() => {
                    setSelectedIdentity({
                      id: 'manual',
                      platform: searchPlatform,
                      handle: searchQuery,
                      display_name: null,
                      profile_url: null,
                      first_seen: null,
                      last_seen: null,
                      claimed: false,
                      stats: null,
                    });
                  }}
                >
                  Skip import — claim "{searchQuery}" with no stats
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Claim Flow */}
      {selectedIdentity && (
        <div className="card" style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
            Claim: {selectedIdentity.handle}
          </div>

          {/* Stats inheritance */}
          {selectedIdentity.stats && (
            <div style={{
              padding: 'var(--space-3)',
              backgroundColor: 'var(--grey-50)',
              marginBottom: 'var(--space-4)',
              fontSize: '11px'
            }}>
              <strong>You'll inherit:</strong>
              <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: 'var(--space-4)' }}>
                <div>{formatNumber(selectedIdentity.stats.comments)} comments</div>
                <div>{formatNumber(selectedIdentity.stats.bids)} bids</div>
                {selectedIdentity.stats.wins > 0 && <div>{selectedIdentity.stats.wins} auction wins</div>}
              </div>
            </div>
          )}

          {/* Before claim started */}
          {!claimId && (
            <div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
                Start your claim, then verify by adding a code to your profile.
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <button className="button button-secondary" onClick={() => setSelectedIdentity(null)}>
                  Cancel
                </button>
                <button className="cursor-button" onClick={startClaim} disabled={submitting} style={{ padding: '8px 14px', fontSize: 12 }}>
                  {submitting ? 'STARTING...' : 'START CLAIM'}
                </button>
              </div>
            </div>
          )}

          {/* After claim started - show verification options */}
          {claimId && verificationCode && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                Verify your claim
              </div>

              {/* Primary: Add code to profile */}
              <div style={{
                padding: 'var(--space-4)',
                backgroundColor: 'var(--grey-50)',
                borderRadius: '6px',
                marginBottom: 'var(--space-3)'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  Option 1: Add this code to your {PLATFORM_LABELS[selectedIdentity.platform] || selectedIdentity.platform} bio
                </div>
                <div style={{
                  padding: 'var(--space-3)',
                  backgroundColor: 'var(--white)',
                  border: '2px dashed var(--border-light)',
                  borderRadius: '4px',
                  fontFamily: 'monospace',
                  fontSize: '19px',
                  textAlign: 'center',
                  userSelect: 'all',
                  letterSpacing: '2px'
                }}>
                  {verificationCode}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
                  We'll check your profile automatically. Once found, your claim is verified instantly.
                </div>
              </div>

              {/* Alternative: SMS */}
              <div style={{
                padding: 'var(--space-4)',
                border: '1px solid var(--border-light)',
                borderRadius: '6px',
                marginBottom: 'var(--space-3)'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  Option 2: Text us a screenshot
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Text a screenshot of your logged-in {PLATFORM_LABELS[selectedIdentity.platform] || selectedIdentity.platform} profile to <strong>(555) 123-4567</strong>
                </div>
              </div>

              {/* Alternative: Send ID */}
              <div style={{
                padding: 'var(--space-4)',
                border: '1px solid var(--border-light)',
                borderRadius: '6px'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  Option 3: Full verification (ID + face scan)
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Text a photo of your ID to <strong>(555) 123-4567</strong> for the highest confidence level.
                  This unlocks all features including proxy bidding.
                </div>
              </div>

              <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="button button-secondary" onClick={() => {
                  setSelectedIdentity(null);
                  setClaimId(null);
                  setVerificationCode(null);
                }}>
                  Done
                </button>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Claim ID: {claimId.slice(0, 8)}
                </div>
              </div>
            </div>
          )}

          {message && (
            <div className="alert alert-info" style={{ marginTop: 'var(--space-3)' }}>
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClaimExternalIdentity;
