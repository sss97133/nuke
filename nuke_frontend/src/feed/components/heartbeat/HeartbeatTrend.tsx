import type { ModelMarketStats } from '../../../hooks/useMarketStats';
import { HeartbeatStatCell } from './HeartbeatStatCell';

function formatPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

const TREND_ICONS: Record<string, string> = {
  up: '\u2191',
  down: '\u2193',
  stable: '\u2192',
};

export function HeartbeatTrend({ stats }: { stats: ModelMarketStats }) {
  const trend = stats.trend_direction ?? 'stable';

  return (
    <div style={{
      display: 'flex',
      gap: '16px',
      flexWrap: 'wrap',
      padding: '8px 0',
      borderTop: '1px solid var(--border)',
    }}>
      <HeartbeatStatCell
        label="TREND"
        value={`${TREND_ICONS[trend] ?? ''} ${trend.toUpperCase()}`}
        color={trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : undefined}
      />
      <HeartbeatStatCell label="P25" value={formatPrice(stats.p25_price)} />
      <HeartbeatStatCell label="P75" value={formatPrice(stats.p75_price)} />
      <HeartbeatStatCell label="AVG DAYS" value={stats.avg_days_on_market != null ? String(Math.round(stats.avg_days_on_market)) : '—'} />
      {stats.rarity_level && (
        <HeartbeatStatCell label="RARITY" value={stats.rarity_level.toUpperCase()} />
      )}
      {stats.total_produced != null && (
        <HeartbeatStatCell label="PRODUCED" value={stats.total_produced.toLocaleString()} />
      )}
      {stats.collector_demand_score != null && (
        <HeartbeatStatCell label="DEMAND" value={String(stats.collector_demand_score)} />
      )}
    </div>
  );
}
