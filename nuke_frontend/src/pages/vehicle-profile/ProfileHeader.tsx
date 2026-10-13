import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { getVehicleTitle } from '../../hooks/usePageTitle';
import { Masthead, Strip, Facet, ClaimView, SourceView, Text, formatMeasure } from '../../kit';
import { VehiclePerformance } from '../stacks/VehicleCohort';
import type { ProfileFacet } from '../stacks/bidPopulationReader';
import { useVehicleProfile } from './VehicleProfileContext';
import { useVehiclePriceFacts } from './hooks/useVehiclePriceFacts';
import { isAuctionPresentation } from './buildAuctionPulse';
import { useProfileDocument } from './profileDocument';

/**
 * The vehicle header through the kit: identity and the one headline price stay in view;
 * the strip of recorded facts scrolls with the page. Every fact is a claim with a source,
 * and the strip states how many of them are attributed.
 */
export default function ProfileHeader({ priceLotId }: { priceLotId?: string }) {
  const { vehicle, auctionPulse, isRowOwner, isVerifiedOwner, hasContributorAccess } = useVehicleProfile();
  const { priceFacts } = useVehiclePriceFacts(vehicle?.id);
  const viewer = isRowOwner || isVerifiedOwner ? 'owner' : hasContributorAccess ? 'contributor' : 'anon';
  const priceOwnedByLiveStack = isAuctionPresentation(auctionPulse) && !!auctionPulse?.listing_url && ['active', 'live'].includes(auctionPulse.listing_status);
  const doc = useProfileDocument(vehicle, priceFacts, priceOwnedByLiveStack, viewer);
  const sticky = useRef<HTMLDivElement>(null);
  const stripBoundary = useRef<HTMLDivElement>(null);
  const [activeFacet, setActiveFacet] = useState<ProfileFacet | null>(null);

  // The sticky stack below reads the masthead's measured height (vehicle-profile.css --vp-h-masthead).
  useLayoutEffect(() => {
    const el = sticky.current;
    const page = el?.closest<HTMLElement>('.vehicle-profile-page');
    if (!el || !page) return;
    const update = () => page.style.setProperty('--vp-h-masthead', `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); page.style.removeProperty('--vp-h-masthead'); };
  }, [vehicle?.id]);
  useEffect(() => setActiveFacet(null), [vehicle?.id]);

  if (!vehicle || !doc) return null;
  const masthead = doc.sections.find(s => s.kind === 'masthead');
  const strip = doc.sections.find(s => s.kind === 'strip');
  if (!masthead) return null;
  const title = getVehicleTitle(vehicle);
  const asArtwork = !!masthead.model && vehicle.listing_kind !== 'non_vehicle_item';
  const classified = masthead.price?.unit === '';
  const selected = strip?.facets.find(f => f.dimension === activeFacet) ?? null;

  return <>
    <div ref={sticky} className="vp-header-sticky">
      <Masthead result={masthead.price && <ClaimView
        label={masthead.priceLabel ?? 'Recorded price'}
        role="measure"
        claim={masthead.price}
        format={value => classified ? Number(value).toLocaleString('en-US') : formatMeasure(Number(value), 'USD')}
        extra={priceLotId ? <PrefetchLink className="k-body" to={`/stacks/order-book/${vehicle.id}?lot=${priceLotId}`}>Open auction stack →</PrefetchLink> : null}
      />}>
        <Text role="entity" as="h1" aria-label={title}>
          {asArtwork
            ? <VehicleIdentity year={vehicle.year} make={vehicle.make ?? ''} model={masthead.model!} variants={masthead.identity.differentiators} />
            : title}
        </Text>
      </Masthead>
    </div>
    {strip && <div ref={stripBoundary} className="vp-strip">
      <Strip coverage={strip.coverage} ariaLabel="Recorded configuration">
        {strip.odometer && <ClaimView label="Odometer" role="label" claim={strip.odometer} format={value => `${Number(value).toLocaleString('en-US')} mi`} />}
        {strip.facets.map(f => <Facet key={f.dimension} label={f.label} expanded={activeFacet === f.dimension}
          ariaLabel={`${f.label} performance stack`}
          onClick={() => setActiveFacet(current => current === f.dimension ? null : f.dimension)} />)}
      </Strip>
      {selected && <HeaderPopover open onClose={() => setActiveFacet(null)} title={selected.label} width={360} dismissBoundaryRef={stripBoundary}>
        <SourceView claim={selected.member} />
        <VehiclePerformance key={`${vehicle.id}:${selected.dimension}`} vehicleId={vehicle.id}
          facet={{ dimension: selected.dimension as ProfileFacet, value: String(selected.member.value), label: selected.label }} />
      </HeaderPopover>}
    </div>}
  </>;
}
