import React from 'react';
import { openVehiclePhoto } from './VehiclePhotoLightbox';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import type { VisualWork } from './hooks/useVisualWork';
import { receiptSupplierLabel } from './receiptSupplierLabel';
import './visual-work.css';

const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function photoDate(image: VisualWork['images'][number]): string {
  const format = (timeZone: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric',
    timeZone, timeZoneName: 'short' }).format(new Date(image.taken_at));
  try { return format(image.capture_time_zone || 'UTC'); } catch { return format('UTC'); }
}
const amount = (value: number, currency: string | null) => {
  if (currency) try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value); } catch { /* Preserve the amount without guessing currency. */ }
  return `${value.toLocaleString('en-US')} · currency ${currency ? 'unrecognized' : 'unrecorded'}`;
};

export function VisualWorkCards({ rows, renderSource }: {
  rows: VisualWork[]; renderSource: (line: VisualWork['receipts'][number]) => React.ReactNode;
}) {
  if (!rows.length) return null;
  return <div className="vp-visual-work">{rows.map(work => {
    const documentedHours = work.receipts.filter(line => line.relation === 'documented_operation' && line.hours != null);
    const hours = documentedHours.reduce((sum, line) => sum + line.hours!, 0);
    return <article key={work.observation_id} aria-label={work.title}>
      <header><span>Photographed work</span><h4>{work.title}</h4><p>{work.summary}</p></header>
      {work.images.length > 1 && <p className="vp-work-swipe">Swipe through the work photos →</p>}
      <div className="vp-work-photos">{work.images.map(image => <button type="button" key={image.image_id}
        onClick={() => openVehiclePhoto(image.image_id)} aria-label={`Open ${image.role} photo: ${image.caption}`}>
        <img src={optimizeImageUrl(image.image_url, 'medium') || image.image_url} alt={image.caption} loading="lazy" />
        <span><strong>{image.role}</strong><time dateTime={image.taken_at} title={image.capture_time_basis || 'Source time shown in UTC; local zone unrecorded'}>{photoDate(image)}</time></span>
        <small>{image.caption}</small>
      </button>)}</div>
      <dl className="vp-work-lenses">
        <div><dt>Recorded time</dt><dd>{documentedHours.length ? `${hours} documented person-hours` : 'No person-hours in the cited operation lines'}</dd><small>{documentedHours.length ? 'Concurrent technician hours add; they are not elapsed time.' : 'The photo interval does not measure working time.'}</small></div>
        <div><dt>Inferred effort</dt><dd>{work.effort_reference ? `${work.effort_reference.hours_min}–${work.effort_reference.hours_max} reference hours` : 'No matched effort reference'}</dd><small>{work.effort_reference ? `${work.effort_reference.description}. Uncalibrated reference; not measured time.` : 'An estimate needs a matching scope and source.'}</small></div>
        <div><dt>Market value</dt><dd>{work.market_value?.status === 'not_established_by_cited_sources' ? 'Not established by these sources' : 'Not reconciled'}</dd><small>Reference hours alone do not establish a market price.</small></div>
        <div><dt>Paid value</dt><dd>Paid labor {work.paid_labor?.status === 'unreconciled' ? 'not reconciled' : 'not established by these sources'}</dd><small>Receipt charges below remain document amounts.</small></div>
      </dl>
      {work.receipts.length > 0 && <div className="vp-work-materials">{work.receipts.map(line => <div key={line.item_id}>
        <span>{line.relation === 'candidate_material' ? 'Candidate material · installation not established' : 'Work recorded on the document'}</span>
        <strong>{line.description || line.part_number || 'Receipt line'}</strong>
        <small>{[receiptSupplierLabel(line.vendor), line.part_number, line.quantity != null ? `Qty ${line.quantity}` : null, line.page_date ? date(line.page_date) : null].filter(Boolean).join(' · ')}</small>
        {line.amounts_visible ? line.amount != null && <b>{amount(line.amount, line.currency)} · line charge</b> : <small>Amount visible to owner & contributors</small>}
        {renderSource(line)}
      </div>)}</div>}
      {work.receipt_links_unavailable > 0 && <p className="vp-work-note">Some cited receipt lines are no longer available in this read.</p>}
      {work.gaps.length > 0 && <div className="vp-work-open"><strong>Still to reconcile</strong><ul>{work.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    </article>;
  })}</div>;
}
