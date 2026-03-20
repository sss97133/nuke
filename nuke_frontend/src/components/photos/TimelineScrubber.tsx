/**
 * TimelineScrubber — Vertical date navigation strip for the photo grid.
 *
 * Shows month markers proportionally positioned by cumulative photo count.
 * Click/drag jumps to date group via virtualizer.scrollToIndex().
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

interface DateSummary {
  month: string; // e.g. '2024-06'
  count: number;
}

interface TimelineScrubberProps {
  dateSummary: DateSummary[];
  virtualizer: Virtualizer<HTMLDivElement, Element> | null;
  /** Map month string → first virtual row index for that month */
  monthToRowIndex: Map<string, number>;
}

const MONTH_SHORT: Record<string, string> = {
  '01': 'JAN', '02': 'FEB', '03': 'MAR', '04': 'APR',
  '05': 'MAY', '06': 'JUN', '07': 'JUL', '08': 'AUG',
  '09': 'SEP', '10': 'OCT', '11': 'NOV', '12': 'DEC',
};

function formatMonth(monthStr: string): string {
  const [year, mm] = monthStr.split('-');
  return `${MONTH_SHORT[mm] || mm} ${year?.slice(2) || ''}`;
}

export function TimelineScrubber({
  dateSummary,
  virtualizer,
  monthToRowIndex,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const [hoveredY, setHoveredY] = useState(0);

  // Compute cumulative positions
  const totalPhotos = useMemo(
    () => dateSummary.reduce((sum, d) => sum + d.count, 0),
    [dateSummary],
  );

  const markers = useMemo(() => {
    if (totalPhotos === 0) return [];
    let cumulative = 0;
    return dateSummary.map((d) => {
      const position = cumulative / totalPhotos;
      cumulative += d.count;
      return {
        month: d.month,
        label: formatMonth(d.month),
        position, // 0..1 from top
        count: d.count,
      };
    });
  }, [dateSummary, totalPhotos]);

  const handleClick = useCallback(
    (month: string) => {
      if (!virtualizer) return;
      const rowIndex = monthToRowIndex.get(month);
      if (rowIndex !== undefined) {
        virtualizer.scrollToIndex(rowIndex, { align: 'start' });
      }
    },
    [virtualizer, monthToRowIndex],
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackRef.current || markers.length === 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      // Find closest marker
      let closest = markers[0];
      let minDist = Math.abs(markers[0].position - ratio);
      for (const m of markers) {
        const dist = Math.abs(m.position - ratio);
        if (dist < minDist) {
          minDist = dist;
          closest = m;
        }
      }
      handleClick(closest.month);
    },
    [markers, handleClick],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!trackRef.current || markers.length === 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      setHoveredY(e.clientY - rect.top);

      // Find closest marker
      let closest = markers[0];
      let minDist = Math.abs(markers[0].position - ratio);
      for (const m of markers) {
        const dist = Math.abs(m.position - ratio);
        if (dist < minDist) {
          minDist = dist;
          closest = m;
        }
      }
      setHoveredMonth(closest.month);
    },
    [markers],
  );

  if (markers.length === 0) return null;

  // Only show label for every Nth marker to avoid overlap
  const trackHeight = trackRef.current?.clientHeight || 400;
  const minSpacing = 24;
  const skip = Math.max(1, Math.ceil((markers.length * minSpacing) / trackHeight));

  return (
    <div
      ref={trackRef}
      onClick={handleTrackClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredMonth(null)}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: '20px',
        zIndex: 4,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Hover tooltip */}
      {hoveredMonth && (
        <div
          style={{
            position: 'absolute',
            right: '22px',
            top: `${hoveredY - 10}px`,
            padding: '2px 6px',
            background: 'rgba(0,0,0,0.85)',
            color: 'var(--surface-elevated)',
            fontSize: '9px',
            fontFamily: 'Courier New, monospace',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {formatMonth(hoveredMonth)} ({markers.find(m => m.month === hoveredMonth)?.count || 0})
        </div>
      )}

      {/* Month markers */}
      {markers.map((m, i) => {
        const showLabel = i % skip === 0;
        return (
          <div
            key={m.month}
            onClick={(e) => {
              e.stopPropagation();
              handleClick(m.month);
            }}
            style={{
              position: 'absolute',
              right: '2px',
              top: `${m.position * 100}%`,
              fontSize: '6px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 800,
              color: 'var(--text-disabled)',
              textTransform: 'uppercase',
              lineHeight: 1,
              transform: 'translateY(-50%)',
              cursor: 'pointer',
            }}
            title={`${m.label} (${m.count})`}
          >
            {showLabel ? m.label : '·'}
          </div>
        );
      })}
    </div>
  );
}
