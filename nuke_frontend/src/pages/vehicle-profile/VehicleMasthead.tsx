import React, { useLayoutEffect, useRef, useState } from 'react';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { getVehicleIdentityTokens } from '../../utils/vehicleIdentity';
import { getVehicleTitle } from '../../hooks/usePageTitle';
import { useVehicleProfile } from './VehicleProfileContext';
import { useVehiclePriceFacts, priceKindLabel } from './hooks/useVehiclePriceFacts';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { isAuctionPresentation, isClassifiedPresentation } from './buildAuctionPulse';

/** Period identity artwork is resolved by the shared, sourced year/make/model catalogue. */
export default function VehicleMasthead({ priceLotId }: { priceLotId?: string }) {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const { priceFacts } = useVehiclePriceFacts(vehicle?.id);
  const [showPriceSources, setShowPriceSources] = useState(false);
  const priceBoundary = useRef<HTMLDivElement>(null);
  const mastheadRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const masthead = mastheadRef.current;
    const page = masthead?.closest<HTMLElement>('.vehicle-profile-page');
    if (!masthead || !page) return;
    const update = () => page.style.setProperty('--vp-h-masthead', `${masthead.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(masthead);
    return () => {
      observer.disconnect();
      page.style.removeProperty('--vp-h-masthead');
    };
  }, [vehicle?.id]);
  if (!vehicle) return null;
  const priceOwnedByLiveStack = isAuctionPresentation(auctionPulse) && !!auctionPulse?.listing_url && ['active', 'live'].includes(auctionPulse.listing_status);
  const classifiedPrice = isClassifiedPresentation(priceFacts);
  const tokens = getVehicleIdentityTokens(vehicle, { transmissionStrategy: 'never' });
  const model = tokens.primary.find(token => token.kind === 'model')?.value;
  if (!model || (vehicle as any).listing_kind === 'non_vehicle_item') {
    return <header ref={mastheadRef} className="vp-masthead"><h1 className="vp-masthead__fallback">{getVehicleTitle(vehicle)}</h1></header>;
  }
  return <header ref={mastheadRef} className="vp-masthead">
    <h1 className="vp-masthead__identity" aria-label={getVehicleTitle(vehicle)}>
      <VehicleIdentity year={vehicle.year} make={vehicle.make ?? ''} model={model} variants={tokens.differentiators} />
    </h1>
    {!priceOwnedByLiveStack && priceFacts?.price_amount != null && priceKindLabel(priceFacts) && <div ref={priceBoundary} className="vp-masthead__result">
      <span>{priceFacts.price_kind === 'sold' ? 'Last recorded sale' : priceKindLabel(priceFacts)}</span>
      <button type="button" onClick={() => setShowPriceSources(open => !open)} aria-label="Inspect recorded price sources" aria-haspopup="dialog" aria-expanded={showPriceSources}><strong>{classifiedPrice ? '' : '$'}{Math.round(priceFacts.price_amount).toLocaleString('en-US')}</strong></button>
      {classifiedPrice && <small>Currency unrecorded</small>}
    {showPriceSources && priceFacts && <HeaderPopover open title="Price source" width={300} align="right"
      dismissBoundaryRef={priceBoundary} onClose={() => setShowPriceSources(false)}>
      <div className="vp-price-source">
        <p>Price as of {priceFacts.price_as_of && Number.isFinite(Date.parse(priceFacts.price_as_of))
          ? new Date(priceFacts.price_as_of).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', timeZone:'UTC' }) : 'unknown date'}</p>
        {priceFacts.source_url && /^https?:\/\//i.test(priceFacts.source_url) && <a href={priceFacts.source_url} target="_blank" rel="noreferrer">{priceFacts.platform?.toUpperCase() || 'Source page'} ↗</a>}
        {priceLotId && <Link to={`/stacks/order-book/${vehicle.id}?lot=${priceLotId}`}>Open auction stack →</Link>}
        <small>Current recorded price · source freshness not established by this reader</small>
      </div>
    </HeaderPopover>}
    </div>}
  </header>;
}
