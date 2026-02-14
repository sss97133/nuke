import React from 'react';
import MicroPortal from './MicroPortal';
import PortalShell from './PortalShell';
import { useMakeMarketStats } from '../../../hooks/useMarketStats';
import { formatCurrencyAmount } from '../../../utils/currency';

interface MakePortalProps {
  make: string;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function MakePortal({ make, activePortal, onOpen }: MakePortalProps) {
  const isOpen = activePortal === 'make';
  const { data, state, isLoading, error } = useMakeMarketStats(make, isOpen);

  return (
    <MicroPortal
      portalId="make"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={<span>{make}</span>}
      width={280}
    >
      <PortalShell
        title={`${make} Brand Health`}
        isLoading={isLoading}
        error={error}
        state={state}
        emptyContent={
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', padding: '8px 0' }}>
            No {make} data yet
          </div>
        }
        richContent={data && (
          <div style={{ fontSize: '8pt' }}>
            {/* Stat grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
              <StatBox label="Volume" value={String(data.total_listings)} />
              <StatBox label="Avg Price" value={data.avg_price > 0 ? formatCurrencyAmount(data.avg_price) : '—'} />
              <StatBox label="Sell-Through" value={`${Math.round(data.sell_through_pct)}%`} />
              <StatBox
                label="Demand"
                value={
                  data.demand_high_pct != null
                    ? data.demand_high_pct > 60 ? 'High' : data.demand_high_pct > 30 ? 'Medium' : 'Low'
                    : '—'
                }
                color={
                  data.demand_high_pct != null
                    ? data.demand_high_pct > 60 ? '#22c55e' : data.demand_high_pct > 30 ? '#f59e0b' : '#6b7280'
                    : undefined
                }
              />
            </div>

            {/* Sentiment dot */}
            {data.sentiment_score != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                  background: data.sentiment_score > 0.6 ? '#22c55e' : data.sentiment_score > 0.3 ? '#f59e0b' : '#ef4444',
                }} />
                <span style={{ color: 'var(--text-muted)' }}>
                  Market sentiment: {data.sentiment_score > 0.6 ? 'Positive' : data.sentiment_score > 0.3 ? 'Neutral' : 'Negative'}
                </span>
              </div>
            )}

            {/* Top models table */}
            {data.top_models && data.top_models.length > 0 && (
              <div>
                <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: '4px' }}>Top Models</div>
                {data.top_models.slice(0, 5).map((m) => (
                  <div key={m.model} style={{
                    display: 'flex', justifyContent: 'space-between', padding: '2px 0',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <span>{m.model}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{m.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      />
    </MicroPortal>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '4px 6px', background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '4px' }}>
      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '9pt', color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}
