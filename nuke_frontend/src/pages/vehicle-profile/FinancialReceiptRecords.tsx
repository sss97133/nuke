import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { signPrivateStorageUrl, privateStoragePath } from '../../lib/privateStorage';
import { openVehiclePhotoByUrl } from './VehiclePhotoLightbox';
import { useVehicleWorkOrderFinancials, type VehicleReceiptRecord, type useVehicleReceiptRecords } from './hooks/useBuildLedger';

function amountText(amount: number | null, currency: string | null): string {
  if (amount == null) return 'Amount not recorded';
  return currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
    : `${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} · currency unrecorded`;
}

function ReceiptSource({ receipt, vehicleId }: { receipt: VehicleReceiptRecord; vehicleId: string }) {
  const [state, setState] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!receipt.sourceId || !['vehicle_documents', 'vehicle_images'].includes(receipt.sourceTable ?? '')) return <p>Original source access is not available in this view.</p>;
  return <div className="vp-financial-original">
    <button type="button" disabled={state === 'Reading source…'} onClick={async () => {
      setState('Reading source…');
      try {
        const image = receipt.sourceTable === 'vehicle_images';
        const { data, error } = await supabase.from(image ? 'vehicle_images_public' : 'vehicle_documents')
          .select(image ? 'image_url' : 'file_url').eq('id', receipt.sourceId!).eq('vehicle_id', vehicleId).maybeSingle();
        const raw = data && (image ? (data as { image_url?: string }).image_url : (data as { file_url?: string }).file_url);
        if (error || !raw || !/^https?:\/\//.test(raw)) throw new Error('Unavailable');
        const signed = await signPrivateStorageUrl(raw);
        if (privateStoragePath(raw) && signed === raw) throw new Error('Unavailable');
        if (!alive.current) return;
        if (image) openVehiclePhotoByUrl(signed); else setUrl(signed);
        setState('');
      } catch { if (alive.current) setState('Source unavailable or not visible to this viewer.'); }
    }}>{state === 'Reading source…' ? state : 'Read original source'}</button>
    {url && <a href={url} target="_blank" rel="noopener noreferrer">Open original document ↗</a>}
    {state && state !== 'Reading source…' && <p role="status">{state}</p>}
  </div>;
}

export function ReceiptRecords({ vehicleId, read }: { vehicleId: string; read: ReturnType<typeof useVehicleReceiptRecords> }) {
  return <section aria-label="Linked receipts"><h3>Build receipts</h3>
    {read.isLoading && <p role="status">Reading linked receipts…</p>}
    {read.isError && <div role="status"><p>Receipt summaries could not load.</p><button type="button" className="vp-financial-action" onClick={() => void read.refetch()}>Retry receipts</button></div>}
    {(read.rows.length > 0 || read.total != null) && <p>{read.rows.length} of {read.total ?? 'an unknown number of'} linked receipt records loaded. Receipt readings and work-order charges can describe the same purchase; they are kept separate.</p>}
    {read.rows.map(receipt => <details key={receipt.id} className="vp-financial-entry">
      <summary><span><strong>{receipt.vendor || 'Linked receipt'}</strong><small>{receipt.dateConflict ? 'Date readings differ' : receipt.date || 'Date not recorded'}</small></span>
        <strong>{receipt.amountConflict ? 'Total readings differ' : amountText(receipt.amount, receipt.currency)}</strong></summary>
      {receipt.amountConflict && <p>Recorded totals disagree: {amountText(receipt.total, receipt.currency)} and {amountText(receipt.totalAmount, receipt.currency)}. No single amount is selected.</p>}
      {receipt.dateConflict && <p>Recorded dates: {receipt.dates.join(' · ')}</p>}
      {receipt.amount === 0 && <p>Zero is retained as an extraction reading. Check the original before treating it as a zero-cost purchase.</p>}
      <p>Receipt reading · {receipt.processingStatus || receipt.status || 'Extraction state unknown'}. Extraction status does not establish payment or vehicle allocation.</p>
      <ReceiptSource receipt={receipt} vehicleId={vehicleId} />
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
