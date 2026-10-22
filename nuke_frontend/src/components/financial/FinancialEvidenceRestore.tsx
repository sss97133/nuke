import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { restoreFinancialEvidence, type RestoreProgress, type RestoreResult } from '../../services/financialEvidenceRestore';

/** Recovery of explicitly selected retained-evidence bundles, one at a time. */
export default function FinancialEvidenceRestore({ onRestored }: { onRestored?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [completedBundles, setCompletedBundles] = useState(0);
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
        running.current?.abort(); setFiles([]); setCompletedBundles(0); setResult(null); setProgress(null); setError('');
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
    if (!files.length || completedBundles === files.length || !signedIn || running.current) return;
    const epoch = identityEpoch.current;
    const controller = new AbortController(); running.current = controller;
    setBusy(true); setError(''); setProgress(null);
    try {
      let totals = result ?? { documents: 0, revisions: 0, verified: 0, expense_posted: false as const, tax_ready: false as const };
      for (let index = completedBundles; index < files.length; index++) {
        if (!mounted.current || epoch !== identityEpoch.current || controller.signal.aborted) break;
        setProgress(null);
        const restored = await restoreFinancialEvidence(files[index], p => { if (mounted.current && epoch === identityEpoch.current && !controller.signal.aborted) setProgress(p); }, controller.signal);
        if (!mounted.current || epoch !== identityEpoch.current || controller.signal.aborted) break;
        totals = { ...totals, documents: totals.documents + restored.documents, revisions: totals.revisions + restored.revisions, verified: totals.verified + restored.verified };
        setResult(totals); setCompletedBundles(index + 1); onRestored?.();
      }
    } catch (e) { if (mounted.current && epoch === identityEpoch.current) setError(e instanceof Error ? e.message : 'Recovery stopped. Retry the same bundle to resume.'); }
    finally { running.current = null; if (mounted.current) setBusy(false); }
  }
  return <section aria-label="Restore retained accounting evidence">
    <h2>Restore retained accounting evidence</h2>
    <p>Choose one or more recovery bundles to bring existing records into this signed-in account. Retained decisions and source references stay attached; restoration does not post expenses or complete tax review.</p>
    {!signedIn && <p>Sign in to select recovery bundles.</p>}
    <label>Recovery bundles <input ref={input} type="file" multiple accept=".json,application/json" disabled={busy || !signedIn} onChange={e => {
      setFiles(Array.from(e.target.files ?? [])); setCompletedBundles(0); setError(''); setResult(null); setProgress(null);
    }} /></label>{' '}
    <button type="button" disabled={!files.length || completedBundles === files.length || busy || !signedIn} onClick={restore}>{completedBundles > 0 && completedBundles < files.length ? 'Resume selected bundles' : 'Restore selected bundles'}</button>{' '}
    {busy && <button type="button" onClick={() => running.current?.abort()}>Stop after current request</button>}
    <div role="status" aria-live="polite">
      {files.length > 0 && <p>{completedBundles} of {files.length} bundles verified.{completedBundles < files.length && ` ${busy ? 'Current' : 'Next'} bundle: ${files[completedBundles].name}`}</p>}
      {busy && progress && <p>{progress.stage === 'validating' ? 'Validating the entire bundle before uploading…' : `${progress.stage}: ${progress.completed} of ${progress.total} revisions acknowledged.`}</p>}
      {result && <p>Verified {result.verified} originals and {result.revisions} retained revisions. Accounting and tax review remain open.</p>}
    </div>
    <p>Bundles run one at a time. Keep this page open. After a reload, select the remaining bundles; replaying a bundle reuses its retained revisions.</p>
    {error && <p role="alert">{error} Previously acknowledged records remain retained; resume retries the unfinished bundle and skips bundles verified in this selection.</p>}
  </section>;
}
