import React from 'react';
import MicroPortal from './MicroPortal';
import PortalShell from './PortalShell';
import { usePlatformPerformance } from '../../../hooks/usePlatformPerformance';
import { formatCurrencyAmount } from '../../../utils/currency';

interface SourcePortalProps {
  vehicleId: string;
  platform: string;
  platformDisplayName: string;
  platformColor: string;
  vehiclePrice?: number;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function SourcePortal({
  vehicleId, platform, platformDisplayName, platformColor, vehiclePrice,
  activePortal, onOpen,
}: SourcePortalProps) {
  const isOpen = activePortal === 'source';
  const { data, state, isLoading, error } = usePlatformPerformance(vehicleId, platform, isOpen);

  const trigger = (
    <span style={{
      background: platformColor + '20',
      color: platformColor,
      padding: '2px 6px', fontSize: '9px',
      fontWeight: 500,
    }}>
      {platformDisplayName}
    </span>
  );

  return (
    <MicroPortal
      portalId="source"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={trigger}
      width={260}
    >
      <PortalShell
        title={`${platformDisplayName} Performance`}
        isLoading={isLoading}
        error={error}
        state={state}
        emptyContent={
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No platform data for this listing
          </div>
        }
        sparseContent={
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '4px 0' }}>
            Listed on {platformDisplayName}
          </div>
        }
        richContent={data && (
          <div style={{ fontSize: '11px' }}>
            {/* Engagement metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginBottom: '8px' }}>
              {data.bid_count != null && (
                <MetricBox label="Bids" value={String(data.bid_count)} />
              )}
              {data.view_count != null && (
                <MetricBox label="Views" value={formatCount(data.view_count)} />
              )}
              {data.watcher_count != null && (
                <MetricBox label="Watchers" value={String(data.watcher_count)} />
              )}
            </div>

            {/* Platform stats */}
            {data.platform_sell_through_pct != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Sell-Through Rate</span>
                <span style={{ fontWeight: 600 }}>{data.platform_sell_through_pct}%</span>
              </div>
            )}
            {data.platform_avg_price != null && data.platform_avg_price > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ color: 'var(--text-muted)' }}>Platform Avg</span>
                <span style={{ fontWeight: 600 }}>{formatCurrencyAmount(data.platform_avg_price)}</span>
              </div>
            )}

            {/* Cross-platform insight */}
            {vehiclePrice && data.platform_avg_price && data.platform_avg_price > 0 && (
              <div style={{
                marginTop: '6px', padding: '4px 6px',
                background: 'var(--bg-secondary)', fontSize: '9px', color: 'var(--text-muted)',
              }}>
                {vehiclePrice > data.platform_avg_price
                  ? `${Math.round(((vehiclePrice - data.platform_avg_price) / data.platform_avg_price) * 100)}% above ${platformDisplayName} average`
                  : `${Math.round(((data.platform_avg_price - vehiclePrice) / data.platform_avg_price) * 100)}% below ${platformDisplayName} average`
                }
              </div>
            )}
          </div>
        )}
      />
    </MicroPortal>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '4px', background: 'var(--bg-secondary)'}}>
      <div style={{ fontSize: '15px', fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
