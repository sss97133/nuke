/**
 * ValueTrendsPanel - Dashboard panel showing value trends over time
 *
 * Displays:
 * 1. Multi-line value trends (mark, ask, realized, cost)
 * 2. Total market value over time
 * 3. Sold vs unsold auction outcomes
 * 4. Import velocity
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '../../lib/supabase';
import MiniLineChart from './MiniLineChart';

// Inlined to avoid Vite import issues
interface DataPoint {
  date: string;
  value: number;
}

interface DataSeries {
  id: string;
  label: string;
  data: DataPoint[];
  color: string;
  showArea?: boolean;
}

type TrendPeriod = '30d' | '90d' | '1y';

interface ValueTrendsData {
  period: string;
  days_back: number;
  generated_at: string;
  current_totals: {
    total_value: number;
    value_mark_total: number;
    value_ask_total: number;
    value_realized_total: number;
    value_cost_total: number;
    total_vehicles: number;
    for_sale_count: number;
    active_auctions: number;
    value_imported_today: number;
    value_imported_24h: number;
    value_imported_7d: number;
  };
  trends: {
    daily_values: Array<{
      date: string;
      cumulative_mark_value: number;
      cumulative_ask_value: number;
      cumulative_realized_value: number;
      cumulative_cost_value: number;
      cumulative_total_value: number;
      daily_mark_value: number;
      daily_ask_value: number;
      daily_realized_value: number;
      daily_cost_value: number;
      daily_total_value: number;
      vehicle_count: number;
    }>;
    daily_sales: Array<{
      date: string;
      sales_count: number;
      sales_volume: number;
      avg_sale_price: number;
      cumulative_sales_count: number;
      cumulative_sales_volume: number;
    }>;
    daily_imports: Array<{
      date: string;
      import_count: number;
      import_value: number;
      avg_import_value: number;
      cumulative_import_count: number;
      cumulative_import_value: number;
    }>;
    auction_outcomes: Array<{
      date: string;
      sold_count: number;
      sold_value: number;
      unsold_count: number;
      unsold_high_bid_value: number;
      sold_ratio: number | null;
    }>;
  };
}

interface ValueTrendsPanelProps {
  style?: React.CSSProperties;
  chartWidth?: number;
  chartHeight?: number;
}

const formatCurrency = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const formatPercent = (v: number | null) => {
  if (v === null) return '--%';
  return `${(v * 100).toFixed(0)}%`;
};

export const ValueTrendsPanel: React.FC<ValueTrendsPanelProps> = ({
  style,
  chartWidth = 280,
  chartHeight = 80,
}) => {
  const [period, setPeriod] = useState<TrendPeriod>('30d');
  const [data, setData] = useState<ValueTrendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrends = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch from edge function
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/value-trends?period=${period}`, {
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch trends: ${res.status}`);
      }

      const trendsData = await res.json();
      setData(trendsData);
    } catch (e: any) {
      console.error('Error loading value trends:', e);
      setError(e.message || 'Failed to load trends');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    loadTrends();
  }, [loadTrends]);

  // Build chart series from data
  const valueBreakdownSeries: DataSeries[] = React.useMemo(() => {
    if (!data?.trends?.daily_values?.length) return [];

    return [
      {
        id: 'realized',
        label: 'Realized',
        color: '#22c55e', // green
        showArea: true,
        data: data.trends.daily_values.map(d => ({
          date: d.date,
          value: d.cumulative_realized_value || 0,
        })),
      },
      {
        id: 'ask',
        label: 'Ask',
        color: '#3b82f6', // blue
        data: data.trends.daily_values.map(d => ({
          date: d.date,
          value: d.cumulative_ask_value || 0,
        })),
      },
      {
        id: 'mark',
        label: 'Mark',
        color: '#f59e0b', // amber
        data: data.trends.daily_values.map(d => ({
          date: d.date,
          value: d.cumulative_mark_value || 0,
        })),
      },
      {
        id: 'cost',
        label: 'Cost',
        color: '#6b7280', // gray
        data: data.trends.daily_values.map(d => ({
          date: d.date,
          value: d.cumulative_cost_value || 0,
        })),
      },
    ];
  }, [data]);

  const totalValueSeries: DataSeries[] = React.useMemo(() => {
    if (!data?.trends?.daily_values?.length) return [];

    return [
      {
        id: 'total',
        label: 'Total Value',
        color: '#8b5cf6', // purple
        showArea: true,
        data: data.trends.daily_values.map(d => ({
          date: d.date,
          value: d.cumulative_total_value || 0,
        })),
      },
    ];
  }, [data]);

  const auctionOutcomeSeries: DataSeries[] = React.useMemo(() => {
    if (!data?.trends?.auction_outcomes?.length) return [];

    // Calculate 7-day rolling sold ratio
    const outcomes = data.trends.auction_outcomes;
    const rollingData: DataPoint[] = [];

    for (let i = 0; i < outcomes.length; i++) {
      const windowStart = Math.max(0, i - 6);
      let soldSum = 0;
      let unsoldSum = 0;

      for (let j = windowStart; j <= i; j++) {
        soldSum += outcomes[j].sold_count || 0;
        unsoldSum += outcomes[j].unsold_count || 0;
      }

      const total = soldSum + unsoldSum;
      const ratio = total > 0 ? soldSum / total : 0;

      rollingData.push({
        date: outcomes[i].date,
        value: ratio * 100, // As percentage
      });
    }

    return [
      {
        id: 'sold_ratio',
        label: 'Sold %',
        color: '#22c55e',
        showArea: true,
        data: rollingData,
      },
    ];
  }, [data]);

  const importVelocitySeries: DataSeries[] = React.useMemo(() => {
    if (!data?.trends?.daily_imports?.length) return [];

    return [
      {
        id: 'daily_value',
        label: 'Daily Import Value',
        color: '#06b6d4', // cyan
        showArea: true,
        data: data.trends.daily_imports.map(d => ({
          date: d.date,
          value: d.import_value || 0,
        })),
      },
    ];
  }, [data]);

  // Calculate trend summaries
  const trends = React.useMemo(() => {
    if (!data?.trends) return null;

    const dv = data.trends.daily_values;
    const firstVal = dv.find(d => d.cumulative_total_value > 0);
    const lastVal = [...dv].reverse().find(d => d.cumulative_total_value > 0);

    const totalTrend = firstVal && lastVal && firstVal.cumulative_total_value > 0
      ? ((lastVal.cumulative_total_value - firstVal.cumulative_total_value) / firstVal.cumulative_total_value) * 100
      : 0;

    // Calculate average sold ratio
    const validOutcomes = data.trends.auction_outcomes.filter(o => o.sold_ratio !== null);
    const avgSoldRatio = validOutcomes.length > 0
      ? validOutcomes.reduce((acc, o) => acc + (o.sold_ratio || 0), 0) / validOutcomes.length
      : 0;

    // Import velocity trend
    const imports = data.trends.daily_imports;
    const recentImports = imports.slice(-7);
    const olderImports = imports.slice(-14, -7);
    const recentAvg = recentImports.reduce((acc, d) => acc + d.import_value, 0) / Math.max(recentImports.length, 1);
    const olderAvg = olderImports.reduce((acc, d) => acc + d.import_value, 0) / Math.max(olderImports.length, 1);
    const velocityTrend = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

    return {
      totalTrend,
      avgSoldRatio,
      velocityTrend,
      recentAvgImport: recentAvg,
    };
  }, [data]);

  if (loading) {
    return (
      <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: '8pt', ...style }}>
        Loading value trends...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '10px', color: '#b91c1c', fontSize: '8pt', ...style }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ ...style }}>
      {/* Period selector */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>PERIOD:</span>
        {(['30d', '90d', '1y'] as TrendPeriod[]).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            style={{
              padding: '2px 8px',
              fontSize: '7pt',
              fontFamily: 'monospace',
              fontWeight: 700,
              border: '1px solid var(--border)',
              background: period === p ? 'var(--grey-600)' : 'transparent',
              color: period === p ? 'var(--white)' : 'var(--text)',
              cursor: 'pointer',
              borderRadius: 6,
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Charts grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
        {/* Value Breakdown */}
        <div style={{ border: '1px solid var(--border)', background: 'var(--grey-50)', padding: '10px', borderRadius: 6 }}>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: '6px' }}>
            VALUE BREAKDOWN (cumulative)
          </div>
          <MiniLineChart
            series={valueBreakdownSeries}
            width={chartWidth}
            height={chartHeight}
            showLegend
            showTrendArrow
          />
        </div>

        {/* Total Market Value */}
        <div style={{ border: '1px solid var(--border)', background: 'var(--grey-50)', padding: '10px', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              TOTAL MARKET VALUE
            </div>
            {trends && (
              <div style={{
                fontSize: '8pt',
                fontWeight: 700,
                color: trends.totalTrend > 0 ? '#22c55e' : trends.totalTrend < 0 ? '#ef4444' : 'var(--text-muted)',
              }}>
                {trends.totalTrend > 0 ? '\u2191' : trends.totalTrend < 0 ? '\u2193' : ''}{Math.abs(trends.totalTrend).toFixed(1)}%
              </div>
            )}
          </div>
          <MiniLineChart
            series={totalValueSeries}
            width={chartWidth}
            height={chartHeight}
            showLegend={false}
            showTrendArrow={false}
          />
          <div style={{ fontSize: '8pt', color: 'var(--text)', marginTop: '4px', fontWeight: 700 }}>
            {data?.current_totals?.total_value ? formatCurrency(data.current_totals.total_value) : '--'}
          </div>
        </div>

        {/* Sold vs Unsold Ratio */}
        <div style={{ border: '1px solid var(--border)', background: 'var(--grey-50)', padding: '10px', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              AUCTION SOLD RATE (7d rolling)
            </div>
            {trends && (
              <div style={{
                fontSize: '8pt',
                fontWeight: 700,
                color: trends.avgSoldRatio >= 0.7 ? '#22c55e' : trends.avgSoldRatio >= 0.5 ? '#f59e0b' : '#ef4444',
              }}>
                avg {formatPercent(trends.avgSoldRatio)}
              </div>
            )}
          </div>
          <MiniLineChart
            series={auctionOutcomeSeries}
            width={chartWidth}
            height={chartHeight}
            showLegend={false}
            showTrendArrow={false}
            formatValue={(v) => `${v.toFixed(0)}%`}
          />
        </div>

        {/* Import Velocity */}
        <div style={{ border: '1px solid var(--border)', background: 'var(--grey-50)', padding: '10px', borderRadius: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              IMPORT VELOCITY (daily)
            </div>
            {trends && (
              <div style={{
                fontSize: '8pt',
                fontWeight: 700,
                color: trends.velocityTrend > 10 ? '#22c55e' : trends.velocityTrend < -10 ? '#ef4444' : 'var(--text-muted)',
              }}>
                {trends.velocityTrend > 0 ? '\u2191' : trends.velocityTrend < 0 ? '\u2193' : ''}{Math.abs(trends.velocityTrend).toFixed(0)}% vs prev 7d
              </div>
            )}
          </div>
          <MiniLineChart
            series={importVelocitySeries}
            width={chartWidth}
            height={chartHeight}
            showLegend={false}
            showTrendArrow={false}
          />
          <div style={{ fontSize: '8pt', color: 'var(--text)', marginTop: '4px' }}>
            7d avg: {trends?.recentAvgImport ? formatCurrency(trends.recentAvgImport) : '--'}/day
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ marginTop: '12px', fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
        Data as of {data?.generated_at ? new Date(data.generated_at).toLocaleString() : '--'} ({period} window)
      </div>
    </div>
  );
};

export default ValueTrendsPanel;
