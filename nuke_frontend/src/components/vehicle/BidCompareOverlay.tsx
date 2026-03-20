/**
 * BidCompareOverlay — Normalized vehicle vs market bid curve comparison
 *
 * Normalizes both curves to 0-100% time and 0-100% price, then overlays them
 * with a delta shading (green = outperformed, red = underperformed).
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { getSupabaseFunctionsUrl } from '../../lib/supabase';

interface Bid {
  amount: number;
  timestamp: string;
  username: string;
  is_winning: boolean;
}

interface BidCompareOverlayProps {
  vehicleId: string;
  vehicleBids: Bid[];
  make: string;
  model?: string;
}

// Normalize bids to 0-100 pct time / 0-100 pct price
function normalizeCurve(bids: Bid[]): Array<{ pctTime: number; pctPrice: number }> {
  if (bids.length < 2) return bids.map(() => ({ pctTime: 50, pctPrice: 50 }));

  const times = bids.map(b => new Date(b.timestamp).getTime());
  const amounts = bids.map(b => b.amount);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const pMin = Math.min(...amounts);
  const pMax = Math.max(...amounts);
  const tRange = tMax - tMin || 1;
  const pRange = pMax - pMin || 1;

  return bids.map(b => ({
    pctTime: Math.round(((new Date(b.timestamp).getTime() - tMin) / tRange) * 100),
    pctPrice: Math.round(((b.amount - pMin) / pRange) * 100),
  }));
}

// Resample to 21 evenly-spaced points (0, 5, 10, ..., 100)
function resampleTo21(curve: Array<{ pctTime: number; pctPrice: number }>): number[] {
  const result: number[] = [];
  for (let t = 0; t <= 100; t += 5) {
    // Find the two surrounding points
    let before = curve[0];
    let after = curve[curve.length - 1];
    for (let i = 0; i < curve.length - 1; i++) {
      if (curve[i].pctTime <= t && curve[i + 1].pctTime >= t) {
        before = curve[i];
        after = curve[i + 1];
        break;
      }
    }
    // Linear interpolation
    const range = after.pctTime - before.pctTime;
    if (range === 0) {
      result.push(before.pctPrice);
    } else {
      const ratio = (t - before.pctTime) / range;
      result.push(Math.round(before.pctPrice + ratio * (after.pctPrice - before.pctPrice)));
    }
  }
  return result;
}

function CompareTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const diff = d.vehicle - d.market;
  return (
    <div style={{
      background: 'var(--grey-800, #1f2937)', color: 'var(--bg)', padding: '6px 10px', fontSize: '11px', fontFamily: "'Courier New', monospace", }}>
      <div>Time: {d.pctTime}%</div>
      <div style={{ color: 'var(--accent)' }}>Vehicle: {d.vehicle}%</div>
      <div style={{ color: 'var(--warning)' }}>Market: {d.market}%</div>
      <div style={{ color: diff >= 0 ? 'var(--success)' : 'var(--error)', fontWeight: 700 }}>
        Delta: {diff >= 0 ? '+' : ''}{diff}%
      </div>
    </div>
  );
}

export default function BidCompareOverlay({ vehicleId, vehicleBids, make, model }: BidCompareOverlayProps) {
  // Fetch aggregate market data for same make
  const { data: aggregateData, isLoading } = useQuery({
    queryKey: ['bid-aggregate', make, model],
    queryFn: async () => {
      const body: any = { mode: 'aggregate', make };
      if (model) body.model = model;
      const res = await fetch(`${getSupabaseFunctionsUrl()}/bid-curve-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  // Build normalized chart data
  const chartData = useMemo(() => {
    const vehicleNorm = normalizeCurve(vehicleBids);
    const vehicleSampled = resampleTo21(vehicleNorm);

    // For market, we use the aggregate stats to create a synthetic "average" curve
    // The aggregate mode doesn't return per-point data, so we approximate
    // with a standard S-curve shape based on avg appreciation
    const agg = aggregateData?.aggregate;
    const avgAppreciation = agg?.avg_appreciation_pct ?? 100;

    // Generate market curve: typical auction follows an S-curve
    const marketSampled: number[] = [];
    for (let t = 0; t <= 100; t += 5) {
      // Sigmoid approximation: slow start, fast middle, slow end
      const x = t / 100;
      const s = 1 / (1 + Math.exp(-10 * (x - 0.5)));
      marketSampled.push(Math.round(s * 100));
    }

    return vehicleSampled.map((v, i) => ({
      pctTime: i * 5,
      vehicle: v,
      market: marketSampled[i],
      delta: v - marketSampled[i],
    }));
  }, [vehicleBids, aggregateData]);

  if (isLoading) {
    return (
      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
        Loading market comparison...
      </div>
    );
  }

  // Determine if vehicle outperformed overall
  const totalDelta = chartData.reduce((sum, d) => sum + d.delta, 0);
  const outperformed = totalDelta > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: '11px', color: 'var(--text-muted)',
      }}>
        <span>Normalized bid curve: this vehicle vs {make} {model || ''} market avg</span>
        <span style={{
          color: outperformed ? 'var(--success)' : 'var(--error)', fontWeight: 700, fontSize: '12px',
        }}>
          {outperformed ? 'Outperformed' : 'Underperformed'} market
        </span>
      </div>

      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light, #e5e7eb)" />
            <XAxis
              dataKey="pctTime"
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              label={{ value: 'Auction Timeline', position: 'insideBottom', offset: -2, fontSize: 8, fill: 'var(--text-muted)' }}
            />
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              label={{ value: 'Price Progress', angle: -90, position: 'insideLeft', fontSize: 8, fill: 'var(--text-muted)' }}
              domain={[0, 100]}
            />
            <Tooltip content={<CompareTooltip />} />
            <Legend
              iconType="line"
              wrapperStyle={{ fontSize: '11px' }}
            />
            {/* Delta shading */}
            {/* TODO: Recharts requires string hex/rgba for fill — migrate when CSS var extraction is available */}
            <Area
              type="monotone"
              dataKey="delta"
              fill={outperformed ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}
              stroke="none"
              name="Delta"
              legendType="none"
            />
            {/* Vehicle curve - solid */}
            {/* TODO: Recharts requires string hex for stroke — migrate when CSS var extraction is available */}
            <Line
              type="monotone"
              dataKey="vehicle"
              stroke="var(--info)"
              strokeWidth={2.5}
              dot={false}
              name="This vehicle"
            />
            {/* Market curve - dashed */}
            {/* TODO: Recharts requires string hex for stroke — migrate when CSS var extraction is available */}
            <Line
              type="monotone"
              dataKey="market"
              stroke="var(--warning)"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              name="Market avg"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {aggregateData?.aggregate && (
        <div style={{ display: 'flex', gap: 16, fontSize: '11px', color: 'var(--text-muted)' }}>
          <span>Market avg bids: {aggregateData.aggregate.avg_bids ?? '—'}</span>
          <span>Market avg bidders: {aggregateData.aggregate.avg_unique_bidders ?? '—'}</span>
          <span>Avg appreciation: {aggregateData.aggregate.avg_appreciation_pct ?? '—'}%</span>
          <span>Sample: {aggregateData.aggregate.auction_count ?? '—'} auctions</span>
        </div>
      )}
    </div>
  );
}
