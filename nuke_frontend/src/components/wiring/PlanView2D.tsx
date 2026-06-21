// PlanView2D.tsx — top-down 2D K5 plan view for the Harness Workbench.
// Drag component nodes (battery, M130, PDM30, FWG grommet, FLOOR-RR, fuel
// tank, starter, alternator, tail cluster, dash cluster) and watch landmark
// routes + lengths reflow live; the side readout diffs the positioned
// derivation against the twin-default baseline (length, gauge, cost).
//
// Geometry: digital-twin coords (meters, x driver+, y front−, z up+) from
// k5LandmarkPaths DEFAULT_POSITIONS (K5_landmarks_blender_derived.yaml
// assumptions A1-A6; wheelbase 2.703m, envelope 4.7m x 2.0m, firewall
// y=-1.46, tail lights y=+1.78). Plan projection: front = −Y at LEFT,
// driver (+x) at BOTTOM. Flat design — no gradients, no shadows, no radius.

import React, { useMemo, useRef, useState } from 'react';
import {
  DEFAULT_POSITIONS, LANDMARK_WAYPOINTS, computeLandmarksIn,
  type ComponentPositions, type DerivedHarness, type DerivedWire,
} from './harnessDerivation';
import { LANDMARKS_IN, type LandmarkWaypoint } from './k5LandmarkPaths';

const C = {
  bg: '#1a1a2e',
  panel: '#20203a',
  border: '#333355',
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  body: '#8888aa',
  amber: '#ffaa00',
  green: '#22aa44',
} as const;

// Route colors by trunk family (workbench subsystem palette, flat)
const ROUTE_COLOR: Record<string, string> = {
  L01: '#cc2222', L02: '#cc2222',                            // engine loom
  L10: '#cc6699', L11: '#cc6699', L12: '#cc6699', L13: '#cc6699', // crank/cam/knock
  L14: '#cc6600', L15: '#cc6600',                            // battery power
  L16: '#2266cc', L17: '#2266cc', L18: '#2266cc', L19: '#2266cc', L28: '#2266cc', // dash loom
  L20: '#8822cc', L22: '#8822cc',                            // door looms
  L23: '#44bbcc',                                            // roof / dome
  L24: '#22aa44', L25: '#22aa44', L26: '#22aa44', L27: '#22aa44', // rear loom
  L29: '#669977', L30: '#669977',                            // O2 / underbody
};

const DRAGGABLE: { id: string; label: string }[] = [
  { id: 'BAT', label: 'BATTERY' },
  { id: 'M130', label: 'M130' },
  { id: 'PDM30', label: 'PDM30' },
  { id: 'FWG_MAIN', label: 'FWG' },
  { id: 'FLOOR_RR', label: 'FLOOR-RR' },
  { id: 'FUEL_TANK', label: 'FUEL TANK' },
  { id: 'STARTER', label: 'STARTER' },
  { id: 'ALT', label: 'ALT' },
  { id: 'TAIL_CLUSTER', label: 'TAIL' },
  { id: 'DASH_CLUSTER', label: 'DASH CLU' },
];
const DRAGGABLE_IDS = new Set(DRAGGABLE.map(d => d.id));

// ── World ↔ SVG projection ──────────────────────────────────────────
// World: y ∈ [-2.92 front bumper, +1.78 tailgate], x ∈ [-1.0 pass, +1.0 drv]
const SC = 150;                 // px per meter
const PAD = 26;
const WY0 = -2.97, WY1 = 1.86;  // drawn world-y range (envelope + margin)
const VBW = Math.round((WY1 - WY0) * SC + PAD * 2);  // ~751
const VBH = Math.round(2.1 * SC + PAD * 2);          // ~367
const sx = (wy: number) => PAD + (wy - WY0) * SC;
const sy = (wx: number) => PAD + (wx + 1.05) * SC;

interface Props {
  harness: DerivedHarness;   // derived WITH current positions
  baseline: DerivedHarness;  // same toggles, twin-default positions
  positions: ComponentPositions;
  onPositionsChange: (next: ComponentPositions) => void;
}

interface DiffRow {
  wire: DerivedWire;
  base: DerivedWire;
  gaugeChanged: boolean;
}

export function PlanView2D({ harness, baseline, positions, onPositionsChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [snap, setSnap] = useState(false);

  const pos: ComponentPositions = useMemo(
    () => ({ ...DEFAULT_POSITIONS, ...positions }),
    [positions],
  );
  const landmarksIn = useMemo(() => computeLandmarksIn(pos), [pos]);

  const moved = useMemo(() => {
    const s = new Set<string>();
    for (const id of DRAGGABLE_IDS) {
      const p = pos[id], d = DEFAULT_POSITIONS[id];
      if (Math.abs(p.x - d.x) > 1e-4 || Math.abs(p.y - d.y) > 1e-4) s.add(id);
    }
    return s;
  }, [pos]);

  // ── Readout diffs: positioned vs twin-default baseline ──
  const diffs = useMemo<DiffRow[]>(() => {
    const baseById = new Map(baseline.wires.map(w => [w.id, w]));
    const rows: DiffRow[] = [];
    for (const w of harness.wires) {
      const b = baseById.get(w.id);
      if (!b) continue;
      const lenChanged = Math.abs(w.lengthFt - b.lengthFt) > 0.005;
      const gaugeChanged = w.effectiveGauge !== b.effectiveGauge;
      if (lenChanged || gaugeChanged) rows.push({ wire: w, base: b, gaugeChanged });
    }
    rows.sort((a, b) =>
      (b.gaugeChanged ? 1 : 0) - (a.gaugeChanged ? 1 : 0) ||
      Math.abs(b.wire.lengthFt - b.base.lengthFt) - Math.abs(a.wire.lengthFt - a.base.lengthFt),
    );
    return rows;
  }, [harness, baseline]);
  const gaugeChanges = diffs.filter(d => d.gaugeChanged);
  const costDelta = Math.round((harness.costUsd - baseline.costUsd) * 100) / 100;
  const lenDelta = Math.round((harness.totalLengthFt - baseline.totalLengthFt) * 10) / 10;

  // ── Drag plumbing ──
  const clientToWorld = (e: React.PointerEvent): { wx: number; wy: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { wy: (p.x - PAD) / SC + WY0, wx: (p.y - PAD) / SC - 1.05 };
  };

  const handleDown = (id: string) => (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic/stale pointerId — svg-level onPointerMove still tracks */
    }
    setDragId(id);
  };
  const handleMove = (e: React.PointerEvent) => {
    if (!dragId) return;
    const w = clientToWorld(e);
    if (!w) return;
    let x = Math.max(-0.98, Math.min(0.98, w.wx));
    let y = Math.max(-2.92, Math.min(1.78, w.wy));
    if (snap) {
      x = Math.round(x / 0.05) * 0.05;
      y = Math.round(y / 0.05) * 0.05;
    }
    onPositionsChange({ ...pos, [dragId]: { x, y, z: pos[dragId].z } });
  };
  const handleUp = () => setDragId(null);

  const mono = "'Courier New', monospace";

  return (
    <div style={{ display: 'flex', gap: 0, background: C.bg, maxHeight: 380, overflow: 'hidden' }}>
      {/* ── Plan canvas ── */}
      <div style={{ flex: 1, minWidth: 0, padding: '6px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: C.label }}>
            K5 PLAN VIEW — DRAG COMPONENTS, ROUTES REFLOW (FRONT ← LEFT, DRIVER = BOTTOM)
          </span>
          <button
            onClick={() => onPositionsChange({ ...DEFAULT_POSITIONS })}
            style={{
              fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 0.5,
              background: C.panel, color: moved.size > 0 ? C.amber : C.muted,
              border: `2px solid ${moved.size > 0 ? C.amber : C.border}`,
              padding: '2px 8px', cursor: 'pointer',
            }}
          >
            RESET TO TWIN
          </button>
          <label style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={snap} onChange={() => setSnap(s => !s)} style={{ margin: 0 }} />
            SNAP 5CM
          </label>
        </div>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VBW} ${VBH}`}
          style={{ width: '100%', display: 'block', maxHeight: 330, touchAction: 'none' }}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
        >
          {/* ── Vehicle envelope (4.7m x 2.0m, chamfered nose) ── */}
          <path
            d={`M ${sx(-2.62)} ${sy(-1.0)} L ${sx(1.7)} ${sy(-1.0)} L ${sx(1.78)} ${sy(-0.92)}
                L ${sx(1.78)} ${sy(0.92)} L ${sx(1.7)} ${sy(1.0)} L ${sx(-2.62)} ${sy(1.0)}
                L ${sx(-2.92)} ${sy(0.78)} L ${sx(-2.92)} ${sy(-0.78)} Z`}
            fill="none" stroke={C.body} strokeWidth={2}
          />
          {/* frame rails */}
          <line x1={sx(-2.7)} y1={sy(-0.4)} x2={sx(1.7)} y2={sy(-0.4)} stroke={C.border} strokeWidth={1} strokeDasharray="6 4" />
          <line x1={sx(-2.7)} y1={sy(0.4)} x2={sx(1.7)} y2={sy(0.4)} stroke={C.border} strokeWidth={1} strokeDasharray="6 4" />
          {/* axles + wheels (wheelbase 2.703m: front -1.853, rear +0.85) */}
          {[-1.853, 0.85].map(ay => (
            <g key={ay}>
              <line x1={sx(ay)} y1={sy(-0.95)} x2={sx(ay)} y2={sy(0.95)} stroke={C.border} strokeWidth={1} />
              <rect x={sx(ay - 0.38)} y={sy(-0.98)} width={0.76 * SC} height={0.26 * SC} fill="none" stroke={C.body} strokeWidth={1.5} />
              <rect x={sx(ay - 0.38)} y={sy(0.72)} width={0.76 * SC} height={0.26 * SC} fill="none" stroke={C.body} strokeWidth={1.5} />
            </g>
          ))}
          {/* firewall / dash rear / cab rear / tailgate stations */}
          {([[-1.46, 'FIREWALL'], [-0.99, 'DASH'], [0.1, 'CAB'], [1.7, 'GATE']] as [number, string][]).map(([wy, lbl]) => (
            <g key={lbl}>
              <line x1={sx(wy)} y1={sy(-1.0)} x2={sx(wy)} y2={sy(1.0)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
              <text x={sx(wy)} y={sy(-1.0) - 4} fontFamily="Arial" fontSize={6} fill={C.muted} textAnchor="middle">{lbl}</text>
            </g>
          ))}
          <text x={sx(-2.9)} y={sy(0) + 3} fontFamily="Arial" fontSize={7} fontWeight={700} fill={C.muted}>FRONT</text>
          <text x={sx(0)} y={sy(1.0) + 12} fontFamily="Arial" fontSize={6} fill={C.muted} textAnchor="middle">DRIVER SIDE</text>
          <text x={sx(0)} y={sy(-1.0) - 12} fontFamily="Arial" fontSize={6} fill={C.muted} textAnchor="middle">PASSENGER SIDE</text>

          {/* ── Landmark routes (live polylines: node anchors + fixed waypoints) ── */}
          {Object.entries(LANDMARK_WAYPOINTS).map(([lm, wp], i) => {
            const resolve = (p: LandmarkWaypoint): { x: number; y: number } | null => {
              if (typeof p === 'string') {
                const n = pos[p];
                return n ? { x: n.x, y: n.y } : null;
              }
              return { x: p[0], y: p[1] };
            };
            const pts = wp.points.map(resolve).filter((p): p is { x: number; y: number } => !!p);
            if (pts.length < 2) return null;
            const color = ROUTE_COLOR[lm] || C.muted;
            const changed = Math.abs((landmarksIn[lm] ?? 0) - (LANDMARKS_IN[lm] ?? 0)) > 0.05;
            // label at fraction t along the projected polyline (staggered per route)
            const t = 0.32 + (i % 4) * 0.12;
            const segLens = pts.slice(1).map((p, k) => Math.hypot(p.x - pts[k].x, p.y - pts[k].y));
            const total = segLens.reduce((s, d) => s + d, 0) || 1;
            let remain = total * t, li = 0;
            while (li < segLens.length - 1 && remain > segLens[li]) { remain -= segLens[li]; li++; }
            const f = segLens[li] > 0 ? remain / segLens[li] : 0;
            const lwx = pts[li].x + (pts[li + 1].x - pts[li].x) * f;
            const lwy = pts[li].y + (pts[li + 1].y - pts[li].y) * f;
            return (
              <g key={lm}>
                <polyline
                  points={pts.map(p => `${sx(p.y)},${sy(p.x)}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={changed ? 2.5 : 1.5}
                  opacity={changed ? 1 : 0.75}
                />
                <text x={sx(lwy)} y={sy(lwx) - 4} fontFamily={mono} fontSize={8} fontWeight={changed ? 700 : 400}
                  fill={changed ? C.amber : color} textAnchor="middle">
                  {lm} {(landmarksIn[lm] ?? 0).toFixed(1)}&quot;
                </text>
              </g>
            );
          })}

          {/* ── Fixed routing anchors ── */}
          {Object.keys(DEFAULT_POSITIONS).filter(id => !DRAGGABLE_IDS.has(id)).map(id => {
            const p = pos[id];
            return (
              <g key={id}>
                <rect x={sx(p.y) - 2.5} y={sy(p.x) - 2.5} width={5} height={5} fill={C.muted} />
                <text x={sx(p.y)} y={sy(p.x) - 5} fontFamily="Arial" fontSize={5.5} fill={C.muted} textAnchor="middle">{id}</text>
              </g>
            );
          })}

          {/* ── Draggable component nodes ── */}
          {DRAGGABLE.map(({ id, label }) => {
            const p = pos[id];
            const isMoved = moved.has(id);
            const isDragging = dragId === id;
            const stroke = isDragging || isMoved ? C.amber : C.text;
            return (
              <g key={id} style={{ cursor: isDragging ? 'grabbing' : 'grab' }} onPointerDown={handleDown(id)}>
                <rect x={sx(p.y) - 7} y={sy(p.x) - 7} width={14} height={14}
                  fill={C.panel} stroke={stroke} strokeWidth={2}>
                  <title>{`${label} — x ${p.x.toFixed(2)}m, y ${p.y.toFixed(2)}m, z ${p.z.toFixed(2)}m (twin coords)`}</title>
                </rect>
                <text x={sx(p.y)} y={sy(p.x) + 16} fontFamily="Arial" fontSize={7} fontWeight={700}
                  letterSpacing={0.5} fill={stroke} textAnchor="middle" style={{ pointerEvents: 'none' }}>
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── Side readout: what moved, what re-gauged, cost delta ── */}
      <div style={{ width: 268, flexShrink: 0, borderLeft: `2px solid ${C.border}`, padding: '6px 8px', overflowY: 'auto' }}>
        <div style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1, color: C.label, borderBottom: `2px solid ${C.border}`, paddingBottom: 3, marginBottom: 5 }}>
          POSITION REFLOW vs DIGITAL TWIN
        </div>

        <div style={{ fontFamily: mono, fontSize: 9, color: C.text, marginBottom: 6 }}>
          <div>MOVED NODES: {moved.size === 0 ? 'none (twin positions)' : [...moved].join(', ')}</div>
          <div style={{ color: lenDelta === 0 ? C.muted : lenDelta > 0 ? C.amber : C.green }}>
            TOTAL LENGTH Δ {lenDelta > 0 ? '+' : ''}{lenDelta.toFixed(1)} ft ({baseline.totalLengthFt.toFixed(1)} → {harness.totalLengthFt.toFixed(1)})
          </div>
          <div style={{ color: costDelta === 0 ? C.muted : costDelta > 0 ? C.amber : C.green }}>
            CONDUCTOR COST Δ {costDelta > 0 ? '+' : ''}${costDelta.toFixed(2)} (${baseline.costUsd.toFixed(2)} → ${harness.costUsd.toFixed(2)})
          </div>
        </div>

        {gaugeChanges.length > 0 && (
          <div style={{ border: `2px solid ${C.amber}`, padding: '4px 6px', marginBottom: 6 }}>
            <div style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: C.amber, marginBottom: 3 }}>
              GAUGE CHANGES — VDROP DOCTRINE ({gaugeChanges.length})
            </div>
            {gaugeChanges.map(({ wire, base }) => (
              <div key={wire.id} style={{ fontFamily: mono, fontSize: 8.5, color: C.amber, marginBottom: 2 }}>
                #{wire.id} {wire.label}: {(base.lengthFt * 12).toFixed(1)}&quot; → {(wire.lengthFt * 12).toFixed(1)}&quot;, {base.effectiveGauge} AWG → {wire.effectiveGauge} AWG
              </div>
            ))}
          </div>
        )}

        <div style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: C.label, marginBottom: 3 }}>
          LENGTH CHANGES ({diffs.length})
        </div>
        {diffs.length === 0 && (
          <div style={{ fontFamily: mono, fontSize: 8.5, color: C.muted }}>
            — drag a node to see wires reflow —
          </div>
        )}
        {diffs.slice(0, 60).map(({ wire, base, gaugeChanged }) => (
          <div key={wire.id} style={{ fontFamily: mono, fontSize: 8.5, color: gaugeChanged ? C.amber : C.text, marginBottom: 1 }}>
            #{wire.id} {wire.label.slice(0, 22)}: {base.lengthFt.toFixed(2)} → {wire.lengthFt.toFixed(2)} ft
          </div>
        ))}
        {diffs.length > 60 && (
          <div style={{ fontFamily: mono, fontSize: 8.5, color: C.muted }}>… +{diffs.length - 60} more</div>
        )}
      </div>
    </div>
  );
}

export default PlanView2D;
