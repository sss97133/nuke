// HarnessWorkbench.tsx — LIVE HARNESS WORKBENCH tab for /vehicle/:vehicleId/wiring.
// Toggle subsystems on/off and watch the whole harness re-derive in real time:
// cut list rows animate out, connector cavity fills update, PDM channels free up,
// and the electrical budget re-ladders. Toggles persist in URL params (?wb=, ?mg=1).
//
// Consumes deriveHarness() from ./harnessDerivation — the pure derivation engine
// (162-wire registry, DOC-05 companion expansion, D38999 cavity rules R1-R6).

import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ManifestDevice } from './overlayCompute';
import {
  deriveHarness, SUBSYSTEMS, DEFAULT_POSITIONS,
  type DerivationInput, type ComponentPositions,
} from './harnessDerivation';
import { SubsystemTogglePanel } from './SubsystemTogglePanel';
import { LiveCutList } from './LiveCutList';
import { ConnectorFaces } from './ConnectorFaces';
import { PdmLoadingPanel } from './PdmLoadingPanel';
import { BudgetBar } from './BudgetBar';
import { PlanView2D } from './PlanView2D';

const C = {
  bg: '#1a1a2e',
  border: '#333355',
} as const;

// stable per-subsystem accent colors (badges in the cut list)
const SUBSYSTEM_PALETTE = [
  '#cc2222', '#cc6600', '#2266cc', '#8822cc', '#22aa44', '#666666',
  '#cc6699', '#44bbcc', '#669977', '#aa8822', '#5577aa', '#aa5544',
  '#447788', '#884466', '#557744', '#775599', '#996633', '#336699',
  '#993344', '#338866', '#666688',
];
const SUBSYSTEM_COLORS: Record<string, string> = Object.fromEntries(
  SUBSYSTEMS.map((s, i) => [s.id, SUBSYSTEM_PALETTE[i % SUBSYSTEM_PALETTE.length]]),
);
SUBSYSTEM_COLORS.MECHANICAL_GAUGES = '#00aabb';

// URL param format: ?wb=FUEL,AUDIO (comma-separated OFF subsystems; default all ON)
//                   ?mg=1 (mechanical gauges alternate on)
const OFF_PARAM = 'wb';
const MG_PARAM = 'mg';

interface Props {
  devices: ManifestDevice[];
}

export function HarnessWorkbench({ devices }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const offIds = useMemo(() => {
    const raw = searchParams.get(OFF_PARAM);
    return new Set(raw ? raw.split(',').filter(Boolean) : []);
  }, [searchParams]);
  const mechanicalGauges = searchParams.get(MG_PARAM) === '1';

  const toggles = useMemo(() => {
    const t: Record<string, boolean> = {};
    for (const s of SUBSYSTEMS) t[s.id] = !offIds.has(s.id);
    return t;
  }, [offIds]);

  // ── Plan-view component positions (lifted here so toggles+positions compose) ──
  const [positions, setPositions] = useState<ComponentPositions>(DEFAULT_POSITIONS);
  const [planOpen, setPlanOpen] = useState(true);

  // ── Derivations: FULL (badge/dim reference) + ACTIVE (live state) ──
  const fullDerivation = useMemo(() => {
    const allOn: Record<string, boolean> = {};
    for (const s of SUBSYSTEMS) allOn[s.id] = true;
    const input: DerivationInput = { devices, toggles: allOn, mechanicalGauges };
    return deriveHarness(input);
  }, [devices, mechanicalGauges]);

  // ACTIVE carries the dragged positions — cut list / budget / PDM reflow too.
  const activeDerivation = useMemo(() => {
    const input: DerivationInput = { devices, toggles, mechanicalGauges, positions };
    return deriveHarness(input);
  }, [devices, toggles, mechanicalGauges, positions]);

  // Same toggles at twin-default positions — the plan view's diff baseline.
  const twinBaseline = useMemo(() => {
    const input: DerivationInput = { devices, toggles, mechanicalGauges };
    return deriveHarness(input);
  }, [devices, toggles, mechanicalGauges]);

  const activeWireIds = useMemo(
    () => new Set(activeDerivation.wires.map(w => w.id)),
    [activeDerivation],
  );

  // ── URL-param toggle writers ──
  const setOff = useCallback((next: Set<string>, mg: boolean) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next.size > 0) p.set(OFF_PARAM, [...next].sort().join(','));
      else p.delete(OFF_PARAM);
      if (mg) p.set(MG_PARAM, '1');
      else p.delete(MG_PARAM);
      return p;
    }, { replace: true });
  }, [setSearchParams]);

  const handleToggle = useCallback((id: string) => {
    const next = new Set(offIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOff(next, mechanicalGauges);
  }, [offIds, mechanicalGauges, setOff]);

  const handleToggleMG = useCallback(() => {
    setOff(offIds, !mechanicalGauges);
  }, [offIds, mechanicalGauges, setOff]);

  const handleAllOn = useCallback(() => setOff(new Set(), mechanicalGauges), [mechanicalGauges, setOff]);
  const handleAllOff = useCallback(() => {
    setOff(new Set(SUBSYSTEMS.filter(s => s.toggleable).map(s => s.id)), mechanicalGauges);
  }, [mechanicalGauges, setOff]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg, overflow: 'hidden' }}>
      {/* ── TOP: collapsible 2D plan view (drag components → derivation reflows) ── */}
      <div style={{ flexShrink: 0, borderBottom: `2px solid ${C.border}` }}>
        <button
          onClick={() => setPlanOpen(o => !o)}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            background: C.bg, color: '#a0a0b0', border: 'none',
            borderBottom: planOpen ? `1px solid ${C.border}` : 'none',
            fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1,
            padding: '5px 10px', cursor: 'pointer',
          }}
        >
          {planOpen ? '▾' : '▸'} PLAN VIEW — TOP-DOWN COMPONENT PLACEMENT (POSITIONS RE-DERIVE THE HARNESS)
        </button>
        {planOpen && (
          <PlanView2D
            harness={activeDerivation}
            baseline={twinBaseline}
            positions={positions}
            onPositionsChange={setPositions}
          />
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* ── LEFT: subsystem toggles ── */}
        <div style={{ width: 252, flexShrink: 0 }}>
          <SubsystemTogglePanel
            toggles={toggles}
            mechanicalGauges={mechanicalGauges}
            fullDerivation={fullDerivation}
            onToggle={handleToggle}
            onToggleMechanicalGauges={handleToggleMG}
            onAllOn={handleAllOn}
            onAllOff={handleAllOff}
          />
        </div>

        {/* ── CENTER: budget bar + live cut list ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: `2px solid ${C.border}` }}>
          <BudgetBar harness={activeDerivation} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <LiveCutList
              wires={fullDerivation.wires}
              activeWireIds={activeWireIds}
              subsystemColors={SUBSYSTEM_COLORS}
            />
          </div>
        </div>

        {/* ── RIGHT: connector faces + PDM loading ── */}
        <div style={{ width: 380, flexShrink: 0, overflowY: 'auto' }}>
          <ConnectorFaces harness={activeDerivation} />
          <PdmLoadingPanel pdm={activeDerivation.pdm} freedChannels={activeDerivation.freedChannels} />
        </div>
      </div>
    </div>
  );
}

export default HarnessWorkbench;
