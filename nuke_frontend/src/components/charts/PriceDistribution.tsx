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

const BAR_HEIGHT = 120;

/** Full distribution chart — pure HTML, hover-interactive, click-through */
export function PriceDistributionChart({ bins, make }: {
  bins: HistogramBin[];
  make: string;
}) {
  const navigate = useNavigate();
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);

  const { filled, max, total } = useMemo(() => {
    const arr = new Array(NUM_BUCKETS + 2).fill(0);
    for (const { b, n } of bins) arr[Math.max(0, Math.min(b, NUM_BUCKETS + 1))] = n;
    const total = arr.reduce((a: number, b: number) => a + b, 0);
    const max = Math.max(...arr, 1);
    return { filled: arr, max, total };
  }, [bins]);

  // Show labels at these bucket indices
  const labelIndices = [0, 3, 6, 9, 12, 15];

  return (
    <div style={{ width: '100%' }}>
      {/* Hover readout */}
      <div style={{
        height: 14,
        fontSize: 9,
        fontFamily: 'Courier New, monospace',
        color: hoveredBucket !== null ? 'var(--text)' : 'var(--text-secondary)',
        marginBottom: 8,
        letterSpacing: '0.04em',
      }}>
        {hoveredBucket !== null
          ? `${bucketRange(hoveredBucket)}  ·  ${filled[hoveredBucket].toLocaleString()} vehicles  ·  ${((filled[hoveredBucket] / total) * 100).toFixed(1)}%`
          : `${total.toLocaleString()} VEHICLES WITH PRICES`
        }
      </div>

      {/* Bars */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        height: BAR_HEIGHT,
        gap: 2,
        width: '100%',
      }}>
        {filled.map((n, i) => {
          const pct = n / max;
          const isHovered = hoveredBucket === i;
          const handleClick = () => {
            if (n === 0) return;
            const { min, max: mx } = bucketPriceBounds(i);
            const params = new URLSearchParams();
            params.set('tab', 'feed');
            params.set('make', make);
            params.set('price_min', String(min));
            params.set('price_max', String(mx));
            navigate(`/?${params.toString()}`);
          };
          return (
            <div
              key={i}
              onMouseEnter={() => setHoveredBucket(i)}
              onMouseLeave={() => setHoveredBucket(null)}
              onClick={handleClick}
              style={{
                flex: 1,
                height: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                cursor: n > 0 ? 'pointer' : 'default',
              }}
            >
              <div style={{
                width: '100%',
                height: n > 0 ? Math.max(2, pct * BAR_HEIGHT) : 0,
                background: isHovered ? 'var(--text)' : 'var(--text-secondary)',
                opacity: isHovered ? 1 : n > 0 ? 0.45 : 0,
                transition: 'opacity 80ms ease-out, background 80ms ease-out',
              }} />
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div style={{
        display: 'flex',
        width: '100%',
        marginTop: 6,
      }}>
        {filled.map((_, i) => (
          <div key={i} style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 8,
            fontFamily: 'Courier New, monospace',
            color: 'var(--text-secondary)',
            opacity: labelIndices.includes(i) ? 0.6 : 0,
            letterSpacing: '0.02em',
            userSelect: 'none',
          }}>
            {bucketShortLabel(i)}
          </div>
        ))}
      </div>
    </div>
  );
}
