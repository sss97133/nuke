/**
 * GarageVehicleCard.tsx
 * Redesigned vehicle card following the NUKE design system.
 *
 * Design rules enforced:
 *   - 0px border-radius everywhere
 *   - No backdrop-filter, no box-shadow, no translateY
 *   - Hover = border-color change to --border-focus only
 *   - All labels ALL CAPS, 8px, letter-spacing 0.5px
 *   - Monospace (Courier New) for all numeric data
 *   - Health bar as 2px progress bar below content
 *   - Solid opaque backgrounds — no blur overlays
 *   - Every element interactive: hover shows tooltip, click triggers action
 *   - Mini timeline barcode under image (3% height)
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { GarageVehicle, RelationshipType, ViewMode } from '../../hooks/useVehiclesDashboard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GarageVehicleCardProps {
  vehicle: GarageVehicle;
  viewMode?: ViewMode;
  onRefresh?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isTriageActive?: boolean;
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
  if (url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') +
      '?width=632&height=356&quality=85&resize=cover';
  }
  return url;
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

const FONT_BODY = 'Arial, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";

const BASE: React.CSSProperties = {
  fontFamily: FONT_BODY,
  fontSize: '9px',
  color: 'var(--text, #2a2a2a)',
  backgroundColor: 'var(--surface, #ebebeb)',
  border: '2px solid var(--border, #bdbdbd)',
  borderRadius: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  transition: 'border-color 0.12s ease',
  cursor: 'pointer',
};

const BASE_HOVER: React.CSSProperties = {
  borderColor: 'var(--border-focus, #2a2a2a)',
};

const MONO: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const LABEL: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text-secondary, #666666)',
};

const TOOLTIP_STYLE: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  padding: '3px 6px',
  fontFamily: FONT_MONO,
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--bg, #f5f5f5)',
  backgroundColor: 'var(--text, #2a2a2a)',
  border: '2px solid var(--text, #2a2a2a)',
  borderRadius: 0,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
  transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

// ---------------------------------------------------------------------------
// Barcode colors (matches BarcodeTimeline.tsx)
// ---------------------------------------------------------------------------

const BARCODE_COLORS: Record<number, string> = {
  0: 'var(--bg, #f5f5f5)',
  1: '#a7f3d0',
  2: '#34d399',
  3: '#059669',
  4: '#047857',
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
        color: accent.color,
        border: `2px solid ${accent.border}`,
        backgroundColor: accent.bg,
        borderRadius: 0,
        padding: '1px 4px',
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
        fontSize: '8px',
        color: 'var(--warning, #b05a00)',
        border: '2px solid var(--warning, #b05a00)',
        borderRadius: 0,
        padding: '1px 4px',
        display: 'inline-block',
      }}
    >
      {label}
    </span>
  );
}

function HealthBar({ score, vehicle }: { score: number | null; vehicle: GarageVehicle }) {
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
            backgroundColor: 'var(--border, #bdbdbd)',
            borderRadius: 0,
            position: 'relative',
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
              transition: 'width 0.12s ease',
            }}
          />
        </div>
        <span style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #666666)', minWidth: 22 }}>
          {pct != null ? `${pct}` : '—'}
        </span>
      </div>
    </HoverData>
  );
}

// ---------------------------------------------------------------------------
// Quick-assign chips for CONTRIBUTOR vehicles (upgrade relationship)
// ---------------------------------------------------------------------------

const QUICK_ASSIGN_CHIPS = [
  { label: 'OWN', table: 'vehicle_user_permissions', role: 'owner' },
  { label: 'CO-OWN', table: 'vehicle_user_permissions', role: 'co_owner' },
  { label: 'PREV OWNER', table: 'discovered_vehicles', type: 'previously_owned' },
  { label: 'WORKED ON', table: 'vehicle_contributors', role: 'contributor' },
] as const;

function QuickAssignStrip({
  vehicleId,
  onRefresh,
}: {
  vehicleId: string;
  onRefresh?: () => void;
}) {
  const [assigning, setAssigning] = useState<string | null>(null);

  const handleAssign = useCallback(async (chip: typeof QUICK_ASSIGN_CHIPS[number]) => {
    setAssigning(chip.label);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (chip.table === 'vehicle_user_permissions') {
        await supabase.from('vehicle_user_permissions').upsert({
          vehicle_id: vehicleId,
          user_id: user.id,
          role: chip.role,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'vehicle_id,user_id' });
      } else if (chip.table === 'discovered_vehicles') {
        const isDismiss = 'dismiss' in chip && (chip as any).dismiss;
        await supabase.from('discovered_vehicles').upsert({
          vehicle_id: vehicleId,
          user_id: user.id,
          relationship_type: (chip as any).type,
          is_active: !isDismiss,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'vehicle_id,user_id' });
      } else if (chip.table === 'vehicle_contributors') {
        await supabase.from('vehicle_contributors').upsert({
          vehicle_id: vehicleId,
          user_id: user.id,
          role: chip.role,
          status: 'active',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'vehicle_id,user_id' });
      }

      onRefresh?.();
    } catch (err) {
      console.error('Quick assign error:', err);
    } finally {
      setAssigning(null);
    }
  }, [vehicleId, onRefresh]);

  return (
    <div
      style={{
        borderTop: '2px solid var(--border, #bdbdbd)',
        padding: '6px 8px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
      }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <span style={{ ...LABEL, width: '100%', marginBottom: 2 }}>ASSIGN RELATIONSHIP</span>
      {QUICK_ASSIGN_CHIPS.map((chip) => {
        const isDismiss = 'dismiss' in chip && (chip as any).dismiss;
        return (
          <button
            key={chip.label}
            disabled={assigning !== null}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleAssign(chip);
            }}
            style={{
              padding: '2px 6px',
              fontSize: '8px',
              fontWeight: 700,
              fontFamily: FONT_BODY,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              border: `2px solid ${isDismiss ? 'var(--error, #d13438)' : 'var(--border, #bdbdbd)'}`,
              borderRadius: 0,
              backgroundColor: assigning === chip.label
                ? 'var(--text, #2a2a2a)'
                : isDismiss
                ? 'var(--error-dim, rgba(209, 52, 56, 0.1))'
                : 'transparent',
              color: assigning === chip.label
                ? 'var(--bg, #f5f5f5)'
                : isDismiss
                ? 'var(--error, #d13438)'
                : 'var(--text, #2a2a2a)',
              cursor: assigning ? 'wait' : 'pointer',
              opacity: assigning && assigning !== chip.label ? 0.5 : 1,
              transition: 'background-color 0.12s ease, color 0.12s ease',
              marginLeft: isDismiss ? 'auto' : undefined,
            }}
          >
            {assigning === chip.label ? '...' : chip.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action strip
// ---------------------------------------------------------------------------

function ActionStrip({
  vehicle,
  vertical = false,
  onRelationshipClick,
}: {
  vehicle: GarageVehicle;
  vertical?: boolean;
  onRelationshipClick?: (e: React.MouseEvent) => void;
}) {
  const primaryAction =
    vehicle.estimated_value == null
      ? 'SET VALUE'
      : (vehicle.image_count ?? 0) < 3
      ? 'ADD PHOTOS'
      : 'VIEW DETAILS';

  if (vertical) {
    return (
      <div
        style={{
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          ...LABEL,
          fontSize: '8px',
          color: 'var(--text, #2a2a2a)',
          writingMode: 'vertical-rl',
          whiteSpace: 'nowrap',
        }}
      >
        {primaryAction}
      </div>
    );
  }

  return (
    <div
      style={{
        borderTop: '2px solid var(--border, #bdbdbd)',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <HoverData tooltip={primaryAction === 'VIEW DETAILS' ? 'OPEN VEHICLE PROFILE' : primaryAction === 'SET VALUE' ? 'ADD ESTIMATED VALUE' : 'UPLOAD MORE PHOTOS'} style={{ flex: 1 }}>
        <div
          style={{
            flex: 1,
            padding: '6px 8px',
            ...LABEL,
            fontSize: '9px',
            color: 'var(--text, #2a2a2a)',
            textAlign: 'center',
            borderRight: '2px solid var(--border, #bdbdbd)',
          }}
        >
          {primaryAction}
        </div>
      </HoverData>
      <HoverData
        tooltip="CHANGE RELATIONSHIP TO THIS VEHICLE"
        onClick={onRelationshipClick}
      >
        <div
          style={{
            padding: '6px 8px',
            ...LABEL,
            fontSize: '9px',
            color: 'var(--text-secondary, #666666)',
            whiteSpace: 'nowrap',
          }}
        >
          RELATIONSHIP
        </div>
      </HoverData>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid card (full detail)
// ---------------------------------------------------------------------------

function GridCard({ vehicle, onRefresh, onDragStart, onDragEnd, isDragging, isTriageActive }: {
  vehicle: GarageVehicle; onRefresh?: () => void;
  onDragStart?: () => void; onDragEnd?: () => void; isDragging?: boolean; isTriageActive?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [vinCopied, setVinCopied] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const title = formatVehicleTitle(vehicle);
  const showQuickAssign = vehicle.relationship_type === 'CONTRIBUTOR';

  const copyVin = useCallback((e: React.MouseEvent) => {
    if (vehicle.vin) {
      navigator.clipboard.writeText(vehicle.vin);
      setVinCopied(true);
      setTimeout(() => setVinCopied(false), 1500);
    }
  }, [vehicle.vin]);

  const toggleAssign = useCallback((e: React.MouseEvent) => {
    setShowAssign(prev => !prev);
  }, []);

  const yearAge = vehicle.year ? `${new Date().getFullYear() - vehicle.year} YEARS OLD` : '';
  const valueTooltip = vehicle.estimated_value != null
    ? vehicle.purchase_price != null && vehicle.purchase_price !== vehicle.estimated_value
      ? `ESTIMATED VALUE | PAID ${formatCurrency(vehicle.purchase_price)}`
      : 'ESTIMATED VALUE'
    : 'NO VALUE SET';
  const deltaTooltip = vehicle.value_delta != null && vehicle.purchase_price != null
    ? `${formatCurrency(vehicle.purchase_price)} → ${formatCurrency(vehicle.estimated_value!)}`
    : '';

  const dragStyle: React.CSSProperties = isDragging
    ? { borderColor: 'var(--text, #2a2a2a)', transform: 'scale(1.02)', opacity: 0.8, zIndex: 10 }
    : isTriageActive
    ? { opacity: 0.4, transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)' }
    : {};

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', vehicle.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      style={{ textDecoration: 'none', display: 'block', color: 'inherit', ...dragStyle }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <article style={{ ...BASE, ...(hovered && !isTriageActive ? BASE_HOVER : {}) }}>
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
          {(vehicle.resolved_image_url || vehicle.primary_image_url) ? (
            <img
              src={optimizeImageUrl(vehicle.resolved_image_url || vehicle.primary_image_url!)}
              alt={title}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
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
              <img src="/nuke.png" alt="No image" style={{ width: 48, height: 48, opacity: 0.3, objectFit: 'contain' }} />
            </div>
          )}

          {/* Relationship badge — top-left, solid bg */}
          <HoverData
            tooltip={`${vehicle.relationship_type} | ${vehicle.relationship_source.toUpperCase()}`}
            style={{ position: 'absolute', top: 6, left: 6 }}
          >
            <div
              style={{
                backgroundColor: 'var(--surface, #ebebeb)',
                border: '2px solid var(--border, #bdbdbd)',
                borderRadius: 0,
                padding: '1px 4px',
              }}
            >
              <span style={{ ...LABEL, fontSize: '8px', color: 'var(--text-secondary, #666666)' }}>
                {vehicle.relationship_type}
              </span>
            </div>
          </HoverData>

          {/* Mini timeline barcode */}
          <MiniBarcode eventWeeks={vehicle.event_weeks} />
        </div>

        {/* Body */}
        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'visible' }}>
          {/* Title — each part hoverable */}
          <div
            style={{
              fontSize: '11px',
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
          </div>

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
                    fontSize: '8px',
                    color: vinCopied ? 'var(--success, #16825d)' : 'var(--text-secondary, #666666)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 130,
                    transition: 'color 180ms ease',
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
              <HoverData tooltip="NO ESTIMATED VALUE SET">
                <MissingTag label="NO PRICE" />
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
                <span style={LABEL}>VALUE</span>
                {vehicle.estimated_value != null ? (
                  <span style={{ ...MONO, fontSize: '10px', fontWeight: 700, color: 'var(--text, #2a2a2a)', marginLeft: 4 }}>
                    {formatCurrency(vehicle.estimated_value)}
                  </span>
                ) : (
                  <span style={{ ...MONO, fontSize: '9px', color: 'var(--text-secondary, #666666)', marginLeft: 4 }}>—</span>
                )}
              </HoverData>
              {vehicle.value_delta != null && vehicle.value_delta !== 0 && (
                <HoverData tooltip={deltaTooltip}>
                  <span
                    style={{
                      ...MONO,
                      fontSize: '8px',
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
              <HoverData tooltip={`${vehicle.view_count ?? 0} TOTAL VIEWS`}>
                <span style={LABEL}>VIEWS</span>
                <span style={{ ...MONO, fontSize: '9px', fontWeight: 700, marginLeft: 3 }}>{vehicle.view_count ?? '—'}</span>
              </HoverData>
            </div>

            {/* Health bar */}
            <HealthBar score={vehicle.health_score} vehicle={vehicle} />
          </div>
        </div>

        {/* Action strip or quick-assign */}
        {showQuickAssign || showAssign ? (
          <QuickAssignStrip vehicleId={vehicle.id} onRefresh={onRefresh} />
        ) : (
          <ActionStrip vehicle={vehicle} onRelationshipClick={toggleAssign} />
        )}
      </article>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// List card (horizontal)
// ---------------------------------------------------------------------------

function ListCard({ vehicle, onRefresh, onDragStart, onDragEnd, isDragging, isTriageActive }: {
  vehicle: GarageVehicle; onRefresh?: () => void;
  onDragStart?: () => void; onDragEnd?: () => void; isDragging?: boolean; isTriageActive?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [vinCopied, setVinCopied] = useState(false);
  const title = formatVehicleTitle(vehicle);
  const showQuickAssign = vehicle.relationship_type === 'CONTRIBUTOR';

  const copyVin = useCallback((e: React.MouseEvent) => {
    if (vehicle.vin) {
      navigator.clipboard.writeText(vehicle.vin);
      setVinCopied(true);
      setTimeout(() => setVinCopied(false), 1500);
    }
  }, [vehicle.vin]);

  const dragStyle: React.CSSProperties = isDragging
    ? { borderColor: 'var(--text, #2a2a2a)', transform: 'scale(1.02)', opacity: 0.8, zIndex: 10 }
    : isTriageActive
    ? { opacity: 0.4, transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)' }
    : {};

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', vehicle.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      style={{ textDecoration: 'none', display: 'block', color: 'inherit', ...dragStyle }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <article style={{ ...BASE, flexDirection: 'row', alignItems: 'stretch', ...(hovered && !isTriageActive ? BASE_HOVER : {}) }}>
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
          {(vehicle.resolved_image_url || vehicle.primary_image_url) ? (
            <img
              src={optimizeImageUrl(vehicle.resolved_image_url || vehicle.primary_image_url!)}
              alt={title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              loading="lazy"
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ ...LABEL, fontSize: '8px' }}>NO IMAGE</span>
            </div>
          )}
          <MiniBarcode eventWeeks={vehicle.event_weeks} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title || 'UNKNOWN VEHICLE'}
            </span>
            <HoverData tooltip={`${vehicle.relationship_type} | ${vehicle.relationship_source.toUpperCase()}`}>
              <RelationshipBadge rel={vehicle.relationship_type} />
            </HoverData>
            {!vehicle.vin && (
              <HoverData tooltip="VIN NOT YET RECORDED">
                <MissingTag label="NO VIN" />
              </HoverData>
            )}
            {vehicle.estimated_value == null && (
              <HoverData tooltip="NO ESTIMATED VALUE SET">
                <MissingTag label="NO PRICE" />
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
                fontSize: '8px',
                color: vinCopied ? 'var(--success, #16825d)' : 'var(--text-secondary, #666666)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                transition: 'color 180ms ease',
              }}>
                {vinCopied ? 'COPIED' : truncateVin(vehicle.vin)}
              </span>
            </HoverData>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <HoverData tooltip={vehicle.estimated_value != null ? 'ESTIMATED VALUE' : 'NO VALUE SET'}>
              <span style={LABEL}>VALUE</span>
              <span style={{ ...MONO, fontSize: '9px', fontWeight: 700, marginLeft: 4 }}>
                {vehicle.estimated_value != null ? formatCurrency(vehicle.estimated_value) : '—'}
              </span>
            </HoverData>
            <HoverData tooltip={`${vehicle.view_count ?? 0} TOTAL VIEWS`}>
              <span style={LABEL}>VWS</span>
              <span style={{ ...MONO, fontSize: '9px', marginLeft: 3 }}>{vehicle.view_count ?? '—'}</span>
            </HoverData>
          </div>

          <div style={{ maxWidth: 280 }}>
            <HealthBar score={vehicle.health_score} vehicle={vehicle} />
          </div>
        </div>

        {/* Right strip */}
        {showQuickAssign ? (
          <div style={{ borderLeft: '2px solid var(--border, #bdbdbd)', padding: '8px', display: 'flex', alignItems: 'center' }}
               onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <span style={{ ...LABEL, fontSize: '8px', color: 'var(--warning, #b05a00)' }}>CATEGORIZE</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '2px solid var(--border, #bdbdbd)' }}>
            <ActionStrip vehicle={vehicle} vertical />
          </div>
        )}
      </article>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Compact card (one-liner)
// ---------------------------------------------------------------------------

function CompactCard({ vehicle, onDragStart, onDragEnd, isDragging, isTriageActive }: {
  vehicle: GarageVehicle;
  onDragStart?: () => void; onDragEnd?: () => void; isDragging?: boolean; isTriageActive?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [vinCopied, setVinCopied] = useState(false);
  const title = formatVehicleTitle(vehicle);

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', vehicle.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      style={{
        textDecoration: 'none', display: 'block', color: 'inherit',
        ...(isDragging ? { borderColor: 'var(--text, #2a2a2a)', transform: 'scale(1.02)', opacity: 0.8, zIndex: 10 } :
            isTriageActive ? { opacity: 0.4, transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)' } : {}),
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
          ...(hovered && !isTriageActive ? BASE_HOVER : {}),
        }}
      >
        <HoverData tooltip={vehicle.vin ? `VIN: ${vehicle.vin}` : 'NO VIN'}>
          <span
            style={{
              fontSize: '9px',
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
        <HoverData tooltip={`${vehicle.relationship_type} | ${vehicle.relationship_source.toUpperCase()}`}>
          <RelationshipBadge rel={vehicle.relationship_type} />
        </HoverData>
        {!vehicle.vin && (
          <HoverData tooltip="VIN NOT YET RECORDED">
            <MissingTag label="NO VIN" />
          </HoverData>
        )}
        <HoverData tooltip={vehicle.estimated_value != null ? 'ESTIMATED VALUE' : 'NO VALUE SET'}>
          <span style={{ ...MONO, fontSize: '9px', fontWeight: 700, flexShrink: 0 }}>
            {vehicle.estimated_value != null ? formatCurrency(vehicle.estimated_value) : '—'}
          </span>
        </HoverData>
        <span style={{ ...LABEL, fontSize: '8px', flexShrink: 0 }}>
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
  onDragStart,
  onDragEnd,
  isDragging,
  isTriageActive,
}: GarageVehicleCardProps) {
  const dragProps = { onDragStart, onDragEnd, isDragging, isTriageActive };
  if (viewMode === 'LIST') return <ListCard vehicle={vehicle} onRefresh={onRefresh} {...dragProps} />;
  if (viewMode === 'COMPACT') return <CompactCard vehicle={vehicle} {...dragProps} />;
  return <GridCard vehicle={vehicle} onRefresh={onRefresh} {...dragProps} />;
}

export default GarageVehicleCard;
