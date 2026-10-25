import { useAccountingBook } from './AccountingBookContext';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { expenseUseKey, type ExpenseUse } from '../../services/financialExpenseUse';
import { remember, remembered } from './accountingMemory';
import RecordClassifier, { type ClassifyTarget } from './RecordClassifier';

export type SavedRecord = { id: string; document_id: string; record: {
  record_kind: string; local_id: string; year: string; date: string | null; account: string | null;
  section: string | null; category: string | null; amount: string | null; currency: string | null;
  description?: string; decision?: string; status?: string; source_key?: string; source_reference?: string;
} };
type Control = { record_kind: string; year: string; account: string | null; currency: string | null; section: string | null; rows: number; missing_amounts?: number; retained_amount: string | number | null };
type Workpapers = { records: SavedRecord[]; total_rows: number; next_after: string | null; controls_valid: boolean; controls: Control[] };
const defaultPageSize = 100;
const pageSizes = [25, 50, 100, 250] as const;
type SortColumn = 'record_date' | 'amount_value' | 'account' | 'section' | 'description';
// PostgREST `or` filters are comma separated and use * as the wildcard; keep the search term to plain text.
export const searchPattern = (query: string) => `*${query.trim().replace(/[%*,().\\]+/g, ' ').replace(/\s+/g, ' ').trim()}*`;

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
  const { ownerId, shared, liveRevision, canCorrect } = useAccountingBook();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Map<string, ClassifyTarget>>(() => new Map());
  const [classifying, setClassifying] = useState(false);
  const [uses, setUses] = useState<Record<string, ExpenseUse>>({});
  const [useError, setUseError] = useState(false);
  const [view, setView] = useState<'overview' | 'records' | 'accounts'>('overview');
  const [year, setYear] = useState(() => remembered('year'));
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState('');
  const [kind, setKind] = useState('');
  const [section, setSection] = useState('');
  const [currency, setCurrency] = useState('');
  const [unclassified, setUnclassified] = useState(false);
  const [sort, setSort] = useState<{ column: SortColumn; descending: boolean }>({ column: 'record_date', descending: true });
  const [rowsPerPage, setRowsPerPage] = useState<number>(defaultPageSize);
  const [tablePage, setTablePage] = useState(0);
  const [rows, setRows] = useState<SavedRecord[] | null>(null);
  const [hasMoreRows, setHasMoreRows] = useState(false);
  const [rowsError, setRowsError] = useState('');
  const [data, setData] = useState<Workpapers | null>(null);
  const [error, setError] = useState('');
  const [sessionRevision, setSessionRevision] = useState(0);
  const generation = useRef(0);
  const scope = useRef('');
  const searched = useRef('');
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
      generation.current++; setSection(''); setCurrency('');
      setData(null); setRows(null); setHasMoreRows(false); setRowsError(''); setError(''); setView('overview'); setQuery(''); setAccount(''); setKind(''); setUnclassified(false); setTablePage(0); setYear(''); setSessionRevision(n => n + 1);
    });
    return () => { generation.current++; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const request = ++generation.current;
    if (scope.current !== (ownerId || '')) { setData(null); setRows(null); setHasMoreRows(false); setUses({}); scope.current = ownerId || ''; }
    setError('');
    void supabase.functions.invoke('ingest-observation', { body: {
      mode: 'financial_evidence_v1', action: 'tax_read', ...(shared ? { owner_user_id: ownerId } : {}), limit: 1,
    } }).then(({ data: response, error: failure }) => {
      if (cancelled || generation.current !== request) return;
      const result = response?.data;
      if (failure || response?.error || !Array.isArray(result?.records) || !Array.isArray(result?.controls) || !Number.isSafeInteger(result?.total_rows) || result.total_rows < 0 || typeof result.controls_valid !== 'boolean' || !(result.next_after === null || typeof result.next_after === 'string')) {
        setData(null); setUses({}); setError('Saved bookkeeping could not load. Its totals are unknown.'); return;
      }
      setData(result);
    }).catch(() => { if (!cancelled && generation.current === request) setError('Saved bookkeeping could not load. Its totals are unknown.'); });
    return () => { cancelled = true; if (generation.current === request) generation.current++; };
  }, [revision, sessionRevision, ownerId, shared, liveRevision]);
  useEffect(() => {
    let cancelled = false;
    const keys = (rows || []).map(row => row.record.source_key).filter((key): key is string => !!key).map(expenseUseKey);
    if (!ownerId || !keys.length) { setUses({}); setUseError(false); return; }
    void Promise.resolve(supabase.from('financial_document_extractions').select('document_id, field_key, value_normalized').eq('owner_id', ownerId).eq('is_superseded', false).in('field_key', keys).limit(keys.length)).then(result => {
      if (cancelled) return;
      const next: Record<string, ExpenseUse> = {};
      setUseError(!!result.error);
      if (!result.error) for (const field of result.data || []) {
        const value = (field.value_normalized as { value?: ExpenseUse })?.value;
        if (value?.source_key && typeof value.destination_label === 'string' && rows?.some(row => row.document_id === field.document_id && row.record.source_key === value.source_key)) next[value.source_key] = value;
      }
      setUses(next);
    }).catch(() => { if (!cancelled) { setUses({}); setUseError(true); } });
    return () => { cancelled = true; };
  }, [rows, ownerId]);
  useEffect(() => { setTablePage(0); }, [view, query, account, kind, section, currency, unclassified, sort, year]);
  // A selection belongs to the filter it was made in; changing what is listed starts a new one.
  useEffect(() => { setSelected(new Map()); }, [view, query, account, kind, section, currency, unclassified, year, ownerId]);
  const controls = data?.controls.filter(row => row.record_kind === 'retained_ledger_decision') || [];
  const years = [...new Set((data?.controls || []).map(row => row.year).filter(value => typeof value === 'string'))].sort().reverse();
  const latestBookYear = controls.filter(row => row.section === 'Revenue' || row.section === 'Expense').map(row => row.year).filter((value): value is string => !!value).sort().at(-1);
  const selectedYear = years.includes(year) ? year : latestBookYear || years[0];
  const summaries = yearOverview(controls).filter(row => row.year === selectedYear);
  const topAccounts = summaries.map(group => ({ currency: group.currency, rows: [...new Set(controls.filter(row => row.year === selectedYear && row.currency === group.currency && row.section === 'Expense' && row.account).map(row => row.account!))].map(name => ({ name, amount: yearOverview(controls.filter(row => row.year === selectedYear && row.currency === group.currency && row.account === name))[0]?.expense ?? null })).filter((row): row is { name: string; amount: bigint } => row.amount !== null).sort((a, b) => a.amount === b.amount ? a.name.localeCompare(b.name) : a.amount > b.amount ? -1 : 1).slice(0, 5) }));
  const bankUnclassified = (data?.controls || []).filter(row => row.record_kind === 'retained_bank_movement' && row.year === selectedYear && !row.section).reduce((total, row) => total + row.rows, 0);
  const matches = (values: unknown[]) => values.join(' ').toLowerCase().includes(query.toLowerCase());
  // Records are read server-side from v_financial_accounting_records: every current record of the selected year,
  // filtered, searched and sorted in the database. The row policies of the book apply to the reader.
  useEffect(() => {
    if (view !== 'records' || !ownerId) { setRows(null); setHasMoreRows(false); setRowsError(''); return; }
    const bookId: string = ownerId;
    let cancelled = false;
    setRows(null); setHasMoreRows(false); setRowsError('');
    const run = () => {
      let request = supabase.from('v_financial_accounting_records').select('id, document_id, record').eq('owner_id', bookId);
      if (selectedYear) request = request.eq('year', selectedYear);
      if (account) request = account === '__unknown' ? request.is('account', null) : request.eq('account', account);
      if (kind) request = request.eq('record_kind', kind);
      if (section) request = section === '__unknown' ? request.is('section', null) : request.eq('section', section);
      if (currency) request = currency === '__unknown' ? request.is('currency', null) : request.eq('currency', currency);
      if (unclassified) request = request.eq('record_kind', 'retained_bank_movement').is('section', null);
      const term = searchPattern(query);
      if (term !== '**') request = request.or(['description', 'category', 'decision', 'status', 'amount', 'account'].map(column => `${column}.ilike.${term}`).join(','));
      let ordered = request.order(sort.column, { ascending: !sort.descending, nullsFirst: false });
      if (sort.column === 'section') ordered = ordered.order('category', { ascending: !sort.descending, nullsFirst: false });
      void Promise.resolve(ordered.order('id').range(tablePage * rowsPerPage, tablePage * rowsPerPage + rowsPerPage)).then(result => {
        if (cancelled) return;
        if (result.error || !Array.isArray(result.data)) { setRows(null); setHasMoreRows(false); setRowsError('Saved records could not load.'); return; }
        const page = result.data as SavedRecord[];
        setRowsError(''); setRows(page.slice(0, rowsPerPage)); setHasMoreRows(page.length > rowsPerPage);
      }).catch(() => { if (!cancelled) { setRows(null); setHasMoreRows(false); setRowsError('Saved records could not load.'); } });
    };
    // Typing is debounced; every other change (filters, paging, refresh) reads at once.
    const typing = searched.current !== query; searched.current = query;
    const handle = typing ? window.setTimeout(run, 250) : (run(), 0);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [view, ownerId, selectedYear, account, kind, section, currency, unclassified, query, sort, tablePage, rowsPerPage, revision, sessionRevision, liveRevision]);
  const sortBy = (column: SortColumn) => setSort(current => ({ column, descending: current.column === column ? !current.descending : column === 'record_date' || column === 'amount_value' }));
  const sortable = (column: SortColumn, label: string) => <th aria-sort={sort.column === column ? (sort.descending ? 'descending' : 'ascending') : undefined}><button type="button" className="accounting-sort" onClick={() => sortBy(column)}>{label}{sort.column === column ? (sort.descending ? ' ↓' : ' ↑') : ''}</button></th>;
  const chip = (label: string, pressed: boolean, onPress: () => void) => <button type="button" aria-pressed={pressed} onClick={onPress}>{label}</button>;
  const selectable = (rows || []).filter(row => !!row.record.source_key);
  const toggle = (row: SavedRecord) => {
    const key = row.record.source_key;
    if (!key) return;
    setSelected(current => { const next = new Map(current); if (next.has(key)) next.delete(key); else next.set(key, { documentId: row.document_id, record: row.record }); return next; });
  };
  const pageSelected = selectable.length > 0 && selectable.every(row => selected.has(row.record.source_key!));
  const togglePage = () => setSelected(current => {
    const next = new Map(current);
    for (const row of selectable) if (pageSelected) next.delete(row.record.source_key!); else next.set(row.record.source_key!, { documentId: row.document_id, record: row.record });
    return next;
  });
  // Saved classifications show at once; the shared ledger's own refresh follows.
  const classified = (changed: ClassifyTarget[]) => {
    const byKey = new Map(changed.map(item => [item.record.source_key, item.record]));
    setRows(current => current && current.map(row => row.record.source_key && byKey.has(row.record.source_key) ? { ...row, record: { ...row.record, ...byKey.get(row.record.source_key)! } } : row));
    setSelected(current => { const next = new Map(current); for (const key of byKey.keys()) if (key) next.delete(key); return next; });
  };
  const accountRows = controls.filter(row => row.year === selectedYear && (!account || (account === '__unknown' ? row.account == null : row.account === account)) && matches([row.account, row.section, row.currency]));
  const accounts = [...new Set((data?.controls || []).map(row => row.account).filter((value): value is string => !!value))].sort();
  const offset = Math.min(tablePage, Math.max(0, Math.ceil(accountRows.length / rowsPerPage) - 1)) * rowsPerPage;
  const recordsOffset = tablePage * rowsPerPage;
  const changeView = (next: typeof view) => { setView(next); setQuery(''); setAccount(''); setKind(''); setSection(''); setCurrency(''); setUnclassified(false); setTablePage(0); };
  const inspect = (nextSection: string | null, nextCurrency: string | null, nextAccount: string | null = '') => {
    changeView('records'); setKind('retained_ledger_decision'); setSection(nextSection ?? '__unknown'); setCurrency(nextCurrency ?? '__unknown'); setAccount(nextAccount ?? '__unknown');
  };
  return <section className="accounting-books" aria-label="Saved bookkeeping">
    <div className="accounting-section-heading"><h2>Your books</h2><label>Year <select value={selectedYear || ''} onChange={event => { setYear(event.target.value); remember('year', event.target.value); }}>{years.map(value => <option key={value}>{value}</option>)}</select></label></div>
    <nav className="accounting-tabs" aria-label="Bookkeeping views">{(['overview', 'records', 'accounts'] as const).map(tab => <button type="button" key={tab} aria-current={view === tab ? 'page' : undefined} onClick={() => changeView(tab)}>{tab === 'overview' ? 'Overview' : tab === 'records' ? 'Records' : 'Accounts'}</button>)}</nav>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Loading saved bookkeeping…</p> : <>
      {!data.controls_valid && <p role="alert">Repeated records need review; the subtotals are withheld.</p>}
      {view === 'overview' && <>
        <div className="accounting-years">{data.controls_valid && summaries.map(group => <article className="accounting-year" key={`${group.year}:${group.currency}`}>
          <h3>{group.year} <span className="accounting-muted">{group.currency || 'Currency unknown'}</span></h3>
          <dl><div><dt>Recorded income</dt><dd><button type="button" className="accounting-total-link" aria-label={`Inspect recorded income for ${group.year} ${group.currency || 'unknown currency'}`} onClick={() => inspect('Revenue', group.currency)}>{overviewAmount(group.revenue, group.currency)} <span aria-hidden="true">›</span></button></dd></div><div><dt>Recorded expenses</dt><dd><button type="button" className="accounting-total-link" aria-label={`Inspect recorded expenses for ${group.year} ${group.currency || 'unknown currency'}`} onClick={() => inspect('Expense', group.currency)}>{overviewAmount(group.expense, group.currency)} <span aria-hidden="true">›</span></button></dd></div>
            <div><dt>Bookkeeping difference</dt><dd>{overviewAmount(group.revenue === null || group.expense === null ? null : group.revenue - group.expense, group.currency)}</dd></div></dl>
        </article>)}</div>
        <p className="accounting-muted">Recorded books · {data.total_rows.toLocaleString('en-US')} records available · tax adjustments pending. Income less expenses excludes bank movements and is not taxable income.</p>
        {data.controls_valid && !summaries.length && <p>No recorded income or expense totals are available for {selectedYear || 'this year'}.</p>}
        {data.controls_valid && topAccounts.map(group => group.rows.length > 0 && <section className="accounting-top-accounts" key={group.currency || 'unknown'} aria-label="Largest expense accounts"><h3>Largest expense accounts · {group.currency || 'currency unknown'}</h3><p className="accounting-muted">Top five account subtotals for {selectedYear}; open an account to inspect its expenses.</p><ol>{group.rows.map(row => <li key={row.name}><button type="button" onClick={() => inspect('Expense', group.currency, row.name)}><span>{row.name}</span><strong>{overviewAmount(row.amount, group.currency)}</strong><span aria-hidden="true">›</span></button></li>)}</ol></section>)}
        <div className="accounting-attention"><div><strong>Coverage</strong><p>Recovery may be partial; completeness has not been confirmed.</p></div>
          <div><strong>{data.controls_valid ? bankUnclassified.toLocaleString('en-US') : 'Unknown'} unclassified bank movements</strong><p>For {selectedYear || 'the selected year'}. Classification is not recorded here. Some movements may already link to a bookkeeping decision.</p><button type="button" onClick={() => { changeView('records'); setKind('retained_bank_movement'); setUnclassified(true); }}>Inspect unclassified movements</button></div></div>

      </>}
      {data.total_rows === 0 && <p>No bookkeeping records have been recovered into this account yet.</p>}
      {view !== 'overview' && <>
        <div className="accounting-filters"><label>{view === 'records' ? 'Search records' : 'Search account breakdown'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          {view === 'records' && <><label>Classification <select value={section} onChange={event => { setSection(event.target.value); setUnclassified(false); }}><option value="">All classifications</option><option value="__unknown">Unclassified</option>{[...new Set(controls.map(row => row.section).filter((value): value is string => !!value))].sort().map(value => <option key={value}>{value}</option>)}</select></label><label>Currency <select value={currency} onChange={event => setCurrency(event.target.value)}><option value="">All currencies</option><option value="__unknown">Currency unknown</option>{[...new Set(controls.map(row => row.currency).filter((value): value is string => !!value))].sort().map(value => <option key={value}>{value}</option>)}</select></label></>}
          <label>Account <select value={account} onChange={event => setAccount(event.target.value)}><option value="">All accounts</option><option value="__unknown">Account unknown</option>{accounts.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Rows per page <select value={rowsPerPage} onChange={event => { setRowsPerPage(Number(event.target.value)); setTablePage(0); }}>{pageSizes.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
          {view === 'records' && <div className="accounting-chips" role="group" aria-label="Record type">
            {chip('All records', !kind && !unclassified, () => { setKind(''); setSection(''); setCurrency(''); setUnclassified(false); })}
            {chip('Bookkeeping decisions', kind === 'retained_ledger_decision', () => { setKind('retained_ledger_decision'); setUnclassified(false); })}
            {chip('Bank movements', kind === 'retained_bank_movement' && !unclassified, () => { setKind('retained_bank_movement'); setSection(''); setUnclassified(false); })}
            {chip('Unclassified', unclassified, () => { setKind('retained_bank_movement'); setSection(''); setUnclassified(current => !current); })}
          </div>}
          {view === 'records' && canCorrect && <div className="accounting-chips">{chip(selecting ? 'Done' : 'Select', selecting, () => { setSelecting(current => !current); setSelected(new Map()); })}</div>}
        </div>
        {view === 'records' && selecting && <div className="accounting-selection-bar" role="region" aria-label="Selected records">
          <span>{selected.size ? `${selected.size} selected` : 'Tap records to select them'}</span>
          <button type="button" className="accounting-primary" disabled={!selected.size} onClick={() => setClassifying(true)}>Classify…</button>
          <button type="button" disabled={!selected.size} onClick={() => setSelected(new Map())}>Clear</button>
        </div>}
        {classifying && <ClassifyDialog targets={[...selected.values()]} onChanged={classified} onClose={() => setClassifying(false)} />}
        {view === 'records' ? <>
          <p className="accounting-muted">Year {selectedYear || 'not recorded'}. Search and filters cover every saved record of the year. Sort by Date, Transaction / decision, Account, Classification or Amount; newest date first by default.</p>
          {rowsError && <p role="alert">{rowsError}</p>}
          {!rows && !rowsError && <p role="status">Loading saved records…</p>}
          {rows && <div className="accounting-table-wrap"><table className={selecting ? 'accounting-records-table accounting-selecting' : 'accounting-records-table'}><thead><tr>{selecting && <th className="accounting-select"><input type="checkbox" aria-label="Select every record on this page" checked={pageSelected} disabled={!selectable.length} onChange={togglePage} /></th>}{sortable('record_date', 'Date')}{sortable('description', 'Transaction / decision')}{sortable('account', 'Account')}{sortable('section', 'Classification')}{sortable('amount_value', 'Amount')}<th className="accounting-cell-use">Vehicle / shop use</th><th className="accounting-cell-evidence">Evidence</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="accounting-row" aria-selected={selecting ? selected.has(row.record.source_key || '') : undefined} onClick={() => selecting ? toggle(row) : onOpen(row.document_id, row.record)}>
            {selecting && <td className="accounting-select"><input type="checkbox" aria-label={`Select ${recordDescription(row.record.description) || 'record'}`} checked={selected.has(row.record.source_key || '')} disabled={!row.record.source_key} onClick={event => event.stopPropagation()} onChange={() => toggle(row)} /></td>}
            <td className="accounting-cell-date">{row.record.date || row.record.year}</td><td className="accounting-cell-desc"><button type="button" className="accounting-record-open" onClick={event => { event.stopPropagation(); selecting ? toggle(row) : onOpen(row.document_id, row.record); }}><span className="accounting-record-description">{recordDescription(row.record.description) || 'Saved record'}</span></button><small>{row.record.record_kind === 'retained_bank_movement' ? 'Bank movement' : 'Bookkeeping decision'}</small></td><td className="accounting-cell-account">{row.record.account || 'Not recorded'}</td><td className="accounting-cell-class">{row.record.section || 'Unclassified'}<small>{row.record.category}</small></td><td className="accounting-number accounting-cell-amount">{displayMoney(row.record.amount, row.record.currency)}</td><td className="accounting-cell-use">{row.record.section === 'Expense' && row.record.record_kind === 'retained_ledger_decision' ? useError ? 'Use unavailable' : row.record.source_key && uses[row.record.source_key]?.destination_label || 'Unassigned' : '—'}</td><td className="accounting-cell-evidence"><button type="button" onClick={event => { event.stopPropagation(); onOpen(row.document_id, row.record); }}>View evidence</button></td>
          </tr>)}</tbody></table></div>}
          {rows && !rows.length && <p>No saved records match these filters for {selectedYear}.</p>}
        </> : <>
          <p className="accounting-muted">Complete saved bookkeeping controls for {selectedYear}. Each row is an account classification, not an account balance. Bank movements are excluded.</p>
          {data.controls_valid && <div className="accounting-table-wrap"><table><thead><tr><th>Account</th><th>Classification</th><th>Amount</th><th>Records</th></tr></thead><tbody>{accountRows.slice(offset, offset + rowsPerPage).map((row, i) => <tr key={i}><td><button type="button" className="accounting-account-link" onClick={() => inspect(row.section, row.currency, row.account)}>{row.account || 'Unresolved'} <span aria-hidden="true">›</span></button></td><td>{row.section || 'Unresolved'}</td><td className="accounting-number">{displayMoney(row.missing_amounts ? null : row.retained_amount, row.currency)}</td><td>{row.rows}</td></tr>)}</tbody></table></div>}
          {!accountRows.length && <p>No account classifications match this filter.</p>}
        </>}
        {view === 'records' ? <div className="accounting-pagination"><span>{rows === null ? 'Matches unavailable' : rows.length ? `Showing ${recordsOffset + 1}–${recordsOffset + rows.length} records${hasMoreRows ? '; more available' : ''}` : 'No matching records'}</span><button type="button" disabled={recordsOffset === 0} onClick={() => setTablePage(value => value - 1)}>Previous {rowsPerPage}</button><button type="button" disabled={!hasMoreRows} onClick={() => setTablePage(value => value + 1)}>Next {rowsPerPage}</button></div>
        : <div className="accounting-pagination"><span>{accountRows.length ? offset + 1 : 0}–{Math.min(offset + rowsPerPage, accountRows.length)} of {accountRows.length} matches</span><button type="button" disabled={offset === 0} onClick={() => setTablePage(value => value - 1)}>Previous {rowsPerPage}</button><button type="button" disabled={offset + rowsPerPage >= accountRows.length} onClick={() => setTablePage(value => value + 1)}>Next {rowsPerPage}</button></div>}
      </>}
    </>}
  </section>;
}

/** The selection, frozen for the dialog's life so its outcome stays readable while the list behind it refreshes. */
function ClassifyDialog({ targets, onChanged, onClose }: { targets: ClassifyTarget[]; onChanged: (records: ClassifyTarget[]) => void; onClose: () => void }) {
  const [items, setItems] = useState(targets);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) { if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', ''); }
    return () => { if (element?.open && typeof element.close === 'function') element.close(); };
  }, []);
  return <dialog className="accounting-evidence-dialog" ref={dialog} aria-label="Classify selected records" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="accounting-dialog-heading"><h2>Classify {items.length} record{items.length === 1 ? '' : 's'}</h2><button type="button" autoFocus onClick={onClose}>Close</button></div>
    <ul className="accounting-selection-list">{items.slice(0, 6).map(({ record }) => <li key={record.source_key}><span>{record.date || record.year}</span><span className="accounting-record-description">{recordDescription(record.description) || 'Saved record'}</span><span className="accounting-number">{displayMoney(record.amount, record.currency)}</span><small>{record.section || 'Unclassified'}{record.category ? ` · ${record.category}` : ''}</small></li>)}
      {items.length > 6 && <li className="accounting-muted">and {items.length - 6} more</li>}</ul>
    <RecordClassifier targets={items} onChanged={changed => {
      const byKey = new Map(changed.map(item => [item.record.source_key, item.record]));
      setItems(current => current.map(item => byKey.has(item.record.source_key) ? { ...item, record: { ...item.record, ...byKey.get(item.record.source_key)! } } : item));
      onChanged(changed);
    }} />
  </dialog>;
}
