import React, { useRef, useState } from 'react';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { useAuthContext } from '../../contexts/AuthContext';
import { useBuildLedger, useVehicleReceiptRecords, type VehicleReceiptRecord } from './hooks/useBuildLedger';
import { Row, Rows } from '../../kit';
const WorkOrderFinancialRecords = React.lazy(() => import('./FinancialReceiptRecords').then(module => ({ default: module.WorkOrderFinancialRecords })));
import FinancialLedger from './FinancialLedger';
import { moneyLabel } from './hooks/useVehicleFinancials';

function recordedDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date not recorded';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const cents = (value: number) => Math.round(value * 100);
const centsLabel = (value: number, currency: string) => moneyLabel((value / 100).toFixed(2), currency);

/**
 * Receipts filed to the vehicle, folded per vendor in place: count, readable total, and the receipts each total
 * stands on. The itemized receipt pages stay with their one owner (#build-receipts). Receipts are evidence of a
 * payment, not booked costs, so this never merges into the allocation ledger.
 */
function ReceiptTotals({ rows, total, complete, onOpenItems }: { rows: VehicleReceiptRecord[]; total: number | null; complete: boolean; onOpenItems: () => void }) {
  if (!rows.length) return null;
  const currencies = [...new Set(rows.flatMap(row => row.amount != null && !row.amountsHidden && row.currency ? [row.currency] : []))];
  const currency = currencies.length === 1 ? currencies[0] : null;
  const vendors = new Map<string, { receipts: number; counted: number; cents: number; hidden: number }>();
  for (const row of rows) {
    const vendor = row.vendor || 'Vendor not read';
    const entry = vendors.get(vendor) ?? { receipts: 0, counted: 0, cents: 0, hidden: 0 };
    if (row.amountsHidden) entry.hidden += 1;
    entry.receipts += 1;
    if (currency && row.currency === currency && row.amount != null && !row.amountsHidden) { entry.counted += 1; entry.cents += cents(row.amount); }
    vendors.set(vendor, entry);
  }
  const counted = [...vendors.values()].reduce((sum, v) => sum + v.counted, 0);
  const sum = [...vendors.values()].reduce((s, v) => s + v.cents, 0);
  const hidden = rows.filter(row => row.amountsHidden).length;
  // Value per dollar: the largest vendors lead.
  const ordered = [...vendors].sort((a, b) => b[1].cents - a[1].cents || b[1].receipts - a[1].receipts);
  return <section className="vp-financial-receipts">
    <Rows title="Receipts filed to this vehicle" count={total ?? rows.length}>
      {currency && counted > 0 && <Row label="Total on receipts" role="measure">{centsLabel(sum, currency)}</Row>}
      {currency && counted > 0 && <Row label="Counted" role="caption">{counted} of {complete ? rows.length : `${rows.length}+`} receipts{rows.length - counted - hidden > 0 ? ` · ${rows.length - counted - hidden} without a readable amount` : ''}{hidden ? ` · ${hidden} amount withheld from this viewer` : ''}</Row>}
      {!currency && hidden === rows.length && <Row label="Amounts" role="caption">Withheld from this viewer</Row>}
      <Row label="Source" role="caption">receipts filed to this vehicle</Row>
    </Rows>
    <Rows title="By vendor">
      {ordered.map(([vendor, v]) => <Row key={vendor} label={vendor} role="measure">
        {currency && v.counted > 0 ? centsLabel(v.cents, currency) : v.hidden === v.receipts ? 'Amount withheld' : 'Amount not read'} · {v.receipts} {v.receipts === 1 ? 'receipt' : 'receipts'}
      </Row>)}
    </Rows>
    <button type="button" className="vp-financial-action" onClick={onOpenItems}>Show each receipt and its items</button>
  </section>;
}

function FinancialDetails({ vehicleId, market, onClose }: { vehicleId: string; market: React.ReactNode; onClose: () => void }) {
  const { user } = useAuthContext();
  const ledger = useBuildLedger(vehicleId, false);
  const receipts = useVehicleReceiptRecords(vehicleId);
  // Booked allocations lead; filed receipts are payment evidence, folded in place after them.
  const receiptTotals = <ReceiptTotals rows={receipts.rows} total={receipts.total} complete={!receipts.hasNextPage}
    onOpenItems={() => { onClose(); document.getElementById('build-receipts')?.scrollIntoView({ block: 'start' }); }} />;
  return <div className="vp-financial-panel">
    {market && <section><h3>Market</h3>{market}</section>}
    {!user ? <><p>Sign in to read the financial records available to you.</p>{receiptTotals}</> : <>
      {ledger.loading && <p role="status">Reading vehicle financial records…</p>}
      {ledger.error && <div role="status"><p>Some financial records could not load. Available records remain shown; missing reads do not establish a zero balance.</p><button className="vp-financial-action" type="button" onClick={() => void ledger.retry()}>Retry financial records</button></div>}
      <FinancialLedger vehicleId={vehicleId} />
      {receiptTotals}
      <details className="vp-financial-sources"><summary>Work orders and historical build records</summary>
      <React.Suspense fallback={null}><WorkOrderFinancialRecords vehicleId={vehicleId} /></React.Suspense>
      {ledger.data.hasAudit && <section><h3>Build records and reported obligations</h3>
        <p>Recorded evidence and attribution remain attached to each entry. These records are kept separate from booked costs.</p>
        {ledger.data.groups.flatMap(group => group.entries).map(entry => <details key={entry.id} className="vp-financial-entry">
          <summary><span><strong>{entry.description || 'Build record'}</strong><small>{recordedDate(entry.observedAt)} · {entry.direction === 'liability' ? 'Reported obligation' : entry.direction === 'out' ? 'Recorded cost' : 'Financial record'}</small></span>
            <strong>{entry.amountUsd == null ? 'Amount unknown' : moneyLabel(String(entry.amountUsd), 'USD')}</strong></summary>
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
      </details>
    </>}

  </div>;
}

export default function ProfileFinancials({ vehicleId, market, reducedMarket, open, onToggle, onClose, boundaryRef }: {
  vehicleId: string; market: React.ReactNode; open: boolean; onToggle: () => void; onClose: () => void;
  reducedMarket?: React.ReactNode;
  boundaryRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { user } = useAuthContext();
  const trigger = useRef<HTMLButtonElement>(null);
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
  return <>
    <div className="vp-header-money">
      {/* Only the canonical price owner supplies header money. Costs and receipt counts are not prices. */}
      {reduced ? reducedMarket : market}
      <button ref={trigger} type="button" className="vp-financial-trigger" aria-label="Explore vehicle financials" aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>$$$</button>
    </div>
    {open && <HeaderPopover open title="Financials" width={640} align="right" onClose={() => { onClose(); trigger.current?.focus(); }} dismissBoundaryRef={boundaryRef}>
      {market && <div className="vp-financial-preference"><button type="button" className="vp-financial-action" onClick={() => {
        const next = !reduced; setReduction({ key: preference, reduced: next });
        try { localStorage.setItem(preference, next ? 'reduced' : 'expanded'); } catch { /* A display preference can remain session-only. */ }
      }}>{reduced ? 'Show header amount' : 'Reduce header amount'}</button></div>}
      <FinancialDetails key={`${user?.id ?? 'anon'}:${vehicleId}`} vehicleId={vehicleId} market={market} onClose={onClose} />
    </HeaderPopover>}
  </>;
}
