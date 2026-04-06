/**
 * PriceHistoryChart — Scatter + line chart showing price over time.
 *
 * Shows:
 * - This vehicle's sale events (if multiple) as highlighted dots
 * - Comparable sales for the same make/model/year range as background context
 *
 * Uses recharts (already a dependency). Queries vehicle_events for data.
 * Returns null if no price data exists (per design system: no empty shells).
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { supabase } from '../../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────

interface PriceEvent {
  id: string;
  sale_price: number;
  event_date: string;
  source_platform: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  is_this_vehicle: boolean;
}

interface PriceHistoryChartProps {
  vehicleId: string;
  make: string;
  model: string;
  year: number;
  salePrice?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const formatUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};

const formatDate = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

// ─── Custom Tooltip ──────────────────────────────────────────────────

function PriceTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--grey-800, #1f2937)',
      color: 'var(--bg)',
      padding: '4px 8px',
      fontSize: '11px',
      fontFamily: "'Courier New', monospace",
      border: 'none',
    }}>
      <div style={{ fontWeight: 700 }}>{formatUsd(d.sale_price)}</div>
      <div style={{ opacity: 0.7 }}>
        {d.year} {d.make} {d.model}
      </div>
      <div style={{ opacity: 0.7 }}>
        {new Date(d.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        {d.source_platform ? ` · ${d.source_platform}` : ''}
      </div>
      {d.is_this_vehicle && (
        <div style={{ color: 'var(--success, #10ac84)', fontWeight: 600, marginTop: 2 }}>
          THIS VEHICLE
        </div>
      )}
    </div>
  );
}

// ─── Data Hook ───────────────────────────────────────────────────────

function usePriceHistory(vehicleId: string, make: string, model: string, year: number) {
  return useQuery<PriceEvent[]>({
    queryKey: ['price-history-chart', vehicleId, make, model, year],
    queryFn: async () => {
      const events: PriceEvent[] = [];

      // 1. This vehicle's sale events from vehicle_events
      const { data: vehicleEvents } = await supabase
        .from('vehicle_events')
        .select('id, final_price, current_price, sold_at, ended_at, created_at, source_platform')
        .eq('vehicle_id', vehicleId)
        .or('final_price.not.is.null,current_price.not.is.null')
        .order('created_at', { ascending: true })
        .limit(50);

      if (vehicleEvents) {
        for (const ev of vehicleEvents) {
          const price = ev.final_price ?? ev.current_price;
          if (!price || price <= 0) continue;
          events.push({
            id: ev.id,
            sale_price: price,
            event_date: ev.sold_at || ev.ended_at || ev.created_at,
            source_platform: ev.source_platform,
            year,
            make,
            model,
            is_this_vehicle: true,
          });
        }
      }

      // 2. Cohort comparable sales (same make + model, +/- 3 years)
      const yearMin = year - 3;
      const yearMax = year + 3;
      const { data: cohortEvents } = await supabase
        .from('vehicle_events')
        .select('id, vehicle_id, final_price, sold_at, ended_at, created_at, source_platform, vehicles!inner(year, make, model)')
        .neq('vehicle_id', vehicleId)
        .not('final_price', 'is', null)
        .gte('vehicles.year', yearMin)
        .lte('vehicles.year', yearMax)
        .ilike('vehicles.make', make)
        .ilike('vehicles.model', model)
        .order('created_at', { ascending: true })
        .limit(200);

      if (cohortEvents) {
        for (const ev of cohortEvents as any[]) {
          const price = ev.final_price;
          if (!price || price <= 0) continue;
          const v = ev.vehicles;
          events.push({
            id: ev.id,
            sale_price: price,
            event_date: ev.sold_at || ev.ended_at || ev.created_at,
            source_platform: ev.source_platform,
            year: v?.year ?? null,
            make: v?.make ?? null,
            model: v?.model ?? null,
            is_this_vehicle: false,
          });
        }
      }

      return events;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!vehicleId && !!make && !!model && !!year,
  });
}

// ─── Main Component ──────────────────────────────────────────────────

export default function PriceHistoryChart({ vehicleId, make, model, year, salePrice }: PriceHistoryChartProps) {
  const { data: events, isLoading } = usePriceHistory(vehicleId, make, model, year);

  // Prepare chart data with numeric timestamps for scatter
  const { thisVehicleData, cohortData, avgPrice } = useMemo(() => {
    if (!events || events.length === 0) return { thisVehicleData: [], cohortData: [], avgPrice: 0 };

    const thisVehicle: any[] = [];
    const cohort: any[] = [];
    let priceSum = 0;
    let priceCount = 0;

    for (const ev of events) {
      const ts = new Date(ev.event_date).getTime();
      if (isNaN(ts)) continue;
      const point = { ...ev, ts };
      if (ev.is_this_vehicle) {
        thisVehicle.push(point);
      } else {
        cohort.push(point);
      }
      priceSum += ev.sale_price;
      priceCount++;
    }

    return {
      thisVehicleData: thisVehicle,
      cohortData: cohort,
      avgPrice: priceCount > 0 ? Math.round(priceSum / priceCount) : 0,
    };
  }, [events]);

  // No data guard — design system: no empty shells
  if (isLoading) return null;
  if (!events || events.length < 2) return null;

  const totalCount = thisVehicleData.length + cohortData.length;
  const cohortLabel = `${year - 3}–${year + 3} ${make} ${model}`;

  return (
    <div style={{
      border: '2px solid var(--border)',
      background: 'var(--surface)',
      padding: '12px',
      marginBottom: '4px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>
            Price History
          </div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {totalCount} sales · {cohortLabel}
          </div>
        </div>
        {avgPrice > 0 && (
          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
            AVG {formatUsd(avgPrice)}
          </div>
        )}
      </div>

      {/* Chart */}
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light, #e5e7eb)" />
            <XAxis
              dataKey="ts"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatDate}
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              dataKey="sale_price"
              type="number"
              tickFormatter={formatUsd}
              tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <Tooltip content={<PriceTooltip />} />
            {avgPrice > 0 && (
              <ReferenceLine
                y={avgPrice}
                stroke="var(--text-muted)"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            )}
            {salePrice && salePrice > 0 && (
              <ReferenceLine
                y={salePrice}
                stroke="var(--success, #10ac84)"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            )}
            {/* Cohort sales — muted dots */}
            {cohortData.length > 0 && (
              <Scatter
                data={cohortData}
                fill="var(--grey-300, #d1d5db)"
                fillOpacity={0.6}
                shape="circle"
                r={3}
              />
            )}
            {/* This vehicle's sales — highlighted */}
            {thisVehicleData.length > 0 && (
              <Scatter
                data={thisVehicleData}
                fill="var(--text)"
                stroke="var(--text)"
                strokeWidth={2}
                shape="circle"
                r={5}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontSize: '9px', color: 'var(--text-muted)' }}>
        {thisVehicleData.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: 'var(--text)' }} />
            <span>This vehicle ({thisVehicleData.length})</span>
          </div>
        )}
        {cohortData.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '8px', height: '8px', background: 'var(--grey-300, #d1d5db)' }} />
            <span>Comparable sales ({cohortData.length})</span>
          </div>
        )}
      </div>
    </div>
  );
}
