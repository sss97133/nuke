import React, { useRef, useState } from 'react';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { useAuthContext } from '../../contexts/AuthContext';
import { useBuildLedger, useVehicleReceiptRecords } from './hooks/useBuildLedger';
import { ReceiptRecords, WorkOrderFinancialRecords } from './FinancialReceiptRecords';
import FinancialLedger from './FinancialLedger';
import { moneyLabel } from './hooks/useVehicleFinancials';

function recordedDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date not recorded';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function FinancialDetails({ vehicleId, market }: { vehicleId: string; market: React.ReactNode }) {
  const { user } = useAuthContext();
  const ledger = useBuildLedger(vehicleId, false);
  const receipts = useVehicleReceiptRecords(vehicleId);
  return <div className="vp-financial-panel">
    {market && <section><h3>Market</h3>{market}</section>}
    {!user ? <p>Sign in to read the financial records available to you.</p> : <>
      {ledger.loading && <p role="status">Reading vehicle financial records…</p>}
      {ledger.error && <div role="status"><p>Some financial records could not load. Available records remain shown; missing reads do not establish a zero balance.</p><button className="vp-financial-action" type="button" onClick={() => void ledger.retry()}>Retry financial records</button></div>}
      <FinancialLedger vehicleId={vehicleId} />
      <details className="vp-financial-sources"><summary>Work orders and historical build records</summary>
      <WorkOrderFinancialRecords vehicleId={vehicleId} />
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
    {(receipts.isLoading || receipts.isError || receipts.rows.length > 0) && <details className="vp-financial-sources">
      <summary>Receipt sources</summary>
      <ReceiptRecords vehicleId={vehicleId} read={receipts} />
    </details>}
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
      <FinancialDetails key={`${user?.id ?? 'anon'}:${vehicleId}`} vehicleId={vehicleId} market={market} />
    </HeaderPopover>}
  </>;
}
