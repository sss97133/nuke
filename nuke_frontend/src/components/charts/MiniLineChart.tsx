/**
 * MiniLineChart - Lightweight SVG line chart for dashboard panels
 *
 * Features:
 * - Multiple data series with different colors
 * - Trend arrows showing direction
 * - Optional area fill
 * - Hover tooltips
 * - Responsive width
 */

import React, { useMemo, useState } from 'react';

export interface DataPoint {
  date: string;
  value: number;
}

export interface DataSeries {
  id: string;
  label: string;
  data: DataPoint[];
  color: string;
  showArea?: boolean;
}

interface MiniLineChartProps {
  series: DataSeries[];
  width?: number;
  height?: number;
  showLegend?: boolean;
  showTrendArrow?: boolean;
  formatValue?: (value: number) => string;
  style?: React.CSSProperties;
}

const defaultFormatValue = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

export const MiniLineChart: React.FC<MiniLineChartProps> = ({
  series,
  width = 200,
  height = 60,
  showLegend = false,
  showTrendArrow = true,
  formatValue = defaultFormatValue,
  style,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<{
    seriesId: string;
    index: number;
    x: number;
    y: number;
    value: number;
    date: string;
  } | null>(null);

  // Calculate bounds and scales
  const { minValue, maxValue, allDates, scaleX, scaleY, paths, areas, trends } = useMemo(() => {
    if (!series.length) {
      return { minValue: 0, maxValue: 0, allDates: [], scaleX: () => 0, scaleY: () => 0, paths: {}, areas: {}, trends: {} };
    }

    // Collect all values and dates
    let minVal = Infinity;
    let maxVal = -Infinity;
    const dateSet = new Set<string>();

    series.forEach(s => {
      s.data.forEach(d => {
        if (d.value > 0) {
          minVal = Math.min(minVal, d.value);
          maxVal = Math.max(maxVal, d.value);
        }
        dateSet.add(d.date);
      });
    });

    // Handle edge case where all values are 0
    if (minVal === Infinity) minVal = 0;
    if (maxVal === -Infinity) maxVal = 1;

    // Add padding to range
    const range = maxVal - minVal;
    const padding = range * 0.1;
    minVal = Math.max(0, minVal - padding);
    maxVal = maxVal + padding;

    const dates = Array.from(dateSet).sort();
    const margin = { top: 5, right: 5, bottom: 5, left: 5 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const scaleXFn = (index: number) => margin.left + (index / Math.max(dates.length - 1, 1)) * chartWidth;
    const scaleYFn = (value: number) => margin.top + chartHeight - ((value - minVal) / (maxVal - minVal)) * chartHeight;

    // Generate paths for each series
    const pathsMap: Record<string, string> = {};
    const areasMap: Record<string, string> = {};
    const trendsMap: Record<string, { direction: 'up' | 'down' | 'flat'; pct: number }> = {};

    series.forEach(s => {
      const points = s.data
        .filter(d => d.value > 0)
        .map((d, i) => ({ x: scaleXFn(dates.indexOf(d.date)), y: scaleYFn(d.value) }));

      if (points.length > 1) {
        pathsMap[s.id] = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;

        if (s.showArea) {
          areasMap[s.id] = `${pathsMap[s.id]} L ${points[points.length - 1].x},${chartHeight + margin.top} L ${points[0].x},${chartHeight + margin.top} Z`;
        }

        // Calculate trend
        const firstVal = s.data.find(d => d.value > 0)?.value || 0;
        const lastVal = [...s.data].reverse().find(d => d.value > 0)?.value || 0;
        if (firstVal > 0) {
          const pctChange = ((lastVal - firstVal) / firstVal) * 100;
          trendsMap[s.id] = {
            direction: pctChange > 1 ? 'up' : pctChange < -1 ? 'down' : 'flat',
            pct: pctChange
          };
        } else {
          trendsMap[s.id] = { direction: 'flat', pct: 0 };
        }
      }
    });

    return {
      minValue: minVal,
      maxValue: maxVal,
      allDates: dates,
      scaleX: scaleXFn,
      scaleY: scaleYFn,
      paths: pathsMap,
      areas: areasMap,
      trends: trendsMap
    };
  }, [series, width, height]);

  if (!series.length) {
    return (
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '8pt', ...style }}>
        No data
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {/* Area fills */}
        {series.map(s => areas[s.id] && (
          <path
            key={`area-${s.id}`}
            d={areas[s.id]}
            fill={s.color}
            fillOpacity={0.1}
          />
        ))}

        {/* Lines */}
        {series.map(s => paths[s.id] && (
          <path
            key={`line-${s.id}`}
            d={paths[s.id]}
            stroke={s.color}
            strokeWidth={1.5}
            fill="none"
            strokeLinejoin="round"
          />
        ))}

        {/* Invisible hit areas for hover */}
        {series.map(s => s.data.map((d, i) => d.value > 0 && (
          <circle
            key={`hit-${s.id}-${i}`}
            cx={scaleX(allDates.indexOf(d.date))}
            cy={scaleY(d.value)}
            r={8}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredPoint({
              seriesId: s.id,
              index: i,
              x: scaleX(allDates.indexOf(d.date)),
              y: scaleY(d.value),
              value: d.value,
              date: d.date
            })}
            onMouseLeave={() => setHoveredPoint(null)}
          />
        )))}

        {/* Hovered point highlight */}
        {hoveredPoint && (
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r={4}
            fill={series.find(s => s.id === hoveredPoint.seriesId)?.color || '#fff'}
            stroke="var(--bg)"
            strokeWidth={2}
          />
        )}
      </svg>

      {/* Tooltip */}
      {hoveredPoint && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hoveredPoint.x, width - 80),
            top: Math.max(0, hoveredPoint.y - 30),
            background: 'var(--grey-800)',
            color: 'var(--white)',
            padding: '2px 6px',
            borderRadius: 4,
            fontSize: '7pt',
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {hoveredPoint.date}: {formatValue(hoveredPoint.value)}
        </div>
      )}

      {/* Legend with trend arrows */}
      {showLegend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          {series.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '7pt' }}>
              <div style={{ width: 12, height: 2, background: s.color }} />
              <span style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              {showTrendArrow && trends[s.id] && (
                <span style={{
                  color: trends[s.id].direction === 'up' ? '#22c55e' : trends[s.id].direction === 'down' ? '#ef4444' : 'var(--text-muted)'
                }}>
                  {trends[s.id].direction === 'up' ? '\u2191' : trends[s.id].direction === 'down' ? '\u2193' : '\u2192'}
                  {Math.abs(trends[s.id].pct).toFixed(1)}%
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MiniLineChart;
