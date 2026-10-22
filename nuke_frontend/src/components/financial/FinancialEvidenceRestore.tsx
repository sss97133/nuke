import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { restoreFinancialEvidence, type RestoreProgress, type RestoreResult } from '../../services/financialEvidenceRestore';

/** One-time recovery of an explicitly selected retained-evidence bundle. */
export default function FinancialEvidenceRestore({ onRestored }: { onRestored?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<RestoreProgress | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const running = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const identityEpoch = useRef(0);
  useEffect(() => {
    mounted.current = true; let owner: string | null = null; let receivedAuthEvent = false;
    const update = (next: string | null) => {
      if (!mounted.current) return;
      if (owner !== next) {
        identityEpoch.current++;
        running.current?.abort(); setFile(null); setResult(null); setProgress(null); setError('');
        if (input.current) input.current.value = '';
      }
      owner = next; setSignedIn(!!next);
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      receivedAuthEvent = true; update(session?.user && !session.user.is_anonymous ? session.user.id : null);
    });
    supabase.auth.getUser().then(({ data: current, error }) => {
      if (!receivedAuthEvent) update(!error && current.user && !current.user.is_anonymous ? current.user.id : null);
    }).catch(() => { if (!receivedAuthEvent) update(null); });
    return () => { mounted.current = false; running.current?.abort(); data.subscription.unsubscribe(); };
  }, []);
  async function restore() {
    if (!file || !signedIn || running.current) return;
    const epoch = identityEpoch.current;
    const controller = new AbortController(); running.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const restored = await restoreFinancialEvidence(file, p => { if (mounted.current && epoch === identityEpoch.current && !controller.signal.aborted) setProgress(p); }, controller.signal);
      if (mounted.current && epoch === identityEpoch.current && !controller.signal.aborted) { setResult(restored); onRestored?.(); }
    } catch (e) { if (mounted.current && epoch === identityEpoch.current) setError(e instanceof Error ? e.message : 'Recovery stopped. Retry the same bundle to resume.'); }
    finally { running.current = null; if (mounted.current) setBusy(false); }
  }
  return <section aria-label="Restore retained accounting evidence">
    <h2>Restore retained accounting evidence</h2>
    <p>Choose your recovery bundle to bring existing records into this signed-in account. Retained decisions and source references stay attached; restoration does not post expenses or complete tax review.</p>
    {!signedIn && <p>Sign in to select a recovery bundle.</p>}
    <label>Recovery bundle <input ref={input} type="file" accept=".json,application/json" disabled={busy || !signedIn} onChange={e => {
      setFile(e.target.files?.[0] ?? null); setError(''); setResult(null); setProgress(null);
    }} /></label>{' '}
    <button type="button" disabled={!file || busy || !signedIn} onClick={restore}>Restore selected bundle</button>{' '}
    {busy && <button type="button" onClick={() => running.current?.abort()}>Stop after current request</button>}
    <div role="status" aria-live="polite">
      {busy && progress && <p>{progress.stage === 'validating' ? 'Validating the entire bundle before uploading…' : `${progress.stage}: ${progress.completed} of ${progress.total} revisions acknowledged.`}</p>}
      {result && <p>Verified {result.verified} originals and {result.revisions} retained revisions. Accounting and tax review remain open.</p>}
    </div>
    {error && <p role="alert">{error} Previously acknowledged records remain retained; retrying this bundle reuses the same revisions.</p>}
  </section>;
}
