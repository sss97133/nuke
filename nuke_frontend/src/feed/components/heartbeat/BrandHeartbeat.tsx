import { useState } from 'react';
import { useMakeMarketStats, useModelMarketStats } from '../../../hooks/useMarketStats';
import { HeartbeatStatCell } from './HeartbeatStatCell';
import { HeartbeatModelBar } from './HeartbeatModelBar';
import { HeartbeatTrend } from './HeartbeatTrend';

function formatPrice(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function formatPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export interface BrandHeartbeatProps {
  make: string;
  model?: string;
}

export function BrandHeartbeat({ make, model }: BrandHeartbeatProps) {
  const [collapsed, setCollapsed] = useState(false);
  const makeStats = useMakeMarketStats(make, true);
  const modelStats = useModelMarketStats(make, model, !!model);

  // Loading skeleton
  if (makeStats.isLoading) {
    return (
      <div style={{
        height: '48px',
        background: 'var(--surface)',
        borderBottom: '2px solid var(--border)',
      }} />
    );
  }

  // No data
  if (!makeStats.data || makeStats.state === 'empty') return null;

  const d = makeStats.data;

  // Guard against incomplete data
  if (d.total_listings == null || d.avg_price == null) return null;

  if (collapsed) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          height: '24px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text)',
        }}>
          {make} — {d.total_listings.toLocaleString()} listings — {formatPrice(d.avg_price)} avg
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            background: 'none',
            border: 'none',
            color: 'var(--text-disabled)',
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          EXPAND
        </button>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface)',
      borderBottom: '2px solid var(--border)',
      padding: '10px 12px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px',
      }}>
        <span style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'var(--text)',
        }}>
          {make}
          {model && <span style={{ color: 'var(--text-disabled)', marginLeft: '6px' }}>{model}</span>}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            background: 'none',
            border: 'none',
            color: 'var(--text-disabled)',
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          COLLAPSE
        </button>
      </div>

      {/* Stat grid */}
      <div style={{
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        marginBottom: '10px',
      }}>
        <HeartbeatStatCell label="LISTINGS" value={d.total_listings.toLocaleString()} />
        <HeartbeatStatCell label="AVG PRICE" value={formatPrice(d.avg_price)} />
        <HeartbeatStatCell label="MEDIAN" value={formatPrice(d.median_price)} />
        <HeartbeatStatCell
          label="SELL-THROUGH"
          value={d.sell_through_pct != null ? formatPct(d.sell_through_pct) : '—'}
        />
        {d.sentiment_score != null && (
          <HeartbeatStatCell label="SENTIMENT" value={String(d.sentiment_score)} />
        )}
        {d.demand_high_pct != null && (
          <HeartbeatStatCell
            label="DEMAND"
            value={d.demand_high_pct > 60 ? 'HIGH' : d.demand_high_pct > 30 ? 'MED' : 'LOW'}
            color={d.demand_high_pct > 60 ? 'var(--success)' : undefined}
          />
        )}
      </div>

      {/* Model bar chart */}
      {d.top_models && d.top_models.length > 0 && (
        <HeartbeatModelBar models={d.top_models} />
      )}

      {/* Model-level trend (when drilled down to a specific model) */}
      {modelStats.data && modelStats.state !== 'empty' && (
        <HeartbeatTrend stats={modelStats.data} />
      )}
    </div>
  );
}
