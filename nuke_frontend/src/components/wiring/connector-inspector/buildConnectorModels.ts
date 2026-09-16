// connector-inspector/buildConnectorModels.ts — pure projection:
// DerivedHarness → four ConnectorModels (FIREWALL / M130A / M130B / PDM30).
// Built ONCE per derivation; every skin renders the same objects.
//
// Geometry sources (reused, not re-derived):
//   - D38999 25-61 cavity coords + order: harnessDerivation.ts exports
//     (MILNEC insert arrangement p. B-22, image coords center 520,610 r360,
//     mirror-X = engine-side mating face — identical transform to
//     ConnectorFaces.tsx D38999Face)
//   - Superseal staggered grids 9/8/8/9 + 7/6/6/7, PDM30 pin→function maps,
//     function-group classification + palette: ConnectorFaces.tsx exports

import {
  D38999_CAV_ORDER, D38999_CAV_XY,
  type DerivedHarness, type DerivedWire,
} from '../harnessDerivation';
import {
  groupOf, PDM_A_PIN, PDM_B_PIN, SUPERSEAL_ROWS_34, SUPERSEAL_ROWS_26,
} from '../ConnectorFaces';
import type { ConnectorId, ConnectorModel, InspectorCavity, Outline } from './types';

// ── FIREWALL — D38999 25-61, engine-side mating face ───────────────────
function buildFirewall(harness: DerivedHarness): ConnectorModel {
  const VIEW = 820;
  const cx = VIEW / 2, cy = VIEW / 2;
  const R = 330;             // insert radius in view units
  const sc = R / 360;        // image-coord radius 360 → R
  const r = 27;              // cavity radius (#20 contacts, uniform)

  const cavities: InspectorCavity[] = D38999_CAV_ORDER.map((cav, i) => {
    const [ix, iy] = D38999_CAV_XY[cav];
    const x = cx - (ix - 520) * sc; // MIRROR X — engine-side view
    const y = cy + (iy - 610) * sc;
    const wire = harness.bulkhead.cavities[i]?.wire || null;
    return {
      key: cav,
      label: cav,
      x, y, r,
      wires: wire ? [wire] : [],
      group: wire ? groupOf(wire) : 'spare',
      conflict: !!wire?.gaugeChangedFromSpec,
    };
  });

  const outlines: Outline[] = [
    { kind: 'circle', cx, cy, r: R + 38, width: 4 },                       // shell
    { kind: 'circle', cx, cy, r: R + 10, width: 2 },                       // insert
    { kind: 'rect', x: cx - 18, y: cy - R - 38 - 24, w: 36, h: 22, width: 3 }, // master keyway, 12 o'clock
  ];

  const used = cavities.filter(c => c.wires.length > 0).length;
  return {
    id: 'FIREWALL',
    title: 'FIREWALL BULKHEAD — D38999 25-61',
    subTitle: 'ENGINE-SIDE MATING FACE — D38999/24WJ61SN RECEPTACLE + /26WJ61PN PLUG, #20 CONTACTS (20-24 AWG)',
    viewW: VIEW, viewH: VIEW,
    cavities,
    overflow: harness.bulkhead.overflow,
    directFeed: harness.bulkhead.directFeed,
    usedCount: used,
    totalCount: 61,
    outlines,
  };
}

// ── Superseal staggered grid geometry (shared by M130 A/B + PDM30) ─────
const CELL = 64, GAP = 14, PAD_X = 28, PAD_TOP = 74;

interface GridPin { pin: number; x: number; y: number }

function gridGeometry(rows: number[]): { pins: GridPin[]; w: number; h: number } {
  const maxCols = Math.max(...rows);
  const gw = maxCols * CELL + (maxCols - 1) * GAP;
  const pins: GridPin[] = [];
  let pinNum = 0;
  rows.forEach((nCols, rIdx) => {
    const off = (maxCols - nCols) * (CELL + GAP) / 2;
    for (let col = 0; col < nCols; col++) {
      pinNum += 1;
      pins.push({
        pin: pinNum,
        x: PAD_X + off + col * (CELL + GAP) + CELL / 2,
        y: PAD_TOP + rIdx * (CELL + GAP) + CELL / 2,
      });
    }
  });
  const gh = rows.length * (CELL + GAP) - GAP;
  return { pins, w: gw + PAD_X * 2, h: PAD_TOP + gh + 26 };
}

function gridOutlines(w: number, h: number, dx = 0, dy = 0): Outline[] {
  return [
    { kind: 'rect', x: dx + 8, y: dy + 36, w: w - 16, h: h - 36 - 14, width: 4 },  // housing
    { kind: 'rect', x: dx + w / 2 - 42, y: dy + 12, w: 84, h: 26, width: 2 },      // KEY 1 tab
    { kind: 'text', x: dx + w / 2, y: dy + 31, text: 'KEY 1', size: 15 },
  ];
}

// ── M130 A / B — wires keyed off fromPin 'M130:A04' ────────────────────
function buildM130(harness: DerivedHarness, conn: 'A' | 'B'): ConnectorModel {
  const pinWires = new Map<string, DerivedWire>();
  for (const w of harness.wires) {
    const m = /^M130:([AB])(\d+)/i.exec(w.fromPin);
    if (m) pinWires.set(`${m[1].toUpperCase()}${parseInt(m[2], 10)}`, w);
  }
  const rows = conn === 'A' ? SUPERSEAL_ROWS_34 : SUPERSEAL_ROWS_26;
  const { pins, w, h } = gridGeometry(rows);

  const cavities: InspectorCavity[] = pins.map(p => {
    const wire = pinWires.get(`${conn}${p.pin}`) || null;
    return {
      key: `${conn}${String(p.pin).padStart(2, '0')}`,
      label: String(p.pin),
      x: p.x, y: p.y, r: CELL / 2 - 3,
      wires: wire ? [wire] : [],
      group: wire ? groupOf(wire) : 'spare',
      conflict: !!wire?.gaugeChangedFromSpec,
    };
  });

  const used = cavities.filter(c => c.wires.length > 0).length;
  return {
    id: conn === 'A' ? 'M130A' : 'M130B',
    title: `M130 CONN ${conn} — ${rows.reduce((s, n) => s + n, 0)}W SUPERSEAL`,
    subTitle: conn === 'A' ? 'TE 4-1437290-0 / MoTeC #65044' : 'TE 3-1437290-7 / MoTeC #65045',
    viewW: w, viewH: h,
    cavities,
    overflow: [], directFeed: [],
    usedCount: used,
    totalCount: pins.length,
    outlines: gridOutlines(w, h),
  };
}

// ── PDM30 — CONN A above CONN B, pin→function from the datasheet map ───
function buildPdm30(harness: DerivedHarness): ConnectorModel {
  const wireById = new Map(harness.wires.map(w => [w.id, w]));
  const liveOuts = new Set(harness.pdm.filter(c => c.devices.length > 0).map(c => c.channel));
  const freedOuts = new Set(harness.freedChannels);
  const chWires = (ch: number): DerivedWire[] =>
    (harness.pdm.find(c => c.channel === ch)?.wireIds || [])
      .map(id => wireById.get(id))
      .filter((w): w is DerivedWire => !!w);

  const a = gridGeometry(SUPERSEAL_ROWS_34);
  const b = gridGeometry(SUPERSEAL_ROWS_26);
  const bDx = (a.w - b.w) / 2;     // center the narrower B housing under A
  const bDy = a.h + 46;

  const makePin = (connLabel: 'A' | 'B', p: GridPin, dx: number, dy: number): InspectorCavity => {
    const fn = (connLabel === 'A' ? PDM_A_PIN : PDM_B_PIN)[p.pin] || '';
    let wires: DerivedWire[] = [];
    let pdmState: InspectorCavity['pdmState'] = 'spare';
    let group: InspectorCavity['group'] = 'spare';
    if (fn.startsWith('OUT')) {
      const ch = parseInt(fn.slice(3), 10);
      wires = chWires(ch);
      if (liveOuts.has(ch)) { pdmState = 'live'; group = 'power'; }
      else if (freedOuts.has(ch)) { pdmState = 'freed'; group = 'can'; }
    } else if (fn.startsWith('CAN')) {
      pdmState = 'live'; group = 'can';
    } else if (fn === 'GND' || fn.startsWith('VBAT')) {
      pdmState = 'live'; group = 'sensor';
    }
    return {
      key: `${connLabel}${String(p.pin).padStart(2, '0')}`,
      label: String(p.pin),
      x: p.x + dx, y: p.y + dy, r: CELL / 2 - 3,
      funcLabel: fn || undefined,
      wires,
      group,
      conflict: wires.some(w => w.gaugeChangedFromSpec),
      pdmState,
    };
  };

  const cavities: InspectorCavity[] = [
    ...a.pins.map(p => makePin('A', p, 0, 0)),
    ...b.pins.map(p => makePin('B', p, bDx, bDy)),
  ];

  const outlines: Outline[] = [
    ...gridOutlines(a.w, a.h),
    { kind: 'text', x: a.w / 2, y: a.h + 14, text: 'CONN A (A1-A34) — 20A OUTS PAIRED PINS', size: 17 },
    ...gridOutlines(b.w, b.h, bDx, bDy),
    { kind: 'text', x: a.w / 2, y: bDy + b.h + 14, text: 'CONN B (B1-B26) — + C1 M6 STUD VBATT+', size: 17 },
  ];

  const used = cavities.filter(c => c.pdmState === 'live').length;
  return {
    id: 'PDM30',
    title: 'PDM30 — CONN A (34W) + CONN B (26W) SUPERSEAL',
    subTitle: 'PDM30 DATASHEET PART 14103 — OUT1-8 = 20A DUAL-PIN, OUT9-30 = 8A; + C1 M6 STUD VBATT+',
    viewW: a.w, viewH: bDy + b.h + 26,
    cavities,
    overflow: [], directFeed: [],
    usedCount: used,
    totalCount: cavities.length,
    outlines,
  };
}

export function buildConnectorModels(harness: DerivedHarness): Record<ConnectorId, ConnectorModel> {
  return {
    FIREWALL: buildFirewall(harness),
    M130A: buildM130(harness, 'A'),
    M130B: buildM130(harness, 'B'),
    PDM30: buildPdm30(harness),
  };
}
