import React, { useEffect, useState } from 'react';
import { getSupabaseFunctionsUrl } from '../lib/supabase';
import '../styles/unified-design-system.css';

// Meta data-deletion callbacks return https://nuke.ag/privacy#ig-deletion-<code>;
// the fragment never reaches the server, so status must render client-side.
type DeletionStatus =
  | { state: 'checking'; code: string }
  | { state: 'completed'; code: string; requestedAt: string; connectionsRevoked: number }
  | { state: 'unknown'; code: string };

const PrivacyPolicy: React.FC = () => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [deletion, setDeletion] = useState<DeletionStatus | null>(null);

  useEffect(() => {
    fetch('/PRIVACY_POLICY.md')
      .then((res) => res.text())
      .then((text) => {
        setContent(text);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load privacy policy:', err);
        setContent('# Privacy Policy\n\nFailed to load privacy policy. Please contact privacy@marque.com');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const match = /^#ig-deletion-([0-9a-f]{4,36})$/i.exec(window.location.hash);
    if (!match) return;
    const code = match[1];
    setDeletion({ state: 'checking', code });
    fetch(`${getSupabaseFunctionsUrl()}/instagram-connect/deletion-status?code=${encodeURIComponent(code)}`)
      .then((res) => res.json())
      .then((body) => {
        if (body?.found) {
          setDeletion({ state: 'completed', code, requestedAt: body.requested_at, connectionsRevoked: body.connections_revoked ?? 0 });
        } else {
          setDeletion({ state: 'unknown', code });
        }
      })
      .catch(() => setDeletion({ state: 'unknown', code }));
  }, []);

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 900, margin: '0 auto' }}>
      {deletion && (
        <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)', fontFamily: 'Arial, sans-serif', fontSize: '11px', lineHeight: 1.4 }}>
          <strong>Instagram Data Deletion Request — {deletion.code}</strong>
          {deletion.state === 'checking' && <p style={{ margin: '8px 0 0' }}>Checking the status of your deletion request…</p>}
          {deletion.state === 'completed' && (
            <p style={{ margin: '8px 0 0' }}>
              Status: <strong>Completed.</strong> Your request was received on{' '}
              {new Date(deletion.requestedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}{' '}
              and processed immediately: {deletion.connectionsRevoked} connected Instagram account{deletion.connectionsRevoked === 1 ? ' was' : 's were'} disconnected,
              the stored access token{deletion.connectionsRevoked === 1 ? '' : 's'} revoked, and all cached Instagram media and metadata permanently deleted.
              No Instagram data associated with this request remains on our systems.
            </p>
          )}
          {deletion.state === 'unknown' && (
            <p style={{ margin: '8px 0 0' }}>
              Status: <strong>Code not recognized.</strong> We could not find a deletion request with this confirmation code.
              If you believe this is an error, contact privacy@nuke.ag and include the code above — we respond within 30 days.
            </p>
          )}
        </div>
      )}
      {loading ? (
        <div style={{ padding: 'var(--space-6)', textAlign: 'center', fontSize: '11px' }}>Loading privacy policy…</div>
      ) : (
        <div style={{ background: 'var(--white)', border: '2px solid var(--border-medium)', padding: 'var(--space-4)' }}>
          <pre style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px', whiteSpace: 'pre-wrap', lineHeight: 1.4, margin: 0 }}>{content}</pre>
        </div>
      )}
    </div>
  );
};

export default PrivacyPolicy;
