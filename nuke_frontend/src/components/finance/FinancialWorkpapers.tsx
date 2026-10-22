import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

type SavedRecord = { id: string; document_id: string; record: {
  record_kind: string; local_id: string; year: string; date: string | null; account: string | null;
  section: string | null; category: string | null; amount: string | null; currency: string | null;
  description?: string; decision?: string; status?: string;
} };
type Control = { record_kind: string; year: string; account: string | null; currency: string | null; section: string | null; rows: number; missing_amounts?: number; retained_amount: string | number | null };
type Workpapers = { records: SavedRecord[]; total_rows: number; next_after: string | null; controls_valid: boolean; controls: Control[] };
const pageSize = 100;

export function displayMoney(value: string | number | null, currency: string | null): string {
  if (value === null || value === '' || !Number.isFinite(Number(value))) return 'Unknown';
  const amount = Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return `${amount} ${currency || '(currency unknown)'}`;
}

// Aggregate complete server controls, never the current page of records or bank movements.
export function yearOverview(controls: Control[]) {
  const invalid = new Set<string>();
  const groups = new Map<string, { year: string; currency: string | null; revenue: bigint | null; expense: bigint | null }>();
  for (const row of controls) {
    if (row.record_kind !== 'retained_ledger_decision' || !['Revenue', 'Expense'].includes(row.section || '')) continue;
    const key = JSON.stringify([row.year, row.currency]);
    const group = groups.get(key) || { year: row.year, currency: row.currency, revenue: null, expense: null };
    const value = String(row.retained_amount ?? '');
    const field = row.section === 'Revenue' ? 'revenue' : 'expense';
    const fieldKey = `${key}:${field}`;
    if ((row.missing_amounts ?? 0) > 0 || !/^-?\d+(?:\.\d{1,6})?$/.test(value)) {
      invalid.add(fieldKey); group[field] = null; groups.set(key, group); continue;
    }
    if (invalid.has(fieldKey)) continue;
    const [whole, fraction = ''] = value.replace('-', '').split('.');
    const scaled = (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))) * (value.startsWith('-') ? -1n : 1n);
    group[field] = (group[field] ?? 0n) + scaled;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.year.localeCompare(a.year));
}
const overviewAmount = (amount: bigint | null, currency: string | null) => amount === null ? 'Not available' : displayMoney(Number(amount) / 1000000, currency);


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
  return <section className="accounting-books" aria-label="Saved bookkeeping">
    <div className="accounting-section-heading"><div><span className="accounting-eyebrow">YOUR BOOKS</span><h2>Year overview</h2></div></div>
    <p className="accounting-muted">Income and expenses recorded in your books. Bank movements are kept separate.</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading saved bookkeeping…</p> : <>
      <div className="accounting-notice"><strong>{data.total_rows.toLocaleString('en-US')} records available</strong><p>This view covers records saved to this account so far. Recovery may be partial; completeness has not been confirmed. These are bookkeeping figures, not finalized taxable income or filing status.</p>
        {!data.controls_valid && <p role="alert">Repeated records need review; the subtotals are withheld.</p>}</div>
      {data.controls_valid && <div className="accounting-years">{yearOverview(controls).map(group => <article className="accounting-year" key={`${group.year}:${group.currency}`}>
        <div className="accounting-section-heading"><h3>{group.year}</h3><span className="accounting-eyebrow">{group.currency || 'CURRENCY UNKNOWN'}</span></div>
        <dl><div><dt>Recorded income</dt><dd>{overviewAmount(group.revenue, group.currency)}</dd></div><div><dt>Recorded expenses</dt><dd>{overviewAmount(group.expense, group.currency)}</dd></div>
        </dl>
        <p className="accounting-muted">Available records · tax adjustments not determined here</p>
      </article>)}</div>}
      {data.total_rows === 0 && <p>No bookkeeping records have been recovered into this account yet.</p>}
      {data.controls_valid && controls.length > 0 && <details className="accounting-disclosure"><summary>Account breakdown <span>Income, expenses and other classifications</span></summary>
        <p>These retain the source classifications. They are not finalized taxable income. Unknown currencies are shown explicitly.</p>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Year</th><th>Account</th><th>Classification</th><th>Amount</th><th>Currency</th><th>Records</th></tr></thead>
          <tbody>{controls.map((row, i) => <tr key={i}><td>{row.year}</td><td>{row.account || 'Unresolved'}</td><td>{row.section || 'Unresolved'}</td><td className="accounting-number">{displayMoney(row.retained_amount, row.currency)}</td><td>{row.currency || 'Unresolved'}</td><td>{row.rows}</td></tr>)}</tbody>
        </table></div></details>}
      {data.records.length > 0 && <details className="accounting-disclosure"><summary>Browse individual records <span>Decisions, bank activity and supporting evidence</span></summary><div style={{ overflowX: 'auto' }}><table><thead><tr><th>Date</th><th>Record</th><th>Account</th><th>Classification</th><th>Amount</th><th>Decision and proof</th></tr></thead>
        <tbody>{data.records.map(row => <tr key={row.id}>
          <td>{row.record.date || row.record.year}</td><td>{row.record.record_kind === 'retained_bank_movement' ? 'Bank movement' : 'Bookkeeping decision'}<div>{row.record.description || row.record.local_id}</div></td>
          <td>{row.record.account || 'Unresolved'}</td><td>{row.record.section || 'Unresolved'}{row.record.category && <div>{row.record.category}</div>}</td>
          <td className="accounting-number">{displayMoney(row.record.amount, row.record.currency)}</td>
          <td>{row.record.status}<details><summary>Retained decision</summary>{row.record.decision || 'No decision recorded.'}</details><button type="button" onClick={() => onOpen(row.document_id)}>View evidence</button></td>
        </tr>)}</tbody></table></div>
        <p>Page {pages.length}</p><button type="button" disabled={pages.length === 1} onClick={() => setPages(previous => previous.slice(0, -1))}>Previous records</button>{' '}
        <button type="button" disabled={!data.next_after || pages.length * pageSize >= data.total_rows} onClick={() => setPages(previous => [...previous, data.next_after])}>Next records</button>
      </details>}
    </>}
  </section>;
}
