import React, { useRef, useState } from 'react';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { getVehicleIdentityTokens } from '../../utils/vehicleIdentity';
import { getVehicleTitle } from '../../hooks/usePageTitle';
import { useVehicleProfile } from './VehicleProfileContext';
import { useVehiclePriceFacts, priceKindLabel } from './hooks/useVehiclePriceFacts';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { PrefetchLink as Link } from '../../components/PrefetchLink';

/** Period identity artwork is resolved by the shared, sourced year/make/model catalogue. */
export default function VehicleMasthead({ priceLotId }: { priceLotId?: string }) {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const { priceFacts } = useVehiclePriceFacts(vehicle?.id);
  const [showPriceSources, setShowPriceSources] = useState(false);
  const priceBoundary = useRef<HTMLDivElement>(null);
  if (!vehicle) return null;
  const priceOwnedByLiveStack = !!auctionPulse?.listing_url && ['active', 'live'].includes(auctionPulse.listing_status);
  const tokens = getVehicleIdentityTokens(vehicle, { transmissionStrategy: 'never' });
  const model = tokens.primary.find(token => token.kind === 'model')?.value;
  if (!model || (vehicle as any).listing_kind === 'non_vehicle_item') {
    return <h1 className="vp-masthead__fallback">{getVehicleTitle(vehicle)}</h1>;
  }
  return <><header className="vp-masthead">
    <h1 className="vp-masthead__identity" aria-label={getVehicleTitle(vehicle)}>
      <VehicleIdentity year={vehicle.year} make={vehicle.make ?? ''} model={model}>
      {tokens.differentiators.map(token => <span key={token.kind} className="vp-masthead__variant">{token.value}</span>)}
      </VehicleIdentity>
    </h1>
    {!priceOwnedByLiveStack && priceFacts?.price_amount != null && priceKindLabel(priceFacts) && <div ref={priceBoundary} className="vp-masthead__result">
      <span>{priceFacts.price_kind === 'sold' ? 'Last recorded sale' : priceKindLabel(priceFacts)}</span>
      <button type="button" onClick={() => setShowPriceSources(open => !open)} aria-label="Inspect recorded price sources" aria-haspopup="dialog" aria-expanded={showPriceSources}><strong>${Math.round(priceFacts.price_amount).toLocaleString('en-US')}</strong></button>
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
  </header></>;
}
