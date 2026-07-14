// connector-inspector/BuildSkin.tsx — ordered build checklist grouped by
// function group. Click a row → build_state ADVANCES (uncut → cut →
// terminated_a → terminated_b → routed → verified); click a stepper segment →
// set that state directly (regression allowed — mis-clicks happen at the
// bench). Optimistic UI; persistence via useBuildState (error toast + revert
// on failure). Header: "N OF 61 TERMINATED" — Dave's pin count as live data.
// All chrome from the active Colorway; build-state hues are constant across
// themes (yellow always means CUT at the bench).

import React, { useMemo } from 'react';
import type { DerivedWire } from '../harnessDerivation';
import type { CavityGroup, ConnectorModel } from './types';
import { frame, rule, textOn, useColorway, type Colorway } from './colorways';
import {
  BUILD_STATES, BUILD_STATE_LABELS, stateIndex,
  type BuildState, type BuildStateApi,
} from './useBuildState';

interface BuildRow { wire: DerivedWire; cavs: string[]; group: CavityGroup | 'overflow' | 'direct' }

const GROUP_ORDER: (CavityGroup | 'overflow' | 'direct')[] = ['sensor', 'drive', 'power', 'can', 'overflow', 'direct'];
const GROUP_TITLES: Record<string, string> = {
  sensor: 'SENSORS / SIGNALS / SUPPLIES',
  drive: 'COIL / INJECTOR / ACTUATOR DRIVES',
  power: 'PDM-FED POWER & LIGHTING',
  can: 'CAN / FREED',
  overflow: 'OVERFLOW — NO CAVITY (DECISION REQUIRED)',
  direct: 'DIRECT FEED — NOT THROUGH THIS CONNECTOR',
};

interface Props {
  model: ConnectorModel;
  build: BuildStateApi;
}

export function BuildSkin({ model, build }: Props) {
  const cw = useColorway();
  const groups = useMemo(() => {
    const byWire = new Map<string, BuildRow>();
    for (const c of model.cavities) {
      for (const w of c.wires) {
        const row = byWire.get(w.id) || { wire: w, cavs: [], group: c.group };
        row.cavs.push(c.key);
        byWire.set(w.id, row);
      }
    }
    for (const w of model.overflow) byWire.set(w.id, { wire: w, cavs: [], group: 'overflow' });
    for (const w of model.directFeed) if (!byWire.has(w.id)) byWire.set(w.id, { wire: w, cavs: [], group: 'direct' });
    const rows = [...byWire.values()];
    return GROUP_ORDER
      .map(g => ({ id: g, title: GROUP_TITLES[g], rows: rows.filter(r => r.group === g) }))
      .filter(g => g.rows.length > 0);
  }, [model]);

  // headline counts from cavity-resident wires (the connector's pins)
  const cavityWires = useMemo(
    () => [...new Map(model.cavities.flatMap(c => c.wires).map(w => [w.id, w])).values()],
    [model],
  );
  const terminated = cavityWires.filter(w => stateIndex(build.states[w.id]) >= stateIndex('terminated_a')).length;
  const stateCounts = BUILD_STATES.map(s => cavityWires.filter(w => (build.states[w.id] ?? 'uncut') === s).length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: cw.bg }}>
      {/* ── progress header ── */}
      <div style={{ padding: '10px 16px', borderBottom: frame(cw), background: cw.surface }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: cw.fontBody, fontSize: 20, fontWeight: 700, letterSpacing: 1, color: cw.ink }}>
            {terminated} OF {model.totalCount} TERMINATED
          </span>
          {BUILD_STATES.map((s, i) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, background: cw.buildState[s], display: 'inline-block' }} />
              <span style={{ fontFamily: cw.fontMono, fontSize: 14, fontWeight: 700, color: cw.inkMuted }}>
                {BUILD_STATE_LABELS[s]} {stateCounts[i]}
              </span>
            </span>
          ))}
          {!build.loaded && (
            <span style={{ fontFamily: cw.fontBody, fontSize: 14, color: cw.inkFaint }}>LOADING SAVED STATES…</span>
          )}
        </div>
        {/* flat segmented progress bar */}
        <div style={{ display: 'flex', height: 8, marginTop: 8, border: rule(cw) }}>
          {BUILD_STATES.map((s, i) => (
            stateCounts[i] > 0 && (
              <span key={s} style={{ flexGrow: stateCounts[i], background: s === 'uncut' ? cw.barUncut : cw.buildState[s] }} />
            )
          ))}
        </div>
        <div style={{ fontFamily: cw.fontBody, fontSize: 14, color: cw.inkFaint, marginTop: 6 }}>
          CLICK A ROW TO ADVANCE ITS BUILD STATE — CLICK A SEGMENT TO SET IT DIRECTLY. SAVES TO THE VEHICLE RECORD.
        </div>
      </div>

      {/* ── checklist ── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {groups.map(g => (
          <div key={g.id}>
            <div style={{
              padding: '8px 16px', fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 1,
              color: g.id === 'overflow' ? cw.warn : cw.inkMuted,
              background: cw.elevated, borderBottom: rule(cw),
              position: 'sticky', top: 0, zIndex: 1,
            }}>
              {g.title} ({g.rows.length})
            </div>
            {g.rows.map(r => (
              <BuildRowView key={r.wire.id} row={r} build={build} cw={cw} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BuildRowView({ row, build, cw }: { row: BuildRow; build: BuildStateApi; cw: Colorway }) {
  const w = row.wire;
  const cur = build.states[w.id] ?? 'uncut';
  const curIdx = stateIndex(cur);
  const isPending = build.pending.has(w.id);
  const done = cur === 'verified';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '7px 16px',
      borderBottom: rule(cw),
      background: done ? cw.okTint : 'transparent',
    }}>
      {/* clickable identity zone — advances */}
      <div
        onClick={() => !done && build.advance(w.id)}
        title={done ? 'VERIFIED — use the segments to regress' : `ADVANCE → ${BUILD_STATE_LABELS[BUILD_STATES[Math.min(curIdx + 1, 5)]]}`}
        style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: done ? 'default' : 'pointer' }}
      >
        <span style={{
          width: 56, flexShrink: 0, fontFamily: cw.fontMono, fontSize: 14, fontWeight: 700,
          color: row.group === 'overflow' ? cw.warn : cw.inkMuted, textAlign: 'center',
          border: `1px solid ${row.group === 'overflow' ? cw.warn : cw.border}`, padding: '2px 0',
        }}>
          {row.cavs.length > 0 ? row.cavs.join('·') : '—'}
        </span>
        <span style={{ width: 64, flexShrink: 0, fontFamily: cw.fontMono, fontSize: 15, fontWeight: 700, color: cw.accent }}>
          #{w.id}
        </span>
        <span style={{
          flex: 1, minWidth: 0, fontFamily: cw.fontBody, fontSize: 15, color: cw.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {w.label}
        </span>
        <span style={{ flexShrink: 0, fontFamily: cw.fontMono, fontSize: 14, color: cw.inkFaint }}>
          {w.effectiveGauge} AWG · {w.lengthFt} FT
        </span>
        {isPending && <span style={{ fontFamily: cw.fontBody, fontSize: 14, color: cw.inkFaint }}>SAVING…</span>}
      </div>

      {/* 6-segment stepper */}
      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
        {BUILD_STATES.map((s, i) => {
          const reached = i <= curIdx && cur !== 'uncut';
          const isCur = i === curIdx && cur !== 'uncut';
          return (
            <button
              key={s}
              onClick={() => build.setState(w.id, s === cur ? BUILD_STATES[Math.max(0, i - 1)] : s)}
              title={s === cur ? `UNDO → ${BUILD_STATE_LABELS[BUILD_STATES[Math.max(0, i - 1)]]}` : `SET ${BUILD_STATE_LABELS[s]}`}
              style={{
                width: 76, padding: '4px 0',
                background: reached ? cw.buildState[s] : 'transparent',
                // text-on-chip law: full contrast on the chip (textOn) or on
                // the bg (inkMuted) — de-emphasis is the border, not the text
                color: reached ? textOn(cw.buildState[s]) : cw.inkMuted,
                border: `2px solid ${isCur ? cw.ink : reached ? cw.buildState[s] : cw.border}`,
                fontFamily: cw.fontBody, fontSize: 14, fontWeight: 700, letterSpacing: 0.3,
                cursor: 'pointer',
              }}
            >
              {BUILD_STATE_LABELS[s]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
