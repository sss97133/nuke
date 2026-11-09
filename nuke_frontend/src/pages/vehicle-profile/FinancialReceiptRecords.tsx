import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { signPrivateStorageUrl, privateStoragePath } from '../../lib/privateStorage';
import { bounded } from '../../services/accountingCloseout';
import { useVehicleWorkOrderFinancials, type VehicleReceiptRecord, type useVehicleReceiptRecords } from './hooks/useBuildLedger';
import type { FieldProvenance } from './hooks/useFieldProvenance';
import type { DayDocument } from './VehicleDayDrawer';
const OriginalDocumentPreview = React.lazy(() => import('../../components/finance/SharedAccountingOriginal').then(module => ({ default: module.OriginalDocumentPreview })));

function amountText(amount: number | null, currency: string | null): string {
  if (amount == null) return 'Amount not recorded';
  return currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    : `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} · currency unrecorded`;
}

function ReceiptSource({ receipt, vehicleId }: { receipt: Pick<VehicleReceiptRecord, 'sourceId' | 'sourceTable'>; vehicleId: string }) {
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
      <header><h3>{doc.vendor || doc.vendor_org?.name || 'Receipt'}{doc.document_number ? ` #${doc.document_number}` : ''}</h3>
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
      <ReceiptSource key={`${viewer}:${vehicleId}:${citation.source_table}:${citation.document_id}`} vehicleId={vehicleId}
        receipt={{ sourceId: citation.document_id, sourceTable: citation.source_table }} />
    </>}
  </article>;
}

export function ReceiptRecords({ vehicleId, read }: { vehicleId: string; read: ReturnType<typeof useVehicleReceiptRecords> }) {
  return <section aria-label="Linked receipts"><h3>Build receipts</h3>
    {read.isLoading && <p role="status">Reading linked receipts…</p>}
    {read.isError && <div role="status"><p>Receipt summaries could not load.</p><button type="button" className="vp-financial-action" onClick={() => void read.refetch()}>Retry receipts</button></div>}
    {(read.rows.length > 0 || read.total != null) && <p>{read.total == null ? `${read.rows.length} linked receipt records loaded. Total not yet read.` : `${read.rows.length} of ${read.total} linked receipt records loaded.`} Receipt readings and work-order charges can describe the same purchase; they are kept separate.</p>}
    {read.rows.map(receipt => <details key={receipt.id} className="vp-financial-entry">
      <summary><span><strong>{receipt.vendor || 'Linked receipt'}</strong><small>{receipt.dateConflict ? 'Date readings differ' : receipt.date || 'Date not recorded'}</small></span>
        <strong>{receipt.amountsHidden ? "Amount visible to the vehicle's people" : receipt.amountConflict ? 'Total readings differ' : amountText(receipt.amount, receipt.currency)}</strong></summary>
      {receipt.amountConflict && <p>Recorded totals disagree: {amountText(receipt.total, receipt.currency)} and {amountText(receipt.totalAmount, receipt.currency)}. No single amount is selected.</p>}
      {receipt.dateConflict && <p>Recorded dates: {receipt.dates.join(' · ')}</p>}
      {receipt.amountsHidden && <p>Receipt totals are shown to the vehicle's owner and contributors. The vendor, date and line items stay public.</p>}
      {receipt.amount === 0 && <p>Zero is retained as an extraction reading. Check the original before treating it as a zero-cost purchase.</p>}
      <p>Receipt reading · {receipt.processingStatus || receipt.status || 'Extraction state unknown'}. Extraction status does not establish payment or vehicle allocation.</p>
      <ReceiptSource key={`${vehicleId}:${receipt.sourceTable}:${receipt.sourceId}`} receipt={receipt} vehicleId={vehicleId} />
    </details>)}
    {read.hasNextPage && <button type="button" className="vp-financial-action" disabled={read.isFetchingNextPage} onClick={() => void read.fetchNextPage()}>{read.isFetchingNextPage ? 'Reading more receipts…' : 'Load more receipts'}</button>}
    {!read.isLoading && !read.isError && !read.rows.length && <p>No receipt summaries are visible for this vehicle.</p>}
  </section>;
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
