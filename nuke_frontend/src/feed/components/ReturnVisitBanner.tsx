/**
 * ReturnVisitBanner — Shows personalized "since your last visit" data at the top
 * of the feed for return visitors.
 *
 * Content varies based on what changed since their last visit:
 * - Total new vehicles added
 * - New vehicles matching their top interest make
 * - Price drops on vehicles they previously viewed
 * - Best "find" (highest find_score) since last visit
 *
 * Design: var(--surface) bg, 2px border, Courier New for numbers, 8px labels.
 */

import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import type { InterestEntry } from '../../hooks/useInterests';
import type { FeedVehicle } from '../types/feed';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriceDrop {
  vehicleId: string;
  year: number | null;
  make: string | null;
  model: string | null;
  oldPrice: number;
  currentPrice: number;
  dropPct: number;
}

interface BestFind {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  display_price: number | null;
  find_score: number;
}

export interface ReturnVisitBannerProps {
  /** Timestamp of the user's previous visit (before this session updated it) */
  previousVisit: number;
  /** Whether the user has recorded interests */
  hasInterests: boolean;
  /** Top makes from interest data */
  topMakes: InterestEntry[];
  /** Vehicles currently loaded in the feed */
  vehicles: FeedVehicle[];
  /** Viewed vehicles with their price-at-view for price-drop detection */
  viewedWithPrices: { vehicleId: string; priceAtView: number; timestamp: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgoLabel(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks} weeks ago`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + Math.round(n / 1_000).toLocaleString() + 'K';
  return '$' + n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const container: CSSProperties = {
  background: 'var(--surface)',
  borderBottom: '2px solid var(--border)',
  padding: '8px 12px',
};

const headerStyle: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text)',
  marginBottom: '6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const statRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  alignItems: 'center',
};

const statItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

const statNumber: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text)',
};

const statLabel: CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  color: 'var(--text-secondary)',
};

const dismissBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  color: 'var(--text-disabled)',
  cursor: 'pointer',
  padding: '2px 4px',
  textTransform: 'uppercase',
};

const findHighlight: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '9px',
  fontWeight: 700,
  color: 'var(--success)',
  letterSpacing: '0.02em',
  padding: '3px 8px',
  border: '2px solid var(--border)',
  background: 'transparent',
  display: 'inline-flex',
  gap: '4px',
  alignItems: 'center',
  marginTop: '4px',
};

const priceDropStyle: CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '9px',
  fontWeight: 700,
  color: 'var(--error, #c0392b)',
  letterSpacing: '0.02em',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReturnVisitBanner({
  previousVisit,
  hasInterests,
  topMakes,
  vehicles,
  viewedWithPrices,
}: ReturnVisitBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [newVehicleCount, setNewVehicleCount] = useState<number | null>(null);
  const [bestFind, setBestFind] = useState<BestFind | null>(null);

  // Don't show if first visit (no meaningful previousVisit) or if less than 1 hour gap
  const isReturnVisitor = previousVisit > 0 && (Date.now() - previousVisit) > 3_600_000;

  // Fetch new vehicle count since last visit from Supabase
  useEffect(() => {
    if (!isReturnVisitor || dismissed) return;
    let cancelled = false;

    async function fetchNewCounts() {
      const sinceISO = new Date(previousVisit).toISOString();

      // Get total new vehicles count
      const { count } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .gt('created_at', sinceISO)
        .is('deleted_at', null);

      if (!cancelled && count !== null) {
        setNewVehicleCount(count);
      }
    }

    fetchNewCounts();
    return () => { cancelled = true; };
  }, [isReturnVisitor, previousVisit, dismissed]);

  // Fetch best find since last visit
  useEffect(() => {
    if (!isReturnVisitor || dismissed) return;
    let cancelled = false;

    async function fetchBestFind() {
      const sinceISO = new Date(previousVisit).toISOString();

      const { data } = await supabase
        .from('vehicles')
        .select('id, year, make, model, display_price, find_score')
        .gt('created_at', sinceISO)
        .not('find_score', 'is', null)
        .is('deleted_at', null)
        .order('find_score', { ascending: false })
        .limit(1);

      if (!cancelled && data && data.length > 0 && data[0].find_score > 0) {
        setBestFind(data[0] as BestFind);
      }
    }

    fetchBestFind();
    return () => { cancelled = true; };
  }, [isReturnVisitor, previousVisit, dismissed]);

  // Count new vehicles matching top interest make (from loaded feed data)
  const interestMakeCount = useMemo(() => {
    if (!hasInterests || topMakes.length === 0) return null;
    const topMake = topMakes[0].name;
    const sinceISO = new Date(previousVisit).toISOString();
    const count = vehicles.filter(
      (v) =>
        v.make?.toUpperCase() === topMake &&
        v.created_at > sinceISO,
    ).length;
    if (count === 0) return null;
    return { make: topMake, count };
  }, [hasInterests, topMakes, previousVisit, vehicles]);

  // Compute price drops on viewed vehicles by comparing stored prices vs current feed data
  const priceDrops = useMemo((): PriceDrop[] => {
    if (viewedWithPrices.length === 0 || vehicles.length === 0) return [];

    // Build a map of current prices from feed data
    const currentPriceMap = new Map<string, FeedVehicle>();
    for (const v of vehicles) {
      currentPriceMap.set(v.id, v);
    }

    const drops: PriceDrop[] = [];
    for (const viewed of viewedWithPrices) {
      const current = currentPriceMap.get(viewed.vehicleId);
      if (!current) continue;

      const currentPrice = current.display_price;
      if (!currentPrice || currentPrice <= 0) continue;
      if (currentPrice >= viewed.priceAtView) continue;

      const dropPct = Math.round(((viewed.priceAtView - currentPrice) / viewed.priceAtView) * 100);
      if (dropPct < 1) continue; // skip trivial drops

      drops.push({
        vehicleId: viewed.vehicleId,
        year: current.year,
        make: current.make,
        model: current.model,
        oldPrice: viewed.priceAtView,
        currentPrice,
        dropPct,
      });
    }

    return drops.sort((a, b) => b.dropPct - a.dropPct).slice(0, 5);
  }, [viewedWithPrices, vehicles]);

  // Don't render conditions
  if (!isReturnVisitor || dismissed) return null;

  // Don't render if we have no data to show yet
  const hasAnyData =
    (newVehicleCount !== null && newVehicleCount > 0) ||
    interestMakeCount !== null ||
    priceDrops.length > 0 ||
    bestFind !== null;

  if (!hasAnyData) return null;

  return (
    <div style={container}>
      {/* Header */}
      <div style={headerStyle}>
        <span>
          SINCE YOUR LAST VISIT ({timeAgoLabel(previousVisit)}):
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={dismissBtn}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-disabled)'; }}
        >
          DISMISS
        </button>
      </div>

      {/* Stat row */}
      <div style={statRow}>
        {/* New vehicles total */}
        {newVehicleCount !== null && newVehicleCount > 0 && (
          <span style={statItem}>
            <span style={statNumber}>+{fmtNum(newVehicleCount)}</span>
            <span style={statLabel}>new vehicles</span>
          </span>
        )}

        {/* New vehicles matching interest */}
        {interestMakeCount && (
          <span style={statItem}>
            <span style={statNumber}>{fmtNum(interestMakeCount.count)}</span>
            <span style={statLabel}>
              new {interestMakeCount.make}{interestMakeCount.count !== 1 ? 's' : ''}
            </span>
          </span>
        )}

        {/* Price drops */}
        {priceDrops.length > 0 && (
          <span style={statItem}>
            <span style={{ ...statNumber, color: 'var(--error, #c0392b)' }}>
              {priceDrops.length}
            </span>
            <span style={statLabel}>
              vehicle{priceDrops.length !== 1 ? 's' : ''} you viewed dropped in price
            </span>
          </span>
        )}
      </div>

      {/* Price drop details (top 3 only) */}
      {priceDrops.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          {priceDrops.slice(0, 3).map((drop) => {
            const label = [drop.year, drop.make, drop.model].filter(Boolean).join(' ');
            return (
              <span key={drop.vehicleId} style={priceDropStyle}>
                {label}: {fmtMoney(drop.oldPrice)} &rarr; {fmtMoney(drop.currentPrice)} (-{drop.dropPct}%)
              </span>
            );
          })}
        </div>
      )}

      {/* Best find highlight */}
      {bestFind && (
        <div style={findHighlight}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '8px', fontFamily: 'Arial, sans-serif', fontWeight: 800, textTransform: 'uppercase' }}>
            TOP FIND:
          </span>
          <span>
            {[bestFind.year, bestFind.make, bestFind.model].filter(Boolean).join(' ')}
            {bestFind.display_price ? ` — ${fmtMoney(bestFind.display_price)}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
