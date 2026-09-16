// BudgetBar.tsx — electrical budget strip for the Harness Workbench.
// Nameplate amps vs the alternator ladder (80 / 105 / 145 / 180 / 220A steps,
// matching overlayCompute's recommendation ladder) + derivation warnings.

import React from 'react';
import type { DerivedHarness } from './harnessDerivation';

const C = {
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  track: '#252540',
  ok: '#22c55e',
  warn: '#eab308',
  over: '#ef4444',
  active: '#00ddff',
} as const;

// alternator ladder per overlayCompute.ts altRecommendation
const LADDER: { amps: number; label: string }[] = [
  { amps: 80, label: '80A STOCK' },
  { amps: 105, label: '105A HO' },
  { amps: 145, label: '145A CS130D' },
  { amps: 180, label: '180A AD244' },
  { amps: 220, label: '220A AD244' },
];

interface Props {
  harness: DerivedHarness;
}

export function BudgetBar({ harness }: Props) {
  const { nameplateAmps, alternatorRequired, warnings } = harness.budget;
  const max = Math.max(240, alternatorRequired + 20);
  const step = LADDER.find(l => l.amps >= alternatorRequired);
  const gaugeEntries = Object.entries(harness.byGauge).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

  return (
    <div style={{ padding: 10, borderBottom: `2px solid ${C.border}` }}>
      {/* headline numbers */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 6 }}>
        <Stat label="NAMEPLATE" value={`${nameplateAmps}A`} />
        <Stat label="ALT REQ (×1.25)" value={`${alternatorRequired}A`} color={step ? C.text : C.over} />
        <Stat label="ALTERNATOR" value={step ? step.label : `${alternatorRequired}A+ DUAL`} color={step ? C.ok : C.over} />
        <Stat label="COST" value={`$${harness.costUsd.toLocaleString()}`} />
      </div>

      {/* ladder bar */}
      <div style={{ position: 'relative', height: 18, background: C.track, border: `1px solid ${C.border}` }}>
        {/* load fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${Math.min(100, (alternatorRequired / max) * 100)}%`,
          background: step ? C.ok : C.over,
          opacity: 0.55,
          transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
        {/* nameplate marker */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, width: 2,
          left: `${Math.min(100, (nameplateAmps / max) * 100)}%`,
          background: C.active,
          transition: 'left 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
        {/* ladder rungs */}
        {LADDER.map(l => (
          <div key={l.amps} style={{
            position: 'absolute', top: 0, bottom: 0, width: 1,
            left: `${(l.amps / max) * 100}%`,
            background: alternatorRequired <= l.amps ? C.label : C.over,
          }} />
        ))}
      </div>
      {/* rung labels */}
      <div style={{ position: 'relative', height: 10, marginTop: 1 }}>
        {LADDER.map(l => (
          <span key={l.amps} style={{
            position: 'absolute', left: `${(l.amps / max) * 100}%`, transform: 'translateX(-50%)',
            fontFamily: "'Courier New', monospace", fontSize: 7,
            color: alternatorRequired <= l.amps ? C.muted : C.over, whiteSpace: 'nowrap',
          }}>
            {l.amps}
          </span>
        ))}
      </div>

      {/* footage by gauge */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {gaugeEntries.map(([g, ft]) => (
          <span key={g} style={{ fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700, color: C.label }}>
            {g}AWG <span style={{ color: C.text }}>{ft}ft</span>
          </span>
        ))}
      </div>

      {/* warnings */}
      {warnings.length > 0 && (
        <div style={{ marginTop: 6, border: `1px solid ${C.warn}`, padding: '4px 6px' }}>
          {warnings.map((w, i) => (
            <div key={i} style={{ fontFamily: 'Arial', fontSize: 8, color: C.warn, lineHeight: 1.5 }}>
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: 0.5, color: C.muted, textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, fontWeight: 700, color: color || C.text }}>
        {value}
      </span>
    </span>
  );
}
