/** Garage cards: the photo, the car, its activity timeline, and the facts on record. */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Link from '../PrefetchLink';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl as sharedOptimizeImageUrl } from '../../lib/imageOptimizer';
import { GarageCardAnalysis, readCardAnalysis, type AnalysisLine } from '../garage/GarageCardAnalysis';
import { appendFrames, coverDayOf, readReelPage, readReelStart, REEL_PAGE, type ReelFrame } from '../garage/garageReel';
import type { GarageVehicle, RelationshipType, ViewMode } from '../../hooks/useVehiclesDashboard';
import '../garage/garage.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GarageVehicleCardProps {
  vehicle: GarageVehicle;
  viewMode?: ViewMode;
  onRefresh?: () => void;
  /** The window and scale every card's timeline shares. */
  axis?: GarageAxis;
  /** Card buttons, in priority order; the lane shows as many as the card's width holds. */
  actions?: { label: string; onPress: () => void }[];
}

/** The window and the intensity steps are the garage's, not the car's, so two cards compare. */
export interface GarageAxis { start: number; end: number; weeks: number; steps: [number, number, number]; grid: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatVehicleTitle(v: GarageVehicle): string {
  return [v.year, v.make, v.model, v.trim]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}D AGO`;
  const months = Math.floor(days / 30);
  return `${months}MO AGO`;
}

function truncateVin(vin: string | null): string {
  if (!vin) return '';
  return vin.length > 17 ? vin.slice(0, 17) : vin;
}

function optimizeImageUrl(url: string): string {
  return sharedOptimizeImageUrl(url, 'small') || url;
}

function ownershipPeriod(vehicle: GarageVehicle): string {
  if (['profile_record', 'account_record', 'contributor'].includes(vehicle.relationship_source)) {
    return 'OWNERSHIP NOT RECORDED';
  }
  if (vehicle.relationship_source === 'owner_statement' &&
      !['OWNER', 'VERIFIED OWNER', 'CO-OWNER', 'PREVIOUSLY OWNED'].includes(vehicle.relationship_type)) {
    return vehicle.relationship_detail || 'DATES UNKNOWN';
  }
  const start = vehicle.ownership_start_date ?? 'START UNKNOWN';
  const end = vehicle.ownership_end_date ??
    (['OWNER', 'VERIFIED OWNER', 'CO-OWNER'].includes(vehicle.relationship_type) ? 'CURRENT' : 'END UNKNOWN');
  return `${start} → ${end}`;
}

function relationshipTooltip(vehicle: GarageVehicle): string {
  return [vehicle.relationship_roles?.join(', ') || vehicle.relationship_type,
    ownershipPeriod(vehicle), vehicle.relationship_detail,
    vehicle.relationship_source === 'owner_statement' ? 'ACCOUNT STATED' : vehicle.relationship_source.toUpperCase()]
    .filter(Boolean).join(' | ');
}

function relationshipSource(vehicle: GarageVehicle): string {
  const labels: Record<GarageVehicle['relationship_source'], string> = {
    verification: 'Ownership verification', ownership: 'Ownership record',
    owner_statement: 'Account statement', discovered: 'Prior ownership record',
    permission: 'Permission record', contributor: 'Contribution record', uploaded_by: 'Upload record',
    profile_record: 'Profile you added', account_record: 'Account vehicle record',
  };
  return labels[vehicle.relationship_source] ?? 'Source unavailable';
}

function estimateTooltip(vehicle: GarageVehicle): string {
  return vehicle.estimated_value != null
    ? `BUILD-CLASS ESTIMATE | ${vehicle.estimate_calculated_at ?? 'DATE UNKNOWN'}`
    : 'CURRENT BUILD-CLASS ESTIMATE UNAVAILABLE';
}

function relationshipAccent(rel: RelationshipType): { bg: string; border: string; color: string } {
  switch (rel) {
    case 'VERIFIED OWNER':
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--success, #16825d)', color: 'var(--success, #16825d)' };
    case 'OWNER':
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--success, #16825d)', color: 'var(--success, #16825d)' };
    case 'CO-OWNER':
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--success, #16825d)', color: 'var(--success, #16825d)' };
    case 'CONSIGNED':
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--warning, #b05a00)', color: 'var(--warning, #b05a00)' };
    case 'PREVIOUSLY OWNED':
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--text-secondary, #666666)', color: 'var(--text-secondary, #666666)' };
    case 'CONTRIBUTOR':
    default:
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--text-secondary, #666666)', color: 'var(--text-secondary, #666666)' };
  }
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const FONT_BODY = 'var(--font-family)';
const FONT_MONO = 'var(--font-mono)';

const BASE: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: 'var(--text-callout)',
  color: 'var(--text, #2a2a2a)',
  backgroundColor: 'var(--surface, #ebebeb)',
  border: '1px solid var(--border)', display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

const BASE_HOVER: React.CSSProperties = {
  borderColor: 'var(--border-focus, #2a2a2a)',
};

const MONO: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const LABEL: React.CSSProperties = {
  fontSize: 'var(--text-caption)',
  fontWeight: 700,
  color: 'var(--text-secondary, #666666)',
};

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  padding: '3px 6px',
  fontFamily: FONT_MONO,
  fontSize: 'var(--text-caption)',
  fontWeight: 700,
  color: 'var(--bg, #f5f5f5)',
  backgroundColor: 'var(--text, #2a2a2a)',
  border: '2px solid var(--text, #2a2a2a)', whiteSpace: 'nowrap',
  pointerEvents: 'none',
  transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

// ---------------------------------------------------------------------------
// HoverData — wraps any element with tooltip + click action
// ---------------------------------------------------------------------------

function HoverData({
  tooltip,
  onClick,
  children,
  style,
}: {
  tooltip: string;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elRef = useRef<HTMLSpanElement>(null);

  const handleEnter = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 4 });
    timerRef.current = setTimeout(() => setShow(true), 150);
  }, []);

  const handleLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setShow(false);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    }
  }, [onClick]);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <>
      <span
        ref={elRef}
        className={onClick ? 'garage-card-control' : undefined}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={onClick ? tooltip : undefined}
        onKeyDown={onClick ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); elRef.current?.click(); } } : undefined}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        style={{
          cursor: onClick ? 'pointer' : 'default',
          borderBottom: onClick ? '1px dotted var(--text-secondary, #666666)' : undefined,
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 'inherit',
          ...style,
        }}
      >
        {children}
      </span>
      {show && (
        <div
          style={{
            ...TOOLTIP_STYLE,
            left: pos.x,
            top: pos.y,
            transform: 'translate(-50%, -100%)',
            opacity: 1,
          }}
        >
          {tooltip}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// MiniBarcode — the car's recorded activity as day squares, the contribution-grid
// layout: seven rows (Monday to Sunday), one column per week, the last year,
// shaded on the garage's own scale. Five years of days would be one-pixel squares
// at card width, so the window is the year and the caption carries the full span.
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const DAY_MS = 86_400_000;
const TIMELINE_WEEKS = 53; // a year of week columns, ending with this week

/** Recorded items per day: the day reader when present, otherwise the event weeks on their Monday. */
function dayTotals(vehicle: GarageVehicle): Map<string, number> {
  const totals = new Map<string, number>();
  if (vehicle.timeline?.days.length) {
    for (const [day, photos, work, events, documents] of vehicle.timeline.days) {
      totals.set(day, (Number(photos) || 0) + (Number(work) || 0) + (Number(events) || 0) + (Number(documents) || 0));
    }
    return totals;
  }
  for (const week of vehicle.event_weeks ?? []) {
    const key = week.slice(0, 10);
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  return totals;
}

/** The window (its first Monday) and steps at the quartiles of the garage's active days. */
export function garageAxis(vehicles: GarageVehicle[], now = new Date()): GarageAxis {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const thisMonday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY_MS;
  const start = thisMonday - (TIMELINE_WEEKS - 1) * 7 * DAY_MS;
  const totals: number[] = [];
  for (const vehicle of vehicles) {
    for (const [day, n] of dayTotals(vehicle)) {
      const at = Date.parse(`${day}T00:00:00Z`);
      if (n > 0 && at >= start && at <= today) totals.push(n);
    }
  }
  totals.sort((a, b) => a - b);
  const at = (q: number) => totals.length ? totals[Math.min(totals.length - 1, Math.floor(q * totals.length))] : 1;
  // Every day that has happened is a square; the rest of this week is not drawn.
  let grid = '';
  for (let index = 0; start + index * DAY_MS <= today; index++) grid += `M${Math.floor(index / 7)} ${index % 7}h.84v.84h-.84z`;
  return { start, end: today, weeks: TIMELINE_WEEKS, steps: [at(0.25), at(0.5), at(0.75)], grid };
}

function MiniBarcode({ vehicle, axis, litDay }: { vehicle: GarageVehicle; axis?: GarageAxis; litDay?: string | null }) {
  const drawn = useMemo(() => {
    const frame = axis ?? garageAxis([vehicle]);
    const cells: { key: string; x: number; y: number; level: number; title: string }[] = [];
    for (const [day, n] of dayTotals(vehicle)) {
      const at = Date.parse(`${day}T00:00:00Z`);
      if (!Number.isFinite(at) || n <= 0 || at < frame.start || at > frame.end) continue;
      const index = Math.round((at - frame.start) / DAY_MS);
      cells.push({
        key: day, x: Math.floor(index / 7), y: index % 7,
        // Above each quartile of the garage's active days the square steps up one shade.
        level: 1 + frame.steps.filter(step => n > step).length,
        title: `${monthLabel(day.slice(0, 7)).replace(' ', ` ${Number(day.slice(8, 10))}, `)}: ${n.toLocaleString('en-US')} recorded`,
      });
    }
    return { frame, cells };
  }, [vehicle, axis]);

  const { frame, cells } = drawn;
  // The day of the photo showing in the card's viewer, when it falls inside the window.
  const litAt = litDay ? Date.parse(`${litDay}T00:00:00Z`) : NaN;
  const litIndex = Number.isFinite(litAt) && litAt >= frame.start && litAt <= frame.end ? Math.round((litAt - frame.start) / DAY_MS) : null;
  const label = `${cells.length} active ${cells.length === 1 ? 'day' : 'days'} recorded in the last year`;
  return (
    <svg className="garage-barcode" role="img" aria-label={label}
      viewBox={`0 0 ${frame.weeks - 0.16} 6.84`} preserveAspectRatio="xMinYMid meet">
      <path className="garage-barcode-grid" d={frame.grid} />
      {cells.map(cell => (
        <rect key={cell.key} x={cell.x} y={cell.y} width={0.84} height={0.84} rx={0.15} data-level={cell.level}><title>{cell.title}</title></rect>
      ))}
      {litIndex != null && <rect className="garage-barcode-lit" x={Math.floor(litIndex / 7) - 0.08} y={(litIndex % 7) - 0.08} width={1} height={1} rx={0.2} />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RelationshipBadge({ rel }: { rel: RelationshipType }) {
  const accent = relationshipAccent(rel);
  return (
    <span
      style={{
        ...LABEL,
        color: 'var(--text)',
        border: `2px solid ${accent.border}`,
        backgroundColor: accent.bg, padding: '1px 4px',
        display: 'inline-block',
        whiteSpace: 'nowrap',
      }}
    >
      {rel}
    </span>
  );
}

function MissingTag({ label }: { label: string }) {
  return (
    <span
      style={{
        ...LABEL,
        fontSize: 'var(--text-caption)',
        color: 'var(--text)',
        border: '2px solid var(--warning, #b05a00)', padding: '1px 4px',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  );
}

function HealthBar({ score, vehicle }: { score: number | null; vehicle: GarageVehicle }) {
  if (score == null || !Number.isFinite(score)) return null;
  const pct = score != null ? Math.max(0, Math.min(100, score)) : null;
  const barColor =
    pct == null
      ? 'var(--border, #bdbdbd)'
      : pct >= 70
      ? 'var(--success, #16825d)'
      : pct >= 40
      ? 'var(--warning, #b05a00)'
      : 'var(--error, #d13438)';

  const breakdown = [
    `IMAGES: ${vehicle.image_count ?? 0}`,
    `VIN: ${vehicle.vin ? 'YES' : 'NO'}`,
    `VALUE: ${vehicle.estimated_value != null ? 'YES' : 'NO'}`,
    `EVENTS: ${vehicle.event_count ?? 0}`,
  ].join(' | ');

  return (
    <HoverData tooltip={breakdown}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <span style={LABEL}>HEALTH</span>
        <div
          style={{
            flex: 1,
            height: 2,
            backgroundColor: 'var(--border, #bdbdbd)', position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: pct != null ? `${pct}%` : '0%',
              backgroundColor: barColor,
              transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </div>
        <span style={{ ...MONO, fontSize: 'var(--text-caption)', color: 'var(--text-secondary, #666666)', minWidth: 22 }}>
          {pct != null ? `${pct}` : '—'}
        </span>
      </div>
    </HoverData>
  );
}

// ---------------------------------------------------------------------------
// Action strip
// ---------------------------------------------------------------------------

function ActionStrip({
  vehicle,
  vertical = false,
}: {
  vehicle: GarageVehicle;
  vertical?: boolean;
}) {
  const primaryAction = 'View vehicle';

  if (vertical) {
    return (
      <Link to={`/vehicle/${vehicle.id}`} className="garage-card-open"
        style={{
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          ...LABEL,
          fontSize: 'var(--text-caption)',
          color: 'var(--text, #2a2a2a)',
          writingMode: 'vertical-rl',
          whiteSpace: 'nowrap',
        }}
      >
        {primaryAction}
      </Link>
    );
  }

  return (
    <div
      className="garage-card-actions"
      style={{
        borderTop: '2px solid var(--border, #bdbdbd)',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <HoverData tooltip="Open vehicle profile" style={{ flex: 1 }}>
        <Link to={`/vehicle/${vehicle.id}`} className="garage-card-open"
          style={{
            flex: 1,
            padding: '6px 8px',
            ...LABEL,
            fontSize: 'var(--text-callout)',
            color: 'var(--text, #2a2a2a)',
            textAlign: 'center',
          }}
        >
          {primaryAction}
        </Link>
      </HoverData>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid card: the photo, the car, its timeline, and only the facts on record
// ---------------------------------------------------------------------------

const sentence = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "Mar 2021 – Nov 2026", or one month when the record sits inside it. */
function recordSpan(vehicle: GarageVehicle): string | null {
  const first = vehicle.timeline?.first_day ?? vehicle.event_summary?.first_event_date ?? null;
  const last = vehicle.timeline?.last_day ?? vehicle.event_summary?.last_event_date ?? null;
  if (!first || !last) return null;
  const from = monthLabel(first.slice(0, 7));
  const to = monthLabel(last.slice(0, 7));
  return from === to ? from : `${from} – ${to}`;
}

/** Counts that exist; a zero is left out instead of printed. */
function recordCounts(vehicle: GarageVehicle): string[] {
  const t = vehicle.timeline;
  if (!t) return vehicle.image_count ? [plural(vehicle.image_count, 'photo', 'photos')] : [];
  // image_count also holds undated photos, so it is the photo total when it is larger.
  const photos = Math.max(t.photos, vehicle.image_count ?? 0);
  return [
    photos > 0 ? plural(photos, 'photo', 'photos') : null,
    t.work_days > 0 ? plural(t.work_days, 'work day', 'work days') : null,
    t.events > 0 ? plural(t.events, 'event', 'events') : null,
    t.documents > 0 ? plural(t.documents, 'paper', 'papers') : null,
  ].filter((part): part is string => part !== null);
}

/** The profile header's own read, so a card and its profile state the same price and configuration. */
interface CardHeader { price: number | null; priceLabel: string | null; facets: { dimension: string; label: string }[] }
const headerReads = new Map<string, Promise<CardHeader | null>>();
function readCardHeader(vehicleId: string): Promise<CardHeader | null> {
  let read = headerReads.get(vehicleId);
  if (!read) {
    read = Promise.resolve(supabase.rpc('vehicle_profile_read', { p_vehicle_id: vehicleId })).then(({ data, error }) => {
      const sections: any[] = !error && Array.isArray((data as any)?.sections) ? (data as any).sections : [];
      const masthead = sections.find(section => section?.kind === 'masthead');
      const strip = sections.find(section => section?.kind === 'strip');
      if (!masthead && !strip) return null;
      return {
        // The read ships the price as a claim ({ value, unit, source, observed_at }).
        price: (amount => Number.isFinite(amount) && amount > 0 ? amount : null)(Number(masthead?.price?.value ?? masthead?.price)),
        priceLabel: typeof masthead?.priceLabel === 'string' ? masthead.priceLabel : null,
        facets: (Array.isArray(strip?.facets) ? strip.facets : [])
          .filter((facet: any) => typeof facet?.label === 'string' && facet.label && facet.dimension !== 'body_style')
          .map((facet: any) => ({ dimension: String(facet.dimension), label: facet.label as string })),
      };
    }).catch(() => null);
    headerReads.set(vehicleId, read);
  }
  return read;
}

/** "Active 19d ago" from the car's newest dated activity. */
function activeAgo(vehicle: GarageVehicle, now = Date.now()): string | null {
  const day = vehicle.last_activity_at?.slice(0, 10) ?? vehicle.timeline?.last_day ?? null;
  const at = day ? Date.parse(`${day}T12:00:00Z`) : NaN;
  if (!Number.isFinite(at)) return null;
  const days = Math.max(0, Math.round((now - at) / DAY_MS));
  return days === 0 ? 'Active today' : days < 60 ? `Active ${days}d ago` : days < 730 ? `Active ${Math.round(days / 30)}mo ago` : `Active ${Math.round(days / 365)}y ago`;
}

function GridCard({ vehicle, onRefresh, axis, actions = [] }: { vehicle: GarageVehicle; onRefresh?: () => void; axis?: GarageAxis; actions?: { label: string; onPress: () => void }[] }) {
  // The header read is asked for once the card is on screen.
  const cardRef = useRef<HTMLDivElement>(null);
  const [header, setHeader] = useState<CardHeader | null>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    let live = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void readCardHeader(vehicle.id).then(read => { if (live) setHeader(read); });
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => { live = false; observer.disconnect(); };
  }, [vehicle.id]);
  const price = header?.price ?? vehicle.estimated_value;
  const priceTitle = header?.price != null ? header.priceLabel ?? 'Price on the profile' : estimateTooltip(vehicle);
  const active = activeAgo(vehicle);
  const [vinCopied, setVinCopied] = useState(false);
  // The car's other photos load the first time the pointer or a finger reaches the photo; the reel is a
  // native scroll-snap strip (a two-finger swipe flips it) with arrows for a mouse. Order: garageReel.ts.
  const cover = vehicle.resolved_image_url;
  const [loadedReel, setReel] = useState<ReelFrame[]>([]);
  // A cover that arrives after the reel loaded is not shown twice.
  const reel = useMemo(() => cover ? loadedReel.filter(item => item.url !== cover) : loadedReel, [loadedReel, cover]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [coverDay, setCoverDay] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const reelRef = useRef<HTMLDivElement>(null);
  const reelAsked = useRef(false);
  const nextOffset = useRef(REEL_PAGE);
  const paging = useRef(false);
  // The analysis frame is read when the reel is first asked for, and exists only when a reader returned a line.
  const [analysis, setAnalysis] = useState<AnalysisLine[] | null>(null);
  const analysisAsked = useRef(false);
  const loadAnalysis = useCallback(() => {
    if (analysisAsked.current) return;
    analysisAsked.current = true;
    // The garage already read this car's class price; the frame reuses that row instead of asking again.
    readCardAnalysis(vehicle.id, vehicle.class_price).then(setAnalysis).catch(() => { analysisAsked.current = false; });
  }, [vehicle.id, vehicle.class_price]);
  const loadReel = useCallback(() => {
    if (reelAsked.current || (!cover && !vehicle.image_count)) return;
    reelAsked.current = true;
    // Asked for with the reel, so the Analysis chip is there however many photos sit in front of the frame.
    loadAnalysis();
    readReelStart(vehicle.id)
      .then(({ sequence, page, total }) => {
        const frames = appendFrames([], [...sequence, ...page], cover);
        setCoverDay(coverDayOf([...sequence, ...page], cover));
        setReel(frames);
        setPhotoTotal(total);
        // A short reel is already at its end.
        if ((cover ? 1 : 0) + frames.length <= 3) loadAnalysis();
      })
      .catch(() => { reelAsked.current = false; });
  }, [vehicle.id, cover, vehicle.image_count, loadAnalysis]);
  const loadMore = useCallback(() => {
    if (paging.current || nextOffset.current >= photoTotal) return;
    paging.current = true;
    const offset = nextOffset.current;
    readReelPage(vehicle.id, offset)
      .then(rows => {
        nextOffset.current = offset + REEL_PAGE;
        setCoverDay(day => day ?? coverDayOf(rows, cover));
        setReel(frames => appendFrames(frames, rows, cover));
      })
      .catch(() => {})
      .finally(() => { paging.current = false; });
  }, [vehicle.id, cover, photoTotal]);
  // Frame one is the cover when there is one; the reel's photos follow it; the analysis is always last.
  const photoFrames = (cover ? 1 : 0) + reel.length;
  const hasAnalysis = !!analysis?.length;
  const lastFrame = photoFrames - 1 + (hasAnalysis ? 1 : 0);
  const onAnalysis = hasAnalysis && frame >= photoFrames;
  const onReelScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const at = Math.round(event.currentTarget.scrollLeft / Math.max(1, event.currentTarget.clientWidth));
    setFrame(at);
    // Three frames from the end of what has loaded, the next page is asked for (not while the analysis shows,
    // so a page never lands in front of it), and the analysis with it.
    if (at >= photoFrames - 3) { if (at < photoFrames) loadMore(); loadAnalysis(); }
  };
  const toAnalysis = () => {
    const node = reelRef.current;
    // At once, so the photos passed on the way do not ask for more pages.
    if (node) node.scrollTo({ left: photoFrames * node.clientWidth });
  };
  const step = (by: number) => {
    loadReel();
    const node = reelRef.current;
    if (node) node.scrollBy({ left: by * node.clientWidth, behavior: 'smooth' });
  };
  const title = formatVehicleTitle(vehicle);
  const name = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim && vehicle.trim !== vehicle.model ? vehicle.trim : null]
    .filter(Boolean).join(' ');

  const copyVin = useCallback(() => {
    if (vehicle.vin) {
      navigator.clipboard.writeText(vehicle.vin);
      setVinCopied(true);
      setTimeout(() => setVinCopied(false), 1500);
    }
  }, [vehicle.vin]);

  const period = ownershipPeriod(vehicle);
  const relationship = [
    sentence(vehicle.relationship_type),
    // An owner-stated detail (transfer pending, disputed interest) belongs on the card, not in a tooltip.
    vehicle.relationship_detail && !/\d{4}-\d{2}-\d{2}/.test(vehicle.relationship_detail) ? sentence(vehicle.relationship_detail) : null,
    vehicle.inventory_status === 'previous' && vehicle.relationship_type !== 'PREVIOUSLY OWNED' ? 'previous' : null,
    vehicle.custody_org ? `at ${vehicle.custody_org.name}` : null,
    /\d{4}-\d{2}-\d{2}/.test(period) ? period : null,
  ].filter(Boolean).join(' · ');
  const span = recordSpan(vehicle);
  const counts = recordCounts(vehicle);

  return (
    <div className="garage-vehicle-card" ref={cardRef}>
      <article className="garage-card">
        <div className="garage-card-photo" onPointerEnter={loadReel} onTouchStart={loadReel}>
          <div className="garage-card-reel" ref={reelRef} onScroll={onReelScroll}>
            {(cover || !vehicle.image_count) && <Link to={`/vehicle/${vehicle.id}`} aria-hidden="true" tabIndex={-1}>
              {cover ? (
                <img
                  key={cover}
                  src={sharedOptimizeImageUrl(cover, 'medium') || cover}
                  alt={title}
                  width={600}
                  height={450}
                  loading="lazy"
                  decoding="async"
                  style={{ display: 'block' }}
                  onError={(e) => {
                    // Two-stage fallback. The optimized src routes through the Supabase
                    // /render/image transform endpoint — a single sitewide point of failure
                    // (outage/quota blanks every image at once while raw object URLs keep
                    // serving). First error: strip the render prefix/params and retry the
                    // raw /storage/v1/object/public/ URL. Second error: hide.
                    const img = e.target as HTMLImageElement;
                    const renderMarker = '/storage/v1/render/image/public/';
                    if (!img.dataset.rawFallbackTried && img.src.includes(renderMarker)) {
                      img.dataset.rawFallbackTried = '1';
                      img.src = img.src
                        .replace(renderMarker, '/storage/v1/object/public/')
                        .split('?')[0];
                      return;
                    }
                    img.style.display = 'none';
                  }}
                />
              ) : (
                // The cover arrives after the roster; only a car with no photos says so.
                <span className="garage-card-photo-empty">No photo yet</span>
              )}
            </Link>}
            {reel.map(({ url }) => (
              <Link key={url} to={`/vehicle/${vehicle.id}`} aria-hidden="true" tabIndex={-1}>
                <img src={sharedOptimizeImageUrl(url, 'medium') || url} alt="" width={600} height={450} loading="lazy" decoding="async" />
              </Link>
            ))}
            {hasAnalysis && <GarageCardAnalysis lines={analysis!} />}
          </div>
          {lastFrame > 0 && <>
            {frame > 0 && <button type="button" className="garage-card-step" data-dir="back" aria-label="Previous frame" onClick={() => step(-1)}>‹</button>}
            {frame < lastFrame && <button type="button" className="garage-card-step" data-dir="next" aria-label="Next frame" onClick={() => step(1)}>›</button>}
            {hasAnalysis && !onAnalysis && <button type="button" className="garage-card-to-analysis" onClick={toAnalysis}>Analysis</button>}
            {!onAnalysis && photoFrames > 1 && <span className="garage-card-frame">{Math.min(frame + 1, photoFrames)} / {Math.max(photoTotal, photoFrames).toLocaleString('en-US')}</span>}
          </>}
          {lastFrame <= 0 && (vehicle.image_count ?? 0) > 1 && <button type="button" className="garage-card-step" data-dir="next" aria-label="Next photo" onClick={() => step(1)}>›</button>}

          {/* This RPC revokes discovery membership, not an ownership period. */}
          {vehicle.relationship_source === 'discovered' && (
            <button
              type="button"
              className="garage-card-eject"
              title="Remove from garage"
              aria-label="Remove discovery from garage"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const ok = window.confirm(`Remove ${title} from your garage? This is reversible — the data is preserved.`);
                if (!ok) return;
                const { error } = await supabase.rpc('revoke_garage_membership', {
                  p_vehicle_id: vehicle.id,
                  p_reason: 'user_eject_from_garage_card',
                });
                if (error) {
                  alert(`Eject failed: ${error.message}`);
                  return;
                }
                onRefresh?.();
              }}
            >×</button>
          )}
        </div>

        <div className="garage-card-body">
          {/* Year, make and model lead from the left; the price holds the right edge. */}
          <div className="garage-card-head">
            <Link to={`/vehicle/${vehicle.id}`} aria-label={`Open ${title || 'vehicle record'}`} className="garage-card-title">
              {name || 'Unknown vehicle'}
            </Link>
            {price != null && <span className="garage-card-price" title={priceTitle}>{formatCurrency(price)}</span>}
          </div>
          {/* One lane, most important first; what the card's width cannot hold drops off the end. */}
          <div className="garage-card-lane">
            <Link to={`/vehicle/${vehicle.id}`} title={relationshipTooltip(vehicle)}>{relationship}</Link>
            {active && <Link to={`/vehicle/${vehicle.id}`} title="Open this car's timeline">{active}</Link>}
            {(header?.facets ?? []).map(facet => <Link key={facet.dimension} to={`/search?q=${encodeURIComponent(facet.label)}`} title={`Find other vehicles: ${facet.label}`}>{facet.label}</Link>)}
            {actions.map(action => <button key={action.label} type="button" onClick={action.onPress}>{action.label}</button>)}
          </div>

          <MiniBarcode vehicle={vehicle} axis={axis} litDay={cover ? (frame === 0 ? coverDay : reel[frame - 1]?.day) : reel[frame]?.day} />
          {(span || counts.length > 0) && (
            <p className="garage-card-record">
              {span && <span className="garage-card-span">{span}</span>}
              {counts.length > 0 && <span>{counts.join(' · ')}</span>}
            </p>
          )}

          <div className="garage-card-foot">
            {vehicle.vin
              ? <button type="button" className="garage-card-vin" onClick={copyVin}
                title="Copy VIN" aria-label={`Copy VIN ${vehicle.vin}`}>
                {vinCopied ? 'Copied' : truncateVin(vehicle.vin)}
              </button>
              : <span className="garage-card-vin-none">No VIN recorded</span>}
          </div>
        </div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List card (horizontal)
// ---------------------------------------------------------------------------

function ListCard({ vehicle, axis }: { vehicle: GarageVehicle; axis?: GarageAxis }) {
  const [hovered, setHovered] = useState(false);
  const [vinCopied, setVinCopied] = useState(false);
  const title = formatVehicleTitle(vehicle);

  const copyVin = useCallback((e: React.MouseEvent) => {
    if (vehicle.vin) {
      navigator.clipboard.writeText(vehicle.vin);
      setVinCopied(true);
      setTimeout(() => setVinCopied(false), 1500);
    }
  }, [vehicle.vin]);



  return (
    <div
      className="garage-vehicle-card"
      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <article style={{ ...BASE, flexDirection: 'row', alignItems: 'stretch', ...(hovered ? BASE_HOVER : {}) }}>
        {/* Thumbnail with mini barcode */}
        <div
          style={{
            width: 120,
            flexShrink: 0,
            backgroundColor: 'var(--bg, #f5f5f5)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Link to={`/vehicle/${vehicle.id}`} className="garage-card-image-link" aria-hidden="true" tabIndex={-1} />
          {vehicle.resolved_image_url ? (
            <img
              key={vehicle.resolved_image_url}
              src={optimizeImageUrl(vehicle.resolved_image_url)}
              alt={title}
              width={120}
              height={90}
              loading="lazy"
              decoding="async"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ ...LABEL, fontSize: 'var(--text-caption)' }}>NO IMAGE</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Link to={`/vehicle/${vehicle.id}`} aria-label={`Open ${title || 'vehicle record'}`} className="garage-card-title"
              style={{
                fontSize: 'var(--text-callout)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title || 'UNKNOWN VEHICLE'}
            </Link>
            <HoverData tooltip={relationshipTooltip(vehicle)}>
              <RelationshipBadge rel={vehicle.relationship_type} />
            </HoverData>
            {!vehicle.vin && (
              <HoverData tooltip="VIN NOT YET RECORDED">
                <MissingTag label="NO VIN" />
              </HoverData>
            )}
          </div>

          {vehicle.vin && (
            <HoverData
              tooltip={vinCopied ? 'COPIED!' : `${vehicle.vin} | CLICK TO COPY`}
              onClick={copyVin}
            >
              <span style={{
                ...MONO,
                fontSize: 'var(--text-caption)',
                color: vinCopied ? 'var(--success, #16825d)' : 'var(--text-secondary, #666666)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}>
                {vinCopied ? 'COPIED' : truncateVin(vehicle.vin)}
              </span>
            </HoverData>
          )}

          <div style={{ maxWidth: 300 }}><MiniBarcode vehicle={vehicle} axis={axis} /></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline' }}>
            {recordSpan(vehicle) && <span style={LABEL}>{recordSpan(vehicle)}</span>}
            {recordCounts(vehicle).length > 0 && <span style={LABEL}>{recordCounts(vehicle).join(' · ')}</span>}
            {vehicle.estimated_value != null && (
              <HoverData tooltip={estimateTooltip(vehicle)}>
                <span style={LABEL}>Estimate</span>
                <span style={{ ...MONO, fontSize: 'var(--text-callout)', fontWeight: 700, marginLeft: 4 }}>
                  {formatCurrency(vehicle.estimated_value)}
                </span>
              </HoverData>
            )}
          </div>

          <div style={{ maxWidth: 280 }}>
            <HealthBar score={vehicle.health_score} vehicle={vehicle} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '2px solid var(--border, #bdbdbd)' }}>
          <ActionStrip vehicle={vehicle} vertical />
        </div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact card (one-liner)
// ---------------------------------------------------------------------------

function CompactCard({ vehicle }: { vehicle: GarageVehicle }) {
  const [hovered, setHovered] = useState(false);
  const [vinCopied, setVinCopied] = useState(false);
  const title = formatVehicleTitle(vehicle);

  return (
    <Link
      className="garage-vehicle-card"
      aria-label={`Open ${title || 'vehicle record'}`}
      to={`/vehicle/${vehicle.id}`}
      style={{
        textDecoration: 'none', display: 'block', color: 'inherit',

      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          ...BASE,
          flexDirection: 'row',
          alignItems: 'center',
          padding: '6px 8px',
          gap: 8,
          ...(hovered ? BASE_HOVER : {}),
        }}
      >
        <HoverData tooltip={vehicle.vin ? `VIN: ${vehicle.vin}` : 'NO VIN'}>
          <span
            style={{
              fontSize: 'var(--text-callout)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title || 'UNKNOWN VEHICLE'}
          </span>
        </HoverData>
        <HoverData tooltip={relationshipTooltip(vehicle)}>
          <RelationshipBadge rel={vehicle.relationship_type} />
        </HoverData>
        {!vehicle.vin && (
          <HoverData tooltip="VIN NOT YET RECORDED">
            <MissingTag label="NO VIN" />
          </HoverData>
        )}
        <HoverData tooltip={estimateTooltip(vehicle)}>
          <span style={{ ...MONO, fontSize: 'var(--text-callout)', fontWeight: 700, flexShrink: 0 }}>
            {vehicle.estimated_value != null ? formatCurrency(vehicle.estimated_value) : '—'}
          </span>
        </HoverData>
        <span style={{ ...LABEL, fontSize: 'var(--text-caption)', flexShrink: 0 }}>
          {formatRelativeTime(vehicle.updated_at)}
        </span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export function GarageVehicleCard({
  vehicle,
  viewMode = 'GRID',
  onRefresh,
  axis,
  actions,
}: GarageVehicleCardProps) {
  if (viewMode === 'LIST') return <ListCard vehicle={vehicle} axis={axis} />;
  if (viewMode === 'COMPACT') return <CompactCard vehicle={vehicle} />;
  return <GridCard vehicle={vehicle} onRefresh={onRefresh} axis={axis} actions={actions} />;
}

export default GarageVehicleCard;
