import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit/Text';
import { STAGE_WORDS, processFinancialDocument, type DocumentLinkTarget, type FinancialIntakeResult } from '../../services/financialEvidenceIntake';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

/** What a linked file says for itself once it is added: new, or already added for this row. The row stays on its list until the books agent cites the file. */
const LINKED_ADDED = 'Added. The file is stored privately and pointed at this row. Document received, link pending: the row stays on the list until the books agent cites it in the books.';
const LINKED_ALREADY = 'This file was already added for this row.';

type Props = {
  onComplete: (documentId: string) => void;
  /** Add each chosen file as the paper for this row of the books: the row's link target, without what the owner says the file is (see `kinds`). */
  link?: Omit<DocumentLinkTarget, 'doc_kind'>;
  /** What the owner may say a file added for a row is, in the words the large-sum rules read; the first is chosen to begin with. */
  kinds?: string[];
  /** The name of the group when it is added for a row (for assistive technology). */
  label?: string;
  /** What to say about the row above the controls. */
  children?: ReactNode;
};

/** The one way a document is added to the accounting office: choose files, press the button, they are uploaded privately and processed one by one, and what
 *  became of each is said. Used by itself (Add documents) and, with a `link`, inside a row of the books docket to add the paper that row needs. */
export default function FinancialDocumentIntake({ onComplete, link, kinds, label, children }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState(kinds?.[0] ?? 'Supporting document');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<{ name: string; result?: FinancialIntakeResult; error?: string }[]>([]);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const fileId = useId(), kindId = useId();
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
    let refused = false;
    for (const file of files) {
      if (generation.current !== run) return;
      try {
        const result = await processFinancialDocument(file, stage => {
          if (generation.current === run) setProgress(`${file.name}: ${STAGE_WORDS[stage]}`);
        }, link ? { ...link, doc_kind: kind } : undefined);
        if (generation.current !== run) return;
        setResults(rows => [...rows, { name: file.name, result }]);
        onComplete(result.documentId);
      } catch (error) {
        if (generation.current !== run) return;
        refused = true;
        setResults(rows => [...rows, { name: file.name, error: error instanceof Error ? error.message : 'Processing failed. Retry this file.' }]);
      }
    }
    if (generation.current !== run) return;
    setBusy(false);
    // Files added for a row are done with once they all landed: the chooser is emptied so they are not added twice. After a refusal the selection stays for
    // another try. The plain flow keeps its selection and its words, as it always did.
    if (link) { setProgress(''); if (!refused) { setFiles([]); if (input.current) input.current.value = ''; } } else setProgress('Selected files checked. Review the results below.');
  }
  const choose = (event: ChangeEvent<HTMLInputElement>) => { setFiles(Array.from(event.target.files || [])); setResults([]); setProgress(''); };
  const said = (row: { result?: FinancialIntakeResult; error?: string }) => row.error
    || (link ? (row.result?.linked?.already ? LINKED_ALREADY : LINKED_ADDED)
      : row.result?.message || (row.result?.status === 'complete' ? 'Document processing complete. Review accounting results.' : row.result?.status === 'blocked' ? 'Evidence retained; processing needs attention.' : 'Evidence retained; reconciliation needs review.'));

  if (link) {
    return <div className="accounting-paper-attach" role="group" aria-label={label ?? 'Add the paper for this row'}>
      {children}
      <div className="accounting-paper-attach__fields">
        <label htmlFor={kindId}><Text role="label">What is it</Text></label>
        <select id={kindId} value={kind} disabled={busy} onChange={event => setKind(event.target.value)}>{(kinds ?? [kind]).map(choice => <option key={choice}>{choice}</option>)}</select>
        <label htmlFor={fileId}><Text role="label">File</Text></label>
        <input id={fileId} ref={input} type="file" multiple accept={ACCEPT} disabled={busy} onChange={choose} />
        <button type="button" className="accounting-primary" disabled={busy || files.length === 0} onClick={submit}>{busy ? 'Adding…' : 'Add to this row'}</button>
      </div>
      {busy && progress && <p role="status"><Text role="caption">{progress}</Text></p>}
      {results.map((row, index) => <p key={index} role={row.error ? 'alert' : 'status'}><Text role={row.error ? 'body' : 'caption'}>{results.length > 1 ? `${row.name}: ` : ''}{said(row)}</Text></p>)}
    </div>;
  }
  return <section aria-label="Add accounting documents" style={{ border: '2px solid var(--border)', padding: 12, marginBottom: 16 }}>
    <h2 style={{ fontSize: 12 }}>ADD ACCOUNTING DOCUMENTS</h2>
    <p>Select documents to grant access to those files. Start processing to upload them privately and reconcile the available evidence.</p>
    <label>Choose images or PDFs <input ref={input} type="file" multiple accept={ACCEPT} disabled={busy} onChange={choose} /></label>{' '}
    <button type="button" disabled={busy || files.length === 0} onClick={submit}>{busy ? 'Processing…' : `Start processing${files.length ? ` ${files.length} files` : ''}`}</button>
    <p role="status" aria-live="polite">{progress}</p>
    {results.map((row, index) => <div key={index}>
      <strong>{row.name}</strong>: {said(row)}
      {row.result?.reused && ' Existing evidence reused.'}
    </div>)}
  </section>;
}
