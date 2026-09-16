/**
 * FreshFindsStrip — Horizontal scrollable strip showing the TOP 10 vehicles
 * added since the user's last visit that match their interests.
 *
 * Small thumbnails (60px) + price + source badge.
 * Same visual language as RecentlyViewed strip.
 *
 * Design: 2px borders, zero radius, 8px labels, Courier New for prices.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from '../../components/popups/usePopup';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { VehiclePopup } from '../../components/popups/VehiclePopup';
import type { InterestEntry } from '../../hooks/useInterests';
import type { FeedVehicle } from '../types/feed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One row of public.get_ranked_offers — the shared web/iOS/API read. */
interface RankedOffer {
  vehicle_id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  image_url: string | null;
  price: number | null;
  price_source: 'listing' | 'event' | 'bat' | null;
  source: string | null;
  segment_slug: string | null;
  priority: number | null;
  rank_score: number | null;
}

interface FreshFindMini {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  asking_price: number | null;
  display_price: number | null;
  discovery_source: string | null;
  find_score: number | null;
}

// ---------------------------------------------------------------------------
// Styles (mirrors RecentlyViewed)
// ---------------------------------------------------------------------------

const stripContainer: CSSProperties = {
  borderBottom: '2px solid var(--border)',
  background: 'var(--surface)',
  padding: '6px 0',
};

const scrollArea: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  overflowX: 'auto',
  padding: '0 12px',
  scrollbarWidth: 'none',
};

const labelStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--text-disabled)',
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const itemContainer: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '2px',
  flexShrink: 0,
  cursor: 'pointer',
  transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
};

const thumbStyle: CSSProperties = {
  width: '60px',
  height: '60px',
  border: '2px solid var(--border)',
  background: 'var(--surface-hover)',
  objectFit: 'cover',
  display: 'block',
};

const thumbPlaceholder: CSSProperties = {
  ...thumbStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'Arial, sans-serif',
  fontSize: '7px',
  fontWeight: 800,
  textTransform: 'uppercase',
  color: 'var(--text-disabled)',
  letterSpacing: '0.3px',
};

const nameStyle: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '7px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.2px',
  color: 'var(--text-secondary)',
  maxWidth: '60px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'center',
  lineHeight: 1.2,
};

const priceStyle: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text)',
  lineHeight: 1,
};

const sourceBadge: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '6px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  color: 'var(--text-disabled)',
  lineHeight: 1,
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FreshFindsStripProps {
  /** User's previous visit timestamp */
  previousVisit: number;
  /** Whether the user has recorded interests */
  hasInterests: boolean;
  /** Top makes from interest data */
  topMakes: InterestEntry[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FreshFindsStrip({
  previousVisit,
  hasInterests,
  topMakes,
}: FreshFindsStripProps) {
  const { openPopup } = usePopup();
  const [vehicles, setVehicles] = useState<FreshFindMini[]>([]);

  // Ranked offers need no interest history — the desire prior lives in
  // market_segments, so a first-time visitor gets the same ranking a returning
  // one does. `previousVisit` / `hasInterests` / `topMakes` are kept on the
  // props so the strip can re-personalise later without a signature change.
  const isReturnVisitor = previousVisit > 0 && (Date.now() - previousVisit) > 3_600_000;
  const shouldFetch = true;
  void isReturnVisitor; void hasInterests; void topMakes;

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;

    async function fetchFreshFinds() {
      // ONE shared read — get_ranked_offers is the same RPC web, iOS and API
      // consume (MULTI_SURFACE_BRIEF_2026-07-27), so the ranking can never
      // disagree between surfaces. It replaces two brittle `vehicles` queries
      // that guessed at make capitalisation and retried on low yield.
      //
      // Rank = desire prior (market_segments.priority) decayed by age; price
      // walks listing -> auction event -> bat_listings, and stays null rather
      // than guessing when no rung hits.
      const { data, error } = await supabase.rpc('get_ranked_offers', {
        p_limit: 10,
        p_max_hours: 168,
      });

      if (cancelled || error || !data) return;

      const mapped = (data as RankedOffer[]).map((v) => ({
        id: v.vehicle_id,
        year: v.year,
        make: v.make,
        model: v.model,
        primary_image_url: v.image_url,
        sale_price: null,
        asking_price: v.price,
        discovery_source: v.source,
        find_score: v.rank_score,
        display_price: v.price ?? null,
      }));
      setVehicles(mapped);
    }

    fetchFreshFinds();
    return () => { cancelled = true; };
  }, [shouldFetch]);

  // No empty shells (.claude/rules/frontend.md) — render nothing, never a
  // "no data" box.
  if (vehicles.length === 0) return null;

  const formatPrice = (n: number | null) => {
    if (!n || n <= 0) return null;
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'K';
    return '$' + n.toLocaleString();
  };

  const formatSource = (src: string | null): string | null => {
    if (!src) return null;
    // Shorten common source names
    if (src.includes('bat') || src.includes('bring')) return 'BAT';
    if (src.includes('cars-and-bids') || src.includes('c&b')) return 'C&B';
    if (src.includes('pcarmarket')) return 'PCAR';
    if (src.includes('hagerty')) return 'HAG';
    if (src.includes('ebay')) return 'EBAY';
    if (src.includes('mecum')) return 'MECUM';
    if (src.includes('rm-sotheby') || src.includes('sotheby')) return 'RM';
    return src.slice(0, 4).toUpperCase();
  };

  const handleClick = (v: FreshFindMini) => {
    const feedVehicle: FeedVehicle = {
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      display_price: v.display_price,
      price_source: v.sale_price ? 'sale' : 'none',
      is_for_sale: false,
      thumbnail_url: v.primary_image_url,
      created_at: '',
    };
    const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
    openPopup(<VehiclePopup vehicle={feedVehicle} />, title, 420);
  };

  return (
    <div style={stripContainer}>
      <div
        style={scrollArea}
        className="no-scrollbar"
      >
        <span style={labelStyle}>FRESH FINDS</span>

        {vehicles.map((v) => {
          const name = v.make
            ? `${v.make}${v.model ? ' ' + v.model : ''}`
            : 'VEHICLE';
          const priceText = formatPrice(v.display_price);
          const sourceText = formatSource(v.discovery_source);

          return (
            <div
              key={v.id}
              style={itemContainer}
              onClick={() => handleClick(v)}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {v.primary_image_url ? (
                <img
                  src={optimizeImageUrl(v.primary_image_url, 'thumbnail') || v.primary_image_url}
                  alt={name}
                  style={thumbStyle}
                  loading="lazy"
                />
              ) : (
                <div style={thumbPlaceholder}>
                  {v.year || '?'}
                </div>
              )}
              <span style={nameStyle}>{name}</span>
              {priceText && <span style={priceStyle}>{priceText}</span>}
              {sourceText && <span style={sourceBadge}>{sourceText}</span>}
            </div>
          );
        })}

        {/* Tail padding for scroll */}
        <div style={{ width: '8px', flexShrink: 0 }} />
      </div>
    </div>
  );
}
