/** Garage cards preserve recorded relationships, evidence and estimate coverage. */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Link from '../PrefetchLink';
import { supabase } from '../../lib/supabase';
import { optimizeImageUrl as sharedOptimizeImageUrl } from '../../lib/imageOptimizer';
import type { GarageVehicle, RelationshipType, ViewMode } from '../../hooks/useVehiclesDashboard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GarageVehicleCardProps {
  vehicle: GarageVehicle;
  viewMode?: ViewMode;
  onRefresh?: () => void;
}

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
  0: 'var(--bg, #f5f5f5)',
  1: 'var(--success-dim, rgba(22, 130, 93, 0.1))',
  2: 'var(--success, #16825d)',
  3: 'var(--success, #16825d)',
  4: 'var(--accent, #2a2a2a)',
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
// MiniBarcode — compressed timeline strip under image
// ---------------------------------------------------------------------------

function MiniBarcode({ eventWeeks }: { eventWeeks: string[] | null }) {
  const bars = useMemo(() => {
    if (!eventWeeks || eventWeeks.length === 0) return null;

    // Count events per week bucket
    const weekCounts = new Map<string, number>();
    for (const w of eventWeeks) {
      const key = w.slice(0, 10); // YYYY-MM-DD
      weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
    }

    const sorted = [...weekCounts.keys()].sort();
    if (sorted.length === 0) return null;

    const earliest = new Date(sorted[0] + 'T00:00:00');
    const latest = new Date(sorted[sorted.length - 1] + 'T00:00:00');

    // Build all weeks from earliest to latest
    const allWeeks: { key: string; level: number }[] = [];
    const cur = new Date(earliest);
    while (cur <= latest) {
      const key = cur.toISOString().slice(0, 10);
      const count = weekCounts.get(key) || 0;
      const level = count === 0 ? 0 : count >= 4 ? 4 : count >= 3 ? 3 : count >= 2 ? 2 : 1;
      allWeeks.push({ key, level });
      cur.setDate(cur.getDate() + 7);
    }

    // If too many weeks (>200), group by month
    if (allWeeks.length > 200) {
      const monthMap = new Map<string, number>();
      for (const w of allWeeks) {
        const monthKey = w.key.slice(0, 7); // YYYY-MM
        monthMap.set(monthKey, Math.max(monthMap.get(monthKey) || 0, w.level));
      }
      return [...monthMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, level]) => ({ key, level }));
    }

    return allWeeks;
  }, [eventWeeks]);

  if (!bars || bars.length === 0) {
    // Empty barcode — subtle indicator that no events exist
    return (
      <div
        style={{
          width: '100%',
          height: '3%',
          minHeight: 3,
          maxHeight: 6,
          backgroundColor: 'var(--bg, #f5f5f5)',
          position: 'absolute',
          bottom: 0,
          left: 0,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '3%',
        minHeight: 3,
        maxHeight: 6,
        display: 'flex',
        position: 'absolute',
        bottom: 0,
        left: 0,
        backgroundColor: 'var(--bg, #f5f5f5)',
      }}
      title={`${bars.filter(b => b.level > 0).length} active periods`}
    >
      {bars.map((bar) => (
        <div
          key={bar.key}
          style={{
            flex: 1,
            height: '100%',
            backgroundColor: BARCODE_COLORS[bar.level],
            minWidth: 1,
          }}
        />
      ))}
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
// Grid card (full detail)
// ---------------------------------------------------------------------------

function GridCard({ vehicle, onRefresh }: { vehicle: GarageVehicle; onRefresh?: () => void }) {
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



  const yearAge = vehicle.year ? `${new Date().getFullYear() - vehicle.year} YEARS OLD` : '';
  const valueTooltip = estimateTooltip(vehicle);
  const deltaTooltip = vehicle.value_delta != null && vehicle.purchase_price != null
    ? `${formatCurrency(vehicle.purchase_price)} → ${formatCurrency(vehicle.estimated_value!)}`
    : '';



  return (
    <div
      className="garage-vehicle-card"
      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <article style={{ ...BASE, ...(hovered ? BASE_HOVER : {}) }}>
        {/* Image 16:9 + mini barcode */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            paddingBottom: '56.25%',
            backgroundColor: 'var(--bg, #f5f5f5)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <Link to={`/vehicle/${vehicle.id}`} className="garage-card-image-link" aria-hidden="true" tabIndex={-1} />
          {(vehicle.resolved_image_url || vehicle.primary_image_url) ? (
            <img
              src={optimizeImageUrl(vehicle.resolved_image_url || vehicle.primary_image_url!)}
              alt={title}
              width={400}
              height={225}
              loading="lazy"
              decoding="async"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
              }}
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
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src="/nuke.png"
                alt="No image"
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
                style={{ width: 48, height: 48, opacity: 0.3, objectFit: 'contain' }}
              />
            </div>
          )}

          {/* Relationship badge — top-left, solid bg */}
          <HoverData
            tooltip={relationshipTooltip(vehicle)}
            style={{ position: 'absolute', top: 6, left: 6, zIndex: 2 }}
          >
            <div
              style={{
                backgroundColor: 'var(--surface, #ebebeb)',
                border: '1px solid var(--border)', padding: '1px 4px',
              }}
            >
              <span style={{ ...LABEL, fontSize: 'var(--text-caption)', color: 'var(--text-secondary, #666666)' }}>
                {vehicle.relationship_type}
              </span>
            </div>
          </HoverData>

          {/* This RPC revokes discovery membership, not an ownership period. */}
          {vehicle.relationship_source === 'discovered' && (
            <button
              type="button"
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
              style={{
                position: 'absolute',
                zIndex: 2,
                top: 6,
                right: 6,
                width: 44,
                height: 44,
                padding: 0,
                fontFamily: FONT_MONO,
                fontSize: '12px',
                fontWeight: 700,
                lineHeight: 1,
                cursor: 'pointer',
                backgroundColor: 'var(--surface, #ebebeb)',
                color: 'var(--text-secondary, #666666)',
                border: '1px solid var(--border)',

              }}
            >×</button>
          )}

          {/* Mini timeline barcode */}
          <MiniBarcode eventWeeks={vehicle.event_weeks} />
        </div>

        {/* Body */}
        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'visible' }}>
          {/* Title — each part hoverable */}
          <Link to={`/vehicle/${vehicle.id}`} aria-label={`Open ${title || 'vehicle record'}`} className="garage-card-title"
            style={{
              fontSize: 'var(--text-callout)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'var(--text, #2a2a2a)',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              gap: 4,
            }}
          >
            {vehicle.year ? (
              <HoverData tooltip={`${vehicle.year} MODEL YEAR | ${yearAge}`}>{String(vehicle.year)}</HoverData>
            ) : null}
            {vehicle.make ? (
              <HoverData tooltip={`MANUFACTURER: ${vehicle.make.toUpperCase()}`}>{vehicle.make.toUpperCase()}</HoverData>
            ) : null}
            {vehicle.model ? (
              <HoverData tooltip={`MODEL: ${vehicle.model.toUpperCase()}${vehicle.trim ? ' ' + vehicle.trim.toUpperCase() : ''}`}>{vehicle.model.toUpperCase()}</HoverData>
            ) : null}
            {vehicle.trim && vehicle.model !== vehicle.trim ? (
              <HoverData tooltip={`TRIM: ${vehicle.trim.toUpperCase()}`}>{vehicle.trim.toUpperCase()}</HoverData>
            ) : null}
            {!title && <span>UNKNOWN VEHICLE</span>}
          </Link>

          <span style={{ ...MONO, ...LABEL }} title={relationshipTooltip(vehicle)}>
            {ownershipPeriod(vehicle)}
          </span>
          <span style={LABEL}>Source: {relationshipSource(vehicle)}</span>

          {/* VIN + missing tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {vehicle.vin ? (
              <HoverData
                tooltip={vinCopied ? 'COPIED!' : `${vehicle.vin} | CLICK TO COPY`}
                onClick={copyVin}
              >
                <span
                  style={{
                    ...MONO,
                    fontSize: 'var(--text-caption)',
                    color: vinCopied ? 'var(--success, #16825d)' : 'var(--text-secondary, #666666)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 130,
                    transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {vinCopied ? 'COPIED' : truncateVin(vehicle.vin)}
                </span>
              </HoverData>
            ) : (
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

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border, #bdbdbd)' }} />

          {/* Data rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Value */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <HoverData tooltip={valueTooltip}>
                <span style={LABEL}>Estimate</span>
                {vehicle.estimated_value != null ? (
                  <span style={{ ...MONO, fontSize: 'var(--text-callout)', fontWeight: 700, color: 'var(--text, #2a2a2a)', marginLeft: 4 }}>
                    {formatCurrency(vehicle.estimated_value)}
                  </span>
                ) : (
                  <span style={{ ...MONO, fontSize: 'var(--text-callout)', color: 'var(--text-secondary, #666666)', marginLeft: 4 }}>—</span>
                )}
              </HoverData>
              {vehicle.value_delta != null && vehicle.value_delta !== 0 && (
                <HoverData tooltip={deltaTooltip}>
                  <span
                    style={{
                      ...MONO,
                      fontSize: 'var(--text-caption)',
                      color: vehicle.value_delta > 0 ? 'var(--success, #16825d)' : 'var(--error, #d13438)',
                    }}
                  >
                    {vehicle.value_delta > 0 ? '+' : ''}{formatCurrency(vehicle.value_delta)}
                  </span>
                </HoverData>
              )}
            </div>

            {/* Counts */}
            <div style={{ display: 'flex', gap: 12 }}>
              <HoverData tooltip={vehicle.view_count == null ? 'View count unavailable' : `${vehicle.view_count} recorded views`}>
                <span style={LABEL}>VIEWS</span>
                <span style={{ ...MONO, fontSize: 'var(--text-callout)', fontWeight: 700, marginLeft: 3 }}>{vehicle.view_count ?? '—'}</span>
              </HoverData>
            </div>

            {/* Health bar */}
            <HealthBar score={vehicle.health_score} vehicle={vehicle} />
          </div>
        </div>

        <ActionStrip vehicle={vehicle} />
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
          {(vehicle.resolved_image_url || vehicle.primary_image_url) ? (
            <img
              src={optimizeImageUrl(vehicle.resolved_image_url || vehicle.primary_image_url!)}
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
          <MiniBarcode eventWeeks={vehicle.event_weeks} />
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
}: GarageVehicleCardProps) {
  if (viewMode === 'LIST') return <ListCard vehicle={vehicle} />;
  if (viewMode === 'COMPACT') return <CompactCard vehicle={vehicle} />;
  return <GridCard vehicle={vehicle} onRefresh={onRefresh} />;
}

export default GarageVehicleCard;
