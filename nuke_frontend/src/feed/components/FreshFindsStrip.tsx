/**
 * FreshFindsStrip — Horizontal scrollable strip showing the TOP 10 vehicles
 * added since the user's last visit that match their interests.
 *
 * Small thumbnails (60px) + price + source badge.
 * Same visual language as RecentlyViewed strip.
 *
 * Design: 2px borders, zero radius, 8px labels, Courier New for prices.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { usePopup } from '../../components/popups/usePopup';
import { VehiclePopup } from '../../components/popups/VehiclePopup';
import type { InterestEntry } from '../../hooks/useInterests';
import type { FeedVehicle } from '../types/feed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  // Only show for return visitors with interests and at least 1 hour gap
  const isReturnVisitor = previousVisit > 0 && (Date.now() - previousVisit) > 3_600_000;
  const shouldFetch = isReturnVisitor && hasInterests && topMakes.length > 0;

  // Get the top 3 makes to query for
  const interestMakes = useMemo(
    () => topMakes.slice(0, 3).map((m) => m.name),
    [topMakes],
  );

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;

    async function fetchFreshFinds() {
      const sinceISO = new Date(previousVisit).toISOString();

      // Query vehicles matching interest makes, added since last visit
      // Ordered by find_score (best finds first), fall back to created_at
      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model, primary_image_url, sale_price, asking_price, discovery_source, find_score')
        .gt('created_at', sinceISO)
        .is('deleted_at', null)
        .in('make', interestMakes.map((m) => m.charAt(0) + m.slice(1).toLowerCase()))
        .not('primary_image_url', 'is', null)
        .order('find_score', { ascending: false, nullsFirst: false })
        .limit(10);

      if (cancelled || !data) return;

      // Also try uppercase makes if the first query returned few results
      if (data.length < 5) {
        const { data: data2 } = await supabase
          .from('vehicles')
          .select('id, year, make, model, primary_image_url, sale_price, asking_price, discovery_source, find_score')
          .gt('created_at', sinceISO)
          .is('deleted_at', null)
          .in('make', interestMakes)
          .not('primary_image_url', 'is', null)
          .order('find_score', { ascending: false, nullsFirst: false })
          .limit(10);

        if (cancelled) return;

        // Merge and dedupe
        const seen = new Set(data.map((v) => v.id));
        const merged = [...data];
        for (const v of (data2 || [])) {
          if (!seen.has(v.id)) {
            merged.push(v);
            seen.add(v.id);
          }
        }

        const mapped = merged.slice(0, 10).map((v: any) => ({
          ...v,
          display_price: v.sale_price || v.asking_price || null,
        }));
        setVehicles(mapped);
        return;
      }

      const mapped = data.map((v: any) => ({
        ...v,
        display_price: v.sale_price || v.asking_price || null,
      }));
      setVehicles(mapped);
    }

    fetchFreshFinds();
    return () => { cancelled = true; };
  }, [shouldFetch, previousVisit, interestMakes]);

  // Don't render if nothing to show
  if (!shouldFetch || vehicles.length === 0) return null;

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
                  src={v.primary_image_url}
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
