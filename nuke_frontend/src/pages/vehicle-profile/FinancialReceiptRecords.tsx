import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../contexts/AuthContext';
import { OrgLogo } from '../../components/common/OrgLogo';
import './receipt-pages.css';
import { signPrivateStorageUrl, privateStoragePath } from '../../lib/privateStorage';
import { bounded } from '../../services/accountingCloseout';
import type { FieldProvenance } from './hooks/useFieldProvenance';
import type { DayDocument } from './VehicleDayDrawer';
import { useVehicleWorkOrderFinancials, useVehicleReceiptRecords, type VehicleReceiptRecord } from './hooks/useBuildLedger';
import { useVisualWork } from './hooks/useVisualWork';
import { VisualWorkCards } from './VisualWorkCards';
import { receiptSupplierLabel } from './receiptSupplierLabel';
const OriginalDocumentPreview = React.lazy(() => import('../../components/finance/SharedAccountingOriginal').then(module => ({ default: module.OriginalDocumentPreview })));

function amountText(amount: number | null, currency: string | null): string {
  if (amount == null) return 'Amount not recorded';
  return currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    : `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} · currency unrecorded`;
}

function ReceiptSource({ receipt, vehicleId, expectedSourceHash }: {
  receipt: Pick<VehicleReceiptRecord, 'sourceId' | 'sourceTable'>; vehicleId: string; expectedSourceHash?: string;
}) {
  const [state, setState] = useState('');
  const [original, setOriginal] = useState<{ blob: Blob; filename: string } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!receipt.sourceId || !['vehicle_documents', 'vehicle_images'].includes(receipt.sourceTable ?? '')) return <p>Original source access is not available in this view.</p>;
  return <div className="vp-financial-original">
    <button ref={trigger} type="button" disabled={state === 'Reading source…'} onClick={async () => {
      setState('Reading source…');
      setOriginal(null);
      try {
        const image = receipt.sourceTable === 'vehicle_images';
        const { data, error } = await supabase.from(image ? 'vehicle_images_public' : 'vehicle_documents')
          .select(image ? 'image_url' : 'file_url').eq('id', receipt.sourceId!).eq('vehicle_id', vehicleId).maybeSingle();
        const raw = data && (image ? (data as { image_url?: string }).image_url : (data as { file_url?: string }).file_url);
        if (error || !raw || !/^https?:\/\//.test(raw)) throw new Error('Unavailable');
        if (expectedSourceHash !== undefined) {
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
          const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
          if (!/^[a-f0-9]{64}$/.test(expectedSourceHash) || actual !== expectedSourceHash) throw new Error('Source changed');
        }
        const signed = await signPrivateStorageUrl(raw);
        if (privateStoragePath(raw) && signed === raw) throw new Error('Unavailable');
        const blob = await bounded(async signal => {
          const response = await fetch(signed, { signal });
          if (!response.ok) throw new Error('Unavailable');
          return response.blob();
        });
        if (!alive.current) return;
        setOriginal({ blob, filename: new URL(raw).pathname.split('/').pop() || 'Original receipt' });
        setState('');
      } catch { if (alive.current) setState('Source unavailable or not visible to this viewer.'); }
    }}>{state === 'Reading source…' ? state : 'Read original source'}</button>
    {original && <React.Suspense fallback={<p role="status">Loading original viewer…</p>}>
      <OriginalDocumentPreview blob={original.blob} filename={original.filename}
        onClose={() => { setOriginal(null); trigger.current?.focus(); }} />
    </React.Suspense>}
    {state && state !== 'Reading source…' && <p role="status">{state}</p>}
  </div>;
}

interface PrintedLine {
  line_number: number | null; description: string | null; part_number: string | null;
  quantity: number | null; amount: number | null; line_date: string | null; hours: number | null; performer: string | null;
}
interface ReceiptPage {
  receipt_id: string; document_number: string | null; document_type: string | null;
  vendor_org?: { logo_url?: string | null; website?: string | null } | null;
  subtotal: number | null; tax: number | null; shipping: number | null; discount: number | null;
  recorded_payment?: { amount: number | null; date: string | null } | null;
  recorded_hours?: number | null; hour_entries?: number;
  lines: PrintedLine[];
}

function printedDate(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date not recorded';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** The retained correction points to an existing receipt, whose existing reader
 * supplies its public lines and masks money/payer/page access for this viewer. */
export function CorrectionReceipt({ vehicleId, citation }: {
  vehicleId: string; citation: NonNullable<FieldProvenance['current_correction']>;
}) {
  const { user, loading: authLoading } = useAuthContext();
  const viewer = user?.id ?? 'anonymous';
  const read = useQuery({
    queryKey: ['field-correction-receipt', viewer, vehicleId, citation.correction_id, citation.receipt_id, citation.page_date],
    enabled: !authLoading,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(sourceSignal => supabase.rpc('get_vehicle_day_documents', {
        p_vehicle_id: vehicleId, p_date: citation.page_date,
      }).abortSignal(sourceSignal), signal);
      if (error || !Array.isArray(data?.documents)) throw new Error('Receipt could not be read');
      return (data.documents as DayDocument[]).find(doc => doc.receipt_id === citation.receipt_id) ?? null;
    },
  });
  const doc = !authLoading && !read.isError ? read.data : null;
  const showAmounts = doc?.lines.some(line => line.amount != null);
  return <article className="field-correction-receipt" aria-label="Receipt cited by the recorded value">
    <strong>{citation.value}</strong>
    <p className="field-citations__note">The recorded correction cites this document.</p>
    {(authLoading || read.isLoading) && <p role="status">Reading cited receipt…</p>}
    {!authLoading && (read.isError || (!read.isLoading && !doc)) && <p role="status">The cited receipt is unavailable in this read.{' '}
      <button type="button" disabled={read.isFetching} onClick={() => void read.refetch()}>Retry receipt</button>
    </p>}
    {doc && <>
      <header><h3>{receiptSupplierLabel(doc.vendor || doc.vendor_org?.name) || 'Receipt'}{doc.document_number ? ` #${doc.document_number}` : ''}</h3>
        <p>{doc.document_type?.replace(/_/g, ' ') || 'Document'} · {citation.page_date}</p>
      </header>
      {doc.lines.length > 0 && <table><thead><tr><th scope="col">Recorded item or work</th><th scope="col">Qty</th>{showAmounts && <th scope="col">Amount</th>}</tr></thead>
        <tbody>{doc.lines.map((line, i) => <tr key={`${line.line_number ?? i}:${i}`}>
          <td>{line.description || line.part_number || 'Line item'}{line.part_number && line.description && <small>{line.part_number}</small>}</td>
          <td>{line.quantity ?? '—'}</td>
          {showAmounts && <td>{line.amount == null ? '—' : amountText(line.amount, doc.currency)}</td>}
        </tr>)}</tbody>
      </table>}
      {doc.total != null && <p className="field-correction-receipt__total">Document total <strong>{amountText(doc.total, doc.currency)}</strong></p>}
      {doc.recorded_payment && <p>Recorded payment <strong>{amountText(doc.recorded_payment.amount, doc.currency)}</strong>{doc.recorded_payment.date ? ` · ${printedDate(doc.recorded_payment.date)}` : ''}</p>}
      {doc.recorded_hours != null && <p>{doc.recorded_hours} recorded person-hours · {doc.hour_entries} entries on this receipt</p>}
      <ReceiptSource key={`${viewer}:${vehicleId}:${citation.source_table}:${citation.document_id}`} vehicleId={vehicleId}
        receipt={{ sourceId: citation.document_id, sourceTable: citation.source_table }} />
    </>}
  </article>;
}

function ReceiptReplica({ vehicleId, receipt }: { vehicleId: string; receipt: VehicleReceiptRecord }) {
  const { user, loading } = useAuthContext();
  const element = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: '600px' });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const read = useQuery({
    queryKey: ['vehicle-receipt-page', vehicleId, receipt.date, user?.id ?? 'anon'],
    queryFn: async ({ signal }) => {
      const { data, error } = await bounded(requestSignal => supabase.rpc('get_vehicle_day_documents', { p_vehicle_id: vehicleId, p_date: receipt.date }).abortSignal(requestSignal), signal);
      if (error || !data || !Array.isArray(data.documents)) throw new Error('Receipt lines unavailable');
      return data as { documents: ReceiptPage[]; tied: boolean };
    },
    enabled: near && !!receipt.date && !loading, staleTime: 60_000, gcTime: 0, retry: false,
  });
  // Never keep a private day's response visible while the viewer changes or a refresh fails.
  const page = !loading && !read.isError && !read.isFetching
    ? read.data?.documents.find(document => document.receipt_id === receipt.id) : undefined;
  const moneyVisible = !receipt.amountsHidden && read.data?.tied === true;
  const [expanded, setExpanded] = useState(false);
  const lines = page?.lines ?? [];
  const visibleLines = expanded ? lines : lines.slice(0, 4);
  if (!loading && !read.isFetching && !read.isError && read.data && !page) return null;
  return <article ref={element} className="vp-receipt-page" aria-label={`${receipt.vendor || 'Receipt'} ${receipt.date || ''}`}>
    <header>
      {page?.vendor_org?.logo_url && <OrgLogo logoUrl={page.vendor_org.logo_url} businessName={receipt.vendor || ''} size={36} variant="icon" />}
      <div><h4>{receipt.vendor || 'Linked receipt'}</h4>
        <p>{receipt.dateConflict ? receipt.dates.map(printedDate).join(' / ') : printedDate(receipt.date)}
          {page?.document_number ? ` · #${page.document_number}` : ''}</p></div>
    </header>
    {receipt.dateConflict && <p className="vp-receipt-note">Document date readings differ.</p>}
    {lines.length > 0 && <table className="vp-receipt-lines"><thead><tr><th>Item / work</th><th>Qty</th>{moneyVisible && <th>Amount</th>}</tr></thead>
      <tbody>{visibleLines.map((line, index) => <tr key={`${line.line_number ?? index}`}>
        <td>{line.line_date && <time dateTime={line.line_date}>{printedDate(line.line_date)} · Work recorded</time>}
          <span>{line.description || 'Description not recorded'}</span>
          {(line.part_number || line.hours != null || line.performer) && <small>{[line.part_number, line.hours != null ? `${line.hours} ${line.hours === 1 ? 'hour' : 'hours'}` : null, line.performer].filter(Boolean).join(' · ')}</small>}
        </td><td>{line.quantity ?? '—'}</td>{moneyVisible && <td>{line.amount == null ? '—' : amountText(line.amount, receipt.currency)}</td>}
      </tr>)}</tbody></table>}
    {lines.length > 4 && <button type="button" className="vp-receipt-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show fewer lines' : `Show all ${lines.length} lines`}</button>}
    {!receipt.date && !receipt.dateConflict && <p className="vp-receipt-note">Open the original for its line items.</p>}
    {receipt.date && !page && <p className="vp-receipt-note" role="status">{read.isError ? 'Line items could not load.' : read.isFetching || !near ? 'Reading receipt…' : 'Line items are not available in this view.'}
      {(!near || read.isError) && <button type="button" onClick={() => { setNear(true); if (read.isError) void read.refetch(); }}>{read.isError ? 'Retry' : 'Read lines'}</button>}</p>}
    <footer>
      {moneyVisible && page && <dl>{([['Subtotal', page.subtotal], ['Shipping', page.shipping], ['Discount', page.discount], ['Tax', page.tax]] as const)
        .filter(([, value]) => value != null && value !== 0).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{amountText(value, receipt.currency)}</dd></React.Fragment>)}</dl>}
      <div className="vp-receipt-total"><span>Document total</span><strong>{receipt.amountsHidden ? 'Visible to owner & contributors' : receipt.amountConflict ? 'Readings differ' : amountText(receipt.amount, receipt.currency)}</strong></div>
      {moneyVisible && page?.recorded_payment && <div className="vp-receipt-total"><span>Recorded payment{page.recorded_payment.date ? ` · ${printedDate(page.recorded_payment.date)}` : ''}</span><strong>{amountText(page.recorded_payment.amount, receipt.currency)}</strong></div>}
      {moneyVisible && page?.recorded_payment && <p className="vp-receipt-note">Payment and document total are separate readings of this receipt; they are not added together.</p>}
      {page?.recorded_hours != null && <p className="vp-receipt-note"><strong>{page.recorded_hours} recorded person-hours</strong> · {page.hour_entries} entries on this receipt. Concurrent entries count separately.</p>}
      {receipt.amountConflict && <p className="vp-receipt-note">{amountText(receipt.total, receipt.currency)} / {amountText(receipt.totalAmount, receipt.currency)} · check original</p>}
      {receipt.amount === 0 && <p className="vp-receipt-note">No charge shown in this reading; check the original.</p>}
      <ReceiptSource key={`${vehicleId}:${receipt.sourceTable}:${receipt.sourceId}`} receipt={receipt} vehicleId={vehicleId} />
    </footer>
  </article>;
}

function ReceiptCollection({ vehicleId, read, work }: { vehicleId: string; read: ReturnType<typeof useVehicleReceiptRecords>; work?: ReturnType<typeof useVisualWork> }) {
  const { user, loading } = useAuthContext();
  const [vendor, setVendor] = useState('');
  const [showAll, setShowAll] = useState(false);
  const rows = (loading || read.isError ? [] : read.rows)
    .map(receipt => ({ ...receipt, vendor: receiptSupplierLabel(receipt.vendor) }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
  const vendors = [...new Set(rows.map(receipt => receipt.vendor).filter((name): name is string => !!name))].sort();
  const selectedVendor = vendors.includes(vendor) ? vendor : '';
  const matching = selectedVendor ? rows.filter(receipt => receipt.vendor === selectedVendor) : rows;
  const visible = showAll || selectedVendor ? matching : matching.slice(0, 6);
  return <section id="build-receipts" aria-label="Work and parts receipts" className="vp-receipt-section">
    <div className="vp-receipt-heading"><h3>Work & parts</h3><span>Receipt collection</span></div>
    <p className="vp-receipt-intro">Parts, dated work and the original paper.</p>
    {work && <VisualWorkCards rows={loading ? [] : work.rows} renderSource={line => line.source_url_sha256 ? <ReceiptSource
      key={`${user?.id ?? 'anonymous'}:${line.source_table}:${line.source_id}:${line.source_url_sha256}`} vehicleId={vehicleId}
      expectedSourceHash={line.source_url_sha256} receipt={{ sourceTable: line.source_table, sourceId: line.source_id }} />
      : <p>Original source unavailable in this read.</p>} />}
    {work?.isError && <p role="status">Photographed work could not load. <button type="button" onClick={() => void work.refetch()}>Retry work</button></p>}
    {work?.limited && <p role="status">This view reached its work-record limit; it is not the complete work history.</p>}
    {vendors.length > 1 && <label className="vp-receipt-filter">Supplier <select value={selectedVendor} onChange={event => setVendor(event.target.value)}><option value="">All suppliers</option>{vendors.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
    {read.isLoading && <p role="status">Reading linked receipts…</p>}
    {read.isError && <p role="status">Receipt summaries could not load. <button type="button" onClick={() => void read.refetch()}>Retry receipts</button></p>}
    {!loading && <div key={`${vehicleId}:${user?.id ?? 'anon'}`} className="vp-receipt-grid">{visible.map(receipt => <ReceiptReplica key={receipt.id} vehicleId={vehicleId} receipt={receipt} />)}</div>}
    {!selectedVendor && matching.length > 6 && <button type="button" className="vp-receipt-browse" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'Show recent receipts' : 'Browse the receipt collection'}</button>}
    {read.hasNextPage && <button type="button" className="vp-financial-action" disabled={read.isFetchingNextPage} onClick={() => void read.fetchNextPage()}>{read.isFetchingNextPage ? 'Reading more receipts…' : 'Load more receipts'}</button>}
  </section>;
}

export function ReceiptRecords({ vehicleId, read, work }: { vehicleId: string; read: ReturnType<typeof useVehicleReceiptRecords>; work?: ReturnType<typeof useVisualWork> }) {
  const { user } = useAuthContext();
  return <ReceiptCollection key={`${vehicleId}:${user?.id ?? 'anon'}`} vehicleId={vehicleId} read={read} work={work} />;
}

export function ProfileReceiptRecords({ vehicleId }: { vehicleId: string }) {
  const read = useVehicleReceiptRecords(vehicleId);
  const work = useVisualWork(vehicleId);
  if (!read.isLoading && !read.isError && !read.rows.length && !work.isLoading && !work.isError && !work.rows.length) return null;
  return <ReceiptRecords vehicleId={vehicleId} read={read} work={work} />;
}

export function WorkOrderFinancialRecords({ vehicleId }: { vehicleId: string }) {
  const read = useVehicleWorkOrderFinancials(vehicleId);
  if (read.isLoading) return <p role="status">Reading work-order financials…</p>;
  if (read.isError) return <div role="status"><p>Work-order financial records could not load.</p><button type="button" className="vp-financial-action" onClick={() => void read.refetch()}>Retry work orders</button></div>;
  if (!read.data?.rows.length) return null;
  return <section><h3>Work orders and recorded payments</h3><p>{read.data.rows.length} of {read.data.total ?? 'an unknown number of'} visible work orders. These amounts remain separate from receipt and book subtotals.</p>
    {read.data.rows.map(order => <details key={order.id} className="vp-financial-entry"><summary><span><strong>{order.title || 'Work order'}</strong><small>{order.status?.replace(/_/g, ' ') || 'Status unknown'}</small></span></summary>
      <dl><dt>Parts and labor charges</dt><dd>{order.pricedEntries > 0 ? amountText(order.charges, order.currency) : 'No priced parts or labor visible in this read'}</dd>
        <dt>Completed payments</dt><dd>{order.paymentCount > 0 ? amountText(order.paid, order.currency) : 'No completed payment records visible in this read'}</dd>
        {order.pricedEntries > 0 && <><dt>Charges less visible payments</dt><dd>{amountText(order.remainder, order.currency)}</dd></>}
      </dl><p>The recorded remainder uses the visible charges and payment records. It does not establish that every payment or obligation has been reconciled.</p>
    </details>)}
  </section>;
}
