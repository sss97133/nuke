import React from 'react';
import MicroPortal from './MicroPortal';
import PortalShell from './PortalShell';
import { useModelMarketStats } from '../../../hooks/useMarketStats';
import { formatCurrencyAmount } from '../../../utils/currency';

interface ModelPortalProps {
  make: string;
  model: string;
  /** This vehicle's price for positioning on the price band */
  vehiclePrice?: number;
  activePortal: string | null;
  onOpen: (id: string | null) => void;
}

export default function ModelPortal({ make, model, vehiclePrice, activePortal, onOpen }: ModelPortalProps) {
  const isOpen = activePortal === 'model';
  const { data, state, isLoading, error } = useModelMarketStats(make, model, isOpen);

  return (
    <MicroPortal
      portalId="model"
      activePortal={activePortal}
      onOpen={onOpen}
      trigger={<span>{model}</span>}
      width={290}
    >
      <PortalShell
        title={`${make} ${model} Intelligence`}
        isLoading={isLoading}
        error={error}
        state={state}
        emptyContent={
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '8px 0' }}>
            No market data for {make} {model}
          </div>
        }
        richContent={data && (
          <div style={{ fontSize: '11px' }}>
            {/* Price band */}
            <PriceBand
              p25={data.p25_price}
              median={data.median_price}
              p75={data.p75_price}
              vehiclePrice={vehiclePrice}
            />

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginBottom: '8px' }}>
              <MiniStat label="Median" value={data.median_price > 0 ? formatCurrencyAmount(data.median_price) : '—'} />
              <MiniStat label="Volume" value={String(data.total_listings)} />
              <MiniStat label="Days Avg" value={data.avg_days_on_market > 0 ? String(Math.round(data.avg_days_on_market)) : '—'} />
            </div>

            {/* Trend + heat */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <TrendBadge direction={data.trend_direction} />
              {data.heat_score_avg != null && <HeatGauge score={data.heat_score_avg} />}
            </div>

            {/* Rarity */}
            {data.rarity_level && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{
                  padding: '1px 5px',
                  background: data.rarity_level === 'rare' ? '#fbbf2420' : 'var(--bg-secondary)',
                  color: data.rarity_level === 'rare' ? 'var(--warning)' : 'var(--text-muted)', fontSize: '9px',
                  fontWeight: 600,
                }}>
                  {data.rarity_level.toUpperCase()}
                </span>
                {data.total_produced != null && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
                    {data.total_produced.toLocaleString()} produced
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      />
    </MicroPortal>
  );
}

/** P25 / median / P75 bar with vehicle marker */
function PriceBand({ p25, median, p75, vehiclePrice }: {
  p25: number; median: number; p75: number; vehiclePrice?: number;
}) {
  if (!p25 || !p75 || p75 <= p25) return null;
  const range = p75 - p25;
  const medianPct = ((median - p25) / range) * 100;
  const vehiclePct = vehiclePrice ? Math.max(0, Math.min(100, ((vehiclePrice - p25) / range) * 100)) : null;

  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', marginBottom: '2px' }}>
        <span>P25: {formatCurrencyAmount(p25)}</span>
        <span>P75: {formatCurrencyAmount(p75)}</span>
      </div>
      <div style={{
        position: 'relative',
        height: '8px',
        background: 'var(--surface)', overflow: 'visible',
      }}>
        {/* Median marker */}
        <div style={{
          position: 'absolute',
          left: `${medianPct}%`,
          top: '-2px',
          width: '2px',
          height: '12px',
          background: 'var(--text)', }} title={`Median: ${formatCurrencyAmount(median)}`} />

        {/* This vehicle marker */}
        {vehiclePct != null && (
          <div style={{
            position: 'absolute',
            left: `${vehiclePct}%`,
            top: '-4px',
            width: '6px',
            height: '6px',
            background: 'var(--primary, #3b82f6)',
            border: '1.5px solid white', transform: 'translateX(-3px)', }} title={vehiclePrice ? `This vehicle: ${formatCurrencyAmount(vehiclePrice)}` : undefined} />
        )}
      </div>
    </div>
  );
}

function TrendBadge({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  const config = {
    up: { arrow: '\u2191', color: 'var(--success)', label: 'Rising' },
    down: { arrow: '\u2193', color: 'var(--error)', label: 'Declining' },
    stable: { arrow: '\u2192', color: 'var(--text-secondary)', label: 'Stable' },
  }[direction];

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      padding: '1px 5px', background: config.color + '15', color: config.color,
      fontSize: '9px', fontWeight: 600,
    }}>
      {config.arrow} {config.label}
    </span>
  );
}

function HeatGauge({ score }: { score: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{
        width: '30px', height: '4px', background: 'var(--border)', overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, Math.max(5, score))}%`,
          height: '100%',
          background: score > 70 ? 'var(--error)' : score > 40 ? 'var(--warning)' : 'var(--text-secondary)',
        }} />
      </div>
      <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
        {score > 70 ? 'Hot' : score > 40 ? 'Warm' : 'Cool'}
      </span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: '11px' }}>{value}</div>
    </div>
  );
}
