import React, { useRef, useCallback } from 'react';
import type { HistogramBucket } from '../types';
import { MAP_FONT } from '../constants';

interface Props {
  buckets: HistogramBucket[];
  timeEnd?: string;
  onScrub: (month: string | undefined) => void;
  loading: boolean;
}

export default function MapTimeline({ buckets, timeEnd, onScrub, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (buckets.length === 0) return null;

  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  // Find the active bucket index based on timeEnd
  let activeIndex = buckets.length - 1;
  if (timeEnd) {
    const endDate = new Date(timeEnd);
    const endMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`;
    const idx = buckets.findIndex(b => b.month >= endMonth);
    activeIndex = idx >= 0 ? idx : buckets.length - 1;
  }

  const handleBarClick = useCallback((month: string, index: number) => {
    if (index === buckets.length - 1) {
      onScrub(undefined); // Clear filter when clicking last bar
    } else {
      onScrub(month);
    }
  }, [buckets.length, onScrub]);

  const handleClear = useCallback(() => {
    onScrub(undefined);
  }, [onScrub]);

  // Show year labels only at first month of each year
  const getLabel = (month: string, idx: number): string | null => {
    if (idx === 0) return month.slice(0, 4);
    const prevYear = buckets[idx - 1]?.month.slice(0, 4);
    const currYear = month.slice(0, 4);
    if (currYear !== prevYear) return currYear;
    return null;
  };

  return (
    <div style={{
      position: 'absolute', bottom: 20, left: 60, right: 60,
      background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.1)',
      padding: '8px 12px', fontFamily: MAP_FONT, zIndex: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          TIMELINE {loading ? '...' : ''}
        </span>
        {timeEnd && (
          <button onClick={handleClear} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.6)', fontSize: 7, cursor: 'pointer',
            padding: '1px 4px', fontFamily: MAP_FONT, textTransform: 'uppercase',
          }}>
            CLEAR
          </button>
        )}
      </div>

      {/* Histogram bars */}
      <div ref={containerRef} style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 32, position: 'relative' }}>
        {buckets.map((bucket, i) => {
          const height = Math.max(2, (bucket.count / maxCount) * 30);
          const isActive = i <= activeIndex;
          const label = getLabel(bucket.month, i);

          return (
            <div key={bucket.month} style={{ flex: 1, position: 'relative', cursor: 'pointer' }} onClick={() => handleBarClick(bucket.month, i)}>
              <div style={{
                height,
                background: isActive ? 'rgba(245, 158, 11, 0.8)' : 'rgba(255,255,255,0.1)',
                transition: 'background 120ms ease',
                minWidth: 2,
              }} title={`${bucket.month}: ${bucket.count.toLocaleString()} events`} />
              {label && (
                <div style={{
                  position: 'absolute', bottom: -12, left: 0,
                  fontSize: 7, color: 'rgba(255,255,255,0.35)',
                  whiteSpace: 'nowrap',
                }}>
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active range label */}
      {timeEnd && (
        <div style={{ fontSize: 9, color: 'rgba(245, 158, 11, 0.9)', marginTop: 14, textAlign: 'center', fontFamily: 'Courier New, monospace' }}>
          UP TO {new Date(timeEnd).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
        </div>
      )}
    </div>
  );
}
