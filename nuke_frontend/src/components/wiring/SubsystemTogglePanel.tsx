// SubsystemTogglePanel.tsx — toggleable subsystem list for the Harness Workbench.
// Per-subsystem wire-count + amps badges computed from the FULL derivation so
// badges stay stable while toggling. MECHANICAL_GAUGES alternate at the bottom.

import React from 'react';
import { SUBSYSTEMS, MECHANICAL_GAUGES_ID, type DerivedHarness } from './harnessDerivation';

const C = {
  surface: '#1f1f35',
  elevated: '#252540',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  active: '#00ddff',
  on: '#22c55e',
  off: '#666680',
  locked: '#555577',
  freed: '#00ddff',
} as const;

interface Props {
  toggles: Record<string, boolean>;
  mechanicalGauges: boolean;
  fullDerivation: DerivedHarness;     // all toggles ON — badge source
  onToggle: (subsystemId: string) => void;
  onToggleMechanicalGauges: () => void;
  onAllOn: () => void;
  onAllOff: () => void;
}

export function SubsystemTogglePanel({
  toggles, mechanicalGauges, fullDerivation, onToggle, onToggleMechanicalGauges, onAllOn, onAllOff,
}: Props) {
  // wire counts per subsystem from the full derivation
  const wireCounts: Record<string, number> = {};
  for (const w of fullDerivation.wires) {
    wireCounts[w.subsystem] = (wireCounts[w.subsystem] || 0) + 1;
  }

  const fixed = SUBSYSTEMS.filter(s => !s.toggleable);
  const toggleable = SUBSYSTEMS.filter(s => s.toggleable);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      borderRight: `2px solid ${C.border}`, background: C.surface, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 28, flexShrink: 0,
        borderBottom: `2px solid ${C.border}`,
      }}>
        <span style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: C.label, textTransform: 'uppercase' }}>
          SUBSYSTEMS
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={onAllOn} style={btnStyle}>ALL ON</button>
        <button onClick={onAllOff} style={btnStyle}>ALL OFF</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* fixed (always-on) subsystems */}
        {fixed.map(s => (
          <Row
            key={s.id}
            label={s.label}
            on
            locked
            wires={wireCounts[s.id] || 0}
            amps={s.nameplateAmps}
            onClick={() => {}}
          />
        ))}
        <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
        {/* toggleable subsystems */}
        {toggleable.map(s => (
          <Row
            key={s.id}
            label={s.label}
            on={toggles[s.id] !== false}
            locked={false}
            wires={wireCounts[s.id] || 0}
            amps={s.nameplateAmps}
            onClick={() => onToggle(s.id)}
          />
        ))}
        <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
        {/* mechanical gauges alternate */}
        <Row
          label="Mechanical Gauges (alt)"
          on={mechanicalGauges}
          locked={false}
          wires={(wireCounts[MECHANICAL_GAUGES_ID] || 0)}
          amps={0}
          accent
          onClick={onToggleMechanicalGauges}
        />
        <div style={{ padding: '4px 10px 10px', fontFamily: 'Arial', fontSize: 7, color: C.muted, lineHeight: 1.5 }}>
          ECU SENSORS NEVER COME OUT — MECHANICAL GAUGES ADD SECOND SENDERS (OWN PORTS/TEES).
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
  padding: '2px 6px', background: 'transparent', border: `1px solid ${C.border}`,
  color: C.label, cursor: 'pointer', textTransform: 'uppercase',
};

function Row({ label, on, locked, wires, amps, accent, onClick }: {
  label: string; on: boolean; locked: boolean; wires: number; amps: number;
  accent?: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={locked ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
        cursor: locked ? 'default' : 'pointer',
        opacity: on ? 1 : 0.45,
        transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        borderBottom: `1px solid ${C.border}`,
        background: 'transparent',
      }}
      onMouseEnter={e => { if (!locked) e.currentTarget.style.background = C.elevated; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {/* toggle square — 2px border, zero radius */}
      <span style={{
        width: 12, height: 12, flexShrink: 0,
        border: `2px solid ${locked ? C.locked : on ? (accent ? C.freed : C.on) : C.off}`,
        background: on ? (locked ? C.locked : accent ? C.freed : C.on) : 'transparent',
        transition: 'all 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }} />
      <span style={{
        flex: 1, fontFamily: 'Arial', fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
        color: C.text, textTransform: 'uppercase',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {label}
        {locked && <span style={{ color: C.muted, marginLeft: 5, fontSize: 7 }}>FIXED</span>}
      </span>
      {/* badges */}
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700, color: C.label, flexShrink: 0 }}>
        {wires}W
      </span>
      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 8, fontWeight: 700, color: C.muted, flexShrink: 0, minWidth: 36, textAlign: 'right' }}>
        {amps > 0 ? `${amps}A` : '—'}
      </span>
    </div>
  );
}
