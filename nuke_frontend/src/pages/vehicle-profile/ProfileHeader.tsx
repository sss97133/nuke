import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import ProfileIdentity from './ProfileIdentity';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import { getVehicleTitle } from '../../hooks/usePageTitle';
import { Masthead, Facet, ClaimView, Text, Rows, Row, formatMeasure, day } from '../../kit';
import { resolveSourceLogo } from '../../kit/Claim';
import type { Claim, ListingState } from '../../kit';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';
import { isAuctionPresentation } from './buildAuctionPulse';
import { useProfileDocument } from './profileDocument';
import ProfileFinancials from './ProfileFinancials';
import ProfileActivity from './ProfileActivity';
import { useContributionDays } from './useContributionDays';
import { useAuctionCommentStats } from '../../hooks/useAuctionComments';
import type { AuctionPulse } from './types';

const LISTING_VENUES: Record<string, string> = { bat: 'Bring a Trailer', ebay: 'eBay', carsandbids: 'Cars & Bids', hemmings: 'Hemmings', hagerty: 'Hagerty', carscom: 'Cars.com', autotrader: 'Autotrader', craigslist: 'Craigslist', facebook: 'Facebook Marketplace', nzero: 'Nuke' };

/** One line for the masthead: where the car is listed and what the listing waits on, as the read serves it. */
export function describeListing(listing: ListingState): string {
  const venue = LISTING_VENUES[listing.platform] ?? listing.platform;
  switch (listing.status) {
    case 'active': return `Live on ${venue}${listing.activated_at ? ` since ${day(listing.activated_at)}` : ''}`;
    case 'sold': return `Sold on ${venue}`;
    case 'expired': return `${venue}: auction ended without a sale`;
    case 'prepared': return `${venue}: listing prepared, not submitted`;
    case 'submitted':
      switch (listing.stage) {
        case 'draft_pending_approval': return `${venue}: draft pending the seller's approval since ${day(listing.stage_since)}`;
        case 'accepted': return `${venue}: accepted ${day(listing.stage_since)}, listing in preparation`;
        case 'scheduled': return `${venue}: approved, awaiting a start date`;
        default: return `${venue}: submitted ${day(listing.submitted_at)}`;
      }
    default: return `${venue}: ${listing.status}`;
  }
}

/** The masthead's one word for the listing's stage; the full sentence stays on the line's label. */
export function listingWord(listing: ListingState): string {
  switch (listing.status) {
    case 'active': return 'Live';
    case 'sold': return 'Sold';
    case 'expired': return 'No sale';
    case 'prepared': return 'Prepared';
    case 'submitted':
      switch (listing.stage) {
        case 'draft_pending_approval': return 'Pending';
        case 'accepted': return 'Accepted';
        case 'scheduled': return 'Scheduled';
        default: return 'Submitted';
      }
    default: return String(listing.status).replace(/^./, c => c.toUpperCase());
  }
}

const HeaderTokenItems = React.lazy(() => import('./HeaderTokenItems'));
/** The tokens vehicle_facet_items reads (docs/market/VEHICLE_HEADER_FORM_RULES.md, "Facet items"). */
const TOKEN_DIMENSIONS = new Set(['year', 'make', 'model', 'body_style', 'trim', 'engine', 'transmission', 'drivetrain', 'location']);
const ExternalAuctionSummary = React.lazy(() => import('../../components/auction/ExternalAuctionLiveBanner').then(module => ({ default: module.ExternalAuctionSummary })));
const ExternalAuctionLiveBanner = React.lazy(() => import('../../components/auction/ExternalAuctionLiveBanner'));
const SellerStackButton = React.lazy(() => import('./SellerStackButton'));

function HeaderLiveAuction({ vehicleId, pulse, currency }: { vehicleId: string; pulse: AuctionPulse; currency: string | null }) {
  const { data: comments } = useAuctionCommentStats(vehicleId, pulse.listing_url);
  return <React.Suspense fallback={<p role="status">Reading live auction…</p>}><ExternalAuctionLiveBanner vehicleId={vehicleId}
    sellerStack={<React.Suspense fallback={null}><SellerStackButton /></React.Suspense>}
    externalListingId={pulse.external_listing_id || null} platform={pulse.platform} listingUrl={pulse.listing_url}
    currentBid={pulse.current_bid} bidCount={pulse.bid_count} watcherCount={pulse.watcher_count} commentCount={comments?.commentCount ?? null}
    endDate={pulse.end_date} listingStatus={pulse.listing_status} lastUpdatedAt={pulse.source_observed_at ?? null} currencyCode={currency} /></React.Suspense>;
}

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
  candidates: SaleLotProvenance[];
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
  const mecumMatch = host === 'mecum.com' ? parsed.pathname.match(/^\/lots\/(?:[A-Za-z]{2}\d{2}-)?(\d+)(?:\/|$)/) : null;
  if (mecumMatch?.[1]) {
    return `mecum:${mecumMatch[1]}${parsed.search}${parsed.hash}`;
  }
  return host + parsed.pathname.replace(/\/+$/, '') + parsed.search + parsed.hash;
}

const BROADCAST_SOURCE_ID = 'e980c7bd-404f-41f6-8a17-1c7cabd1d8a4';

/** Keep only presentations explicitly bound to the cited source episode. Recording consensus is handled
 * with the other exact-source candidates below; screen outcome never chooses the canonical price's clip.
 * Offsets are recording positions, never auction wall time or evidence of the cited price. */
export function pickLotPresentations(rows: any[] | null | undefined, vehicleId: string, lotNumber: string | null,
  episodeKeys: ReadonlySet<string>): { videoUrl: string; startSeconds: number; endSeconds: number | null }[] {
  const lot = String(lotNumber ?? '').trim().toUpperCase();
  if (!lot || !Array.isArray(rows)) return [];
  return rows.filter(r => r?.vehicle_id === vehicleId
    && String(r?.structured_data?.value?.lot ?? '').trim().toUpperCase() === lot
    && r?.structured_data?.event_context?.resolution_status === 'scoped_event_match'
    && episodeKeys.has(`${r?.structured_data?.event_context?.matched_event?.table}:${r?.structured_data?.event_context?.matched_event?.id}`)
    && /^[A-Za-z0-9_-]{11}$/.test(String(r?.structured_data?.media?.video_id ?? ''))
    && Number.isFinite(r?.structured_data?.media?.start_seconds) && r.structured_data.media.start_seconds >= 0)
    .map(r => ({
      videoUrl: `https://www.youtube.com/watch?v=${r.structured_data.media.video_id}`,
      startSeconds: r.structured_data.media.start_seconds,
      endSeconds: typeof r.structured_data.media.end_seconds === 'number' ? r.structured_data.media.end_seconds : null,
    }));
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
 * One compact identity and the available priority data, from the viewer-scoped profile read.
 * Configuration opens this vehicle's reports and related photographs in place; it does not
 * borrow an unrelated auction study or replace the vehicle route with a market page.
 */
export default function ProfileHeader({ priceLotId }: { priceLotId?: string }) {
  const { vehicle, auctionPulse, auctionCurrency, setGalleryFilter, timelineEvents, timelineReadState } = useVehicleProfile();
  const contributionDays = useContributionDays(vehicle?.id);
  const priceOwnedByLiveStack = isAuctionPresentation(auctionPulse) && !!auctionPulse?.listing_url && ['active', 'live'].includes(auctionPulse.listing_status);
  const doc = useProfileDocument(vehicle?.id, priceOwnedByLiveStack);
  const hasMasthead = doc?.sections.some(section => section.kind === 'masthead') ?? false;
  const sticky = useRef<HTMLDivElement>(null);
  const [activeFacet, setActiveFacet] = useState<{ field: string; value: string; dimension: string } | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [lotRead, setLotRead] = useState<LotProvenanceRead | null>(null);

  // The sticky stack below reads the masthead's measured height (vehicle-profile.css --vp-h-masthead).
  useLayoutEffect(() => {
    const el = sticky.current;
    const page = el?.closest<HTMLElement>('.vehicle-profile-page');
    if (!el || !page) return;
    // offsetHeight rounds away the fractional pixels exposed by browser zoom.
    const update = () => page.style.setProperty('--vp-h-masthead', `${el.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); page.style.removeProperty('--vp-h-masthead'); };
  }, [vehicle?.id, hasMasthead]);
  useEffect(() => { setActiveFacet(null); setFinancialOpen(false); setActivityOpen(false); setListingOpen(false); }, [vehicle?.id]);
  useEffect(() => setLiveOpen(false), [vehicle?.id, auctionPulse?.listing_url, priceOwnedByLiveStack]);

  const masthead = doc?.sections.find(s => s.kind === 'masthead');
  const strip = doc?.sections.find(s => s.kind === 'strip');
  const title = vehicle ? getVehicleTitle(vehicle) : '';
  const classified = masthead?.price?.unit === '';

  const targetLotKey = comparableLotKey(masthead?.price?.source?.url);
  const readAt = doc?.read_at ?? '';
  const currentLotRead = lotRead?.vehicleId === vehicle?.id && lotRead?.lotKey === targetLotKey && lotRead?.readAt === readAt ? lotRead : null;

  // Supplement only the canonical price's addressed source, within this subject/read.
  // Event, sale and ingest clocks never fill the price owner's observation clock.
  useEffect(() => {
    const vehicleId = vehicle?.id ? String(vehicle.id) : '';
    if (!vehicleId || !targetLotKey) return;
    let cancelled = false;
    (async () => {
      try {
        const [auctionRes, eventRes, presentationRes] = await Promise.all([
          Promise.resolve(
        supabase
          .from('auction_events_canonical')
          .select('id, lot_number, source_url, broadcast_video_url, broadcast_video_id, broadcast_timestamp_start, broadcast_timestamp_end')
          .eq('vehicle_id', vehicleId)
          .order('auction_end_date', { ascending: false, nullsFirst: false })
          .limit(10)
      ).catch(() => ({ data: null, error: true })),
      Promise.resolve(
        supabase
          .from('vehicle_events')
          .select('id, source_url, metadata')
          .eq('vehicle_id', vehicleId)
          .order('extracted_at', { ascending: false, nullsFirst: false })
          .limit(10)
      ).catch(() => ({ data: null, error: true })),
      Promise.resolve(
        supabase
          .from('vehicle_observations')
          .select('vehicle_id, structured_data')
          .eq('vehicle_id', vehicleId)
          .eq('source_id', BROADCAST_SOURCE_ID)
          .eq('structured_data->>property', 'broadcast_lot_presentation')
          .eq('is_superseded', false)
          .limit(20)
      ).catch(() => ({ data: null, error: true })),
    ]);
    if (cancelled) return;
    const matchingRows = (rows: any[] | null | undefined): any[] => {
      return Array.isArray(rows) ? rows.filter(r => comparableLotKey(r?.source_url) === targetLotKey) : [];
    };
    const failed = !!auctionRes?.error || !!eventRes?.error || !Array.isArray(auctionRes?.data) || !Array.isArray(eventRes?.data);
    const auctionRows = auctionRes?.error ? [] : matchingRows(auctionRes?.data as any[] | null);
    const eventRows = eventRes?.error ? [] : matchingRows(eventRes?.data as any[] | null);
    const candidates: SaleLotProvenance[] = [
      ...auctionRows.map(row => ({ lotNumber: row.lot_number ?? null,
        videoUrl: row.broadcast_video_url || (/^[A-Za-z0-9_-]{11}$/.test(row.broadcast_video_id ?? '')
          ? `https://www.youtube.com/watch?v=${row.broadcast_video_id}` : row.broadcast_video_id || null),
        startSeconds: typeof row.broadcast_timestamp_start === 'number' ? row.broadcast_timestamp_start : null,
        endSeconds: typeof row.broadcast_timestamp_end === 'number' ? row.broadcast_timestamp_end : null })),
      ...eventRows.map(row => { const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
        return { lotNumber: meta.lot_number ?? null, auctionName: meta.auction_name || meta.event_name || null, videoUrl: meta.video_url || null }; }),
    ];
    // Join presentations bound to the agreed lot and exact episode even when it already names the broadcast:
    // that URL may lack the lot offset. The recording consensus below refuses conflicting videos or offsets.
    const boundLots = [...new Set(candidates.map(c => String(c.lotNumber ?? '').trim()).filter(Boolean))];
    const episodeKeys = new Set([
      ...auctionRows.filter(row => typeof row.id === 'string' && row.id).map(row => `auction_events:${row.id}`),
      ...eventRows.filter(row => typeof row.id === 'string' && row.id).map(row => `vehicle_events:${row.id}`),
    ]);
    const presentations = boundLots.length === 1 && !presentationRes?.error
      ? pickLotPresentations(presentationRes?.data as any[] | null, vehicleId, boundLots[0], episodeKeys) : [];
    candidates.push(...presentations.map(presentation => ({ lotNumber: boundLots[0], ...presentation })));
    setLotRead({ vehicleId, lotKey: targetLotKey, readAt, status: failed ? 'failed' : candidates.length ? 'matched' : 'unmatched', candidates });
      } catch {
        if (!cancelled) setLotRead({ vehicleId, lotKey: targetLotKey, readAt, status: 'failed', candidates: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [vehicle?.id, targetLotKey, readAt]);

  const priceProjection = useMemo<{ claim: Claim<number>; conflicted: boolean } | null>(() => {
    if (!masthead?.price || !vehicle) return null;
    const base = masthead.price;
    const vAny = vehicle as Record<string, any>;
    const pAny = (auctionPulse ?? {}) as Record<string, any>;
    // The existing Mecum writer stores its native web ID beside these metadata fields.
    // Free description mentions and other vehicle URLs do not bind a price episode.
    const boundInline = [vAny.provenance_metadata, vAny.import_metadata].filter(meta =>
      meta && /^\d+$/.test(String(meta.mec_web_id)) && `mecum:${meta.mec_web_id}` === targetLotKey);
    const fallbackUrl = base.source.url ?? null;
    const pulseLot = targetLotKey && comparableLotKey(pAny.listing_url) === targetLotKey ? pAny.lot_number : null;
    const candidates: SaleLotProvenance[] = [...(currentLotRead?.candidates ?? []), { lotNumber: pulseLot },
      ...boundInline.map(meta => extractInlineLotProvenance({ provenance_metadata: meta }))];
    const texts = (values: unknown[]) => [...new Set(values.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()))];
    const lots = texts([base.source.lotNumber, base.source.video?.lotNumber, ...candidates.map(c => c.lotNumber)]);
    const names = texts([base.source.auctionName, base.source.video?.auctionName, ...candidates.map(c => c.auctionName)]);
    // A disputed lot makes its attached event/recording context unsafe to combine.
    // Recording-only disagreements do not erase an independently agreed lot/name.
    const lotConflict = lots.length > 1;
    const clips = candidates.filter(c => typeof c.videoUrl === 'string' && !!c.videoUrl.trim());
    const urls = texts(clips.map(c => c.videoUrl));
    const positions = (key: 'startSeconds' | 'endSeconds') => [...new Set(clips.map(c => c[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))];
    const starts = positions('startSeconds'), ends = positions('endSeconds');
    const clipConflict = urls.length > 1 || starts.length > 1 || ends.length > 1;
    const lotNumber = base.source.lotNumber || (!lotConflict ? lots[0] : null) || null;
    const auctionName = base.source.auctionName || (!lotConflict && names.length === 1 ? names[0] : null) || null;
    const recording = !lotConflict && !clipConflict ? { url: urls[0] ?? null, startSeconds: starts[0] ?? null, endSeconds: ends[0] ?? null }
      : { url: null, startSeconds: null, endSeconds: null };
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

    return { conflicted: lotConflict || names.length > 1 || clipConflict, claim: {
      ...base,
      source: {
        ...base.source,
        url: fallbackUrl,
        lotNumber,
        auctionName,
        video: base.source.video ?? {
          ...recording,
          lotNumber,
          auctionName,
          title,
          priceText,
          imageUrl: typeof vAny.primary_image_url === 'string' ? vAny.primary_image_url : null,
          lotUrl: fallbackUrl,
          searchQuery,
        },
      },
    } };
  }, [masthead?.price, vehicle, auctionPulse, currentLotRead, classified, title, targetLotKey]);
  const enrichedPriceClaim = priceProjection?.claim ?? null;
  const provenanceNote = priceProjection?.conflicted ? `${currentLotRead?.status === 'failed' ? 'Additional lot provenance unavailable. ' : ''}Additional lot provenance conflicts; disputed context withheld.`
    : !targetLotKey ? 'Headline source URL unavailable for lot matching; additional lot provenance unlinked.'
      : !currentLotRead ? 'Additional lot provenance pending.'
        : currentLotRead.status === 'failed' ? 'Additional lot provenance unavailable.'
          : currentLotRead.status === 'unmatched' ? 'No additional matching lot provenance in this read.' : null;

  if (!vehicle || !doc || !masthead) return null;
  const asArtwork = !!masthead.model && vehicle.listing_kind !== 'non_vehicle_item';
  // A header token opens its line items (vehicle_facet_items). Identity variant kinds the reader has no token for
  // (series, package) are trim.
  const explore = (field: string, value: string, gap = false) => {
    setLiveOpen(false); setFinancialOpen(false); setActivityOpen(false); setListingOpen(false);
    const evidenceField = field === 'engine' ? 'engine_type' : field;
    const dimension = field === 'engine_type' ? 'engine' : TOKEN_DIMENSIONS.has(field) ? field : 'trim';
    setActiveFacet(current => current?.field === evidenceField ? null : { field: evidenceField, value, dimension });
    // A gap has no member to filter the gallery by.
    setGalleryFilter?.(!gap && ['transmission', 'drivetrain', 'engine_type', 'body_style', 'mileage'].includes(evidenceField)
      ? { field: evidenceField, label: value } : null);
  };
  const configuration = strip && <div className="vp-header-facets" role="group" aria-label="Explore this vehicle">
    {strip.odometer && <ClaimView label="Odometer" role="label" claim={strip.odometer} format={value => `${Number(value).toLocaleString('en-US')} mi`} />}
    {strip.facets.map(f => {
      const label = f.dimension === 'transmission' ? masthead.transmissionModel || f.label : f.label;
      return <Facet key={f.dimension} label={label} expanded={activeFacet?.field === (f.dimension === 'engine' ? 'engine_type' : f.dimension)}
        ariaLabel={`Explore ${label} in this profile`}
        onClick={() => explore(f.dimension, label)} />;
    })}
    {(strip.gaps ?? []).map(g => g.lead
      // The record holds nothing, but the token's lead item does: its value, marked with its status.
      ? <Facet key={`gap:${g.dimension}`} label={g.lead.value} status={g.lead.status}
        expanded={activeFacet?.field === (g.dimension === 'engine' ? 'engine_type' : g.dimension)}
        ariaLabel={`${g.label}: ${g.lead.value}, ${g.lead.status}. Show its items`}
        onClick={() => explore(g.dimension, g.lead!.value, true)} />
      : <Facet key={`gap:${g.dimension}`} gap label={g.label}
        expanded={activeFacet?.field === (g.dimension === 'engine' ? 'engine_type' : g.dimension)}
        ariaLabel={`${g.label}: not established. Show what would establish it`}
        onClick={() => explore(g.dimension, g.label, true)} />)}
  </div>;

  const market = (reduced = false) => priceOwnedByLiveStack && auctionPulse ? <React.Suspense fallback={null}><ExternalAuctionSummary
        currentBid={auctionPulse.current_bid} currencyCode={auctionCurrency} endDate={auctionPulse.end_date} listingStatus={auctionPulse.listing_status}
        sourceObservedAt={auctionPulse.source_observed_at}
        hideAmount={reduced}
        onClick={() => { setActiveFacet(null); setFinancialOpen(false); setActivityOpen(false); setLiveOpen(current => !current); }} /></React.Suspense> : !reduced && enrichedPriceClaim && <ClaimView
        label={masthead.priceLabel ?? 'Recorded price'}
        role="measure"
        claim={enrichedPriceClaim}
        format={value => classified ? Number(value).toLocaleString('en-US') : formatMeasure(Number(value), 'USD')}
        extra={<>
          {provenanceNote && <Text role="caption">{provenanceNote}</Text>}
          {priceLotId && <PrefetchLink className="k-body" to={`/stacks/order-book/${vehicle.id}?lot=${priceLotId}`}>Open auction stack →</PrefetchLink>}
        </>}
      />;

  return <>
    <div ref={sticky} className="vp-header-sticky">
      <Masthead result={<div className="vp-header-departments">
        <ProfileActivity vehicleId={vehicle.id} events={timelineEvents ?? []} pulse={auctionPulse} days={contributionDays} readState={timelineReadState}
          open={activityOpen} onToggle={() => { setFinancialOpen(false); setLiveOpen(false); setActiveFacet(null); setListingOpen(false); setActivityOpen(current => !current); }}
          onClose={() => setActivityOpen(false)} boundaryRef={sticky} />
        <ProfileFinancials vehicleId={vehicle.id} market={market()} reducedMarket={market(true)} open={financialOpen}
          onToggle={() => { setActivityOpen(false); setLiveOpen(false); setActiveFacet(null); setListingOpen(false); setFinancialOpen(current => !current); }}
          onClose={() => setFinancialOpen(false)} boundaryRef={sticky} />
      </div>}>
        <Text role="entity" as="h1" aria-label={title}>
          {asArtwork
            ? <ProfileIdentity vehicleId={vehicle.id} compact year={vehicle.year} make={vehicle.make ?? ''} model={masthead.model!} variants={masthead.identity.differentiators} onExplore={explore} />
            : title}
        </Text>
        {masthead.listing && (() => {
          const listing = masthead.listing;
          const venue = LISTING_VENUES[listing.platform] ?? listing.platform;
          const logo = resolveSourceLogo(venue, listing.url);
          const mark = <>{logo ? <img className="k-claim__logo" src={logo} alt={venue} width={40} height={16} /> : <span>{venue}</span>} <span>{listingWord(listing)}</span></>;
          return <Text role="label" as="p" className="vp-header-listing" aria-label={describeListing(listing)} title={describeListing(listing)}>
            <button type="button" className="vp-header-listing__mark" aria-expanded={listingOpen} aria-label={`${describeListing(listing)}. Show listing`}
              onClick={() => { setActiveFacet(null); setFinancialOpen(false); setActivityOpen(false); setLiveOpen(false); setListingOpen(current => !current); }}>{mark}</button>
          </Text>;
        })()}
        {priceOwnedByLiveStack ? <details className="vp-header-configuration"><summary>Configuration</summary>{configuration}</details> : configuration}
      </Masthead>
      {liveOpen && priceOwnedByLiveStack && auctionPulse && <HeaderPopover open title="Live auction" width={680} onClose={() => setLiveOpen(false)} dismissBoundaryRef={sticky}>
        <HeaderLiveAuction vehicleId={vehicle.id} pulse={auctionPulse} currency={auctionCurrency} />
      </HeaderPopover>}
      {listingOpen && masthead.listing && <HeaderPopover open title={LISTING_VENUES[masthead.listing.platform] ?? masthead.listing.platform} width={420} onClose={() => setListingOpen(false)} dismissBoundaryRef={sticky}>
        <Rows title="Listing">
          <Row label="Status">{listingWord(masthead.listing)}</Row>
          {masthead.listing.stage === 'draft_pending_approval' && <Row label="Waiting on">Seller's approval of the draft</Row>}
          {masthead.listing.stage_since && <Row label="Since">{day(masthead.listing.stage_since)}</Row>}
          {masthead.listing.submitted_at && <Row label="Submitted">{day(masthead.listing.submitted_at)}</Row>}
          {masthead.listing.activated_at && <Row label="Live since">{day(masthead.listing.activated_at)}</Row>}
          {masthead.listing.external_listing_id && <Row label="Listing id">{masthead.listing.external_listing_id}</Row>}
          <Row label="Source" role="caption">vehicle_listing_state{masthead.listing.as_of ? ` · as of ${day(masthead.listing.as_of)}` : ''}</Row>
        </Rows>
        {masthead.listing.url && <a className="k-body" href={masthead.listing.url} target="_blank" rel="noreferrer">Open on {LISTING_VENUES[masthead.listing.platform] ?? masthead.listing.platform} ↗</a>}
      </HeaderPopover>}
      {activeFacet && <HeaderPopover open onClose={() => setActiveFacet(null)} title={activeFacet.value} width={560} dismissBoundaryRef={sticky}>
        <React.Suspense fallback={<p role="status">Reading line items…</p>}>
          <HeaderTokenItems key={`${vehicle.id}:${activeFacet.dimension}`} vehicleId={vehicle.id} dimension={activeFacet.dimension} items={masthead.token_items} />
        </React.Suspense>
      </HeaderPopover>}
    </div>
  </>;
}
