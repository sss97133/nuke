import React, { useMemo, useRef, useState } from 'react';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { useAuthContext } from '../../contexts/AuthContext';
import { useBuildLedger, useVehicleBookCosts, useVehicleReceiptRecords, type BookCostEntry } from './hooks/useBuildLedger';
import { ReceiptRecords, WorkOrderFinancialRecords } from './FinancialReceiptRecords';
const SharedAccountingOriginal = React.lazy(() => import('../../components/finance/SharedAccountingOriginal'));

export type BookSummary = {
  key: string; owner: string; currency: string; entries: BookCostEntry[];
  total: number | null; allocated: number; unallocated: number;
};

/** Currency and book are separate scopes. Audit testimony never enters this subtotal. */
export function summarizeVehicleCosts(rows: BookCostEntry[]): BookSummary[] {
  const groups = new Map<string, BookCostEntry[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const key = `${row.bookOwnerId}:${row.currency}`;
    const group = groups.get(key);
    if (group) group.push(row); else groups.set(key, [row]);
  }
  return [...groups.entries()].map(([key, entries]) => {
    const { bookOwnerId: owner, currency } = entries[0];
    const validCurrency = /^[A-Z]{3}$/.test(currency);
    const digits = validCurrency ? new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 : 2;
    const scale = 10 ** digits;
    let minor = 0n;
    let allocated = 0;
    for (const entry of entries) {
      if (entry.allocated == null || !Number.isFinite(entry.allocated)) continue;
      // Add decimal minor units, rather than accumulating floating-point money.
      const text = String(entry.allocated);
      if (!/^-?\d+(\.\d+)?$/.test(text)) continue;
      const [whole, fraction = ''] = text.replace('-', '').split('.');
      const padded = fraction.padEnd(digits + 1, '0');
      const value = BigInt(whole) * BigInt(scale) + BigInt(padded.slice(0, digits) || '0') + (Number(padded[digits]) >= 5 ? 1n : 0n);
      minor += text.startsWith('-') ? -value : value;
      allocated++;
    }
    return { key, owner, currency, entries, allocated, unallocated: entries.length - allocated,
      total: validCurrency && allocated > 0 && Number.isSafeInteger(Number(minor)) ? Number(minor) / scale : null };
  });
}

export function financialAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code' }).format(amount);
}

function recordedDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date not recorded';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function CostRow({ entry }: { entry: BookCostEntry }) {
  return <details className="vp-financial-entry">
    <summary><span><strong>{entry.description || 'Recorded expense'}</strong><small>{recordedDate(entry.date)}</small></span>
      <strong>{entry.allocated == null ? 'Amount not allocated' : entry.currency ? financialAmount(entry.allocated, entry.currency) : `${entry.allocated} · currency unknown`}</strong></summary>
    <dl>
      <dt>Vehicle allocation</dt><dd>{entry.basis || 'Basis not recorded'}</dd>
      {entry.category && <><dt>Category</dt><dd>{entry.category}</dd></>}
      {entry.account && <><dt>Account</dt><dd>{entry.account}</dd></>}
      <dt>Source record</dt><dd>{entry.ledgerId || 'Record id not available'}</dd>
      <dt>Assigned</dt><dd>{recordedDate(entry.assignedAt)}{entry.assignedMethod ? ` · ${entry.assignedMethod}` : ''}</dd>
    </dl>
    <div className="vp-financial-original"><React.Suspense fallback={<p role="status">Loading source control…</p>}>
      <SharedAccountingOriginal ownerId={entry.bookOwnerId} documentId={entry.documentId} />
    </React.Suspense></div>
  </details>;
}

function CostHistory({ scope }: { scope: BookSummary }) {
  const [month, setMonth] = useState<string | null>(null);
  const months = useMemo(() => {
    const grouped = new Map<string, BookCostEntry[]>();
    for (const entry of scope.entries) {
      if (entry.allocated == null || !entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
      const key = entry.date.slice(0, 7);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => ({ key, amount: summarizeVehicleCosts(entries)[0]?.total ?? null }));
  }, [scope]);
  const maximum = Math.max(1, ...months.map(item => Math.abs(item.amount ?? 0)));
  const visible = month ? scope.entries.filter(entry => entry.date?.startsWith(month)) : scope.entries;
  return <>
    {months.length > 0 && <div className="vp-financial-history" role="group" aria-label="Booked vehicle costs by month">
      {months.map(item => <button key={item.key} type="button" aria-pressed={month === item.key}
        onClick={() => setMonth(current => current === item.key ? null : item.key)}>
        <span>{item.key}</span><progress aria-label={`Booked costs ${item.key}`} value={Math.abs(item.amount ?? 0)} max={maximum} />
        <span>{item.amount == null ? 'Amount unavailable' : financialAmount(item.amount, scope.currency)}</span>
      </button>)}
    </div>}
    {month && <button type="button" className="vp-financial-action" onClick={() => setMonth(null)}>Show all dates</button>}
    {visible.map(entry => <CostRow key={entry.id} entry={entry} />)}
  </>;
}

function FinancialDetails({ vehicleId, market, receipts }: { vehicleId: string; market: React.ReactNode; receipts: ReturnType<typeof useVehicleReceiptRecords> }) {
  const { user } = useAuthContext();
  const ledger = useBuildLedger(vehicleId);
  const scopes = useMemo(() => summarizeVehicleCosts(ledger.data.book), [ledger.data.book]);
  const [selected, setSelected] = useState<string | null>(null);
  const scope = scopes.find(item => item.key === selected) ?? scopes[0];
  return <div className="vp-financial-panel">
    {market && <section><h3>Market</h3>{market}</section>}
    <ReceiptRecords vehicleId={vehicleId} read={receipts} />
    {!user ? <p>Sign in to read work-order payments and private books available to you. Public receipt summaries remain visible here.</p> : <>
      <WorkOrderFinancialRecords vehicleId={vehicleId} />
      {ledger.loading && <p role="status">Reading vehicle financial records…</p>}
      {ledger.error && <div role="status"><p>Some financial records could not load. Available records remain shown; missing reads do not establish a zero balance.</p><button className="vp-financial-action" type="button" onClick={() => void ledger.retry()}>Retry financial records</button></div>}
      {scope && <section><h3>Booked vehicle costs</h3>
        {scopes.length === 1 && <p>{scope.owner === user.id ? 'Your book' : 'Shared book'} · {scope.currency || 'Currency unknown'}</p>}
        {scopes.length > 1 && <label>Book and currency <select value={scope.key} onChange={event => setSelected(event.target.value)}>
          {scopes.map((item, index) => <option key={item.key} value={item.key}>{item.owner === user.id ? 'Your book' : `Shared book ${index + 1}`} · {item.currency || 'Currency unknown'}</option>)}
        </select></label>}
        <p className="vp-financial-total">{scope.total == null ? 'Allocated subtotal unavailable' : financialAmount(scope.total, scope.currency)}</p>
        <p>{scope.allocated} allocated of {scope.entries.length} visible entries{scope.unallocated ? ` · ${scope.unallocated} awaiting an amount` : ''}. This is the subtotal assigned in this book, rather than a lifetime investment or amount paid.</p>
        <p className="vp-financial-coverage">Across the available books: {ledger.bookCoverage.shown} of {ledger.bookCoverage.total ?? 'an unknown number of'} visible cost entries loaded.</p>
        <CostHistory key={scope.key} scope={scope} />
      </section>}
      {ledger.data.hasAudit && <section><h3>Build records and reported obligations</h3>
        <p>Recorded evidence and attribution remain attached to each entry. These records are kept separate from booked costs.</p>
        {ledger.data.groups.flatMap(group => group.entries).map(entry => <details key={entry.id} className="vp-financial-entry">
          <summary><span><strong>{entry.description || 'Build record'}</strong><small>{recordedDate(entry.observedAt)} · {entry.direction === 'liability' ? 'Reported obligation' : entry.direction === 'out' ? 'Recorded cost' : 'Financial record'}</small></span>
            <strong>{entry.amountUsd == null ? 'Amount unknown' : financialAmount(entry.amountUsd, 'USD')}</strong></summary>
          <dl><dt>Attribution</dt><dd>{entry.attributionTier || 'Unknown'}{entry.needsOwnerConfirmation ? ' · needs confirmation' : ''}</dd>
            {entry.counterparty && <><dt>Counterparty</dt><dd>{entry.counterparty}</dd></>}
            {entry.entityPaid && <><dt>Reported payer</dt><dd>{entry.entityPaid.replace(/_/g, ' ')}</dd></>}
            <dt>Basis</dt><dd>{entry.attributionBasis || 'Not recorded'}</dd>
            {Object.entries(entry.citation).map(([key, value]) => <React.Fragment key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></React.Fragment>)}
          </dl>
        </details>)}
      </section>}
      {ledger.data.notes.length > 0 && <section><h3>Working notes</h3><p>Amounts in working notes are historical context and do not enter the booked subtotal.</p>
        {ledger.data.notes.map(note => <details key={note.cellId} className="vp-financial-entry"><summary>{[note.workbook, note.sheet, note.table].filter(Boolean).join(' · ') || 'Working notes'}</summary>
          {note.vehicleMatch === 'candidate' && <p>Possible vehicle match.</p>}
          {note.rows.map(row => <p key={row.r}>{row.d ? `${row.d} · ` : ''}{row.t}</p>)}
          {note.rowsMatched > note.rows.length && <p>Showing {note.rows.length} of {note.rowsMatched} matching rows.</p>}
        </details>)}
      </section>}
      {!ledger.loading && !ledger.error && !ledger.data.hasData && <p>No entries are visible in the accounting-book or audit readers for this vehicle. Linked receipts and work orders are shown separately.</p>}
    </>}
  </div>;
}

export default function ProfileFinancials({ vehicleId, market, reducedMarket, marketPriority = false, open, onToggle, onClose, boundaryRef }: {
  vehicleId: string; market: React.ReactNode; open: boolean; onToggle: () => void; onClose: () => void;
  marketPriority?: boolean;
  reducedMarket?: React.ReactNode;
  boundaryRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useAuthContext();
  const trigger = useRef<HTMLButtonElement>(null);
  const read = useVehicleBookCosts(vehicleId);
  const receipts = useVehicleReceiptRecords(vehicleId);
  const scopes = useMemo(() => summarizeVehicleCosts(read.isError ? [] : read.data ?? []), [read.data, read.isError]);
  const preference = `vp:financial-display:v1:${user?.id ?? 'anon'}:${vehicleId}`;
  const [reduction, setReduction] = useState<{ key: string; reduced: boolean }>(() => {
    try { return { key: preference, reduced: localStorage.getItem(preference) === 'reduced' }; }
    catch { return { key: preference, reduced: false }; }
  });
  // A changed viewer/subject starts from that viewer's own display preference.
  let reduced = reduction.key === preference && reduction.reduced;
  if (reduction.key !== preference) {
    try { reduced = localStorage.getItem(preference) === 'reduced'; } catch { reduced = false; }
  }
  const amount = scopes.length === 1 && scopes[0].total != null ? <span className="vp-financial-headline"><small>Booked subtotal</small>{financialAmount(scopes[0].total, scopes[0].currency)}</span> : null;
  return <>
    <div className="vp-header-money">
      {reduced ? reducedMarket : marketPriority ? market || amount : amount || market || (receipts.rows.length > 0 ? <span className="vp-financial-headline"><small>Receipts{receipts.total == null ? ' loaded' : ''}</small>{receipts.total ?? receipts.rows.length}</span> : null)}
      <button ref={trigger} type="button" className="vp-financial-trigger" aria-label="Explore vehicle financials" aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>$$$</button>
    </div>
    {open && <HeaderPopover open title="Financials" width={640} align="right" onClose={() => { onClose(); trigger.current?.focus(); }} dismissBoundaryRef={boundaryRef}>
      <div className="vp-financial-preference"><button type="button" className="vp-financial-action" onClick={() => {
        const next = !reduced; setReduction({ key: preference, reduced: next });
        try { localStorage.setItem(preference, next ? 'reduced' : 'expanded'); } catch { /* A display preference can remain session-only. */ }
      }}>{reduced ? 'Show header amount' : 'Reduce header amount'}</button></div>
      <FinancialDetails key={`${user?.id ?? 'anon'}:${vehicleId}`} vehicleId={vehicleId} market={market} receipts={receipts} />
    </HeaderPopover>}
  </>;
}
