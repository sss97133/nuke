/**
 * DealsHeroPanel -- Server-powered DEALS lens visualization.
 *
 * Shows where the arbitrage is:
 * - Top row: deal count + best deal highlight
 * - Scrollable horizontal strip of top deal compact cards
 * - Deal distribution by make sidebar
 * - Price vs estimate scatter dots
 *
 * Design: green accent for deal badges, 2px borders, zero radius, Courier New for prices.
 */

import { useRef, useState, useMemo } from 'react';
import { useHeroDeals, type DealItem, type DealByMake, type PriceVsEstimateItem } from '../../hooks/useHeroDeals';
import { optimizeImageUrl } from '../../../lib/imageOptimizer';
import type { HeroFilter } from '../HeroPanel';

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
// Deal Card (horizontal scroll strip)
// ---------------------------------------------------------------------------

function DealCard({
  deal, rank, onClick,
}: {
  deal: DealItem; rank: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imgError, setImgError] = useState(false);
  const ymm = [deal.year, deal.make, deal.model].filter(Boolean).join(' ');
  const thumbUrl = optimizeImageUrl(deal.thumbnail, 'small');
  const discountPct = deal.nuke_estimate && deal.price && deal.nuke_estimate > 0
    ? Math.round(((deal.nuke_estimate - deal.price) / deal.nuke_estimate) * 100)
    : null;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 180, minWidth: 180, height: '100%',
        border: `2px solid ${hovered ? 'var(--text)' : 'var(--border)'}`,
        background: hovered ? 'var(--surface-hover)' : 'var(--surface)',
        cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        transition: 'border-color 120ms ease-out, background 120ms ease-out',
        userSelect: 'none', position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div style={{ width: '100%', height: 72, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}>
        {thumbUrl && !imgError ? (
          <img
            src={thumbUrl} alt={ymm} onError={() => setImgError(true)}
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

        {/* Deal score badge */}
        <div style={{
          position: 'absolute', top: 4, right: 4, background: '#16825d', color: '#fff',
          fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700,
          padding: '2px 4px', lineHeight: 1,
        }}>
          {Math.round(deal.deal_score)}%
        </div>

        {/* Rank badge */}
        <div style={{
          position: 'absolute', top: 4, left: 4, background: 'var(--text)', color: 'var(--surface)',
          fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
          padding: '1px 3px', lineHeight: 1,
        }}>
          #{rank}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: '4px 6px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{
          fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
          color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', letterSpacing: '0.03em',
        }}>
          {ymm || 'UNKNOWN'}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700,
            color: 'var(--text)',
          }}>
            {fmtPrice(deal.price)}
          </span>
          {discountPct != null && discountPct > 0 && (
            <span style={{
              fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
              color: '#16825d',
            }}>
              {discountPct}% BELOW
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Make distribution bar
// ---------------------------------------------------------------------------

function MakeBar({
  make, count, bestScore, maxCount, onClick,
}: {
  make: string; count: number; bestScore: number; maxCount: number; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const barWidth = Math.max(20, (count / maxCount) * 100);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '1px 0' }}
    >
      <span style={{
        fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
        color: hovered ? 'var(--text)' : 'var(--text-secondary)',
        width: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        letterSpacing: '0.03em', textAlign: 'right', flexShrink: 0,
        transition: 'color 120ms ease-out',
      }}>
        {make}
      </span>
      <div style={{
        width: `${barWidth}%`, height: 8,
        background: hovered ? '#16825d' : '#2d9d78',
        border: `1px solid ${hovered ? '#16825d' : 'var(--border)'}`,
        transition: 'background 120ms ease-out, border-color 120ms ease-out, width 200ms ease-out',
        minWidth: 8, maxWidth: 'calc(100% - 90px)',
      }} />
      <span style={{
        fontFamily: "'Courier New', monospace", fontSize: 8,
        color: 'var(--text-disabled)', flexShrink: 0,
      }}>
        {count}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price vs estimate scatter dots
// ---------------------------------------------------------------------------

function ScatterDots({ items }: { items: PriceVsEstimateItem[] }) {
  if (items.length === 0) return null;

  const maxPrice = Math.max(...items.map((i) => Math.max(i.price, i.estimate)));
  const underCount = items.filter((i) => i.discount_pct > 10).length;
  const overCount = items.filter((i) => i.discount_pct < -10).length;
  const fairCount = items.length - underCount - overCount;

  return (
    <div>
      <div style={{
        fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 700,
        textTransform: 'uppercase', color: 'var(--text-disabled)',
        letterSpacing: '0.5px', marginBottom: 2,
      }}>
        PRICE VS ESTIMATE
      </div>
      {/* Stacked bar */}
      <div style={{
        display: 'flex', width: '100%', height: 14,
        border: '2px solid var(--border)', overflow: 'hidden',
      }}>
        {underCount > 0 && (
          <div style={{
            width: `${(underCount / items.length) * 100}%`, height: '100%',
            background: '#16825d', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {underCount > 2 && (
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 7, fontWeight: 700, color: '#fff' }}>
                {underCount} UNDER
              </span>
            )}
          </div>
        )}
        {fairCount > 0 && (
          <div style={{
            width: `${(fairCount / items.length) * 100}%`, height: '100%',
            background: 'var(--text-disabled)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {fairCount > 2 && (
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 7, fontWeight: 700, color: '#fff' }}>
                {fairCount} FAIR
              </span>
            )}
          </div>
        )}
        {overCount > 0 && (
          <div style={{
            width: `${(overCount / items.length) * 100}%`, height: '100%',
            background: 'var(--error)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {overCount > 2 && (
              <span style={{ fontFamily: "'Courier New', monospace", fontSize: 7, fontWeight: 700, color: '#fff' }}>
                {overCount} OVER
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div style={{ width: '100%', height: '100%', padding: '8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 14, width: 160, background: 'var(--border)', opacity: 0.4 }} />
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ width: 180, minWidth: 180, height: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ height: 72, background: 'var(--border)', opacity: 0.2 }} />
            <div style={{ height: 8, width: '80%', background: 'var(--border)', opacity: 0.3 }} />
            <div style={{ height: 8, width: '50%', background: 'var(--border)', opacity: 0.25 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export interface DealsHeroPanelProps {
  onFilter: (filter: HeroFilter) => void;
}

export function DealsHeroPanel({ onFilter }: DealsHeroPanelProps) {
  const { data, isLoading, error } = useHeroDeals(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const topDeals = data?.top_deals ?? [];
  const dealByMake = data?.deal_by_make ?? [];
  const priceVsEstimate = data?.price_vs_estimate ?? [];

  const bestDeal = topDeals[0] ?? null;
  const maxMakeCount = useMemo(
    () => Math.max(...dealByMake.map((m) => m.count), 1),
    [dealByMake],
  );

  if (isLoading) return <LoadingSkeleton />;

  if (error || topDeals.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Arial, sans-serif', fontSize: 9, color: 'var(--text-disabled)', textTransform: 'uppercase',
      }}>
        NO DEAL DATA AVAILABLE
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top row: deal count + best deal callout */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: "'Courier New', monospace", fontSize: 14, fontWeight: 700,
            color: '#16825d', lineHeight: 1,
          }}>
            {fmtNum(data?.total_deals ?? 0)}
          </span>
          <span style={{
            fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--text)', letterSpacing: '0.5px',
          }}>
            DEALS RIGHT NOW
          </span>
        </div>

        {bestDeal && (
          <div
            onClick={() => { if (bestDeal.make) onFilter({ makes: [bestDeal.make], sort: 'deal_score' as any }); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              padding: '2px 6px', border: '2px solid #16825d', background: 'rgba(22, 130, 93, 0.08)',
            }}
          >
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700, color: '#16825d' }}>
              BEST:
            </span>
            <span style={{
              fontFamily: 'Arial, sans-serif', fontSize: 8, fontWeight: 700,
              textTransform: 'uppercase', color: 'var(--text)',
            }}>
              {[bestDeal.year, bestDeal.make, bestDeal.model].filter(Boolean).join(' ')}
            </span>
            <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, fontWeight: 700, color: 'var(--text)' }}>
              {fmtPrice(bestDeal.price)}
            </span>
            <span style={{
              fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700,
              color: '#fff', background: '#16825d', padding: '1px 3px',
            }}>
              {Math.round(bestDeal.deal_score)}% DEAL
            </span>
          </div>
        )}
      </div>

      {/* Main content: cards strip + sidebar */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left: scrollable deal cards */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div
            ref={scrollRef}
            style={{
              display: 'flex', gap: 2, overflowX: 'auto', overflowY: 'hidden',
              height: '100%', padding: '4px 4px', scrollBehavior: 'smooth',
            }}
          >
            {topDeals.slice(0, 15).map((deal, i) => (
              <DealCard
                key={deal.id}
                deal={deal}
                rank={i + 1}
                onClick={() => {
                  if (deal.make) onFilter({ makes: [deal.make], sort: 'deal_score' as any });
                }}
              />
            ))}
          </div>
        </div>

        {/* Right sidebar: make distribution + scatter */}
        <div style={{
          width: 200, flexShrink: 0, borderLeft: '1px solid var(--border)',
          padding: '4px 6px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden',
        }}>
          <div style={{
            fontFamily: 'Arial, sans-serif', fontSize: 7, fontWeight: 700,
            textTransform: 'uppercase', color: 'var(--text-disabled)', letterSpacing: '0.5px',
          }}>
            DEALS BY MAKE
          </div>

          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
            {dealByMake.map((m) => (
              <MakeBar
                key={m.make}
                make={m.make}
                count={m.count}
                bestScore={m.best_score}
                maxCount={maxMakeCount}
                onClick={() => onFilter({ makes: [m.make], sort: 'deal_score' as any })}
              />
            ))}
          </div>

          <ScatterDots items={priceVsEstimate} />
        </div>
      </div>
    </div>
  );
}
