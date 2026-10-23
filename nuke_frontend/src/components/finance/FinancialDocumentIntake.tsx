import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { processFinancialDocument, type FinancialIntakeResult } from '../../services/financialEvidenceIntake';

export default function FinancialDocumentIntake({ onComplete }: { onComplete: (documentId: string) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ name: string; result?: FinancialIntakeResult; error?: string }[]>([]);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      generation.current++; if (input.current) input.current.value = ''; setFiles([]); setResults([]); setProgress(''); setBusy(false);
    });
    return () => { generation.current++; subscription.unsubscribe(); };
  }, []);
  async function submit() {
    const run = generation.current;
    setBusy(true); setResults([]);
    for (const file of files) {
      if (generation.current !== run) return;
      try {
        const result = await processFinancialDocument(file, stage => {
          if (generation.current === run) setProgress(`${file.name}: ${stage}`);
        });
        if (generation.current !== run) return;
        setResults(rows => [...rows, { name: file.name, result }]);
        onComplete(result.documentId);
      } catch (error) {
        if (generation.current !== run) return;
        setResults(rows => [...rows, { name: file.name, error: error instanceof Error ? error.message : 'Processing failed. Retry this file.' }]);
      }
    }
    if (generation.current === run) { setBusy(false); setProgress('Selected files checked. Review the results below.'); }
  }
  return <section aria-label="Add accounting documents" style={{ border: '2px solid var(--border)', padding: 12, marginBottom: 16 }}>
    <h2 style={{ fontSize: 12 }}>ADD ACCOUNTING DOCUMENTS</h2>
    <p>Select documents to grant access to those files. Start processing to upload them privately and reconcile the available evidence.</p>
    <label>Choose images or PDFs <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" disabled={busy}
      onChange={event => { setFiles(Array.from(event.target.files || [])); setResults([]); setProgress(''); }} /></label>{' '}
    <button type="button" disabled={busy || files.length === 0} onClick={submit}>{busy ? 'Processing…' : `Start processing${files.length ? ` ${files.length} files` : ''}`}</button>
    <p role="status" aria-live="polite">{progress}</p>
    {results.map((row, index) => <div key={index}>
      <strong>{row.name}</strong>: {row.error || row.result?.message || (row.result?.status === 'complete' ? 'Document processing complete. Review accounting results.' : row.result?.status === 'blocked' ? 'Evidence retained; processing needs attention.' : 'Evidence retained; reconciliation needs review.')}
      {row.result?.reused && ' Existing evidence reused.'}
    </div>)}
  </section>;
}
