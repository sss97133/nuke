import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useVehicleProfile } from './VehicleProfileContext';

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

function formatPrice(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
  if (isNaN(n)) return String(value);
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatMileage(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const n = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
  if (isNaN(n)) return String(value);
  return n.toLocaleString('en-US') + ' mi';
}

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr  / 24);

  if (diffSec <  60)  return `${diffSec}s ago`;
  if (diffMin <  60)  return `${diffMin}m ago`;
  if (diffHr  <  24)  return `${diffHr}h ago`;
  if (diffDay < 365)  return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 365)}y ago`;
}

function endingIn(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now = new Date();
  const diffMs = then.getTime() - now.getTime();
  if (diffMs <= 0) return 'ended';
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr  / 24);

  if (diffMin < 60)  return `${diffMin}m`;
  if (diffHr  < 24)  return `${diffHr}h ${diffMin % 60}m`;
  return `${diffDay}d`;
}

function resolveStatus(vehicle: any): {
  label: string;
  variant: string;
  tooltip: string;
} {
  const status = (vehicle?.status || '').toLowerCase();
  const reserveMet = vehicle?.reserve_met ?? vehicle?.reserveMet;
  const hasBids = (vehicle?.bid_count ?? vehicle?.bidCount ?? 0) > 0;

  if (status === 'sold') {
    return { label: 'SOLD', variant: 'sold', tooltip: 'Vehicle sold' };
  }
  if (status === 'no_sale' || status === 'no-sale' || status === 'nosale') {
    return { label: 'NO SALE', variant: 'no-sale', tooltip: 'Auction ended — no sale' };
  }
  if (status === 'draft') {
    return { label: 'DRAFT', variant: 'draft', tooltip: 'Not yet published' };
  }
  if (status === 'live' || status === 'active') {
    const end = vehicle?.end_date ?? vehicle?.endDate ?? vehicle?.auction_end;
    const remaining = end ? endingIn(end) : null;
    const isEndingSoon = (() => {
      if (!end) return false;
      const diffMs = new Date(end).getTime() - Date.now();
      return diffMs > 0 && diffMs < 1000 * 60 * 60 * 6; // < 6 hours
    })();

    if (isEndingSoon) {
      return {
        label: 'ENDING SOON',
        variant: 'ending-soon',
        tooltip: remaining ? `Ends in ${remaining}` : 'Ending soon',
      };
    }
    if (hasBids && reserveMet === false) {
      return {
        label: 'RNM',
        variant: 'rnm',
        tooltip: 'Reserve not met',
      };
    }
    return {
      label: 'LIVE',
      variant: 'live',
      tooltip: remaining ? `Ends in ${remaining}` : 'Auction live',
    };
  }
  // Fallback: ended but no clear status
  if (status === 'ended' || status === 'closed') {
    if (hasBids && reserveMet === false) {
      return { label: 'RNM', variant: 'rnm', tooltip: 'Reserve not met' };
    }
    return { label: 'NO SALE', variant: 'no-sale', tooltip: 'Auction ended' };
  }
  return { label: status.toUpperCase() || 'UNKNOWN', variant: 'draft', tooltip: `Status: ${status}` };
}

function resolveSource(vehicle: any): string | null {
  const raw = vehicle?.source ?? vehicle?.auction_source ?? vehicle?.auctionSource;
  if (!raw) return null;
  const map: Record<string, string> = {
    'bring_a_trailer': 'BaT',
    'bat': 'BaT',
    'bring a trailer': 'BaT',
    'cars_and_bids': 'C&B',
    'cars and bids': 'C&B',
    'c&b': 'C&B',
    'pcarmarket': 'PCM',
    'pcm': 'PCM',
    'rm_sothebys': 'RM',
    'rm': 'RM',
    'gooding': 'Gooding',
    'bonhams': 'Bonhams',
    'barrett_jackson': 'B-J',
    'barrett-jackson': 'B-J',
    'mecum': 'Mecum',
  };
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return map[key] ?? raw.toUpperCase();
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

/** Use CSS variables so dark mode is respected (design rule: no hardcoded hex). */
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
  bids:         { background: 'rgba(106,173,228,0.08)', borderColor: 'rgba(106,173,228,0.45)', color: '#2a6fa0' },
  comments:     { background: 'rgba(150,120,200,0.07)', borderColor: 'rgba(150,120,200,0.35)', color: '#6040a0' },
  watchers:     { background: 'transparent' },
  dq:           { background: 'rgba(238,118,35,0.08)', borderColor: 'rgba(238,118,35,0.40)',  color: '#b05510' },
  buyer:        { background: 'rgba(106,173,228,0.06)', borderColor: 'rgba(106,173,228,0.3)', color: TOKEN.ink2 },
  seller:       { background: 'rgba(0,66,37,0.05)',     borderColor: 'rgba(0,66,37,0.25)',    color: '#004225' },
  location:     { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, letterSpacing: '0.06em', color: TOKEN.ink2 },
  price:        { background: 'rgba(26,26,26,0.04)', fontFamily: TOKEN.fontMono, fontWeight: 700, color: TOKEN.ink, letterSpacing: '0.04em' },
  sold:         { background: 'rgba(0,66,37,0.07)',     borderColor: 'rgba(0,66,37,0.35)',    color: '#004225' },
  time:         { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, color: TOKEN.ink2 },
  source:       { background: 'rgba(26,26,26,0.06)',    borderColor: 'rgba(26,26,26,0.20)',   color: TOKEN.ink, letterSpacing: '0.14em' },
  live:         { background: 'rgba(0,66,37,0.07)',     borderColor: 'rgba(0,66,37,0.35)',    color: '#004225' },
  rnm:          { background: 'rgba(238,118,35,0.06)',  borderColor: 'rgba(238,118,35,0.35)', color: '#b05510' },
  'no-sale':    { background: 'rgba(200,16,46,0.06)',   borderColor: 'rgba(200,16,46,0.30)',  color: '#8a0020' },
  'ending-soon':{ background: 'rgba(255,128,0,0.08)',   borderColor: 'rgba(255,128,0,0.40)',  color: '#994d00' },
  draft:        { background: 'rgba(136,136,136,0.08)', borderColor: 'rgba(136,136,136,0.3)', color: TOKEN.ink2 },
  mileage:      { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, color: TOKEN.ink2, letterSpacing: '0.06em' },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface BadgeProps {
  variant?: string;
  label: string;
  tooltip?: string;
  children?: React.ReactNode;
  /** Optional click handler for data-view navigation (e.g. garage filtered by year/make/model) */
  onClick?: () => void;
}

const Badge: React.FC<BadgeProps> = ({ variant = '', label, tooltip, children, onClick }) => {
  const [hovered, setHovered] = React.useState(false);

  const variantStyle = variant ? (BADGE_VARIANTS[variant] ?? {}) : {};
  const style: React.CSSProperties = {
    ...BADGE_BASE,
    ...variantStyle,
    ...(onClick ? { cursor: 'pointer' as const } : {}),
  };

  const tooltipStyle: React.CSSProperties = {
    position:       'absolute',
    top:            'calc(100% + 6px)',
    left:           '50%',
    transform:      'translateX(-50%)',
    zIndex:         200,
    background:     TOKEN.ink,
    color:          '#ffffff',
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
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {label}
      {children}
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
// VehicleSubHeader
// ---------------------------------------------------------------------------

const VehicleSubHeader: React.FC = () => {
  const { vehicle } = useVehicleProfile();
  const navigate = useNavigate();
  if (!vehicle) return null;

  // --- Derived values ---
  const year      = vehicle.year   ?? vehicle.model_year   ?? '';
  const make      = vehicle.make   ?? vehicle.make_name    ?? '';
  const model     = vehicle.model  ?? vehicle.model_name   ?? '';
  const trim      = vehicle.trim   ?? vehicle.trim_name    ?? '';
  // Title in proper case for display (e.g. "1973 GMC K5 Jimmy")
  const titleParts = [year, make, model, trim].filter(Boolean);
  const titleStr  = titleParts.map((p) => (typeof p === 'number' ? String(p) : toTitleCase(String(p)))).join(' ');

  const mileage   = vehicle.mileage    ?? vehicle.odometer   ?? vehicle.miles;
  const bidCount  = vehicle.bid_count  ?? vehicle.bidCount   ?? vehicle.bids ?? 0;
  const commentCount = vehicle.comment_count ?? vehicle.commentCount ?? vehicle.comments ?? 0;

  const price     = vehicle.sold_price ?? vehicle.final_price ?? vehicle.high_bid ?? vehicle.price;
  const location  = resolveLocation(vehicle);
  const source    = resolveSource(vehicle);
  const status    = resolveStatus(vehicle);

  const timeStr   = vehicle.sold_date ?? vehicle.end_date ?? vehicle.endDate ?? vehicle.updated_at ?? vehicle.updatedAt;

  // --- Container ---
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
    overflow:        'hidden',
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
    // Hide scrollbar
    scrollbarWidth: 'none',
    msOverflowStyle: 'none' as any,
  };

  // Garage filter links for YMM badges (hover shows stats intent; click opens garage)
  const garageBase = '/?tab=garage';
  const onYearClick = year ? () => navigate(`${garageBase}&year=${encodeURIComponent(String(year))}`) : undefined;
  const onMakeClick = make ? () => navigate(`${garageBase}&make=${encodeURIComponent(String(make).trim())}`) : undefined;
  const onModelClick = model ? () => navigate(`${garageBase}&model=${encodeURIComponent(String(model).trim())}`) : undefined;
  const onTrimClick = trim ? () => navigate(`${garageBase}&trim=${encodeURIComponent(String(trim).trim())}`) : undefined;

  return (
    <div className="vp-sub-header" style={containerStyle}>
      {/* Left: YMM (+ trim) as clickable badges, then mileage */}
      <div className="vp-sub-header__left" style={leftStyle}>
        {titleStr ? (
          <>
            {year && (
              <Badge
                variant="source"
                label={String(year)}
                tooltip={`View all vehicles from ${year}`}
                onClick={onYearClick}
              />
            )}
            {make && (
              <Badge
                variant="source"
                label={toTitleCase(String(make))}
                tooltip={`View all ${String(make).trim()} vehicles`}
                onClick={onMakeClick}
              />
            )}
            {model && (
              <Badge
                variant="source"
                label={toTitleCase(String(model))}
                tooltip={make ? `View ${String(model).trim()} (e.g. ${String(make).trim()} / related makes)` : `View ${String(model).trim()} vehicles`}
                onClick={onModelClick}
              />
            )}
            {trim && (
              <Badge
                variant="source"
                label={toTitleCase(String(trim))}
                tooltip={`View ${String(trim).trim()} variants`}
                onClick={onTrimClick}
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

      {/* Badges strip */}
      <div className="vp-sub-header__badges" style={badgesWrapStyle}>
        {/* Status */}
        <Badge
          variant={status.variant}
          label={status.label}
          tooltip={status.tooltip}
        />

        {/* Source */}
        {source && (
          <Badge
            variant="source"
            label={source}
            tooltip={`Source: ${vehicle.source ?? vehicle.auction_source ?? source}`}
          />
        )}

        {/* Price */}
        {price != null && price !== '' && price !== 0 && (
          <Badge
            variant="price"
            label={formatPrice(price)}
            tooltip={
              status.label === 'SOLD'
                ? `Sold for ${formatPrice(price)}`
                : status.label === 'RNM'
                ? `High bid ${formatPrice(price)} — reserve not met`
                : `Current high bid: ${formatPrice(price)}`
            }
          />
        )}

        {/* Bids */}
        {bidCount > 0 && (
          <Badge
            variant="bids"
            label={`${bidCount} BID${bidCount !== 1 ? 'S' : ''}`}
            tooltip={`${bidCount} bid${bidCount !== 1 ? 's' : ''} placed`}
          />
        )}

        {/* Comments */}
        {commentCount > 0 && (
          <Badge
            variant="comments"
            label={`${commentCount} CMT`}
            tooltip={`${commentCount} comment${commentCount !== 1 ? 's' : ''}`}
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

        {/* Time */}
        {timeStr && (
          <Badge
            variant="time"
            label={relativeTime(timeStr)}
            tooltip={new Date(timeStr).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          />
        )}
      </div>
    </div>
  );
};

export default VehicleSubHeader;
export type { VehicleSubHeaderProps };
