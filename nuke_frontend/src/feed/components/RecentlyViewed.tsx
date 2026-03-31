/**
 * RecentlyViewed — Horizontal scrollable strip of recently viewed vehicles.
 *
 * Small thumbnails (60px) with make/model text.
 * Only renders when user has view history.
 * Clickable: opens VehiclePopup.
 *
 * Design: 2px borders, zero radius, 8px labels, Courier New for prices.
 */

import { useEffect, useMemo, useState, useRef, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { useViewHistory } from '../../hooks/useViewHistory';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import { usePopup } from '../../components/popups/usePopup';
import { VehiclePopup } from '../../components/popups/VehiclePopup';
import type { FeedVehicle } from '../types/feed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentVehicleMini {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  display_price: number | null;
  mileage: number | null;
  transmission: string | null;
  body_style: string | null;
  vin: string | null;
  discovery_source: string | null;
  discovery_url: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Styles
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
  scrollbarWidth: 'none', // Firefox
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RecentlyViewedProps {
  /** Max number of items to show */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecentlyViewed({ limit = 20 }: RecentlyViewedProps) {
  const { getRecentlyViewed, totalViews } = useViewHistory();
  const { openPopup } = usePopup();
  const [vehicles, setVehicles] = useState<RecentVehicleMini[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Get recent unique vehicle IDs
  const recentEntries = useMemo(
    () => getRecentlyViewed(limit),
    [getRecentlyViewed, limit],
  );

  const recentIds = useMemo(
    () => recentEntries.map((e) => e.vehicleId),
    [recentEntries],
  );

  // Fetch vehicle data for the recent IDs
  useEffect(() => {
    if (recentIds.length === 0) {
      setVehicles([]);
      return;
    }

    let cancelled = false;

    async function fetchVehicles() {
      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model, primary_image_url, sale_price, asking_price, mileage, transmission, body_style, vin, discovery_source, discovery_url, description')
        .in('id', recentIds.slice(0, limit));

      if (cancelled || !data) return;

      // Sort results to match the recentIds order (most recent first)
      const idOrder = new Map(recentIds.map((id, i) => [id, i]));
      const sorted = (data as RecentVehicleMini[]).sort(
        (a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999),
      );

      // Map asking_price to display_price if no sale_price
      const mapped = sorted.map((v: any) => ({
        ...v,
        display_price: v.sale_price || v.asking_price || null,
      }));

      setVehicles(mapped);
    }

    fetchVehicles();
    return () => { cancelled = true; };
  }, [recentIds, limit]);

  // Don't render if no history
  if (totalViews === 0 || vehicles.length === 0) return null;

  const formatPrice = (n: number | null) => {
    if (!n || n <= 0) return null;
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return '$' + Math.round(n / 1_000) + 'K';
    return '$' + n.toLocaleString();
  };

  const handleClick = (v: RecentVehicleMini) => {
    // Build a FeedVehicle with specs for the popup
    const feedVehicle: FeedVehicle = {
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      display_price: v.display_price,
      price_source: v.sale_price ? 'sale' : 'none',
      is_for_sale: false,
      thumbnail_url: v.primary_image_url,
      mileage: v.mileage,
      transmission: v.transmission,
      body_style: v.body_style,
      vin: v.vin,
      discovery_source: v.discovery_source,
      discovery_url: v.discovery_url,
      description: v.description,
      created_at: '',
    };
    const title = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
    openPopup(<VehiclePopup vehicle={feedVehicle} />, title, 420);
  };

  return (
    <div style={stripContainer}>
      <div
        ref={scrollRef}
        style={scrollArea}
        className="no-scrollbar"
      >
        <span style={labelStyle}>RECENTLY VIEWED</span>

        {vehicles.map((v) => {
          const name = v.make
            ? `${v.make}${v.model ? ' ' + v.model : ''}`
            : 'VEHICLE';
          const priceText = formatPrice(v.display_price);

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
            </div>
          );
        })}

        {/* Tail padding for scroll */}
        <div style={{ width: '8px', flexShrink: 0 }} />
      </div>
    </div>
  );
}
