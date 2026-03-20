/**
 * IngestionTimeline — Stacked area chart showing 30-day ingestion per platform
 */
import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { TimeSeriesRow } from './useDataPulse';

const CHART_COLORS = [
  '#4a9eff', '#16825d', '#b05a00', '#d13438',
  '#7d6b91', '#6b9d7d', '#c47a2b', '#5b8fa8',
];

const S = {
  section: {
    border: '2px solid #333',
    background: '#222',
    padding: '12px',
  } as CSSProperties,
  title: {
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '2px',
    color: 'var(--text-disabled)',
    marginBottom: '8px',
  } as CSSProperties,
};

interface IngestionTimelineProps {
  timeSeries: TimeSeriesRow[];
}

export const IngestionTimeline: React.FC<IngestionTimelineProps> = ({ timeSeries }) => {
  const { chartData, topPlatforms } = useMemo(() => {
    if (!timeSeries.length) return { chartData: [], topPlatforms: [] };

    // Find top 8 platforms by total 30-day volume
    const volumeByPlatform: Record<string, number> = {};
    for (const t of timeSeries) {
      volumeByPlatform[t.canonical_platform] = (volumeByPlatform[t.canonical_platform] || 0) + t.cnt;
    }
    const top = Object.entries(volumeByPlatform)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([p]) => p);

    // Build chart data: one row per day, columns are platforms
    const dayMap: Record<string, Record<string, number>> = {};
    for (const t of timeSeries) {
      if (!top.includes(t.canonical_platform)) continue;
      if (!dayMap[t.day]) dayMap[t.day] = {};
      dayMap[t.day][t.canonical_platform] = t.cnt;
    }

    const sorted = Object.keys(dayMap).sort();
    const data = sorted.map((day) => ({
      day: day.slice(5), // MM-DD
      ...dayMap[day],
    }));

    return { chartData: data, topPlatforms: top };
  }, [timeSeries]);

  if (!chartData.length) {
    return (
      <div style={{ ...S.section, textAlign: 'center', padding: '32px', color: 'var(--text-secondary)', fontSize: '11px' }}>
        NO TIME SERIES DATA
      </div>
    );
  }

  return (
    <div style={S.section}>
      <div style={S.title}>INGESTION TIMELINE — 30 DAYS</div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData}>
          <XAxis
            dataKey="day"
            tick={{ fontSize: 8, fill: 'var(--text-disabled)', fontFamily: 'Courier New' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--text)' }}
          />
          <YAxis
            tick={{ fontSize: 8, fill: 'var(--text-disabled)', fontFamily: 'Courier New' }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--text)',
              border: '1px solid #333',
              fontSize: '10px',
              fontFamily: 'Courier New',
              color: 'var(--surface-hover)',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '8px', fontFamily: 'Arial', textTransform: 'uppercase' }}
          />
          {topPlatforms.map((platform, i) => (
            <Area
              key={platform}
              type="monotone"
              dataKey={platform}
              stackId="1"
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              fillOpacity={0.6}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
