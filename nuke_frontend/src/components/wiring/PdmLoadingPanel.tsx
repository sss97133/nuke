// PdmLoadingPanel.tsx — PDM30 channel loading view for the Harness Workbench.
// 30 channels with load bars vs rating (OUT1-8 = 20A, OUT9-30 = 8A).
// Channels freed by subsystem toggles are highlighted.

import React from 'react';
import type { PdmChannel } from './harnessDerivation';

const C = {
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  track: '#252540',
  ok: '#22c55e',
  warn: '#eab308',
  over: '#ef4444',
  freed: '#00ddff',
} as const;

interface Props {
  pdm: PdmChannel[];
  freedChannels: number[];
}

export function PdmLoadingPanel({ pdm, freedChannels }: Props) {
  const freed = new Set(freedChannels);
  const usedCount = pdm.filter(c => c.devices.length > 0).length;
  const totalLoad = pdm.reduce((s, c) => s + c.loadAmps, 0);

  return (
    <div style={{ padding: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1,
        color: C.label, textTransform: 'uppercase',
        borderBottom: `2px solid ${C.border}`, paddingBottom: 4, marginBottom: 6,
      }}>
        PDM30 LOADING
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: C.text, letterSpacing: 0 }}>
          {usedCount}/30 CH — {Math.round(totalLoad)}A
        </span>
        {freed.size > 0 && (
          <span style={{ fontFamily: "'Courier New', monospace", fontSize: 9, color: C.freed, letterSpacing: 0 }}>
            {freed.size} FREED
          </span>
        )}
      </div>

      {pdm.map(ch => {
        const isFreed = freed.has(ch.channel);
        const isSpare = ch.devices.length === 0 && !isFreed;
        const pct = Math.min(100, (ch.loadAmps / ch.rating) * 100);
        const barColor = ch.loadAmps > ch.rating ? C.over : pct > 80 ? C.warn : C.ok;
        return (
          <div
            key={ch.channel}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 16,
              opacity: isSpare ? 0.4 : 1,
              outline: isFreed ? `1px solid ${C.freed}` : 'none',
              outlineOffset: -1,
              transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <span style={{
              width: 38, flexShrink: 0, fontFamily: "'Courier New', monospace",
              fontSize: 8, fontWeight: 700, color: isFreed ? C.freed : C.label,
            }}>
              OUT{ch.channel}
            </span>
            <span style={{
              width: 24, flexShrink: 0, fontFamily: "'Courier New', monospace",
              fontSize: 7, color: C.muted, textAlign: 'right',
            }}>
              {ch.rating}A
            </span>
            {/* load bar */}
            <span style={{ flex: 1, height: 8, background: C.track, border: `1px solid ${C.border}`, position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${pct}%`,
                background: isFreed ? C.freed : barColor,
                transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
              }} />
            </span>
            <span style={{
              width: 34, flexShrink: 0, fontFamily: "'Courier New', monospace",
              fontSize: 8, fontWeight: 700, textAlign: 'right',
              color: ch.loadAmps > ch.rating ? C.over : C.text,
            }}>
              {ch.loadAmps > 0 ? `${ch.loadAmps}A` : '—'}
            </span>
            <span style={{
              width: 150, flexShrink: 0, fontFamily: 'Arial', fontSize: 7,
              color: isFreed ? C.freed : isSpare ? C.muted : C.label,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              textTransform: 'uppercase', letterSpacing: 0.3,
            }} title={ch.label}>
              {isFreed ? 'FREED' : ch.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
