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
  lotNumber?: string | null;
  auctionName?: string | null;
  videoUrl?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
};

type LotProvenanceRead = {
  vehicleId: string;
  lotKey: string;
  readAt: string;
  status: 'matched' | 'unmatched' | 'failed';
  provenance: SaleLotProvenance | null;
};

/** Normalize a listing/lot URL into a comparable lot key so multi-event vehicles match the right sale episode. */
export function comparableLotKey(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const mecumMatch = host === 'mecum.com' ? parsed.pathname.match(/^\/lots\/([^/]+)/i) : null;
  if (mecumMatch?.[1]) {
    const seg = mecumMatch[1].toLowerCase().replace(/^[a-z]{2}\d{2}-(?=\d)/, '');
    return `mecum:${seg}`;
  }
  return host + parsed.pathname.replace(/\/+$/, '') + parsed.search;
}

/** Extract lot number and auction event name from vehicle metadata or enriched description text. */
export function extractInlineLotProvenance(vehicle: Record<string, any> | null | undefined): {
  lotNumber: string | null;
  auctionName: string | null;
} {
  if (!vehicle || typeof vehicle !== 'object') return { lotNumber: null, auctionName: null };
  const prov = vehicle.provenance_metadata && typeof vehicle.provenance_metadata === 'object'
    ? (vehicle.provenance_metadata as Record<string, any>)
    : {};
  const imp = vehicle.import_metadata && typeof vehicle.import_metadata === 'object'
    ? (vehicle.import_metadata as Record<string, any>)
    : {};

  let lotNumber: string | null =
    prov.mec_lot_number ||
    prov.lot_number ||
    imp.lot_number ||
    imp.mec_lot_number ||
    vehicle.bat_lot_number ||
    null;
  let auctionName: string | null =
    prov.mec_auction_name ||
    prov.auction_name ||
    imp.auction_name ||
    imp.event_name ||
    null;

  if (!lotNumber || !auctionName) {
    const textBlob = [vehicle.description, vehicle.notes]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join('\n');
    const mecumMatch = textBlob.match(/Offered at Mecum\s+([^.(]+?)(?:\s*\(Lot\s+([^)]+)\))?\./i);
    if (mecumMatch) {
      if (!auctionName && mecumMatch[1]) auctionName = mecumMatch[1].trim();
      if (!lotNumber && mecumMatch[2]) lotNumber = mecumMatch[2].trim();
    }
  }

  return {
    lotNumber: lotNumber ? String(lotNumber).trim() : null,
    auctionName: auctionName ? String(auctionName).trim() : null,
  };
}

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
  const [lotRead, setLotRead] = useState<LotProvenanceRead | null>(null);

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

  const masthead = doc?.sections.find(s => s.kind === 'masthead');
  const strip = doc?.sections.find(s => s.kind === 'strip');
  const title = vehicle ? getVehicleTitle(vehicle) : '';
  const classified = masthead?.price?.unit === '';

  const targetLotKey = comparableLotKey(masthead?.price?.source?.url);
  const readAt = doc?.read_at ?? '';
  const currentLotRead = lotRead?.vehicleId === vehicle?.id && lotRead?.lotKey === targetLotKey && lotRead?.readAt === readAt ? lotRead : null;
  const lotProvenance = currentLotRead?.provenance ?? null;
  const provenanceNote = !targetLotKey ? 'Headline source URL unavailable for lot matching; additional lot provenance unlinked.'
    : !currentLotRead ? 'Additional lot provenance pending.'
      : currentLotRead.status === 'failed' ? 'Additional lot provenance unavailable.'
        : currentLotRead.status === 'unmatched' ? 'No additional matching lot provenance in this read.' : null;

  // Supplement only the canonical price's addressed source, within this subject/read.
  // Event, sale and ingest clocks never fill the price owner's observation clock.
  useEffect(() => {
    const vehicleId = vehicle?.id ? String(vehicle.id) : '';
    if (!vehicleId || !targetLotKey) return;
    let cancelled = false;
    (async () => {
      try {
        const [auctionRes, eventRes] = await Promise.all([
          Promise.resolve(
        supabase
          .from('auction_events')
          .select('lot_number, source_url, broadcast_video_url, broadcast_video_id, broadcast_timestamp_start, broadcast_timestamp_end')
          .eq('vehicle_id', vehicleId)
          .order('auction_end_date', { ascending: false, nullsFirst: false })
          .limit(10)
      ).catch(() => ({ data: null, error: true })),
      Promise.resolve(
        supabase
          .from('vehicle_events')
          .select('source_url, metadata')
          .eq('vehicle_id', vehicleId)
          .order('extracted_at', { ascending: false, nullsFirst: false })
          .limit(10)
      ).catch(() => ({ data: null, error: true })),
    ]);
    if (cancelled) return;
    const pickMatchingRow = (rows: any[] | null | undefined): any => {
      if (!Array.isArray(rows) || rows.length === 0) return null;
      return rows.find((r) => comparableLotKey(r?.source_url) === targetLotKey) ?? null;
    };
    const failed = !!auctionRes?.error || !!eventRes?.error || !Array.isArray(auctionRes?.data) || !Array.isArray(eventRes?.data);
    const auctionRow = auctionRes?.error ? null : pickMatchingRow(auctionRes?.data as any[] | null);
    const eventRow = eventRes?.error ? null : pickMatchingRow(eventRes?.data as any[] | null);
    const meta = (eventRow?.metadata && typeof eventRow.metadata === 'object' ? eventRow.metadata : {}) as Record<string, any>;
    setLotRead({ vehicleId, lotKey: targetLotKey, readAt, status: failed ? 'failed' : auctionRow || eventRow ? 'matched' : 'unmatched', provenance: {
      lotNumber: auctionRow?.lot_number || meta.lot_number || null,
      auctionName: meta.auction_name || meta.event_name || null,
      videoUrl: auctionRow?.broadcast_video_url || auctionRow?.broadcast_video_id || meta.video_url || null,
      startSeconds: typeof auctionRow?.broadcast_timestamp_start === 'number' ? auctionRow.broadcast_timestamp_start : null,
      endSeconds: typeof auctionRow?.broadcast_timestamp_end === 'number' ? auctionRow.broadcast_timestamp_end : null,
    } });
      } catch {
        if (!cancelled) setLotRead({ vehicleId, lotKey: targetLotKey, readAt, status: 'failed', provenance: null });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle?.id, targetLotKey, readAt]);

  const enrichedPriceClaim: Claim<number> | null = useMemo(() => {
    if (!masthead?.price || !vehicle) return null;
    const base = masthead.price;
    const vAny = vehicle as Record<string, any>;
    const pAny = (auctionPulse ?? {}) as Record<string, any>;
    // The existing Mecum writer stores its native web ID beside these metadata fields.
    // Free description mentions and other vehicle URLs do not bind a price episode.
    const boundInline = [vAny.provenance_metadata, vAny.import_metadata].find(meta =>
      meta && targetLotKey?.startsWith('mecum:') && `mecum:${meta.mec_web_id}` === targetLotKey);
    const inlineProv = extractInlineLotProvenance(boundInline ? { provenance_metadata: boundInline } : null);
    const fallbackUrl = base.source.url ?? null;
    const pulseLot = targetLotKey && comparableLotKey(pAny.listing_url) === targetLotKey ? pAny.lot_number : null;
    const lotNumber =
      base.source.lotNumber ||
      pulseLot ||
      lotProvenance?.lotNumber ||
      inlineProv.lotNumber ||
      null;
    const auctionName =
      base.source.auctionName ||
      lotProvenance?.auctionName ||
      inlineProv.auctionName ||
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
  }, [masthead?.price, vehicle, auctionPulse, lotProvenance, classified, title, targetLotKey]);

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
        extra={<>
          {provenanceNote && <Text role="caption">{provenanceNote}</Text>}
          {priceLotId && <PrefetchLink className="k-body" to={`/stacks/order-book/${vehicle.id}?lot=${priceLotId}`}>Open auction stack →</PrefetchLink>}
        </>}
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
