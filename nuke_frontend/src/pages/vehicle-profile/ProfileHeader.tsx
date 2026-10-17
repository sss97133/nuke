import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { getVehicleTitle } from '../../hooks/usePageTitle';
import { Masthead, Strip, Facet, ClaimView, SourceView, Text, formatMeasure } from '../../kit';
import type { Claim } from '../../kit';
import { supabase } from '../../lib/supabase';
import { VehiclePerformance } from '../stacks/VehicleCohort';
import type { ProfileFacet } from '../stacks/bidPopulationReader';
import { useVehicleProfile } from './VehicleProfileContext';
import { isAuctionPresentation } from './buildAuctionPulse';
import { useProfileDocument } from './profileDocument';

type SaleLotProvenance = {
  sourceUrl?: string | null;
  lotNumber?: string | null;
  auctionName?: string | null;
  observedAt?: string | null;
  videoUrl?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
};

/**
 * The vehicle header through the kit: identity and the one headline price stay in view;
 * the strip of recorded facts scrolls with the page. Every fact is a claim with a source,
 * and the strip states how many of them are attributed. The document comes from one
 * viewer-scoped read (vehicle_profile_read); the viewer is whoever the database says it is.
 */
export default function ProfileHeader({ priceLotId }: { priceLotId?: string }) {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const priceOwnedByLiveStack = isAuctionPresentation(auctionPulse) && !!auctionPulse?.listing_url && ['active', 'live'].includes(auctionPulse.listing_status);
  const doc = useProfileDocument(vehicle?.id, priceOwnedByLiveStack);
  const sticky = useRef<HTMLDivElement>(null);
  const stripBoundary = useRef<HTMLDivElement>(null);
  const [activeFacet, setActiveFacet] = useState<ProfileFacet | null>(null);
  const [lotProvenance, setLotProvenance] = useState<SaleLotProvenance | null>(null);

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

  // Enrich the headline sale claim with lot number, auction event name, fallback source URL, and broadcast video timestamp when recorded.
  useEffect(() => {
    const vehicleId = vehicle?.id ? String(vehicle.id) : '';
    if (!vehicleId || typeof (supabase as any)?.from !== 'function') {
      setLotProvenance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [auctionRes, eventRes] = await Promise.all([
          Promise.resolve(
        supabase
          .from('auction_events')
          .select('lot_number, source_url, auction_end_date, auction_start_date, broadcast_video_url, broadcast_video_id, broadcast_timestamp_start, broadcast_timestamp_end')
          .eq('vehicle_id', vehicleId)
          .order('auction_end_date', { ascending: false, nullsFirst: false })
          .limit(1)
      ).catch(() => ({ data: null })),
      Promise.resolve(
        supabase
          .from('vehicle_events')
          .select('source_url, sold_at, ended_at, extracted_at, metadata')
          .eq('vehicle_id', vehicleId)
          .order('extracted_at', { ascending: false, nullsFirst: false })
          .limit(1)
      ).catch(() => ({ data: null })),
    ]);
    if (cancelled) return;
    const auctionRow = Array.isArray(auctionRes?.data) ? (auctionRes.data[0] as any) : null;
    const eventRow = Array.isArray(eventRes?.data) ? (eventRes.data[0] as any) : null;
    const meta = (eventRow?.metadata && typeof eventRow.metadata === 'object' ? eventRow.metadata : {}) as Record<string, any>;
    setLotProvenance({
      sourceUrl: auctionRow?.source_url || eventRow?.source_url || null,
      lotNumber: auctionRow?.lot_number || meta.lot_number || null,
      auctionName: meta.auction_name || meta.event_name || null,
      observedAt: auctionRow?.auction_end_date || auctionRow?.auction_start_date || eventRow?.sold_at || eventRow?.ended_at || eventRow?.extracted_at || null,
      videoUrl: auctionRow?.broadcast_video_url || auctionRow?.broadcast_video_id || meta.video_url || null,
      startSeconds: typeof auctionRow?.broadcast_timestamp_start === 'number' ? auctionRow.broadcast_timestamp_start : null,
      endSeconds: typeof auctionRow?.broadcast_timestamp_end === 'number' ? auctionRow.broadcast_timestamp_end : null,
    });
      } catch {
        // Provenance enrichment is additive; never block the header.
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle?.id]);

  const masthead = doc?.sections.find(s => s.kind === 'masthead');
  const strip = doc?.sections.find(s => s.kind === 'strip');
  const title = vehicle ? getVehicleTitle(vehicle) : '';
  const classified = masthead?.price?.unit === '';

  const enrichedPriceClaim: Claim<number> | null = useMemo(() => {
    if (!masthead?.price || !vehicle) return null;
    const base = masthead.price;
    const vAny = vehicle as Record<string, any>;
    const pAny = (auctionPulse ?? {}) as Record<string, any>;
    const fallbackUrl =
      base.source.url ||
      vAny.listing_url ||
      vAny.discovery_url ||
      vAny.bat_auction_url ||
      vAny.platform_url ||
      pAny.listing_url ||
      lotProvenance?.sourceUrl ||
      null;
    const lotNumber =
      base.source.lotNumber ||
      pAny.lot_number ||
      vAny.lot_number ||
      lotProvenance?.lotNumber ||
      null;
    const auctionName =
      base.source.auctionName ||
      lotProvenance?.auctionName ||
      null;
    const observedAt =
      base.observed_at ||
      (typeof vAny.sale_date === 'string' ? vAny.sale_date : null) ||
      lotProvenance?.observedAt ||
      null;
    const priceText = classified
      ? Number(base.value).toLocaleString('en-US')
      : formatMeasure(Number(base.value), 'USD');
    const sourceLabel = base.source.label ?? 'Auction';
    const searchQuery = [
      sourceLabel,
      auctionName,
      lotNumber ? `Lot ${lotNumber}` : null,
      title,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      ...base,
      observed_at: observedAt,
      source: {
        ...base.source,
        url: fallbackUrl,
        lotNumber,
        auctionName,
        video: base.source.video ?? {
          url: lotProvenance?.videoUrl ?? null,
          startSeconds: lotProvenance?.startSeconds ?? null,
          endSeconds: lotProvenance?.endSeconds ?? null,
          lotNumber,
          auctionName,
          title,
          priceText,
          imageUrl: typeof vAny.primary_image_url === 'string' ? vAny.primary_image_url : null,
          lotUrl: fallbackUrl,
          searchQuery,
        },
      },
    };
  }, [masthead?.price, vehicle, auctionPulse, lotProvenance, classified, title]);

  if (!vehicle || !doc || !masthead) return null;
  const asArtwork = !!masthead.model && vehicle.listing_kind !== 'non_vehicle_item';
  const selected = strip?.facets.find(f => f.dimension === activeFacet) ?? null;

  return <>
    <div ref={sticky} className="vp-header-sticky">
      <Masthead result={enrichedPriceClaim && <ClaimView
        label={masthead.priceLabel ?? 'Recorded price'}
        role="measure"
        claim={enrichedPriceClaim}
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
