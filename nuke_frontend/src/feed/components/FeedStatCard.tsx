import type { FeedStats } from '../types/feed';

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
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
  vehicleCount,
}: {
  index: number;
  stats: FeedStats | null;
  vehicleCount: number;
}) {
  if (!stats) return null;

  // Rotate through stat card variants
  const variant = index % 3;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        padding: '8px 12px',
        background: '#ebebeb',
        border: '2px solid var(--border)',
        margin: '4px 0',
      }}
    >
      {variant === 0 && (
        <>
          <div>
            <div style={labelStyle}>SHOWING</div>
            <div style={valueStyle}>{vehicleCount.toLocaleString()} vehicles</div>
          </div>
          <div>
            <div style={labelStyle}>TOTAL VALUE</div>
            <div style={valueStyle}>{formatCompact(stats.total_value)}</div>
          </div>
          <div>
            <div style={labelStyle}>AVG PRICE</div>
            <div style={valueStyle}>{formatCompact(stats.avg_price)}</div>
          </div>
        </>
      )}
      {variant === 1 && (
        <>
          <div>
            <div style={labelStyle}>FOR SALE</div>
            <div style={valueStyle}>{stats.for_sale_count.toLocaleString()}</div>
          </div>
          {stats.active_auctions > 0 && (
            <div>
              <div style={labelStyle}>LIVE AUCTIONS</div>
              <div style={{ ...valueStyle, color: '#ef4444' }}>{stats.active_auctions}</div>
            </div>
          )}
          {stats.sales_count_today > 0 && (
            <div>
              <div style={labelStyle}>SOLD TODAY</div>
              <div style={{ ...valueStyle, color: '#10b981' }}>{stats.sales_count_today}</div>
            </div>
          )}
        </>
      )}
      {variant === 2 && (
        <>
          {stats.vehicles_added_today > 0 && (
            <div>
              <div style={labelStyle}>ADDED TODAY</div>
              <div style={{ ...valueStyle, color: '#10b981' }}>+{stats.vehicles_added_today}</div>
            </div>
          )}
          <div>
            <div style={labelStyle}>TOTAL TRACKED</div>
            <div style={valueStyle}>{stats.total_vehicles.toLocaleString()}</div>
          </div>
        </>
      )}
    </div>
  );
}
