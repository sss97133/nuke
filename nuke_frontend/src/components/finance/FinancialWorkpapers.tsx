import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

export type SavedRecord = { id: string; document_id: string; record: {
  record_kind: string; local_id: string; year: string; date: string | null; account: string | null;
  section: string | null; category: string | null; amount: string | null; currency: string | null;
  description?: string; decision?: string; status?: string; source_key?: string; source_reference?: string;
} };
type Control = { record_kind: string; year: string; account: string | null; currency: string | null; section: string | null; rows: number; missing_amounts?: number; retained_amount: string | number | null };
type Workpapers = { records: SavedRecord[]; total_rows: number; next_after: string | null; controls_valid: boolean; controls: Control[] };
const pageSize = 100;

// Readable label only; the retained source description is never rewritten.
export function recordDescription(value?: string): string {
  return (value || '').split('|').map(part => {
    const cleaned = part.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
    return (cleaned === part ? part : cleaned.replace(/^[\s,;]+|[\s,;]+$/g, '')).trim();
  }).filter(Boolean).join(' · ');
}

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
    if (!row.currency) { groups.set(key, group); continue; }
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


export default function FinancialWorkpapers({ revision, onOpen }: { revision: number; onOpen: (documentId: string, record: SavedRecord['record']) => void }) {
  const [view, setView] = useState<'overview' | 'records' | 'accounts'>('overview');
  const [year, setYear] = useState('');
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState('');
  const [kind, setKind] = useState('');
  const [unclassified, setUnclassified] = useState(false);
  const [tablePage, setTablePage] = useState(0);
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
      setData(null); setError(''); setPages([null]); setView('overview'); setQuery(''); setAccount(''); setKind(''); setUnclassified(false); setTablePage(0); setYear(''); setSessionRevision(n => n + 1);
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
  useEffect(() => { setTablePage(0); }, [view, query, account, kind, unclassified, cursor, year]);
  const controls = data?.controls.filter(row => row.record_kind === 'retained_ledger_decision') || [];
  const years = [...new Set((data?.controls || []).map(row => row.year).filter(value => typeof value === 'string'))].sort().reverse();
  const latestBookYear = controls.filter(row => row.section === 'Revenue' || row.section === 'Expense').map(row => row.year).filter((value): value is string => !!value).sort().at(-1);
  const selectedYear = years.includes(year) ? year : latestBookYear || years[0];
  const summaries = yearOverview(controls).filter(row => row.year === selectedYear);
  const topAccounts = summaries.map(group => ({ currency: group.currency, rows: [...new Set(controls.filter(row => row.year === selectedYear && row.currency === group.currency && row.section === 'Expense' && row.account).map(row => row.account!))].map(name => ({ name, amount: yearOverview(controls.filter(row => row.year === selectedYear && row.currency === group.currency && row.account === name))[0]?.expense ?? null })).filter((row): row is { name: string; amount: bigint } => row.amount !== null).sort((a, b) => a.amount === b.amount ? a.name.localeCompare(b.name) : a.amount > b.amount ? -1 : 1).slice(0, 5) }));
  const bankUnclassified = (data?.controls || []).filter(row => row.record_kind === 'retained_bank_movement' && row.year === selectedYear && !row.section).reduce((total, row) => total + row.rows, 0);
  const matches = (values: unknown[]) => values.join(' ').toLowerCase().includes(query.toLowerCase());
  const records = (data?.records || []).filter(({ record: row }) => (!selectedYear || row.year === selectedYear) && (!account || row.account === account) && (!kind || row.record_kind === kind) && (!unclassified || row.record_kind === 'retained_bank_movement' && row.year === selectedYear && !row.section) && matches([row.description, row.category, row.section, row.decision, row.status, row.amount, row.date]));
  const accountRows = controls.filter(row => row.year === selectedYear && (!account || row.account === account) && matches([row.account, row.section, row.currency]));
  const accounts = [...new Set((data?.controls || []).map(row => row.account).filter((value): value is string => !!value))].sort();
  const activeRows = view === 'accounts' ? accountRows : records;
  const offset = Math.min(tablePage, Math.max(0, Math.ceil(activeRows.length / 25) - 1)) * 25;
  const changeView = (next: typeof view) => { setView(next); setQuery(''); setAccount(''); setKind(''); setUnclassified(false); setTablePage(0); };
  return <section className="accounting-books" aria-label="Saved bookkeeping">
    <div className="accounting-section-heading"><h2>Your books</h2><label>Year <select value={selectedYear || ''} onChange={event => setYear(event.target.value)}>{years.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <nav className="accounting-tabs" aria-label="Bookkeeping views">{(['overview', 'records', 'accounts'] as const).map(tab => <button type="button" key={tab} aria-current={view === tab ? 'page' : undefined} onClick={() => changeView(tab)}>{tab === 'overview' ? 'Overview' : tab === 'records' ? 'Records' : 'Accounts'}</button>)}</nav>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading saved bookkeeping…</p> : <>
      {!data.controls_valid && <p role="alert">Repeated records need review; the subtotals are withheld.</p>}
      {view === 'overview' && <>
        <div className="accounting-years">{data.controls_valid && summaries.map(group => <article className="accounting-year" key={`${group.year}:${group.currency}`}>
          <h3>{group.year} <span className="accounting-muted">{group.currency || 'Currency unknown'}</span></h3>
          <dl><div><dt>Recorded income</dt><dd>{overviewAmount(group.revenue, group.currency)}</dd></div><div><dt>Recorded expenses</dt><dd>{overviewAmount(group.expense, group.currency)}</dd></div>
            <div><dt>Bookkeeping difference</dt><dd>{overviewAmount(group.revenue === null || group.expense === null ? null : group.revenue - group.expense, group.currency)}</dd></div></dl>
        </article>)}</div>
        <p className="accounting-muted">Recorded books · {data.total_rows.toLocaleString('en-US')} records available · tax adjustments pending. Income less expenses excludes bank movements and is not taxable income.</p>
        {data.controls_valid && !summaries.length && <p>No recorded income or expense totals are available for {selectedYear || 'this year'}.</p>}
        {data.controls_valid && topAccounts.map(group => group.rows.length > 0 && <section className="accounting-top-accounts" key={group.currency || 'unknown'} aria-label="Largest expense accounts"><h3>Largest expense accounts · {group.currency || 'currency unknown'}</h3><p className="accounting-muted">Top five account subtotals for {selectedYear}; accounts with unknown totals cannot be ranked.</p><ol>{group.rows.map(row => <li key={row.name}><button type="button" onClick={() => { changeView('accounts'); setAccount(row.name); }}>{row.name}</button><strong>{overviewAmount(row.amount, group.currency)}</strong></li>)}</ol></section>)}
        <div className="accounting-attention"><div><strong>Coverage</strong><p>Recovery may be partial; completeness has not been confirmed.</p></div>
          <div><strong>{data.controls_valid ? bankUnclassified.toLocaleString('en-US') : 'Unknown'} unclassified bank movements</strong><p>For {selectedYear || 'the selected year'}. Classification is not recorded here. Some movements may already link to a bookkeeping decision.</p><button type="button" onClick={() => { changeView('records'); setKind('retained_bank_movement'); setUnclassified(true); }}>Inspect unclassified movements</button></div></div>

      </>}
      {data.total_rows === 0 && <p>No bookkeeping records have been recovered into this account yet.</p>}
      {view !== 'overview' && <>
        <div className="accounting-filters"><label>{view === 'records' ? 'Search loaded records' : 'Search account breakdown'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label>Account <select value={account} onChange={event => setAccount(event.target.value)}><option value="">All accounts</option>{accounts.map(value => <option key={value}>{value}</option>)}</select></label>
          {view === 'records' && <><label>Record type <select value={kind} onChange={event => setKind(event.target.value)}><option value="">All record types</option><option value="retained_ledger_decision">Bookkeeping decisions</option><option value="retained_bank_movement">Bank movements</option></select></label><label><input type="checkbox" checked={unclassified} onChange={event => setUnclassified(event.target.checked)} /> Unclassified bank movements</label></>}
        </div>
        {view === 'records' ? <>
          <p className="accounting-muted">Year {selectedYear || 'not recorded'}. Search and filters cover the {data.records.length} records loaded on source page {pages.length}, not all {data.total_rows.toLocaleString('en-US')} records. Source pages follow saved record order, not date or priority.</p>
          <div className="accounting-table-wrap"><table><thead><tr><th>Date</th><th>Transaction / decision</th><th>Account</th><th>Classification</th><th>Amount</th><th>Evidence</th></tr></thead><tbody>{records.slice(offset, offset + 25).map(row => <tr key={row.id}>
            <td>{row.record.date || row.record.year}</td><td><span className="accounting-record-description">{recordDescription(row.record.description) || 'Saved record'}</span><small>{row.record.record_kind === 'retained_bank_movement' ? 'Bank movement' : 'Bookkeeping decision'}</small></td><td>{row.record.account || 'Not recorded'}</td><td>{row.record.section || 'Unclassified'}<small>{row.record.category}</small></td><td className="accounting-number">{displayMoney(row.record.amount, row.record.currency)}</td><td><button type="button" onClick={() => onOpen(row.document_id, row.record)}>View evidence</button></td>
          </tr>)}</tbody></table></div>
          {!records.length && <p>No matches in this loaded source page. Clear filters or load another source page.</p>}
        </> : <>
          <p className="accounting-muted">Complete saved bookkeeping controls for {selectedYear}. Each row is an account classification, not an account balance. Bank movements are excluded.</p>
          {data.controls_valid && <div className="accounting-table-wrap"><table><thead><tr><th>Account</th><th>Classification</th><th>Amount</th><th>Records</th></tr></thead><tbody>{accountRows.slice(offset, offset + 25).map((row, i) => <tr key={i}><td>{row.account || 'Unresolved'}</td><td>{row.section || 'Unresolved'}</td><td className="accounting-number">{displayMoney(row.missing_amounts ? null : row.retained_amount, row.currency)}</td><td>{row.rows}</td></tr>)}</tbody></table></div>}
          {!accountRows.length && <p>No account classifications match this filter.</p>}
        </>}
        <div className="accounting-pagination"><span>{activeRows.length ? offset + 1 : 0}–{Math.min(offset + 25, activeRows.length)} of {activeRows.length} matches</span><button type="button" disabled={offset === 0} onClick={() => setTablePage(value => value - 1)}>Previous 25</button><button type="button" disabled={offset + 25 >= activeRows.length} onClick={() => setTablePage(value => value + 1)}>Next 25</button></div>
        {view === 'records' && <div className="accounting-pagination"><span>Source page {pages.length}</span><button type="button" disabled={pages.length === 1} onClick={() => setPages(previous => previous.slice(0, -1))}>Previous records</button><button type="button" disabled={!data.next_after || pages.length * pageSize >= data.total_rows} onClick={() => setPages(previous => [...previous, data.next_after])}>Next records</button></div>}
      </>}
    </>}
  </section>;
}
