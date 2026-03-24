import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
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
      return diffMs > 0 && diffMs < 1000 * 60 * 60 * 6;
    })();

    if (isEndingSoon) {
      return {
        label: 'ENDING SOON',
        variant: 'ending-soon',
        tooltip: remaining ? `Ends in ${remaining}` : 'Ending soon',
      };
    }
    if (hasBids && reserveMet === false) {
      return { label: 'RNM', variant: 'rnm', tooltip: 'Reserve not met' };
    }
    return {
      label: 'LIVE',
      variant: 'live',
      tooltip: remaining ? `Ends in ${remaining}` : 'Auction live',
    };
  }
  if (status === 'ended' || status === 'closed') {
    if (hasBids && reserveMet === false) {
      return { label: 'RNM', variant: 'rnm', tooltip: 'Reserve not met' };
    }
    return { label: 'NO SALE', variant: 'no-sale', tooltip: 'Auction ended' };
  }
  return { label: status.toUpperCase() || 'UNKNOWN', variant: 'draft', tooltip: `Status: ${status}` };
}

/** Only show source badge for real auction/marketplace platforms */
const PLATFORM_SOURCES: Record<string, string> = {
  // Major auction houses
  'bring_a_trailer': 'BaT',
  'bat': 'BaT',
  'bring a trailer': 'BaT',
  'cars_and_bids': 'C&B',
  'cars and bids': 'C&B',
  'c&b': 'C&B',
  'mecum': 'Mecum',
  'barrett_jackson': 'B-J',
  'barrett-jackson': 'B-J',
  'bonhams': 'Bonhams',
  'gooding': 'Gooding',
  'rm_sothebys': 'RM',
  'rm-sothebys': 'RM',
  'rm': 'RM',
  'broad_arrow': 'Broad Arrow',
  'broad-arrow': 'Broad Arrow',
  'pcarmarket': 'PCM',
  'pcm': 'PCM',
  'collecting_cars': 'CC',
  'conceptcarz': 'ConceptCarz',
  'silver-auctions': 'Silver',
  'leake': 'Leake',
  'kruse': 'Kruse',
  'auctions-america': 'AA',
  'russo-and-steele': 'R&S',
  'carlisle': 'Carlisle',
  'gaa-classic-cars': 'GAA',
  'worldwide-auctioneers': 'Worldwide',
  'artcurial': 'Artcurial',
  'h-and-h': 'H&H',
  'coys': 'Coys',
  'shannons': 'Shannons',
  'sbx-cars': 'SBX',
  // Marketplaces
  'facebook_marketplace': 'FB',
  'facebook-marketplace': 'FB',
  'craigslist': 'CL',
  'craigslist_listing': 'CL',
  'ebay': 'eBay',
  'hagerty': 'Hagerty',
  'hemmings': 'Hemmings',
  'classic-com': 'Classic',
  'ksl': 'KSL',
  'barnfinds': 'BarnFinds',
  'jamesedition': 'JamesEd',
  'design-auto': 'Design Auto',
  'copart': 'Copart',
  'iaai': 'IAAI',
};

function resolvePlatformSource(vehicle: any): string | null {
  const raw = vehicle?.source ?? vehicle?.auction_source ?? vehicle?.auctionSource;
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return PLATFORM_SOURCES[key] ?? null; // null = not a real platform, don't show badge
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
  bids:         { background: 'rgba(106,173,228,0.08)', borderColor: 'rgba(106,173,228,0.45)', color: '#2a6fa0' },
  comments:     { background: 'rgba(150,120,200,0.07)', borderColor: 'rgba(150,120,200,0.35)', color: '#6040a0' },
  watchers:     { background: 'transparent' },
  dq:           { background: 'rgba(238,118,35,0.08)', borderColor: 'rgba(238,118,35,0.40)',  color: '#b05510' },
  buyer:        { background: 'rgba(106,173,228,0.06)', borderColor: 'rgba(106,173,228,0.3)', color: TOKEN.ink2 },
  seller:       { background: 'rgba(0,66,37,0.05)',     borderColor: 'rgba(0,66,37,0.25)',    color: '#004225' },
  location:     { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, letterSpacing: '0.06em', color: TOKEN.ink2 },
  price:        { background: 'rgba(26,26,26,0.04)', fontFamily: TOKEN.fontMono, fontWeight: 700, color: TOKEN.ink, letterSpacing: '0.04em' },
  sold:         { background: 'rgba(0,66,37,0.07)',     borderColor: 'rgba(0,66,37,0.35)',    color: '#004225' },
  source:       { background: 'rgba(26,26,26,0.06)',    borderColor: 'rgba(26,26,26,0.20)',   color: TOKEN.ink, letterSpacing: '0.14em' },
  live:         { background: 'rgba(0,66,37,0.07)',     borderColor: 'rgba(0,66,37,0.35)',    color: '#004225' },
  rnm:          { background: 'rgba(238,118,35,0.06)',  borderColor: 'rgba(238,118,35,0.35)', color: '#b05510' },
  'no-sale':    { background: 'rgba(200,16,46,0.06)',   borderColor: 'rgba(200,16,46,0.30)',  color: '#8a0020' },
  'ending-soon':{ background: 'rgba(255,128,0,0.08)',   borderColor: 'rgba(255,128,0,0.40)',  color: '#994d00' },
  draft:        { background: 'rgba(136,136,136,0.08)', borderColor: 'rgba(136,136,136,0.3)', color: TOKEN.ink2 },
  mileage:      { background: 'transparent', fontFamily: TOKEN.fontMono, fontSize: 7, color: TOKEN.ink2, letterSpacing: '0.06em' },
  finance:      { background: 'rgba(0,66,37,0.05)', fontFamily: TOKEN.fontMono, fontSize: 7, fontWeight: 700, letterSpacing: '0.04em' },
};

// ---------------------------------------------------------------------------
// StatsStack — hover popover showing market stats for a Y/M/M dimension
// ---------------------------------------------------------------------------

interface StatsStackData {
  count: number;
  avgPrice: number | null;
  medianPrice: number | null;
  priceRange: { min: number; max: number } | null;
}

function useStatsStack(dimension: 'year' | 'make' | 'model' | 'trim', value: string | number | null) {
  const [data, setData] = useState<StatsStackData | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    if (!value || fetchedRef.current || loading) return;
    fetchedRef.current = true;
    setLoading(true);
    try {
      let query = supabase
        .from('vehicles')
        .select('sale_price, nuke_estimate')
        .eq('status', 'active')
        .not('sale_price', 'is', null);

      if (dimension === 'year') query = query.eq('year', Number(value));
      else if (dimension === 'make') query = query.ilike('make', String(value));
      else if (dimension === 'model') query = query.ilike('model', String(value));
      else if (dimension === 'trim') query = query.ilike('trim', String(value));

      const { data: rows } = await query.limit(500);
      if (!rows || rows.length === 0) {
        setData({ count: 0, avgPrice: null, medianPrice: null, priceRange: null });
        setLoading(false);
        return;
      }
      const prices = rows
        .map((r: any) => Number(r.sale_price || r.nuke_estimate || 0))
        .filter((p: number) => p > 0)
        .sort((a: number, b: number) => a - b);
      const count = rows.length;
      const avg = prices.length > 0 ? Math.round(prices.reduce((s: number, p: number) => s + p, 0) / prices.length) : null;
      const median = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null;
      const range = prices.length > 0 ? { min: prices[0], max: prices[prices.length - 1] } : null;
      setData({ count, avgPrice: avg, medianPrice: median, priceRange: range });
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [dimension, value, loading]);

  return { data, loading, load };
}

// ---------------------------------------------------------------------------
// YMMBadge — Y/M/M badge with StatsStack hover popover
// ---------------------------------------------------------------------------

interface YMMBadgeProps {
  label: string;
  dimension: 'year' | 'make' | 'model' | 'trim';
  value: string | number | null;
  onClick?: () => void;
}

const STATS_STACK_STYLE: React.CSSProperties = {
  position:       'absolute',
  top:            'calc(100% + 4px)',
  left:           0,
  zIndex:         300,
  background:     TOKEN.ink,
  color:          'var(--surface-elevated)',
  fontFamily:     TOKEN.fontBody,
  fontSize:       8,
  fontWeight:     400,
  textTransform:  'none',
  letterSpacing:  0,
  padding:        '8px 10px',
  minWidth:       160,
  pointerEvents:  'none',
  transition:     'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

const STATS_ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '2px 0',
};

const STATS_LABEL: React.CSSProperties = {
  fontFamily: TOKEN.fontBody,
  fontSize: 7,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.55)',
};

const STATS_VALUE: React.CSSProperties = {
  fontFamily: TOKEN.fontMono,
  fontSize: 9,
  fontWeight: 700,
  color: 'var(--surface-elevated)',
};

const YMMBadge: React.FC<YMMBadgeProps> = ({ label, dimension, value, onClick }) => {
  const [hovered, setHovered] = useState(false);
  const { data, loading, load } = useStatsStack(dimension, value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    setHovered(true);
    timerRef.current = setTimeout(() => load(), 200); // lazy-load on hover
  }, [load]);

  const handleLeave = useCallback(() => {
    setHovered(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const variantStyle = BADGE_VARIANTS['source'] ?? {};
  const style: React.CSSProperties = {
    ...BADGE_BASE,
    ...variantStyle,
    cursor: 'pointer',
  };

  const dimensionLabels: Record<string, string> = {
    year: 'vehicles from this year',
    make: 'vehicles by this make',
    model: 'this model in garage',
    trim: 'this trim variant',
  };

  return (
    <span
      role="button"
      tabIndex={0}
      style={style}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      {label}
      {hovered && (
        <span style={{ ...STATS_STACK_STYLE, opacity: 1 }}>
          {loading && !data && (
            <span style={{ ...STATS_LABEL, color: 'rgba(255,255,255,0.4)' }}>Loading...</span>
          )}
          {data && (
            <>
              <div style={STATS_ROW}>
                <span style={STATS_LABEL}>In garage</span>
                <span style={STATS_VALUE}>{data.count}</span>
              </div>
              {data.avgPrice != null && (
                <div style={STATS_ROW}>
                  <span style={STATS_LABEL}>Avg price</span>
                  <span style={STATS_VALUE}>{formatPrice(data.avgPrice)}</span>
                </div>
              )}
              {data.medianPrice != null && (
                <div style={STATS_ROW}>
                  <span style={STATS_LABEL}>Median</span>
                  <span style={STATS_VALUE}>{formatPrice(data.medianPrice)}</span>
                </div>
              )}
              {data.priceRange && (
                <div style={STATS_ROW}>
                  <span style={STATS_LABEL}>Range</span>
                  <span style={STATS_VALUE}>{formatPrice(data.priceRange.min)} — {formatPrice(data.priceRange.max)}</span>
                </div>
              )}
              <div style={{ marginTop: 4, fontSize: 7, color: 'rgba(255,255,255,0.35)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                CLICK TO VIEW {dimensionLabels[dimension]?.toUpperCase()}
              </div>
            </>
          )}
          {!loading && !data && (
            <span style={{ ...STATS_LABEL, color: 'rgba(255,255,255,0.4)' }}>No data</span>
          )}
        </span>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Badge (simple — for non-YMM badges)
// ---------------------------------------------------------------------------

interface BadgeProps {
  variant?: string;
  label: string;
  tooltip?: string;
  onClick?: () => void;
}

const Badge: React.FC<BadgeProps> = ({ variant = '', label, tooltip, onClick }) => {
  const [hovered, setHovered] = useState(false);

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
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
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
// Finance badge helpers
// ---------------------------------------------------------------------------

function resolveFinance(vehicle: any): { label: string; variant: string; tooltip: string; color: string } | null {
  const estimate = Number(vehicle?.nuke_estimate || 0);
  const salePrice = Number(vehicle?.sold_price ?? vehicle?.sale_price ?? vehicle?.final_price ?? vehicle?.price ?? 0);
  if (!estimate || !salePrice) return null;

  const diff = estimate - salePrice;
  const pct = Math.round((diff / salePrice) * 100);
  const absPct = Math.abs(pct);

  if (absPct < 5) {
    return { label: 'FAIR MARKET', variant: 'finance', tooltip: `Estimate ${formatPrice(estimate)} vs ${formatPrice(salePrice)} (${pct >= 0 ? '+' : ''}${pct}%)`, color: TOKEN.ink2 };
  }
  if (diff > 0) {
    return { label: `+${absPct}% UNDER`, variant: 'finance', tooltip: `Underpriced: estimate ${formatPrice(estimate)} vs paid ${formatPrice(salePrice)}`, color: '#004225' };
  }
  return { label: `${absPct}% OVER`, variant: 'finance', tooltip: `Overpriced: estimate ${formatPrice(estimate)} vs paid ${formatPrice(salePrice)}`, color: '#8a0020' };
}

// ---------------------------------------------------------------------------
// VehicleSubHeader
// ---------------------------------------------------------------------------

const VehicleSubHeader: React.FC = () => {
  const { vehicle } = useVehicleProfile();
  const navigate = useNavigate();
  if (!vehicle) return null;

  const year      = vehicle.year   ?? vehicle.model_year   ?? '';
  const make      = vehicle.make   ?? vehicle.make_name    ?? '';
  const model     = vehicle.model  ?? vehicle.model_name   ?? '';
  const trim      = vehicle.trim   ?? vehicle.trim_name    ?? '';
  const titleParts = [year, make, model, trim].filter(Boolean);
  const titleStr  = titleParts.map((p) => (typeof p === 'number' ? String(p) : toTitleCase(String(p)))).join(' ');

  const mileage   = vehicle.mileage    ?? vehicle.odometer   ?? vehicle.miles;
  const bidCount  = vehicle.bid_count  ?? vehicle.bidCount   ?? vehicle.bids ?? 0;
  const commentCount = vehicle.comment_count ?? vehicle.commentCount ?? vehicle.comments ?? 0;

  const price     = vehicle.sold_price ?? vehicle.final_price ?? vehicle.high_bid ?? vehicle.price;
  const location  = resolveLocation(vehicle);
  const source    = resolvePlatformSource(vehicle);
  const status    = resolveStatus(vehicle);
  const finance   = resolveFinance(vehicle);

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
      {/* Left: YMM (+ trim) as BadgePortal — click expands cluster inline, no navigation */}
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

      {/* Badges strip */}
      <div className="vp-sub-header__badges" style={badgesWrapStyle}>
        {/* Status */}
        <Badge
          variant={status.variant}
          label={status.label}
          tooltip={status.tooltip}
        />

        {/* Source — only for real platforms (BaT, C&B, Mecum, etc.) */}
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

        {/* Finance: estimate vs sale price */}
        {finance && (
          <Badge
            variant="finance"
            label={finance.label}
            tooltip={finance.tooltip}
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
            label={`${commentCount} Comment${commentCount !== 1 ? 's' : ''}`}
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

        {/* Time badge REMOVED — user found "1D AGO" meaningless */}
      </div>
    </div>
  );
};

export default VehicleSubHeader;
