import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

type SavedRecord = { id: string; document_id: string; record: {
  record_kind: string; local_id: string; year: string; date: string | null; account: string | null;
  section: string | null; category: string | null; amount: string | null; currency: string | null;
  description?: string; decision?: string; status?: string;
} };
type Control = { record_kind: string; year: string; account: string | null; currency: string | null; section: string | null; rows: number; retained_amount: string | number | null };
type Workpapers = { records: SavedRecord[]; total_rows: number; next_after: string | null; controls_valid: boolean; controls: Control[] };
const pageSize = 100;

export default function FinancialWorkpapers({ revision, onOpen }: { revision: number; onOpen: (documentId: string) => void }) {
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [data, setData] = useState<Workpapers | null>(null);
  const [error, setError] = useState('');
  const [sessionRevision, setSessionRevision] = useState(0);
  const generation = useRef(0);
  const cursor = pages[pages.length - 1];
  useEffect(() => { setPages([null]); }, [revision]);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      generation.current++;
      setData(null); setError(''); setPages([null]); setSessionRevision(n => n + 1);
    });
    return () => { generation.current++; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const request = ++generation.current;
    setData(null); setError('');
    void supabase.functions.invoke('ingest-observation', { body: {
      mode: 'financial_evidence_v1', action: 'tax_read', limit: pageSize, ...(cursor ? { after: cursor } : {}),
    } }).then(({ data: response, error: failure }) => {
      if (cancelled || generation.current !== request) return;
      const result = response?.data;
      if (failure || response?.error || !Array.isArray(result?.records) || !Array.isArray(result?.controls) || !Number.isSafeInteger(result?.total_rows) || result.total_rows < 0 || typeof result.controls_valid !== 'boolean' || !(result.next_after === null || typeof result.next_after === 'string')) {
        setError('Saved bookkeeping could not load. Its totals are unknown.'); return;
      }
      setData(result);
    }).catch(() => { if (!cancelled && generation.current === request) setError('Saved bookkeeping could not load. Its totals are unknown.'); });
    return () => { cancelled = true; if (generation.current === request) generation.current++; };
  }, [cursor, revision, sessionRevision]);
  const controls = data?.controls.filter(row => row.record_kind === 'retained_ledger_decision') || [];
  return <section aria-label="Saved bookkeeping">
    <h2>Saved bookkeeping</h2>
    <p>Retained bookkeeping decisions and bank movements stay separate. Reconciliation and tax adjustments remain under review.</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading saved bookkeeping…</p> : <>
      <p>{data.total_rows} saved records. {data.controls_valid ? 'No repeated record identifiers were found.' : 'Repeated records need review; the subtotals are withheld.'}</p>
      {data.total_rows === 0 && <p>No bookkeeping records have been recovered into this account yet.</p>}
      {data.controls_valid && controls.length > 0 && <details><summary>Bookkeeping subtotals by year and account</summary>
        <p>These retain the source classifications. They are not finalized taxable income. Unknown currencies are shown explicitly.</p>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Year</th><th>Account</th><th>Classification</th><th>Amount</th><th>Currency</th><th>Records</th></tr></thead>
          <tbody>{controls.map((row, i) => <tr key={i}><td>{row.year}</td><td>{row.account || 'Unresolved'}</td><td>{row.section || 'Unresolved'}</td><td>{row.retained_amount ?? 'Unknown'}</td><td>{row.currency || 'Unresolved'}</td><td>{row.rows}</td></tr>)}</tbody>
        </table></div></details>}
      {data.records.length > 0 && <><div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>Record</th><th>Account</th><th>Classification</th><th>Amount</th><th>Decision and proof</th></tr></thead>
        <tbody>{data.records.map(row => <tr key={row.id}>
          <td>{row.record.date || row.record.year}</td><td>{row.record.record_kind === 'retained_bank_movement' ? 'Bank movement' : 'Bookkeeping decision'}<div>{row.record.description || row.record.local_id}</div></td>
          <td>{row.record.account || 'Unresolved'}</td><td>{row.record.section || 'Unresolved'}{row.record.category && <div>{row.record.category}</div>}</td>
          <td>{row.record.amount ?? 'Unknown'} {row.record.currency || '(currency unresolved)'}</td>
          <td>{row.record.status}<details><summary>Retained decision</summary>{row.record.decision || 'No decision recorded.'}</details><button type="button" onClick={() => onOpen(row.document_id)}>View evidence</button></td>
        </tr>)}</tbody></table></div>
        <p>Page {pages.length}</p><button type="button" disabled={pages.length === 1} onClick={() => setPages(previous => previous.slice(0, -1))}>Previous records</button>{' '}
        <button type="button" disabled={!data.next_after || pages.length * pageSize >= data.total_rows} onClick={() => setPages(previous => [...previous, data.next_after])}>Next records</button>
      </>}
    </>}
  </section>;
}
