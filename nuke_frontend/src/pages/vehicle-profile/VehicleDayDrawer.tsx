/**
 * VehicleDayDrawer — the complete day document for one vehicle-day.
 *
 * C10 depth contract: clicking a day answers "what happened that day"
 * completely, in place — every photo (square thumbs, lazy), first/last/span,
 * the work-session story, dollar lines, and a deep link to /journal/:date.
 * Reuses the user-profile day-receipt drawer pattern (UserBarcodeTimeline):
 * inline below the grid, additive, reversible (ESC / click-out / ✕).
 *
 * Data: photos come from one indexed vehicle_images query (day window on
 * taken_at — same attribution as get_vehicle_contribution_days); the work
 * story and event lines come from context timelineEvents (already loaded
 * via the security-definer profile RPC) so the drawer adds exactly ONE
 * cheap query per day viewed.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';
import { highlightVehicleDays, openVehicleDay, openVehiclePhoto, openVehiclePhotoByUrl } from './VehiclePhotoLightbox';
import WorkSessionContext from './WorkSessionContext';
import { auctionMomentDayTitle, auctionOpenDayTitle, fmtClock, fmtMoment, fmtUsd, isBatHosted, listingForPhoto, localDate, momentDay, type AuctionSequence } from './auctionSequence';

interface DayPhoto {
  id: string;
  image_url: string;
  taken_at: string | null;
  source?: string | null;
  source_url?: string | null;
}

/** Minimal shape of context timeline events the drawer reads. */
interface DayEvent {
  id?: string;
  event_date?: string | null;
  event_type?: string | null;
  title?: string | null;
  cost_amount?: number | null;
  cost_currency?: unknown;
  metadata?: {
    duration_minutes?: number | null;
    work_type?: string | null;
    work_description?: string | null;
    synthetic_day?: boolean;
  } | null;
}

/** One receipt of the day as get_vehicle_day_documents returns it: money, payer and the page are null unless the viewer is tied. */
interface DayDocumentInstall {
  /** the photo zone the line's words name (dashboard, interior, engine, wheel) or null */
  zone: string | null;
  /** photographed = that zone has a photo after the page date (a candidate the owner looks at); no_photo = none yet; no_zone = nothing a photo shows */
  status: 'photographed' | 'no_photo' | 'no_zone';
  photo_day: string | null;
  photo_count: number | null;
  image_id: string | null;
}
interface DayDocumentLine { line_number: number | null; description: string | null; part_number: string | null; quantity: number | null; unit_price: number | null; amount: number | null; line_date: string | null; hours: number | null; performer: string | null; install?: DayDocumentInstall | null }
interface DayDocumentPage { bucket: string; path: string; bytes?: number | null; page_no?: number | null }
interface DayDocumentVendor { id?: string | null; name?: string | null; logo_url?: string | null; website?: string | null }
interface DayDocument { receipt_id: string; vendor: string | null; vendor_org?: DayDocumentVendor | null; document_type: string | null; document_number: string | null; pages: number | null; page?: DayDocumentPage | null; page_paths?: string[] | null; payer_as_named: string | null; subtotal: number | null; tax: number | null; total: number | null; currency: string | null; date_basis: string | null; lines: DayDocumentLine[] }

/** The install proofs a document's lines point at: the distinct days, oldest first. */
export function installProofDays(doc: Pick<DayDocument, 'lines'>): string[] {
  const days = new Set<string>();
  for (const line of doc.lines) if (line.install?.status === 'photographed' && line.install.photo_day) days.add(line.install.photo_day);
  return [...days].sort();
}

/** The words beside a line for its install proof; null when the line names nothing a photo would show. */
export function describeInstall(install: DayDocumentInstall | null | undefined): string | null {
  if (!install || install.status === 'no_zone' || !install.zone) return null;
  if (install.status === 'no_photo') return `no ${install.zone} photo after this date yet`;
  const day = install.photo_day ? fmtDayShort(install.photo_day) : 'later';
  return `${install.zone} photographed ${day}${install.photo_count && install.photo_count > 1 ? ` (${install.photo_count} photos)` : ''}`;
}

/** The page's signed render URL for this viewer (the bucket is private; signing needs the viewer's own storage policy). */
async function signDocumentPage(page: DayDocumentPage): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage.from(page.bucket).createSignedUrl(page.path, 600, { transform: { width: 1800, quality: 80 } });
    return !error && data?.signedUrl ? data.signedUrl : null;
  } catch {
    return null;
  }
}

interface VehicleDayDrawerProps {
  date: string; // YYYY-MM-DD
  /** the BaT auction sequences, one per listing, when this vehicle was a lot — bids and comments land on their days */
  auctions?: AuctionSequence[];
  hasWorkSummary?: boolean;
  /** receipts linked to this vehicle on this page date (get_vehicle_contribution_days kind 'document'); 0 = no read */
  documentCount?: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

/** Supabase render-endpoint thumbnail (resize=contain per platform rule). */
function renderThumb(url: string, width = 200): string {
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx < 0) return url;
  return `${url.slice(0, idx)}/storage/v1/render/image/public/${url.slice(idx + marker.length).split('?')[0]}?width=${width}&quality=70&resize=contain`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtSpan(first: string | null, last: string | null): string {
  if (!first || !last) return '';
  const a = new Date(first).getTime();
  const b = new Date(last).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return '';
  const mins = Math.round((b - a) / 60000);
  if (mins < 1) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}H ${m}M SPAN` : `${m}M SPAN`;
}

function fmtMoney(n: number | null | undefined, currency: unknown): string {
  const v = Number(n || 0);
  if (!v) return '';
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim().toUpperCase() : null;
  return `${Math.round(v).toLocaleString()} ${code ?? '(currency unknown)'}`;
}

function fmtDayShort(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtDayHeader(date: string): string {
  const d = new Date(date + 'T12:00:00');
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase();
}

const mono: React.CSSProperties = { fontFamily: "var(--vp-font-mono, 'Courier New', monospace)" };

// Session-scoped photo cache so re-opening a day never refetches.
const dayPhotoCache = new Map<string, DayPhoto[]>();

const VehicleDayDrawer: React.FC<VehicleDayDrawerProps> = ({ date, auctions = [], hasWorkSummary = false, documentCount = 0, onClose, onPrev, onNext }) => {
  const { vehicleId, timelineEvents, timelineReadState } = useVehicleProfile();
  const [photoRead, setPhotoRead] = useState<{ key: string; rows: DayPhoto[]; failed: boolean } | null>(null);
  const [documentRead, setDocumentRead] = useState<{ key: string; rows: DayDocument[]; failed: boolean } | null>(null);
  const [pageNote, setPageNote] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // The bids and comments that landed on this day, across the car's listings, in time order.
  const auctionItems = useMemo(
    () => auctions.flatMap(a => a.items).filter(i => localDate(i.at) === date).sort((a, b) => (a.at < b.at ? -1 : 1)),
    [auctions, date],
  );
  // Carry the owner's recorded role, date grain and source basis into the day document.
  const auctionMoments = useMemo(() => auctions.flatMap(auction => [
    ...(auction.open && momentDay(auction.open) === date
      ? [{ auction, moment: auction.open, label: auctionOpenDayTitle(auction), kind: 'open' }] : []),
    ...(auction.close && momentDay(auction.close) === date
      ? [{ auction, moment: auction.close, label: auctionMomentDayTitle(auction), kind: 'close' }] : []),
  ]), [auctions, date]);
  const lotOf = useMemo(() => new Map(auctions.map(a => [a.key, a.lotNumber ?? String(a.ordinal)])), [auctions]);
  // Display inferred listing groups on the opening day, without claiming a photo
  // capture/publication time or source-page membership. Import stamps stay excluded.
  const listingOfDay = useMemo(
    () => auctions.find(a => !!a.open && momentDay(a.open) === date && a.photos.publishedWithListing > 0) ?? null,
    [auctions, date],
  );
  const isListingDay = !!listingOfDay;
  // Include the exact inputs used by listingForPhoto, preserving order and newest-listing fallback.
  // Equivalent input arrays produce the same key and keep their cache/pending read.
  const photoContextKey = JSON.stringify([vehicleId, date, isListingDay ? ['listing', listingOfDay.key,
    auctions.map(a => [a.key, a.open?.at ?? a.items[0]?.at ?? a.close?.at ?? null, a.ordinal, a.listingCount]),
  ] : ['capture']]);
  const currentPhotoRead = photoRead?.key === photoContextKey ? photoRead : null;
  const photos = currentPhotoRead?.rows ?? null;
  const photosUnavailable = currentPhotoRead?.failed ?? false;

  // ── Photos of the day (one query, cached) ──
  useEffect(() => {
    if (!vehicleId || !date) return;
    const cached = dayPhotoCache.get(photoContextKey);
    if (cached) { setPhotoRead({ key: photoContextKey, rows: cached, failed: false }); return; }
    let cancelled = false;
    setPhotoRead(null);
    const base = supabase
      .from('vehicle_images')
      .select('id, image_url, taken_at, source, source_url')
      .eq('vehicle_id', vehicleId)
      .not('is_duplicate', 'is', true);
    const captureStart = Date.parse(`${date}T00:00:00Z`);
    const captureEnd = Number.isFinite(captureStart) ? new Date(captureStart + 86_400_000).toISOString() : `${date}T23:59:59.999Z`;
    const query = isListingDay
      // Candidate records for the same inferred upload-month/fallback group as the timeline;
      // the path does not identify an exact listing or publication time.
      ? base.or('source.ilike.%bat%,source_url.ilike.%bringatrailer.com%,taken_at.is.null').limit(600)
      : base
          .gte('taken_at', `${date}T00:00:00Z`)
          .lt('taken_at', captureEnd)
          .order('taken_at', { ascending: true })
          .limit(120);
    Promise.resolve(query)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setPhotoRead({ key: photoContextKey, rows: [], failed: true });
          return;
        }
        let rows = (data as DayPhoto[]).filter(p => p.image_url);
        if (isListingDay && listingOfDay) {
          rows = rows.filter(p => listingForPhoto({ id: p.id, taken_at: p.taken_at, source: p.source ?? null, source_url: p.source_url ?? null }, auctions)?.key === listingOfDay.key).slice(0, 120);
        }
        dayPhotoCache.set(photoContextKey, rows);
        setPhotoRead({ key: photoContextKey, rows, failed: false });
      }).catch(() => {
        if (!cancelled) setPhotoRead({ key: photoContextKey, rows: [], failed: true });
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoContextKey]);

  // ── The day's paper: one read, only on a day the timeline leg counted a linked receipt ──
  const documentKey = `${vehicleId}:${date}`;
  const documents = documentRead?.key === documentKey ? documentRead.rows : null;
  const documentsUnavailable = documentRead?.key === documentKey ? documentRead.failed : false;
  useEffect(() => {
    if (!vehicleId || !date || documentCount <= 0) return;
    let cancelled = false;
    setDocumentRead(null);
    Promise.resolve(supabase.rpc('get_vehicle_day_documents', { p_vehicle_id: vehicleId, p_date: date }))
      .then(({ data, error }) => {
        if (cancelled) return;
        const rows = !error && data && Array.isArray((data as { documents?: unknown }).documents) ? (data as { documents: DayDocument[] }).documents : null;
        setDocumentRead({ key: documentKey, rows: rows ?? [], failed: rows === null });
      })
      .catch(() => { if (!cancelled) setDocumentRead({ key: documentKey, rows: [], failed: true }); });
    return () => { cancelled = true; };
  }, [vehicleId, date, documentCount, documentKey]);

  // ── Day events from the already-loaded timeline ──
  const dayEvents = useMemo(
    () => ((timelineEvents || []) as DayEvent[]).filter((ev) => String(ev.event_date || '').slice(0, 10) === date),
    [timelineEvents, date],
  );
  const workEvents = useMemo(
    () => dayEvents.filter((ev) => String(ev.event_type || '') === 'work_session' && !ev.metadata?.synthetic_day),
    [dayEvents],
  );
  const otherEvents = useMemo(
    () => dayEvents.filter((ev) => !['work_session', 'photo_session', 'document'].includes(String(ev.event_type || ''))),
    [dayEvents],
  );

  // Native taken_at is an importer clock, so it cannot join a photo capture span.
  const hasImportedPhotos = !isListingDay && photos?.some(p => isBatHosted({ ...p, source: p.source ?? null, source_url: p.source_url ?? null }));
  const first = photos && photos.length > 0 && !isListingDay && !hasImportedPhotos ? photos[0].taken_at : null;
  const last = photos && photos.length > 0 && !isListingDay && !hasImportedPhotos ? photos[photos.length - 1].taken_at : null;
  const span = fmtSpan(first, last);
  const dayBids = auctionItems.filter(i => i.kind === 'bid').length;
  const dayComments = auctionItems.length - dayBids;
  const missingWorkDetails = hasWorkSummary && workEvents.length === 0;
  const timelinePending = timelineReadState?.timeline === 'pending' || timelineReadState?.work === 'pending';
  const timelineUnavailable = timelineReadState?.timeline === 'unavailable' || timelineReadState?.work === 'unavailable';

  const loading = photos === null;
  const paperPending = documentCount > 0 && documents === null && !documentsUnavailable;
  // The days the paper's lines point at as install proofs: the date header illuminates them on the timeline.
  const proofDays = useMemo(() => [...new Set((documents ?? []).flatMap(installProofDays))].sort(), [documents]);
  const openPage = async (doc: DayDocument) => {
    if (!doc.page) return;
    setPageNote(null);
    const url = await signDocumentPage(doc.page);
    if (url) openVehiclePhotoByUrl(url);
    else setPageNote('The page could not be signed for this viewer.');
  };
  const isEmpty = !loading && !photosUnavailable && photos.length === 0 && workEvents.length === 0 && otherEvents.length === 0 && auctionItems.length === 0 && auctionMoments.length === 0 && documentCount <= 0;

  return (
    <div
      ref={drawerRef}
      data-day-drawer
      style={{
        borderTop: '2px solid var(--vp-ink, #1a1a1a)',
        background: 'var(--vp-surface, #fff)',
        padding: '8px 12px 10px',
        maxHeight: '46vh',
        overflowY: 'auto',
      }}
    >
      {/* Header: date · span · nav · close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {proofDays.length > 0 ? (
          <button
            type="button"
            onClick={() => highlightVehicleDays(proofDays)}
            title={`Illuminate the install proofs on the timeline: ${proofDays.join(', ')}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textDecoration: 'underline dotted', color: 'inherit' }}
          >{fmtDayHeader(date)}</button>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>{fmtDayHeader(date)}</span>
        )}
        {photos && photos.length > 0 && (
          <span style={{ ...mono, fontSize: 8, color: 'var(--vp-pencil, #888)' }}>
            {hasImportedPhotos ? 'IMPORTED PHOTO CAPTURE TIMES UNKNOWN' : <>{fmtTime(first)}–{fmtTime(last)}{span ? ` · ${span}` : ''}</>}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {onPrev && (
          <button onClick={onPrev} aria-label="Previous day" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 700, padding: '2px 4px' }}>← PREV</button>
        )}
        {onNext && (
          <button onClick={onNext} aria-label="Next day" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 700, padding: '2px 4px' }}>NEXT →</button>
        )}
        <Link
          to={`/journal/${date}`}
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--vp-pencil, #888)', textDecoration: 'none', border: '1px solid var(--vp-ghost, #ddd)', padding: '2px 5px' }}
        >
          JOURNAL →
        </Link>
        <button onClick={onClose} aria-label="Close day" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '0 2px' }}>✕</button>
      </div>

      {(loading || photosUnavailable) && <div style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>{photosUnavailable ? 'Photos unavailable' : 'LOADING…'}</div>}
      {isEmpty && !missingWorkDetails && !timelinePending && !timelineUnavailable && <div style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>NO ACTIVITY</div>}
      {timelinePending && <div role="status" style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>Timeline details are still being read.</div>}
      {timelineReadState?.timeline === 'unavailable' && <div role="status" style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>Timeline events could not be fully read.</div>}
      {timelineReadState?.work === 'unavailable' && <div role="status" style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>Work-session details could not be fully read.</div>}
      {missingWorkDetails && <div style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>Work-session details unavailable in this read.</div>}

      {/* Facet chips — only the facets this day touched */}
      {!loading && !isEmpty && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {photos.length > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>{isListingDay ? `PHOTOS ${photos.length}${(listingOfDay?.photos.publishedWithListing ?? 0) > photos.length ? ` OF ${listingOfDay!.photos.publishedWithListing} GROUPED IN TIMELINE READ` : ''} · LISTING ASSOCIATION INFERRED${auctions.length > 1 && listingOfDay?.lotNumber ? ` (LOT ${listingOfDay.lotNumber})` : ''}` : `PHOTOS ${photos.length}`}</span>}
          {dayBids > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>BIDS {dayBids}</span>}
          {dayComments > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>COMMENTS {dayComments}</span>}
          {workEvents.length > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>WORK {workEvents.length}</span>}
          {documentCount > 0 && <span style={{ ...mono, fontSize: 8, border: '1px solid var(--vp-ghost, #ddd)', padding: '1px 5px' }}>PAPER {documentCount}</span>}
        </div>
      )}

      {/* The day's paper: each receipt with its lines; amounts only when the read returned them (owner-tied viewers) */}
      {paperPending && <div role="status" style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>Reading the day's paper…</div>}
      {documentsUnavailable && <div role="status" style={{ ...mono, fontSize: 9, color: 'var(--vp-pencil, #888)' }}>Paper unavailable in this read.</div>}
      {documents?.map((doc) => (
        <div key={doc.receipt_id} className="day-drawer__document" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 9 }}>
            <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {doc.vendor_org?.logo_url && (
                <img
                  src={doc.vendor_org.logo_url}
                  alt={doc.vendor_org.name || doc.vendor || 'vendor'}
                  width={14}
                  height={14}
                  loading="lazy"
                  style={{ width: 14, height: 14, objectFit: 'contain', flex: 'none' }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              {doc.vendor_org?.website ? (
                <a href={doc.vendor_org.website} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{doc.vendor || doc.vendor_org.name || 'Receipt'}</a>
              ) : (doc.vendor || 'Receipt')}
              <span>{[doc.document_type ? doc.document_type.replace(/_/g, ' ') : null, doc.document_number ? `#${doc.document_number}` : null].filter(Boolean).map((part) => ` · ${part}`).join('')}</span>
            </span>
            <span style={{ ...mono, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {doc.page && (
                <button
                  type="button"
                  onClick={() => { void openPage(doc); }}
                  style={{ ...mono, background: 'none', border: '1px solid var(--vp-ghost, #ddd)', cursor: 'pointer', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', padding: '1px 5px', color: 'inherit' }}
                >OPEN THE PAGE →</button>
              )}
              {[doc.pages && doc.pages > 1 ? `${doc.pages} pages` : null, doc.total != null ? fmtMoney(doc.total, doc.currency) : null].filter(Boolean).join(' · ') || `${doc.lines.length} line${doc.lines.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {doc.payer_as_named && <div style={{ fontSize: 8, color: 'var(--vp-pencil, #888)' }}>billed to {doc.payer_as_named}</div>}
          {pageNote && doc.page && <div role="status" style={{ fontSize: 8, color: 'var(--vp-pencil, #888)' }}>{pageNote}</div>}
          {doc.lines.length > 0 && (
            <div style={{ fontSize: 9, color: 'var(--vp-pencil, #888)', marginTop: 2, lineHeight: 1.5 }}>
              {doc.lines.map((line, i) => (
                <div key={`${doc.receipt_id}:${line.line_number ?? i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    {[line.line_date && line.line_date !== date ? line.line_date : null, line.performer, line.part_number, line.description].filter(Boolean).join(' · ')}
                    {describeInstall(line.install) && (
                      line.install?.status === 'photographed' && line.install.photo_day ? (
                        <button
                          type="button"
                          className="day-drawer__install"
                          onClick={() => openVehicleDay(line.install!.photo_day!)}
                          title="Open the day of the first photo of this zone after the invoice"
                          style={{ ...mono, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 6px', fontSize: 8, color: 'var(--vp-gulf-blue, #1f5fbf)', textDecoration: 'underline dotted' }}
                        >{describeInstall(line.install)}</button>
                      ) : (
                        <span className="day-drawer__install" style={{ ...mono, fontSize: 8, paddingLeft: 6, color: 'var(--vp-pencil, #888)' }}>{describeInstall(line.install)}</span>
                      )
                    )}
                  </span>
                  <span style={mono}>{[line.hours != null ? `${line.hours} h` : null, line.quantity != null && line.quantity !== 1 ? `×${line.quantity}` : null, line.amount != null ? fmtMoney(line.amount, doc.currency) : null].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Work story */}
      {workEvents.map((ev) => {
        const meta = ev.metadata || {};
        const mins = Number(meta.duration_minutes) || 0;
        const hrs = mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '';
        const cost = fmtMoney(ev.cost_amount, ev.cost_currency);
        return (
          <div key={ev.id || ev.title} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9 }}>
              <span style={{ fontWeight: 700 }}>{ev.title || meta.work_type || 'WORK SESSION'}</span>
              <span style={mono}>{[hrs, cost].filter(Boolean).join(' · ') || '—'}</span>
            </div>
            {meta.work_description && (
              <div style={{ fontSize: 9, color: 'var(--vp-pencil, #888)', marginTop: 2, lineHeight: 1.5 }}>
                {String(meta.work_description)}
              </div>
            )}
            {vehicleId && ev.id && <WorkSessionContext key={`${vehicleId}:${ev.id}:${date}`} vehicleId={vehicleId} sessionId={ev.id} date={date} />}
          </div>
        );
      })}

      {/* Other event lines (sales, listings, milestones) */}
      {otherEvents.map((ev) => (
        <div key={ev.id || `${ev.event_type}-${ev.title}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9, marginBottom: 3 }}>
          <span>{ev.title || String(ev.event_type || '').replace(/_/g, ' ')}</span>
          <span style={mono}>{fmtMoney(ev.cost_amount, ev.cost_currency) || ''}</span>
        </div>
      ))}

      {auctionMoments.map(({ auction, moment, label, kind }) => (
        <div key={`${auction.key}:${kind}`} className="day-drawer__auction-moment" style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 9 }}>
            <a href={auction.lotUrl} target="_blank" rel="noreferrer">
              {auctions.length > 1 ? `LOT ${auction.lotNumber ?? auction.ordinal} · ` : ''}{label}
            </a>
            <span style={mono}>{fmtMoment(moment)}</span>
          </div>
          <div style={{ fontSize: 8, color: 'var(--vp-pencil, #888)' }}>{moment.basis}</div>
        </div>
      ))}

      {/* The auction's bids and comments of the day, each opening its comment on BaT */}
      {auctionItems.length > 0 && (
        <div className="day-drawer__auction-list">
          {auctionItems.map(i => (
            <div key={i.id} className={`day-drawer__auction-row${i.kind === 'seller' ? ' seller' : ''}`}>
              <span style={mono}>{fmtClock(i.at)}</span>
              <span style={mono}>{auctions.length > 1 ? `LOT ${lotOf.get(i.listingKey) ?? ''} · ` : ''}{i.kind === 'bid' ? `BID ${fmtUsd(i.amount)}` : i.kind === 'seller' ? 'SELLER' : 'COMMENT'}{i.postClose ? ' · after close' : ''}</span>
              <span>
                <a href={i.url} target="_blank" rel="noreferrer">{i.author}</a>
                {i.kind !== 'bid' && i.text ? ` — ${i.text.length > 240 ? `${i.text.slice(0, 237)}…` : i.text}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Photo grid — square thumbs, lazy, render-endpoint sized */}
      {!loading && photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 3, marginTop: 4 }}>
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => openVehiclePhoto(p.id)}
              title={isListingDay ? 'listing association inferred; capture and publication times unknown' : isBatHosted({ ...p, source: p.source ?? null, source_url: p.source_url ?? null }) ? `import clock ${fmtTime(p.taken_at) || 'unknown'}; capture time unknown` : fmtTime(p.taken_at)}
              style={{ display: 'block', padding: 0, border: '1px solid var(--vp-ghost, #ddd)', background: 'var(--vp-row-alt, #f9f9f9)', cursor: 'pointer', aspectRatio: '1 / 1', overflow: 'hidden' }}
            >
              <img
                src={renderThumb(p.image_url, 200)}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleDayDrawer;
