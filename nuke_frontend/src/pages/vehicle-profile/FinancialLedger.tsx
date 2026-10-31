import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { readRecordEvidence } from '../../services/accountingCloseout';
import { readAccountingSnapshot } from '../../services/financialExpenseUse';
import { JobReaders } from '../jobs/jobsReaders';
import { FINANCIAL_PHASES, financialDate, moneyLabel, totalMoney, useVehicleFinancials, type FinancialPhase, type VehicleFinancialUse } from './hooks/useVehicleFinancials';
const SharedAccountingOriginal = React.lazy(() => import('../../components/finance/SharedAccountingOriginal'));
const LABELS: Record<FinancialPhase, string> = { customer_receipt: 'Customer payments', book_expense: 'Booked vehicle costs', customer_refund: 'Customer refunds' };
const dateLabel = (date: string | null) => date && /^\d{4}-\d{2}-\d{2}$/.test(date)
  ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Date not recorded';

function FinancialSource({ owner, documentId }: { owner: string; documentId: string }) {
  const { user } = useAuthContext();
  const read = useQuery({ queryKey: ['vehicle-financial-source-items', user?.id, owner, documentId],
    queryFn: () => readAccountingSnapshot(owner, documentId), staleTime: 60_000, gcTime: 0, retry: false });
  const lines = read.data?.lines.flatMap(line => line.attributes?.staging ? [line.attributes.staging] : []) ?? [];
  return <div className="vp-financial-original">
    {lines.length > 0 && <><h4>Source items</h4><ul>{lines.map(line => <li key={line.source_line_key}>
      {line.quantity == null ? 'Quantity unrecorded' : `${line.quantity} ×`} {line.description_raw || line.sku_raw || 'Unnamed item'}{line.sku_raw ? ` · ${line.sku_raw}` : ''}
      {line.amount == null ? ' · line price unrecorded' : ` · ${moneyLabel(line.amount, line.currency || '')}`}
    </li>)}</ul><p>These are source readings within the selected order. They do not add charges or establish which items were installed.</p></>}
    {read.isError && <p role="status">Source items unavailable. You can still check the original.</p>}
    <React.Suspense fallback={<p role="status">Loading source control…</p>}><SharedAccountingOriginal ownerId={owner} documentId={documentId} /></React.Suspense>
  </div>;
}

function AllocationEvidence({ row, vehicleId }: { row: VehicleFinancialUse; vehicleId: string }) {
  const { user } = useAuthContext();
  const [document, setDocument] = useState<string | null>(null);
  const evidence = useQuery({
    queryKey: ['vehicle-allocation-evidence', user?.id, vehicleId, row.owner, row.documentId, row.sourceKey],
    queryFn: () => readRecordEvidence(row.owner, row.documentId, row.sourceKey), staleTime: 60_000, gcTime: 0, retry: false,
  });
  const photos = row.witnesses.filter(w => w.kind === 'image' && w.id);
  const photoRead = useQuery({
    queryKey: ['vehicle-allocation-photos', user?.id, vehicleId, row.id, row.index, photos.map(w => w.id)],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_images').select('id,image_url').eq('vehicle_id', vehicleId)
        .in('id', photos.map(w => w.id!)).eq('is_sensitive', false).eq('is_superseded', false);
      if (error) throw new Error('Cited photos unavailable.');
      return data ?? [];
    }, enabled: photos.length > 0, staleTime: 60_000, gcTime: 0, retry: false,
  });
  // Reuse the current vehicle-filed source-line reader. Source items are not extra charges.
  const items = useQuery({
    queryKey: ['vehicle-allocation-items', user?.id, vehicleId, row.receiptId],
    queryFn: async () => {
      const result = await JobReaders.vehicleReceiptLines(vehicleId);
      if (result.refusal || !result.data) throw new Error('Receipt lines unavailable.');
      return result.data;
    }, enabled: !!row.receiptId, staleTime: 60_000, gcTime: 0, retry: false,
  });
  const documents = new Map<string, string>();
  for (const w of row.witnesses) if (w.kind === 'document' && w.id) documents.set(w.id, w.label);
  if (row.invoiceDocumentId) documents.set(row.invoiceDocumentId, row.invoiceReference || 'Invoice original');
  for (const a of evidence.data?.artifacts ?? []) documents.set(a.document_id, a.filename || 'Supporting original');
  for (const line of evidence.data?.statement_lines ?? []) documents.set(line.document_id, 'Statement original');
  if (row.bankDocumentId) documents.set(row.bankDocumentId, 'Bank source original');
  documents.set(row.documentId, 'Book source original');
  const lines = items.data?.rows.filter(item => item.receipt_id === row.receiptId) ?? [];
  return <div className="vp-financial-evidence">
    <dl><dt>Vehicle allocation</dt><dd>{row.basis || 'Basis not recorded'}</dd>
      {row.invoiceReference && <><dt>Invoice</dt><dd>{row.invoiceReference}</dd></>}
      {row.account && <><dt>Account</dt><dd>{row.account}</dd></>}
      {row.category && <><dt>Book category</dt><dd>{row.category}</dd></>}
      {row.bankAmount != null && <><dt>Bank movement</dt><dd>{moneyLabel(row.bankAmount, row.currency)} · posted {dateLabel(row.bankDate)}</dd>
        <dt>Assigned here</dt><dd>{moneyLabel(row.amount, row.currency)}{row.bankRemainder !== '0' && row.bankRemainder != null ? ` · ${moneyLabel(row.bankRemainder, row.currency)} of the movement remains outside current vehicle allocations` : ''}</dd></>}
      {row.bookAmount != null && row.bankAmount != null && Number(row.bookAmount) !== Math.abs(Number(row.bankAmount)) && <><dt>Book source amount</dt><dd>{moneyLabel(row.bookAmount, row.currency)} · retained separately from the bank amount</dd></>}
    </dl>
    {lines.length > 0 && <div><h4>Receipt items</h4><ul>{lines.map(item => <li key={item.id}>{item.quantity ?? 'Quantity unknown'} × {item.description || item.part_number || 'Unnamed source item'}{item.part_number ? ` · ${item.part_number}` : ''}</li>)}</ul></div>}
    {items.data?.next_after && <p>More filed receipt lines are available in the vehicle work records; this source-line read is partial.</p>}
    {items.isError && <p role="status">Itemized source lines could not load.</p>}
    {row.witnesses.filter(w => w.kind === 'work' || w.kind === 'receipt' || !w.id).map((w, i) => <p key={`${w.kind}:${i}`}>{w.label}{!w.id ? ' · source changed or unavailable' : w.kind === 'work' ? ' · cited work record' : ' · receipt source'}</p>)}
    {photos.length > 0 && <div className="vp-financial-photos" aria-label="Cited work photos">{photoRead.data?.map(photo => <figure key={photo.id}>
      <img src={photo.image_url} alt={photos.find(w => w.id === photo.id)?.label || 'Cited work photo'} loading="lazy" />
      <figcaption>{photos.find(w => w.id === photo.id)?.label}</figcaption>
    </figure>)}{photoRead.isError && <p role="status">Cited photos could not load.</p>}</div>}
    <div className="vp-financial-source-choices" role="group" aria-label="Supporting originals">
      {[...documents].map(([id, label]) => <button type="button" className="vp-financial-action" key={id} aria-pressed={document === id} onClick={() => setDocument(current => current === id ? null : id)}>{label}</button>)}
    </div>
    {document && <FinancialSource key={document} owner={row.owner} documentId={document} />}
    {evidence.isError && <p role="status">Additional source links could not load. The allocation and its explicit citations remain shown.</p>}
    {evidence.data?.questions.map(q => <p key={q.id}>{q.detail}</p>)}
  </div>;
}

function AllocationRow({ row, vehicleId }: { row: VehicleFinancialUse; vehicleId: string }) {
  const [open, setOpen] = useState(false);
  return <details className="vp-financial-entry" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span><strong>{row.description}</strong><small>{dateLabel(financialDate(row))}{row.invoiceReference ? ` · ${row.invoiceReference}` : ''}</small></span>
      <strong>{row.qualification === 'ready' ? moneyLabel(row.amount, row.currency) : row.qualification === 'unallocated' ? 'Awaiting allocation' : 'Source needs review'}</strong></summary>
    {open && <AllocationEvidence row={row} vehicleId={vehicleId} />}
  </details>;
}

function FinancialScope({ rows, vehicleId, complete }: { rows: VehicleFinancialUse[]; vehicleId: string; complete: boolean }) {
  const [phase, setPhase] = useState<FinancialPhase>('customer_receipt'), [month, setMonth] = useState('');
  const available = FINANCIAL_PHASES.filter(p => rows.some(row => row.phase === p));
  const current = available.includes(phase) ? phase : available[0];
  const entries = rows.filter(row => row.phase === current);
  const known = entries.filter(row => row.qualification === 'ready' && row.amount != null);
  const months = [...new Set(known.map(financialDate).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).map(d => d.slice(0, 7)))].sort();
  const history = months.map(date => ({ date, value: totalMoney(known.filter(row => financialDate(row)!.slice(0, 7) <= date)) }));
  const values = history.map(h => Number(h.value ?? 0));
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const y = (value: string | null) => 128 - (Number(value ?? 0) - low) / Math.max(1, high - low) * 112;
  const visible = month ? entries.filter(row => financialDate(row)?.startsWith(month)) : entries;
  const currency = rows[0]?.currency ?? '';
  return <>
    <div className="vp-financial-measures" role="group" aria-label="Vehicle financial measures">
      {available.map(p => <button type="button" key={p} aria-pressed={current === p} onClick={() => { setPhase(p); setMonth(''); }}>
        <span>{LABELS[p]}</span><strong>{moneyLabel(totalMoney(rows.filter(row => row.phase === p)), currency)}</strong>
        <small>{rows.filter(row => row.phase === p && row.qualification === 'ready').length} allocated entries{!complete ? ' · partial read' : ''}</small>
      </button>)}
    </div>
    {history.length > 0 && <figure className="vp-financial-curve">
      <figcaption>{LABELS[current]} over time · cumulative {complete ? 'visible records' : 'loaded records'}</figcaption>
      <svg viewBox="0 0 600 140" role="img" aria-label={`Cumulative ${LABELS[current].toLowerCase()}`}>
        <polyline points={history.map((h, i) => `${12 + i / Math.max(1, history.length - 1) * 576},${y(h.value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
        {history.map((h, i) => <circle key={h.date} cx={12 + i / Math.max(1, history.length - 1) * 576} cy={y(h.value)} r="3" fill="currentColor"><title>{h.date}: {moneyLabel(h.value, currency)}</title></circle>)}
      </svg><div><span>{history[0].date}</span><span>{history[history.length - 1].date}</span></div>
    </figure>}
    <div className="vp-financial-filter"><h3>{LABELS[current]}</h3>{months.length > 1 && <label>Period <select value={month} onChange={event => setMonth(event.target.value)}><option value="">All dates</option>{months.map(date => <option key={date}>{date}</option>)}</select></label>}</div>
    <p>{moneyLabel(totalMoney(visible), currency)}{month ? ` · ${month}` : ''} · {visible.filter(row => row.qualification === 'ready').length} allocated of {visible.length} visible entries</p>
    {entries.some(row => row.qualification !== 'ready') && <p>Entries awaiting allocation or revised source evidence are excluded from the amounts.</p>}
    {visible.sort((a, b) => (financialDate(b) ?? '').localeCompare(financialDate(a) ?? '')).map(row => <AllocationRow key={`${row.id}:${row.index}`} row={row} vehicleId={vehicleId} />)}
  </>;
}

export default function FinancialLedger({ vehicleId }: { vehicleId: string }) {
  const { user } = useAuthContext();
  const read = useVehicleFinancials(vehicleId), [selected, setSelected] = useState('');
  const scopes = useMemo(() => {
    const groups = new Map<string, VehicleFinancialUse[]>();
    for (const row of read.rows) { const key = `${row.owner}:${row.currency}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
    return [...groups];
  }, [read.rows]);
  const scope = scopes.find(([key]) => key === selected) ?? scopes[0];
  return <section className="vp-financial-ledger" aria-label="Vehicle financial ledger">
    {read.isLoading && <p role="status">Reading vehicle financial allocations…</p>}
    {read.isError && <div role="status"><p>Financial allocations could not load. A failed read does not establish a zero balance.</p><button type="button" className="vp-financial-action" onClick={() => void read.refetch()}>Retry financial allocations</button></div>}
    {scope && <>
      {scopes.length > 1 ? <label>Book and currency <select value={scope[0]} onChange={event => setSelected(event.target.value)}>{scopes.map(([key, rows], index) => <option key={key} value={key}>{rows[0].owner === user?.id ? 'Your book' : `Shared book ${index + 1}`} · {rows[0].currency}</option>)}</select></label> : <p>{scope[1][0].owner === user?.id ? 'Your book' : 'Shared book'} · {scope[1][0].currency}</p>}
      <FinancialScope key={scope[0]} rows={scope[1]} vehicleId={vehicleId} complete={read.complete} />
      <p className="vp-financial-coverage">{read.rows.length} {read.complete ? 'of '+read.rows.length+' visible allocation entries loaded' : 'allocation entries loaded · more available'}. Customer payments and booked costs remain separate; these records do not establish a sale price, lifetime investment, or a settled job balance.</p>
    </>}
    {read.hasNextPage && <button type="button" className="vp-financial-action" disabled={read.isFetchingNextPage} onClick={() => void read.fetchNextPage()}>Load more allocations</button>}
    {!read.isLoading && !read.isError && !read.rows.length && <p>No financial allocations are visible to this account for this vehicle.</p>}
  </section>;
}
