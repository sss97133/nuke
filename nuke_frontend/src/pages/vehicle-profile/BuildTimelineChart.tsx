import React, { useMemo, useState, useCallback } from 'react';
import type { BuildSnapshot } from './hooks/useBuildProfile';

interface BuildPhase {
  name: string;
  label: string;
  start: string;
  end: string;
  color: string;
}

const BUILD_PHASES: BuildPhase[] = [
  { name: 'BASELINE', label: 'BASELINE', start: '2021-01', end: '2021-08', color: '#6b7280' },
  { name: 'PLANNING', label: 'PLANNING', start: '2021-09', end: '2022-06', color: '#3b82f6' },
  { name: 'ACQUISITION', label: 'ACQUISITION', start: '2022-07', end: '2023-06', color: '#f59e0b' },
  { name: 'FABRICATION', label: 'FABRICATION', start: '2023-07', end: '2024-08', color: '#ef4444' },
  { name: 'WIRING', label: 'WIRING', start: '2024-09', end: '2025-06', color: '#8b5cf6' },
  { name: 'CURRENT', label: 'CURRENT', start: '2025-07', end: '2027-12', color: '#10b981' },
];

interface Props {
  snapshots: BuildSnapshot[];
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const monthLabel = (m: string) => {
  const d = new Date(m + 'T00:00:00');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
};

const BuildTimelineChart: React.FC<Props> = ({ snapshots }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Filter out zero-activity months for cleaner display
  const activeSnapshots = useMemo(
    () => snapshots.filter(s => s.total_spend > 0 || s.photo_count > 0),
    [snapshots]
  );

  // Use P90 spend as max instead of absolute max — prevents one huge month
  // (like vehicle purchase) from making everything else invisible
  const maxSpend = useMemo(() => {
    const spends = activeSnapshots.map(s => s.total_spend).filter(s => s > 0).sort((a, b) => a - b);
    if (spends.length === 0) return 1;
    const p90idx = Math.floor(spends.length * 0.9);
    return Math.max(spends[p90idx] || spends[spends.length - 1], 1);
  }, [activeSnapshots]);

  const maxPhotos = useMemo(
    () => Math.max(...activeSnapshots.map(s => s.photo_count), 1),
    [activeSnapshots]
  );

  const handleMouseEnter = useCallback((i: number) => setHoveredIdx(i), []);
  const handleMouseLeave = useCallback(() => setHoveredIdx(null), []);

  if (activeSnapshots.length === 0) return null;

  return (
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px' }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '6px', fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        <span>■ SPENDING</span>
        <span style={{ color: 'var(--vp-gulf-orange, #f48024)' }}>■ PHOTOS</span>
      </div>

      {/* Phase labels above chart */}
      {activeSnapshots.length > 0 && (() => {
        const phases: { phase: BuildPhase; startIdx: number; endIdx: number }[] = [];
        for (const phase of BUILD_PHASES) {
          const startIdx = activeSnapshots.findIndex(s => s.month >= phase.start);
          const endIdx = activeSnapshots.findLastIndex(s => s.month <= phase.end);
          if (startIdx >= 0 && endIdx >= startIdx) {
            phases.push({ phase, startIdx, endIdx });
          }
        }
        return phases.length > 0 ? (
          <div style={{ display: 'flex', gap: '1px', marginBottom: '2px' }}>
            {activeSnapshots.map((s, i) => {
              const p = phases.find(p => i === p.startIdx);
              const inPhase = phases.find(p => i >= p.startIdx && i <= p.endIdx);
              if (!inPhase) return <div key={`phase-${i}`} style={{ flex: 1, minWidth: '4px', maxWidth: '24px' }} />;
              return (
                <div key={`phase-${i}`} style={{
                  flex: 1, minWidth: '4px', maxWidth: '24px',
                  borderBottom: `2px solid ${inPhase.phase.color}`,
                  textAlign: 'left',
                  overflow: 'visible',
                  whiteSpace: 'nowrap',
                  position: 'relative',
                }}>
                  {p && (
                    <span style={{
                      fontSize: '6px',
                      fontFamily: 'var(--vp-font-sans)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: inPhase.phase.color,
                      position: 'absolute',
                      top: '-8px',
                      left: 0,
                    }}>{p.phase.label}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null;
      })()}

      {/* Chart */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '1px',
        height: '80px',
        borderBottom: '2px solid var(--vp-ink)',
        position: 'relative',
      }}>
        {activeSnapshots.map((s, i) => {
          const spendH = Math.min(72, Math.max(2, (s.total_spend / maxSpend) * 72));
          const photoH = Math.min(72, Math.max(0, (s.photo_count / maxPhotos) * 72));
          const isOutlier = s.total_spend > maxSpend; // capped bar
          const isHovered = hoveredIdx === i;
          return (
            <div
              key={s.month}
              style={{
                flex: 1,
                minWidth: '4px',
                maxWidth: '24px',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'center',
                cursor: 'pointer',
                position: 'relative',
              }}
              onMouseEnter={() => handleMouseEnter(i)}
              onMouseLeave={handleMouseLeave}
            >
              {/* Photo overlay bar */}
              {s.photo_count > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '60%',
                  height: `${photoH}px`,
                  background: 'var(--vp-gulf-orange, #f48024)',
                  opacity: 0.4,
                  zIndex: 1,
                }} />
              )}
              {/* Spend bar */}
              <div style={{
                width: '80%',
                height: `${spendH}px`,
                background: isHovered ? 'var(--vp-ink)' : isOutlier ? 'var(--vp-martini-red, #c62828)' : 'var(--vp-pencil, #888)',
                transition: 'background 0.12s ease',
                position: 'relative',
                zIndex: 2,
              }} />

              {/* Tooltip — pin edges to prevent clipping */}
              {isHovered && (() => {
                const isNearLeft = i < 3;
                const isNearRight = i > activeSnapshots.length - 4;
                const align = isNearLeft ? { left: 0 } : isNearRight ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' };
                return (
                  <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    ...align,
                    background: 'var(--vp-ink)',
                    color: '#fff',
                    padding: '4px 6px',
                    fontSize: '8px',
                    fontFamily: 'var(--vp-font-mono)',
                    whiteSpace: 'nowrap',
                    zIndex: 100,
                    pointerEvents: 'none',
                    lineHeight: 1.4,
                  }}>
                    <div style={{ fontWeight: 700 }}>{monthLabel(s.month)}</div>
                    <div>{fmt(s.total_spend)} · {s.photo_count} photos</div>
                    {s.vendor_count > 0 && <div>{s.vendor_count} vendors</div>}
                    <div>SCORE: {s.activity_score}</div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* X-axis labels — show every 3rd month */}
      <div style={{ display: 'flex', gap: '1px' }}>
        {activeSnapshots.map((s, i) => (
          <div key={s.month} style={{
            flex: 1, minWidth: '4px', maxWidth: '24px',
            textAlign: 'center', fontSize: '6px',
            fontFamily: 'var(--vp-font-mono)',
            color: 'var(--vp-pencil)',
            paddingTop: '2px',
          }}>
            {i % 3 === 0 ? monthLabel(s.month) : ''}
          </div>
        ))}
      </div>
    </div>
  );
};

export default BuildTimelineChart;
