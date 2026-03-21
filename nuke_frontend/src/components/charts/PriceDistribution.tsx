import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Price distribution histogram — pure HTML/CSS, matches design system.
 *
 * Buckets are log-scale: width_bucket(ln(price), ln(1000), ln(15000000), 15)
 * Bucket 0 = below $1K, buckets 1-15 = log-spaced, bucket 16 = above $15M
 */

interface HistogramBin {
  b: number; // bucket index (0-16)
  n: number; // count
}

const LN_LO = Math.log(1000);
const LN_HI = Math.log(15_000_000);
const NUM_BUCKETS = 15;
const STEP = (LN_HI - LN_LO) / NUM_BUCKETS;

function bucketRange(b: number): string {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  };
  if (b <= 0) return `< $1K`;
  if (b > NUM_BUCKETS) return `> $15M`;
  const lo = Math.exp(LN_LO + (b - 1) * STEP);
  const hi = Math.exp(LN_LO + b * STEP);
  return `${fmt(lo)} – ${fmt(hi)}`;
}

function bucketShortLabel(b: number): string {
  if (b <= 0) return '<$1K';
  if (b > NUM_BUCKETS) return '$15M+';
  const lo = Math.exp(LN_LO + (b - 1) * STEP);
  if (lo >= 1_000_000) return `$${(lo / 1_000_000).toFixed(1)}M`;
  if (lo >= 1_000) return `$${Math.round(lo / 1_000)}K`;
  return `$${Math.round(lo)}`;
}

function bucketPriceBounds(b: number): { min: number; max: number } {
  if (b <= 0) return { min: 0, max: 1000 };
  if (b > NUM_BUCKETS) return { min: 15_000_000, max: 100_000_000 };
  return {
    min: Math.round(Math.exp(LN_LO + (b - 1) * STEP)),
    max: Math.round(Math.exp(LN_LO + b * STEP)),
  };
}

/** Tiny inline sparkline — fits inside treemap cells */
export function MiniDistribution({ bins, width = 80, height = 20 }: {
  bins: HistogramBin[];
  width?: number;
  height?: number;
}) {
  const filled = useMemo(() => {
    const arr = new Array(NUM_BUCKETS + 2).fill(0);
    for (const { b, n } of bins) arr[Math.max(0, Math.min(b, NUM_BUCKETS + 1))] = n;
    return arr;
  }, [bins]);

  const max = Math.max(...filled, 1);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: 0,
      width,
      height,
      flexShrink: 0,
    }}>
      {filled.map((n, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: n > 0 ? Math.max(1, (n / max) * height) : 0,
            background: 'var(--text-secondary)',
            opacity: n > 0 ? 0.5 : 0,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Market depth tiers — groups log-scale histogram bins into meaningful
 * price segments that tell you the composition of the market at a glance.
 *
 * Each tier is clickable → navigates to search filtered by that price range.
 */

interface MarketTier {
  label: string;
  min: number;
  max: number;
  count: number;
}

function aggregateTiers(bins: HistogramBin[]): MarketTier[] {
  // Materialize all 17 buckets (0 = <$1K, 1-15 log-spaced, 16 = >$15M)
  const filled = new Array(NUM_BUCKETS + 2).fill(0);
  for (const { b, n } of bins) filled[Math.max(0, Math.min(b, NUM_BUCKETS + 1))] = n;

  // Map each bucket to its price bounds, then sum into tiers
  const tierDefs = [
    { label: 'ENTRY',     min: 0,         max: 10_000 },
    { label: 'CORE',      min: 10_000,    max: 50_000 },
    { label: 'COLLECTOR', min: 50_000,    max: 250_000 },
    { label: 'PREMIUM',   min: 250_000,   max: 1_000_000 },
    { label: 'TROPHY',    min: 1_000_000, max: Infinity },
  ];

  return tierDefs.map(td => {
    let count = 0;
    for (let i = 0; i <= NUM_BUCKETS + 1; i++) {
      const bounds = bucketPriceBounds(i);
      // Bucket overlaps tier if its midpoint falls within
      const mid = (bounds.min + Math.min(bounds.max, 20_000_000)) / 2;
      if (mid >= td.min && mid < td.max) count += filled[i];
    }
    return { ...td, count };
  });
}

const tierPriceLabel = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};

/** Market depth chart — horizontal tier bars with counts and percentages */
export function PriceDistributionChart({ bins, make }: {
  bins: HistogramBin[];
  make: string;
}) {
  const navigate = useNavigate();
  const [hoveredTier, setHoveredTier] = useState<number | null>(null);

  const { tiers, total, maxCount } = useMemo(() => {
    const tiers = aggregateTiers(bins);
    const total = tiers.reduce((a, t) => a + t.count, 0);
    const maxCount = Math.max(...tiers.map(t => t.count), 1);
    return { tiers, total, maxCount };
  }, [bins]);

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        color: 'var(--text-secondary)', marginBottom: 10,
        fontFamily: 'Courier New, monospace',
      }}>
        MARKET DEPTH — {total.toLocaleString()} WITH PRICES
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {tiers.map((tier, i) => {
          if (tier.count === 0) return null;
          const pct = total > 0 ? (tier.count / total) * 100 : 0;
          const barWidth = (tier.count / maxCount) * 100;
          const isHovered = hoveredTier === i;
          const rangeLabel = tier.max === Infinity
            ? `${tierPriceLabel(tier.min)}+`
            : `${tierPriceLabel(tier.min)}–${tierPriceLabel(tier.max)}`;

          return (
            <div
              key={tier.label}
              onClick={() => {
                const params = new URLSearchParams();
                params.set('tab', 'feed');
                params.set('make', make);
                params.set('price_min', String(tier.min));
                if (tier.max !== Infinity) params.set('price_max', String(tier.max));
                navigate(`/?${params.toString()}`);
              }}
              onMouseEnter={() => setHoveredTier(i)}
              onMouseLeave={() => setHoveredTier(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 0,
                cursor: 'pointer', height: 22,
                opacity: isHovered ? 1 : 0.85,
                transition: 'opacity 80ms ease-out',
              }}
            >
              {/* Tier label */}
              <div style={{
                width: 70, flexShrink: 0,
                fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                fontFamily: 'Arial, sans-serif',
                color: isHovered ? 'var(--text)' : 'var(--text-secondary)',
              }}>
                {tier.label}
              </div>

              {/* Price range */}
              <div style={{
                width: 80, flexShrink: 0,
                fontSize: 9,
                fontFamily: 'Courier New, monospace',
                color: 'var(--text-secondary)',
              }}>
                {rangeLabel}
              </div>

              {/* Bar */}
              <div style={{ flex: 1, height: 14, position: 'relative' }}>
                <div style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  background: isHovered ? 'var(--text)' : 'var(--text-secondary)',
                  opacity: isHovered ? 0.7 : 0.3,
                  transition: 'opacity 80ms ease-out, background 80ms ease-out, width 300ms ease-out',
                }} />
              </div>

              {/* Count + percentage */}
              <div style={{
                width: 100, flexShrink: 0, textAlign: 'right',
                fontSize: 10,
                fontFamily: 'Courier New, monospace',
                color: isHovered ? 'var(--text)' : 'var(--text-secondary)',
                fontWeight: isHovered ? 700 : 400,
              }}>
                {tier.count.toLocaleString()}
                <span style={{ opacity: 0.5, marginLeft: 6 }}>{pct.toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
