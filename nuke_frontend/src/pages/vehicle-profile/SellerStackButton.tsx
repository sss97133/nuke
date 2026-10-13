import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVehicleProfile } from './VehicleProfileContext';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { normalizePartyHandle } from './vehicleHeaderUtils';
import { summarizeSellerLots, usePopoverData } from './hooks/useVehicleHeaderData';

function SellerEvidenceView({ evidence, make, model }: { evidence: ReturnType<typeof summarizeSellerLots>; make?: string | null; model?: string | null }) {
  const e = evidence;
  return <div className="vp-seller-evidence">
    <dl>
      {e.resolved > 0 && <div><dt>Recorded sell-through</dt><dd><strong>{Math.round(e.sold / e.resolved * 100)}%</strong><small>{e.sold} sold / {e.resolved} resolved lots</small></dd></div>}
      {e.sameModel != null && <div><dt>Same model label</dt><dd><strong>{e.sameModel}</strong><small>of {e.n} retained lots · all years</small></dd></div>}
      <div><dt>Repeat vehicle listings</dt><dd><strong>{e.repeatLots}</strong></dd></div>
    </dl>
    <small>{e.n} keyed lots{e.capped ? ' · capped recent sample' : ''} · this vehicle excluded · {e.unresolved} unresolved outcomes</small>
    <small>Current {make} {model} labels. Seller price premium is unmeasured.</small>
    {e.rows.map((row: any) => <Link key={row.id} to={`/stacks/order-book/${row.vehicle_id}?lot=${row.id}`}>{new Date(row.auction_end_date).toLocaleDateString()} · {String(row.outcome || 'unknown').replace(/_/g, ' ')} →</Link>)}
  </div>;
}

/** The seller reader beside the live metrics. It lived inside the hidden legacy header until that header was removed. */
export function SellerStackButton() {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLDivElement>(null);
  const { popoverData, popoverLoading } = usePopoverData(open ? 'seller' : null, vehicle, auctionPulse);
  useEffect(() => setOpen(false), [vehicle?.id, auctionPulse?.listing_url]);
  const handle = normalizePartyHandle((auctionPulse as any)?.seller_username || (auctionPulse as any)?.metadata?.seller_username || (vehicle as any)?.bat_seller || (vehicle as any)?.origin_metadata?.bat_seller);
  if (!handle || !vehicle) return null;
  return <div ref={boundary} className="vp-live-seller">
    <button type="button" aria-label="Inspect seller stack" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>Seller · {handle} ▾</button>
    <HeaderPopover open={open} title="Seller stack" width={320} align="right" dismissBoundaryRef={boundary} onClose={() => setOpen(false)}>
      {popoverLoading ? <p>Reading keyed seller history…</p> : popoverData?.sellerEvidence ?
        <SellerEvidenceView evidence={popoverData.sellerEvidence} make={vehicle?.make} model={vehicle?.model} /> : <p>Seller history could not be resolved.</p>}
    </HeaderPopover>
  </div>;
}

export default SellerStackButton;
