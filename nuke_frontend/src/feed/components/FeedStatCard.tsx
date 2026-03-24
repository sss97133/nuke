import type { FeedStats } from '../types/feed';
import type { FilteredStats } from './FeedStatsStrip';

/** Format a number compactly: 1.2B, 345.6M, 12.3K, 1,234 */
function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function formatDollar(n: number): string {
  return `$${formatCompact(n)}`;
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '8px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.3px',
  color: 'var(--text-disabled)',
};

const valueStyle: React.CSSProperties = {
  fontFamily: "'Courier New', monospace",
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--text)',
};

export function FeedStatCard({
  index,
  stats,
  filteredStats,
}: {
  index: number;
  stats: FeedStats | null;
  filteredStats?: FilteredStats | null;
}) {
  if (!stats) return null;

  // Use filtered stats when available, fall back to global stats
  const count = filteredStats?.count ?? stats.total_vehicles;
  const totalValue = filteredStats?.totalValue ?? stats.total_value;
  const avgPrice = filteredStats?.avgPrice ?? stats.avg_price;
  const forSaleCount = filteredStats?.forSaleCount ?? stats.for_sale_count;
  const liveCount = filteredStats?.liveCount ?? stats.active_auctions;

  // Rotate through stat card variants
  const variant = index % 3;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        padding: '8px 12px',
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        margin: '4px 0',
      }}
    >
      {variant === 0 && (
        <>
          <div>
            <div style={labelStyle}>SHOWING</div>
            <div style={valueStyle}>{formatCompact(count)}</div>
          </div>
          <div>
            <div style={labelStyle}>VALUE</div>
            <div style={valueStyle}>{formatDollar(totalValue)}</div>
          </div>
          {avgPrice > 0 && (
            <div>
              <div style={labelStyle}>AVG PRICE</div>
              <div style={valueStyle}>{formatDollar(avgPrice)}</div>
            </div>
          )}
        </>
      )}
      {variant === 1 && (
        <>
          <div>
            <div style={labelStyle}>FOR SALE</div>
            <div style={valueStyle}>{formatCompact(forSaleCount)}</div>
          </div>
          {liveCount > 0 && (
            <div>
              <div style={labelStyle}>LIVE AUCTIONS</div>
              <div style={{ ...valueStyle, color: 'var(--error)' }}>{liveCount}</div>
            </div>
          )}
          {stats.sales_count_today > 0 && (
            <div>
              <div style={labelStyle}>SOLD TODAY</div>
              <div style={{ ...valueStyle, color: 'var(--success)' }}>{stats.sales_count_today}</div>
            </div>
          )}
        </>
      )}
      {variant === 2 && (
        <>
          {stats.vehicles_added_today > 0 && (
            <div>
              <div style={labelStyle}>ADDED TODAY</div>
              <div style={{ ...valueStyle, color: 'var(--success)' }}>+{stats.vehicles_added_today}</div>
            </div>
          )}
          <div>
            <div style={labelStyle}>TOTAL TRACKED</div>
            <div style={valueStyle}>{formatCompact(stats.total_vehicles)}</div>
          </div>
        </>
      )}
    </div>
  );
}
