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
 */

import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { GarageVehicle, RelationshipType, ViewMode } from '../../hooks/useVehiclesDashboard';
import VehicleThumbnail from '../VehicleThumbnail';

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
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--text-secondary, #666666)', color: 'var(--text-secondary, #666666)' };
    case 'UPLOADER':
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--border, #bdbdbd)', color: 'var(--text-secondary, #666666)' };
    case 'WATCHING':
    default:
      return { bg: 'var(--bg, #f5f5f5)', border: 'var(--border, #bdbdbd)', color: 'var(--text-secondary, #666666)' };
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

function HealthBar({ score }: { score: number | null }) {
  const pct = score != null ? Math.max(0, Math.min(100, score)) : null;
  const barColor =
    pct == null
      ? 'var(--border, #bdbdbd)'
      : pct >= 70
      ? 'var(--success, #16825d)'
      : pct >= 40
      ? 'var(--warning, #b05a00)'
      : 'var(--error, #d13438)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
  );
}

// ---------------------------------------------------------------------------
// Quick-assign chips for UPLOADER vehicles
// ---------------------------------------------------------------------------

const QUICK_ASSIGN_CHIPS = [
  { label: 'OWN', table: 'vehicle_user_permissions', role: 'owner' },
  { label: 'CO-OWN', table: 'vehicle_user_permissions', role: 'co_owner' },
  { label: 'PREV OWNER', table: 'discovered_vehicles', type: 'previously_owned' },
  { label: 'WORKED ON', table: 'vehicle_contributors', role: 'contributor' },
  { label: 'WATCHING', table: 'discovered_vehicles', type: 'interested' },
  { label: 'DISMISS', table: 'discovered_vehicles', type: 'discovered', dismiss: true },
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
}: {
  vehicle: GarageVehicle;
  vertical?: boolean;
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid card (full detail)
// ---------------------------------------------------------------------------

function GridCard({ vehicle, onRefresh }: { vehicle: GarageVehicle; onRefresh?: () => void }) {
  const [hovered, setHovered] = useState(false);
  const title = formatVehicleTitle(vehicle);
  const isUploader = vehicle.relationship_type === 'UPLOADER';

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <article style={{ ...BASE, ...(hovered ? BASE_HOVER : {}) }}>
        {/* Image 16:9 */}
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
          {vehicle.primary_image_url ? (
            <img
              src={optimizeImageUrl(vehicle.primary_image_url)}
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
              <VehicleThumbnail vehicleId={vehicle.id} />
            </div>
          )}

          {/* Relationship badge — top-left, solid bg */}
          <div
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
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
        </div>

        {/* Body */}
        <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          {/* Title */}
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
            }}
          >
            {title || 'UNKNOWN VEHICLE'}
          </div>

          {/* VIN + missing tags */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {vehicle.vin ? (
              <span
                style={{
                  ...MONO,
                  fontSize: '8px',
                  color: 'var(--text-secondary, #666666)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 130,
                }}
                title={vehicle.vin}
              >
                {truncateVin(vehicle.vin)}
              </span>
            ) : (
              <MissingTag label="NO VIN" />
            )}
            {vehicle.estimated_value == null && <MissingTag label="NO PRICE" />}
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border, #bdbdbd)' }} />

          {/* Data rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Value */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={LABEL}>VALUE</span>
              {vehicle.estimated_value != null ? (
                <span style={{ ...MONO, fontSize: '10px', fontWeight: 700, color: 'var(--text, #2a2a2a)' }}>
                  {formatCurrency(vehicle.estimated_value)}
                </span>
              ) : (
                <span style={{ ...MONO, fontSize: '9px', color: 'var(--text-secondary, #666666)' }}>—</span>
              )}
              {vehicle.value_delta != null && vehicle.value_delta !== 0 && (
                <span
                  style={{
                    ...MONO,
                    fontSize: '8px',
                    color: vehicle.value_delta > 0 ? 'var(--success, #16825d)' : 'var(--error, #d13438)',
                  }}
                >
                  {vehicle.value_delta > 0 ? '+' : ''}{formatCurrency(vehicle.value_delta)}
                </span>
              )}
            </div>

            {/* Counts */}
            <div style={{ display: 'flex', gap: 12 }}>
              {([
                ['VIEWS', vehicle.view_count],
              ] as [string, number | null][]).map(([lbl, val]) => (
                <div key={lbl} style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                  <span style={LABEL}>{lbl}</span>
                  <span style={{ ...MONO, fontSize: '9px', fontWeight: 700 }}>{val ?? '—'}</span>
                </div>
              ))}
            </div>

            {/* Health bar */}
            <HealthBar score={vehicle.health_score} />
          </div>
        </div>

        {/* Action strip or quick-assign for uploaders */}
        {isUploader ? (
          <QuickAssignStrip vehicleId={vehicle.id} onRefresh={onRefresh} />
        ) : (
          <ActionStrip vehicle={vehicle} />
        )}
      </article>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// List card (horizontal)
// ---------------------------------------------------------------------------

function ListCard({ vehicle, onRefresh }: { vehicle: GarageVehicle; onRefresh?: () => void }) {
  const [hovered, setHovered] = useState(false);
  const title = formatVehicleTitle(vehicle);
  const isUploader = vehicle.relationship_type === 'UPLOADER';

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <article style={{ ...BASE, flexDirection: 'row', alignItems: 'stretch', ...(hovered ? BASE_HOVER : {}) }}>
        {/* Thumbnail */}
        <div
          style={{
            width: 120,
            flexShrink: 0,
            backgroundColor: 'var(--bg, #f5f5f5)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {vehicle.primary_image_url ? (
            <img
              src={optimizeImageUrl(vehicle.primary_image_url)}
              alt={title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              loading="lazy"
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ ...LABEL, fontSize: '8px' }}>NO IMAGE</span>
            </div>
          )}
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
            <RelationshipBadge rel={vehicle.relationship_type} />
            {!vehicle.vin && <MissingTag label="NO VIN" />}
            {vehicle.estimated_value == null && <MissingTag label="NO PRICE" />}
          </div>

          {vehicle.vin && (
            <span style={{ ...MONO, fontSize: '8px', color: 'var(--text-secondary, #666666)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {truncateVin(vehicle.vin)}
            </span>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
              <span style={LABEL}>VALUE</span>
              <span style={{ ...MONO, fontSize: '9px', fontWeight: 700 }}>
                {vehicle.estimated_value != null ? formatCurrency(vehicle.estimated_value) : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 3, alignItems: 'baseline' }}>
              <span style={LABEL}>VWS</span>
              <span style={{ ...MONO, fontSize: '9px' }}>{vehicle.view_count ?? '—'}</span>
            </div>
          </div>

          <div style={{ maxWidth: 280 }}>
            <HealthBar score={vehicle.health_score} />
          </div>
        </div>

        {/* Right strip */}
        {isUploader ? (
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

function CompactCard({ vehicle }: { vehicle: GarageVehicle }) {
  const [hovered, setHovered] = useState(false);
  const title = formatVehicleTitle(vehicle);

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{ textDecoration: 'none', display: 'block', color: 'inherit' }}
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
        <RelationshipBadge rel={vehicle.relationship_type} />
        {!vehicle.vin && <MissingTag label="NO VIN" />}
        <span style={{ ...MONO, fontSize: '9px', fontWeight: 700, flexShrink: 0 }}>
          {vehicle.estimated_value != null ? formatCurrency(vehicle.estimated_value) : '—'}
        </span>
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
}: GarageVehicleCardProps) {
  if (viewMode === 'LIST') return <ListCard vehicle={vehicle} onRefresh={onRefresh} />;
  if (viewMode === 'COMPACT') return <CompactCard vehicle={vehicle} />;
  return <GridCard vehicle={vehicle} onRefresh={onRefresh} />;
}

export default GarageVehicleCard;
