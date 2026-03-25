/**
 * FindsHeroPanel — STORY-style hero for the FINDS lens.
 *
 * Not a treemap. A horizontal scrollable strip of story cards.
 * Each card: thumbnail, "1971 PLYMOUTH CUDA -- BARN FIND" headline,
 * find_score badge, red flag count, source.
 * Below: "WHY THIS IS A FIND" one-liner from signal breakdown.
 * Click -> VehiclePopup (via onFilter).
 *
 * Design: 2px borders, zero radius, Courier New for scores, story cards.
 */

import { useRef, useState } from 'react';
import { useHeroFinds, buildFindExplanation, type FindItem } from '../../hooks/useHeroFinds';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';
import type { HeroFilter } from '../HeroPanel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FindsHeroPanelProps {
  onFilter: (filter: HeroFilter) => void;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function buildHeadline(item: FindItem): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  if (item.make) parts.push(item.make.toUpperCase());
  if (item.model) parts.push(item.model.toUpperCase());

  const sb = item.signal_breakdown;
  // Add flavor tag
  if (sb.condition === 'concours') return parts.join(' ') + ' -- CONCOURS';
  if (sb.old_discovery) return parts.join(' ') + ' -- DISCOVERY';
  if (sb.rare) return parts.join(' ') + ' -- RARE';
  if (sb.red_flags > 2) return parts.join(' ') + ' -- BARN FIND';
  if (sb.mods > 5) return parts.join(' ') + ' -- RESTOMOD';
  if (sb.cross_platform > 1) return parts.join(' ') + ' -- HOT COMMODITY';
  if (sb.deal_score > 70) return parts.join(' ') + ' -- SLEEPER DEAL';
  if (sb.heat_score > 60) return parts.join(' ') + ' -- TRENDING';
  return parts.join(' ');
}

function sourceLabel(src: string | null): string {
  if (!src) return '';
  const map: Record<string, string> = {
    bat: 'BAT',
    bringatrailer: 'BAT',
    'cars-and-bids': 'C&B',
    cars_and_bids: 'C&B',
    mecum: 'MECUM',
    'barrett-jackson': 'BJ',
    barrett_jackson: 'BJ',
    pcarmarket: 'PCAR',
    hagerty: 'HAGERTY',
    hemmings: 'HEMMINGS',
    facebook_marketplace: 'FB',
    facebook: 'FB',
    craigslist: 'CL',
    rmsothebys: 'RM',
    bonhams: 'BONHAMS',
    gooding: 'GOODING',
    'collecting-cars': 'CC',
    collecting_cars: 'CC',
  };
  return map[src] ?? src.toUpperCase().slice(0, 6);
}

// ---------------------------------------------------------------------------
// Find Card (horizontal scroll strip)
// ---------------------------------------------------------------------------

function FindCard({
  item,
  rank,
  onClick,
}: {
  item: FindItem;
  rank: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const thumbUrl = optimizeImageUrl(item.primary_image_url, 'small');
  const headline = buildHeadline(item);
  const explanation = buildFindExplanation(item);
  const src = sourceLabel(item.discovery_source);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 220,
        minWidth: 220,
        height: '100%',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        cursor: 'pointer',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none',
        position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        width: '100%',
        height: 80,
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--bg)',
      }}>
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl}
            alt={headline}
            onError={() => setImgError(true)}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Courier New', monospace", fontSize: 9, color: 'var(--text-disabled)',
          }}>
            NO IMG
          </div>
        )}

        {/* Find score badge */}
        <div style={{
          position: 'absolute',
          top: 4,
          right: 4,
          background: 'var(--text)',
          color: 'var(--surface)',
          fontFamily: "'Courier New', monospace",
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 5px',
          lineHeight: 1,
          letterSpacing: '0.02em',
        }}>
          {item.find_score}
        </div>

        {/* Rank badge */}
        <div style={{
          position: 'absolute',
          top: 4,
          left: 4,
          background: 'var(--text)',
          color: 'var(--surface)',
          fontFamily: "'Courier New', monospace",
          fontSize: 8,
          fontWeight: 700,
          padding: '1px 3px',
          lineHeight: 1,
        }}>
          #{rank}
        </div>

        {/* Source badge */}
        {src && (
          <div style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontSize: 7,
            fontWeight: 700,
            padding: '1px 4px',
            lineHeight: 1.2,
            letterSpacing: '0.3px',
            textTransform: 'uppercase',
          }}>
            {src}
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '5px 6px', flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Headline */}
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 9,
          fontWeight: 800,
          textTransform: 'uppercase',
          color: 'var(--text)',
          lineHeight: 1.2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          letterSpacing: '0.04em',
        }}>
          {headline || 'UNKNOWN'}
        </div>

        {/* Price + signal badges row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {item.display_price != null && (
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--text)',
            }}>
              {fmtPrice(item.display_price)}
            </span>
          )}

          {item.signal_breakdown.deal_score > 70 && (
            <SignalBadge label={`DEAL ${item.signal_breakdown.deal_score}%`} color="#16825d" />
          )}
          {item.signal_breakdown.rare && (
            <SignalBadge label="RARE" color="#b45309" />
          )}
          {item.red_flag_count > 0 && (
            <SignalBadge label={`${item.red_flag_count} FLAG${item.red_flag_count > 1 ? 'S' : ''}`} color="#dc2626" />
          )}
          {item.cross_platform_count > 1 && (
            <SignalBadge label={`${item.cross_platform_count}x PLATFORM`} color="#6d28d9" />
          )}
        </div>

        {/* WHY THIS IS A FIND one-liner */}
        <div style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 7,
          color: 'var(--text-secondary)',
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginTop: 'auto',
          letterSpacing: '0.02em',
        }}>
          {explanation}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal Badge
// ---------------------------------------------------------------------------

function SignalBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontFamily: "'Courier New', monospace",
      fontSize: 7,
      fontWeight: 700,
      color: '#fff',
      background: color,
      padding: '1px 3px',
      lineHeight: 1,
      letterSpacing: '0.02em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FindsHeroPanel({ onFilter }: FindsHeroPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: finds, isLoading, error } = useHeroFinds(true);

  // Scroll with arrow buttons
  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = dir === 'left' ? -440 : 440;
    scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  const handleCardClick = (item: FindItem) => {
    // Filter to this specific make + model + navigate
    onFilter({
      makes: item.make ? [item.make] : undefined,
      sort: 'finds' as any,
    });
  };

  if (isLoading) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 8,
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'var(--text-disabled)',
        letterSpacing: '0.5px',
      }}>
        LOADING FINDS...
      </div>
    );
  }

  if (error || !finds || finds.length === 0) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 8,
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'var(--text-disabled)',
        letterSpacing: '0.5px',
      }}>
        NO FINDS DATA
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px 2px',
      }}>
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 8,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text-disabled)',
        }}>
          TOP FINDS — MULTI-SIGNAL DISCOVERIES
        </div>

        {/* Scroll arrows */}
        <div style={{ display: 'flex', gap: 2 }}>
          <ArrowButton direction="left" onClick={() => scroll('left')} />
          <ArrowButton direction="right" onClick={() => scroll('right')} />
        </div>
      </div>

      {/* Horizontal scrollable card strip */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          display: 'flex',
          gap: 2,
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '2px 8px 6px',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {finds.map((item, i) => (
          <FindCard
            key={item.vehicle_id}
            item={item}
            rank={i + 1}
            onClick={() => handleCardClick(item)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arrow button
// ---------------------------------------------------------------------------

function ArrowButton({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 20,
        height: 16,
        border: `1px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        color: hovered ? 'var(--text)' : 'var(--text-disabled)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 10,
        fontWeight: 700,
        padding: 0,
        transition: 'all 120ms ease-out',
      }}
    >
      {direction === 'left' ? '\u2190' : '\u2192'}
    </button>
  );
}
