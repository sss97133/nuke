import React from 'react';
import { supabase } from '../lib/supabase';
import '../design-system.css';

type ProofType = 'profile_link' | 'screenshot' | 'oauth' | 'other';

const ClaimExternalIdentity: React.FC = () => {
  const [platform, setPlatform] = React.useState<string>('bat');
  const [handle, setHandle] = React.useState<string>('');
  const [profileUrl, setProfileUrl] = React.useState<string>('');
  const [proofType, setProofType] = React.useState<ProofType>('profile_link');
  const [proofUrl, setProofUrl] = React.useState<string>('');
  const [notes, setNotes] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string>('');

  React.useEffect(() => {
    // Allow prefill via querystring: ?platform=bat&handle=foo&profileUrl=...
    try {
      const url = new URL(window.location.href);
      const p = url.searchParams.get('platform');
      const h = url.searchParams.get('handle');
      const pu = url.searchParams.get('profileUrl');
      if (p) setPlatform(p);
      if (h) setHandle(h);
      if (pu) setProfileUrl(pu);
    } catch {
      // ignore
    }
  }, []);

  const submit = async () => {
    setMessage('');
    const h = handle.trim();
    if (!h) {
      setMessage('Handle is required.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session?.user) {
        setMessage('You must be logged in to claim an identity.');
        return;
      }

      const { data, error } = await supabase.rpc('request_external_identity_claim', {
        p_platform: platform,
        p_handle: h,
        p_profile_url: profileUrl || null,
        p_proof_type: proofType,
        p_proof_url: proofUrl || null,
        p_notes: notes || null,
      });

      if (error) throw error;

      setMessage(`Claim request submitted (id: ${String(data)}).`);
      // Keep values for now; user may submit multiple
    } catch (e: any) {
      console.error('Claim submit failed:', e);
      setMessage(e?.message || 'Failed to submit claim request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 780, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="heading-1" style={{ marginBottom: 'var(--space-2)' }}>Claim External Activity</h1>
        <div className="text-small" style={{ color: 'var(--text-muted)' }}>
          Link a platform handle to your N‑Zero profile. Once approved, activity from that handle can be merged into your contribution repo.
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <div className="text-small" style={{ fontWeight: 700, marginBottom: 6 }}>Platform</div>
            <select className="form-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="bat">Bring a Trailer</option>
              <option value="cars_and_bids">Cars & Bids</option>
              <option value="ebay_motors">eBay Motors</option>
              <option value="instagram">Instagram</option>
              <option value="youtube">YouTube</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <div className="text-small" style={{ fontWeight: 700, marginBottom: 6 }}>Handle</div>
            <input className="form-input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="e.g. VivaLasVegasAutos" />
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="text-small" style={{ fontWeight: 700, marginBottom: 6 }}>Profile URL (optional)</div>
          <input className="form-input" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://..." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          <div>
            <div className="text-small" style={{ fontWeight: 700, marginBottom: 6 }}>Proof type</div>
            <select className="form-input" value={proofType} onChange={(e) => setProofType(e.target.value as ProofType)}>
              <option value="profile_link">Profile link (place a link to your N‑Zero profile)</option>
              <option value="screenshot">Screenshot (logged-in proof)</option>
              <option value="oauth">OAuth (future)</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <div className="text-small" style={{ fontWeight: 700, marginBottom: 6 }}>Proof URL (optional)</div>
            <input className="form-input" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-3)' }}>
          <div className="text-small" style={{ fontWeight: 700, marginBottom: 6 }}>Notes (optional)</div>
          <textarea className="form-input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any context that helps verify ownership" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <div className="text-small" style={{ color: 'var(--text-muted)' }}>
            Review is required before the handle is linked to your profile.
          </div>
          <button className="cursor-button" onClick={submit} disabled={submitting} style={{ padding: '8px 14px', fontSize: 12 }}>
            {submitting ? 'SUBMITTING…' : 'SUBMIT CLAIM'}
          </button>
        </div>

        {message ? (
          <div className="alert alert-info" style={{ marginTop: 'var(--space-3)' }}>
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ClaimExternalIdentity;


