/** Garage cards: the photo, the car, its activity timeline, and the facts on record. */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Link from '../PrefetchLink';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl as sharedOptimizeImageUrl } from '../../lib/imageOptimizer';
import type { GarageVehicle, RelationshipType, ViewMode } from '../../hooks/useVehiclesDashboard';
import '../garage/garage.css';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GarageVehicleCardProps {
  vehicle: GarageVehicle;
  viewMode?: ViewMode;
  onRefresh?: () => void;
  /** First and last month (YYYY-MM) every card's strip spans, so the strips line up down the page. */
  axis?: GarageAxis;
}

export interface GarageAxis { start: string; end: string }

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
// Barcode colors (matches BarcodeTimeline.tsx)
// ---------------------------------------------------------------------------

const BARCODE_COLORS: Record<number, string> = {
  1: 'var(--heat-3, #34d399)',
  2: 'var(--heat-4, #059669)',
  3: 'var(--heat-5, #047857)',
  4: 'var(--heat-6, #065f46)',
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
// MiniBarcode — the car's activity by month. A strip in the grid card, a sliver
// over the thumbnail in the list card.
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Recorded items per month: the month reader when present, otherwise the event weeks. */
function monthTotals(vehicle: GarageVehicle): Map<string, number> {
  const totals = new Map<string, number>();
  if (vehicle.timeline?.months.length) {
    for (const [ym, photos, work, events, documents] of vehicle.timeline.months) {
      totals.set(ym, (Number(photos) || 0) + (Number(work) || 0) + (Number(events) || 0) + (Number(documents) || 0));
    }
    return totals;
  }
  for (const week of vehicle.event_weeks ?? []) {
    const ym = week.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) totals.set(ym, (totals.get(ym) || 0) + 1);
  }
  return totals;
}

/** The same thresholds on every card, so two strips can be compared. */
const monthLevel = (n: number) => (n >= 60 ? 4 : n >= 20 ? 3 : n >= 5 ? 2 : 1);

function MiniBarcode({ vehicle, axis, variant }: { vehicle: GarageVehicle; axis?: GarageAxis; variant: 'strip' | 'overlay' }) {
  const strip = useMemo(() => {
    const totals = monthTotals(vehicle);
    const active = [...totals.entries()].filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
    if (active.length === 0) return null;
    const first = Math.min(monthIndex(active[0][0]), axis ? monthIndex(axis.start) : Infinity);
    const last = Math.max(monthIndex(active[active.length - 1][0]), axis ? monthIndex(axis.end) : -Infinity);
    const years: number[] = [];
    for (let m = Math.ceil(first / 12) * 12; m <= last; m += 12) if (m > first) years.push(m - first);
    return {
      span: last - first + 1,
      years,
      bars: active.map(([ym, n]) => ({ ym, x: monthIndex(ym) - first, level: monthLevel(n), n })),
      label: `Recorded activity by month: ${active.length} active ${active.length === 1 ? 'month' : 'months'}, ${monthLabel(active[0][0])} to ${monthLabel(active[active.length - 1][0])}`,
    };
  }, [vehicle, axis]);

  if (!strip) return variant === 'strip' ? null : <div className="garage-barcode garage-barcode-overlay" />;

  return (
    <div className={`garage-barcode garage-barcode-${variant}`} role="img" aria-label={strip.label} title={strip.label}>
      <svg viewBox={`0 0 ${strip.span} 4`} preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        {variant === 'strip' && strip.years.map(x => <rect key={`y${x}`} className="garage-barcode-year" x={x} y={0} width={0.12} height={4} />)}
        {strip.bars.map(bar => (
          <rect key={bar.ym} x={bar.x + 0.08} width={0.84}
            y={variant === 'strip' ? 4 - bar.level : 0} height={variant === 'strip' ? bar.level : 4}
            style={{ fill: BARCODE_COLORS[bar.level] }} />
        ))}
      </svg>
    </div>
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

function GridCard({ vehicle, onRefresh, axis }: { vehicle: GarageVehicle; onRefresh?: () => void; axis?: GarageAxis }) {
  const [vinCopied, setVinCopied] = useState(false);
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
    vehicle.custody_org ? `at ${vehicle.custody_org.name}` : null,
    /\d{4}-\d{2}-\d{2}/.test(period) ? period : null,
  ].filter(Boolean).join(' · ');
  const span = recordSpan(vehicle);
  const counts = recordCounts(vehicle);

  return (
    <div className="garage-vehicle-card">
      <article className="garage-card">
        <div className="garage-card-photo">
          <Link to={`/vehicle/${vehicle.id}`} className="garage-card-image-link" aria-hidden="true" tabIndex={-1} />
          {vehicle.resolved_image_url ? (
            <img
              key={vehicle.resolved_image_url}
              src={sharedOptimizeImageUrl(vehicle.resolved_image_url, 'medium') || vehicle.resolved_image_url}
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
            <span className="garage-card-photo-empty">No photo yet</span>
          )}

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
          <Link to={`/vehicle/${vehicle.id}`} aria-label={`Open ${title || 'vehicle record'}`} className="garage-card-title">
            {name || 'Unknown vehicle'}
          </Link>
          <p className="garage-card-relationship" title={relationshipTooltip(vehicle)}>{relationship}</p>

          <MiniBarcode vehicle={vehicle} axis={axis} variant="strip" />
          {(span || counts.length > 0) && (
            <p className="garage-card-record">
              {span && <span className="garage-card-span">{span}</span>}
              {counts.length > 0 && <span>{counts.join(' · ')}</span>}
            </p>
          )}

          {(vehicle.vin || vehicle.estimated_value != null) && (
            <div className="garage-card-foot">
              {vehicle.vin ? (
                <button type="button" className="garage-card-vin" onClick={copyVin}
                  title="Copy VIN" aria-label={`Copy VIN ${vehicle.vin}`}>
                  {vinCopied ? 'Copied' : truncateVin(vehicle.vin)}
                </button>
              ) : <span />}
              {vehicle.estimated_value != null && (
                <span className="garage-card-estimate" title={estimateTooltip(vehicle)}>
                  {formatCurrency(vehicle.estimated_value)}
                </span>
              )}
            </div>
          )}
        </div>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List card (horizontal)
// ---------------------------------------------------------------------------

function ListCard({ vehicle }: { vehicle: GarageVehicle }) {
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
          <MiniBarcode vehicle={vehicle} variant="overlay" />
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
            {vehicle.estimated_value == null && (
              <HoverData tooltip="CURRENT BUILD-CLASS ESTIMATE UNAVAILABLE">
                <MissingTag label="NOT ESTIMATED" />
              </HoverData>
            )}
          </div>

          <span style={LABEL}>Source: {relationshipSource(vehicle)}</span>
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

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline' }}>
            <HoverData tooltip={estimateTooltip(vehicle)}>
              <span style={LABEL}>Estimate</span>
              <span style={{ ...MONO, fontSize: 'var(--text-callout)', fontWeight: 700, marginLeft: 4 }}>
                {vehicle.estimated_value != null ? formatCurrency(vehicle.estimated_value) : '—'}
              </span>
            </HoverData>
            <HoverData tooltip={vehicle.view_count == null ? 'View count unavailable' : `${vehicle.view_count} recorded views`}>
              <span style={LABEL}>VWS</span>
              <span style={{ ...MONO, fontSize: 'var(--text-callout)', marginLeft: 3 }}>{vehicle.view_count ?? '—'}</span>
            </HoverData>
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
}: GarageVehicleCardProps) {
  if (viewMode === 'LIST') return <ListCard vehicle={vehicle} />;
  if (viewMode === 'COMPACT') return <CompactCard vehicle={vehicle} />;
  return <GridCard vehicle={vehicle} onRefresh={onRefresh} axis={axis} />;
}

export default GarageVehicleCard;
