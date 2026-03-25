/**
 * HeatHeroPanel — Server-powered HEAT lens visualization.
 *
 * Shows where the attention is:
 * - Top row: "HOTTEST RIGHT NOW" header with #1 vehicle callout
 * - Scrollable horizontal strip of top 5+ hottest vehicles with thermometer bars
 * - Right sidebar: make heat bars + "Most discussed" mini-list (comment velocity)
 *
 * Design: warm colors for heat indicators (sparingly — color communicates data state).
 * 2px borders, zero radius, Courier New for data values.
 */

import { useRef, useState, useMemo } from 'react';
import {
  useHeroHeat,
  type HotVehicle,
  type CommentVelocityItem,
  type MakeHeatItem,
} from '../../hooks/useHeroHeat';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';
import type { HeroFilter } from '../HeroPanel';
import type { SortBy } from '../../../types/feedTypes';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface HeatHeroPanelProps {
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

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Heat color scale — cold blue through warm amber to hot red
// score range: 5-55 based on data distribution
// ---------------------------------------------------------------------------

function heatToBarColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 5) / 50));
  // Hue: 210 (steel blue) -> 30 (amber) -> 0 (red)
  const hue = 210 - t * 210;
  const saturation = 50 + t * 30;
  const lightness = 55 - t * 15;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// ---------------------------------------------------------------------------
// Hot Vehicle Card (horizontal scroll strip)
// ---------------------------------------------------------------------------

function HotCard({
  vehicle,
  rank,
  maxHeat,
  onClick,
}: {
  vehicle: HotVehicle;
  rank: number;
  maxHeat: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(vehicle.thumbnail, 'small');
  const heatPct = maxHeat > 0 ? (vehicle.heat_score / maxHeat) * 100 : 0;
  const barColor = heatToBarColor(vehicle.heat_score);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 180,
        minWidth: 180,
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
        width: '100%', height: 72, overflow: 'hidden',
        position: 'relative', background: 'var(--bg)',
      }}>
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl}
            alt={ymm}
            onError={() => setImgError(true)}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Courier New', monospace", fontSize: 9, color: 'var(--text-disabled)',
          }}>
            NO IMG
          </div>
        )}

        {/* Heat score badge */}
        <div style={{
          position: 'absolute', top: 4, right: 4,
          background: barColor, color: '#fff',
          fontFamily: "'Courier New', monospace",
          fontSize: 9, fontWeight: 700,
          padding: '2px 4px', lineHeight: 1,
          letterSpacing: '0.02em',
        }}>
          {vehicle.heat_score.toFixed(0)} HEAT
        </div>

        {/* Rank badge */}
        <div style={{
          position: 'absolute', top: 4, left: 4,
          background: 'var(--text)', color: 'var(--surface)',
          fontFamily: "'Courier New', monospace",
          fontSize: 8, fontWeight: 700,
          padding: '1px 3px', lineHeight: 1,
        }}>
          #{rank}
        </div>

        {/* Source badge at bottom */}
      </div>

      {/* Info row */}
      <div style={{
        padding: '4px 6px', flex: 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}>
        <div style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 8, fontWeight: 700,
          textTransform: 'uppercase', color: 'var(--text)',
          lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          letterSpacing: '0.03em',
        }}>
          {ymm || 'UNKNOWN'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <span style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 9, fontWeight: 700, color: 'var(--text)',
          }}>
            {fmtPrice(vehicle.price)}
          </span>

          {/* Thermometer bar: cold blue to hot red */}
          <div style={{
            flex: 1, height: 4,
            background: 'var(--border)', overflow: 'hidden',
          }}>
            <div style={{
              width: `${heatPct}%`, height: '100%',
              background: barColor,
              transition: 'width 300ms ease-out',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Make Heat Bar
// ---------------------------------------------------------------------------

function MakeHeatBar({
  item,
  maxHeat,
  onClick,
}: {
  item: MakeHeatItem;
  maxHeat: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const barWidth = Math.max(20, (item.total_heat / maxHeat) * 100);
  const barColor = heatToBarColor(item.total_heat);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center',
        gap: 4, cursor: 'pointer', padding: '1px 0',
      }}
    >
      <span style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: 8, fontWeight: 700,
        textTransform: 'uppercase',
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        width: 60, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', letterSpacing: '0.03em',
        textAlign: 'right', flexShrink: 0,
        transition: 'color 120ms ease-out',
      }}>
        {item.make}
      </span>
      <div style={{
        width: `${barWidth}%`, height: 8,
        background: hovered ? heatToBarColor(item.total_heat + 5) : barColor,
        border: `1px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        transition: 'background 120ms ease-out, border-color 120ms ease-out, width 200ms ease-out',
        minWidth: 8, maxWidth: 'calc(100% - 90px)',
      }} />
      <span style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 8, color: 'var(--text-disabled)', flexShrink: 0,
      }}>
        {item.total_heat}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment Velocity Mini-List
// ---------------------------------------------------------------------------

function VelocityItem({
  item,
  rank,
  onClick,
}: {
  item: CommentVelocityItem;
  rank: number;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const ymm = [item.year, item.make, item.model].filter(Boolean).join(' ');

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center',
        gap: 4, cursor: 'pointer', padding: '2px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 8, fontWeight: 700,
        color: 'var(--text-disabled)',
        width: 14, textAlign: 'right', flexShrink: 0,
      }}>
        {rank}
      </span>
      <span style={{
        fontFamily: 'Arial, sans-serif',
        fontSize: 8, fontWeight: 700,
        textTransform: 'uppercase',
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', letterSpacing: '0.03em',
        transition: 'color 120ms ease-out',
      }}>
        {ymm || 'UNKNOWN'}
      </span>
      <span style={{
        fontFamily: "'Courier New', monospace",
        fontSize: 8, fontWeight: 700,
        color: heatToBarColor(Math.min(55, item.comment_count_7d / 5)),
        flexShrink: 0,
      }}>
        {fmtNum(item.comment_count_7d)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function HeatHeroPanel({ onFilter }: HeatHeroPanelProps) {
  const { data, isLoading, error } = useHeroHeat(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hotVehicles = data?.top_hot ?? [];
  const commentVelocity = data?.comment_velocity ?? [];
  const makeHeat = data?.make_heat ?? [];

  const maxHeat = useMemo(
    () => Math.max(...hotVehicles.map((v) => v.heat_score), 1),
    [hotVehicles],
  );

  const maxMakeHeat = useMemo(
    () => Math.max(...makeHeat.map((m) => m.total_heat), 1),
    [makeHeat],
  );

  const hottestVehicle = hotVehicles[0] ?? null;

  if (isLoading) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Courier New', monospace",
        fontSize: 9, color: 'var(--text-disabled)', textTransform: 'uppercase',
      }}>
        LOADING HEAT DATA...
      </div>
    );
  }

  if (error || hotVehicles.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        fontSize: 9, color: 'var(--text-disabled)', textTransform: 'uppercase',
      }}>
        NO HEAT DATA AVAILABLE
      </div>
    );
  }

  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', padding: '0',
    }}>
      {/* ── Header row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 14, fontWeight: 700,
            color: heatToBarColor(maxHeat), lineHeight: 1,
          }}>
            {hotVehicles.length}
          </span>
          <span style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 8, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--text)',
            letterSpacing: '0.5px',
          }}>
            HOTTEST RIGHT NOW
          </span>
        </div>

        {/* #1 callout */}
        {hottestVehicle && (
          <div
            onClick={() => {
              if (hottestVehicle.make) {
                onFilter({ makes: [hottestVehicle.make], sort: 'heat_score' as SortBy });
              }
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              cursor: 'pointer', padding: '2px 6px',
              border: `2px solid ${heatToBarColor(hottestVehicle.heat_score)}`,
            }}
          >
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 9, fontWeight: 700,
              color: heatToBarColor(hottestVehicle.heat_score),
            }}>
              #1:
            </span>
            <span style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 8, fontWeight: 700,
              textTransform: 'uppercase', color: 'var(--text)',
            }}>
              {[hottestVehicle.year, hottestVehicle.make, hottestVehicle.model].filter(Boolean).join(' ')}
            </span>
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 9, fontWeight: 700, color: 'var(--text)',
            }}>
              {fmtPrice(hottestVehicle.price)}
            </span>
            <span style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 8, fontWeight: 700,
              color: '#fff',
              background: heatToBarColor(hottestVehicle.heat_score),
              padding: '1px 3px',
            }}>
              {hottestVehicle.heat_score.toFixed(0)} HEAT
            </span>
            {hottestVehicle.comment_count > 0 && (
              <span style={{
                fontFamily: "'Courier New', monospace",
                fontSize: 8, fontWeight: 700,
                color: 'var(--text-secondary)',
              }}>
                {fmtNum(hottestVehicle.comment_count)} COMMENTS
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Main content: cards + sidebar ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: scrollable hot vehicle cards */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            ref={scrollRef}
            style={{
              display: 'flex', gap: 2,
              overflowX: 'auto', overflowY: 'hidden',
              height: '100%', padding: '4px 4px',
              scrollBehavior: 'smooth',
            }}
          >
            {hotVehicles.slice(0, 15).map((vehicle, i) => (
              <HotCard
                key={vehicle.id}
                vehicle={vehicle}
                rank={i + 1}
                maxHeat={maxHeat}
                onClick={() => {
                  if (vehicle.listing_url) {
                    window.open(vehicle.listing_url, '_blank');
                  }
                }}
              />
            ))}
          </div>
        </div>

        {/* Right sidebar: make heat + comment velocity */}
        <div style={{
          width: 220, flexShrink: 0,
          borderLeft: '1px solid var(--border)',
          padding: '4px 6px',
          display: 'flex', flexDirection: 'column',
          gap: 2, overflow: 'hidden',
        }}>
          {/* Make heat */}
          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 7, fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--text-disabled)',
            letterSpacing: '0.5px',
          }}>
            HEAT BY MAKE
          </div>

          <div style={{ flex: '0 1 auto', overflowY: 'auto', overflowX: 'hidden', maxHeight: 68 }}>
            {makeHeat.slice(0, 8).map((m) => (
              <MakeHeatBar
                key={m.make}
                item={m}
                maxHeat={maxMakeHeat}
                onClick={() => {
                  onFilter({ makes: [m.make], sort: 'heat_score' as SortBy });
                }}
              />
            ))}
          </div>

          {/* Comment velocity */}
          <div style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 7, fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--text-disabled)',
            letterSpacing: '0.5px',
            marginTop: 2,
          }}>
            MOST DISCUSSED (30D)
          </div>

          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {commentVelocity.slice(0, 5).map((item, i) => (
              <VelocityItem
                key={item.id}
                item={item}
                rank={i + 1}
                onClick={() => {
                  if (item.listing_url) {
                    window.open(item.listing_url, '_blank');
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
