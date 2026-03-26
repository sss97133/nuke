import React, { useState } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { BadgePortal } from '../../components/badges/BadgePortal';

/** Capitalize first letter of each word for display (e.g. "K5 JIMMY" -> "K5 Jimmy") */
function toTitleCase(s: string): string {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMileage(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
  if (isNaN(n)) return String(value);
  return n.toLocaleString('en-US') + ' mi';
}

function resolveLocation(vehicle: any): string | null {
  const state = vehicle?.state ?? vehicle?.seller_state ?? vehicle?.sellerState;
  const zip   = vehicle?.zip   ?? vehicle?.seller_zip   ?? vehicle?.sellerZip;
  if (state && zip) return `${zip} ${state}`;
  if (state) return state;
  if (zip)   return String(zip);
  return null;
}

// ---------------------------------------------------------------------------
// Base CSS values inlined as React style objects
// ---------------------------------------------------------------------------

const TOKEN = {
  fontBody: 'Arial, Helvetica, sans-serif' as const,
  fontMono: 'var(--font-mono, "Courier New", Courier, monospace)' as const,
  ink:      'var(--text, var(--ink, #1a1a1a))',
  ink2:     'var(--text-muted, var(--text-secondary, #888888))',
  surface:  'var(--surface, #ffffff)',
  borderSubtle: '1px solid var(--border, var(--border-subtle, #dddddd))',
  borderPrimary: '2px solid var(--border, #1a1a1a)',
};

const BADGE_BASE: React.CSSProperties = {
  position:      'relative',
  display:       'inline-flex',
  alignItems:    'center',
  gap:           3,
  fontFamily:    TOKEN.fontBody,
  fontSize:      8,
  fontWeight:    700,
  textTransform: 'uppercase',
  letterSpacing: '0.10em',
  lineHeight:    1,
  padding:       '2px 6px',
  border:        TOKEN.borderSubtle,
  background:    'transparent',
  color:         TOKEN.ink,
  whiteSpace:    'nowrap',
  cursor:        'default',
  flexShrink:    0,
  userSelect:    'none',
};

const BADGE_VARIANTS: Record<string, React.CSSProperties> = {
  source:       { background: 'rgba(26,26,26,0.06)',    borderColor: 'rgba(26,26,26,0.20)',   color: TOKEN.ink, letterSpacing: '0.14em' },
  location:     { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, letterSpacing: '0.06em', color: TOKEN.ink2 },
  mileage:      { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, color: TOKEN.ink2, letterSpacing: '0.06em' },
};

// ---------------------------------------------------------------------------
// Badge (simple)
// ---------------------------------------------------------------------------

interface BadgeProps {
  variant?: string;
  label: string;
  tooltip?: string;
}

const Badge: React.FC<BadgeProps> = ({ variant = '', label, tooltip }) => {
  const [hovered, setHovered] = useState(false);

  const variantStyle = variant ? (BADGE_VARIANTS[variant] ?? {}) : {};
  const style: React.CSSProperties = {
    ...BADGE_BASE,
    ...variantStyle,
  };

  const tooltipStyle: React.CSSProperties = {
    position:       'absolute',
    top:            'calc(100% + 6px)',
    left:           '50%',
    transform:      'translateX(-50%)',
    zIndex:         200,
    background:     TOKEN.ink,
    color:          'var(--surface-elevated)',
    fontFamily:     TOKEN.fontBody,
    fontSize:       7,
    fontWeight:     400,
    textTransform:  'none',
    letterSpacing:  0,
    padding:        '4px 7px',
    whiteSpace:     'nowrap',
    pointerEvents:  'none',
    opacity:        hovered ? 1 : 0,
    visibility:     hovered ? 'visible' : 'hidden',
    transition:     'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), visibility 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const arrowStyle: React.CSSProperties = {
    content:       '""',
    position:      'absolute',
    bottom:        '100%',
    left:          '50%',
    transform:     'translateX(-50%)',
    border:        '4px solid transparent',
    borderBottomColor: TOKEN.ink,
  };

  return (
    <span
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
      {tooltip && (
        <span style={tooltipStyle}>
          <span style={arrowStyle} />
          {tooltip}
        </span>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// VehicleSubHeader — dimension badges only (year, make, model, mileage,
// body style, transmission, drivetrain, location).
// Auction/engagement data (price, bids, comments, watchers, status) is
// shown exclusively in the ExternalAuctionLiveBanner below.
// ---------------------------------------------------------------------------

const VehicleSubHeader: React.FC = () => {
  const { vehicle } = useVehicleProfile();
  if (!vehicle) return null;

  const year      = vehicle.year   ?? vehicle.model_year   ?? '';
  const make      = vehicle.make   ?? vehicle.make_name    ?? '';
  const model     = vehicle.model  ?? vehicle.model_name   ?? '';
  const trim      = vehicle.trim   ?? vehicle.trim_name    ?? '';
  const titleParts = [year, make, model, trim].filter(Boolean);
  const titleStr  = titleParts.map((p) => (typeof p === 'number' ? String(p) : toTitleCase(String(p)))).join(' ');

  const mileage      = vehicle.mileage    ?? vehicle.odometer   ?? vehicle.miles;
  const bodyStyle    = (vehicle as any).body_style ?? (vehicle as any).bodyStyle ?? '';
  const transmission = (vehicle as any).transmission ?? '';
  const drivetrain   = (vehicle as any).drivetrain ?? (vehicle as any).drive_type ?? '';
  const location     = resolveLocation(vehicle);

  // --- Styles ---
  const containerStyle: React.CSSProperties = {
    position:        'sticky',
    top:             'var(--header-height, 48px)',
    zIndex:          90,
    height:          36,
    backgroundColor: TOKEN.surface,
    borderBottom:    TOKEN.borderPrimary,
    display:         'flex',
    alignItems:      'center',
    padding:         '0 12px',
    gap:             10,
    overflow:        'visible',
    fontFamily:      TOKEN.fontBody,
  };

  const leftStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'baseline',
    gap:        8,
    flexShrink: 0,
    minWidth:   0,
  };

  const titleStyle: React.CSSProperties = {
    fontFamily:     TOKEN.fontBody,
    fontSize:       11,
    fontWeight:     700,
    textTransform:  'uppercase',
    letterSpacing:  '0.04em',
    color:          TOKEN.ink,
    whiteSpace:     'nowrap',
    overflow:       'hidden',
    textOverflow:   'ellipsis',
    maxWidth:       280,
  };

  const dividerStyle: React.CSSProperties = {
    width:       1,
    height:      16,
    background:  'var(--border, var(--border-subtle, #dddddd))',
    flexShrink:  0,
  };

  const badgesWrapStyle: React.CSSProperties = {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    flex:       1,
    overflowX:  'auto',
    overflowY:  'visible',
    minWidth:   0,
    scrollbarWidth: 'none',
    msOverflowStyle: 'none' as any,
  };

  return (
    <div className="vp-sub-header" style={containerStyle}>
      {/* Left: YMM (+ trim) as BadgePortal — click expands cluster inline */}
      <div className="vp-sub-header__left" style={leftStyle}>
        {titleStr ? (
          <>
            {year && (
              <BadgePortal
                dimension="year"
                value={year}
                label={String(year)}
                variant="source"
              />
            )}
            {make && (
              <BadgePortal
                dimension="make"
                value={make}
                label={toTitleCase(String(make))}
                variant="source"
              />
            )}
            {model && (
              <BadgePortal
                dimension="model"
                value={model}
                label={toTitleCase(String(model))}
                variant="source"
              />
            )}
            {trim && (
              <BadgePortal
                dimension="model"
                value={trim}
                label={toTitleCase(String(trim))}
                variant="source"
              />
            )}
          </>
        ) : (
          <span className="vp-sub-header__title" style={titleStyle}>VEHICLE</span>
        )}

        {mileage != null && mileage !== '' && (
          <Badge
            variant="mileage"
            label={formatMileage(mileage)}
            tooltip={`Odometer: ${formatMileage(mileage)}`}
          />
        )}
      </div>

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Dimension badges only — auction/engagement data lives in the banner below */}
      <div className="vp-sub-header__badges" style={badgesWrapStyle}>
        {/* Body style */}
        {bodyStyle && (
          <Badge
            variant="source"
            label={toTitleCase(String(bodyStyle))}
            tooltip={`Body style: ${bodyStyle}`}
          />
        )}

        {/* Transmission */}
        {transmission && (
          <Badge
            variant="source"
            label={toTitleCase(String(transmission))}
            tooltip={`Transmission: ${transmission}`}
          />
        )}

        {/* Drivetrain */}
        {drivetrain && (
          <Badge
            variant="source"
            label={toTitleCase(String(drivetrain))}
            tooltip={`Drivetrain: ${drivetrain}`}
          />
        )}

        {/* Location */}
        {location && (
          <Badge
            variant="location"
            label={location}
            tooltip={`Vehicle location: ${location}`}
          />
        )}
      </div>
    </div>
  );
};

export default VehicleSubHeader;
