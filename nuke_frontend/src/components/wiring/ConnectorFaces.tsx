// ConnectorFaces.tsx — live SVG connector face drawings for the Harness Workbench.
// Geometry ported from scripts/generate_connector_build_sheets.py:
//   - D38999 25-61 cavity coordinates (MILNEC insert-arrangement p. B-22, mirrored X
//     for the engine-side view of the socket-insert receptacle)
//   - Tyco Superseal 1.0 staggered grids: 34-pos = 9/8/8/9, 26-pos = 7/6/6/7
//   - title-block framing style
// Fill states update live from the derivation: assigned = function-group color,
// overflow pressure = orange, spare = gray.

import React from 'react';
import {
  D38999_CAV_ORDER, D38999_CAV_XY,
  type DerivedHarness, type DerivedWire,
} from './harnessDerivation';

// function-group fills (same palette as the python build sheets)
// Exported for the Connector Inspector skins (connector-inspector/*) — single
// source for group classification + palette + Superseal grids + PDM pin maps.
export const FILL = {
  sensor: '#BBD3EE',   // sensors + supplies
  drive: '#F2BBBB',    // coil / injector / actuator drives
  power: '#F8D9A8',    // PDM-fed power & lighting
  can: '#BFEAEF',      // CAN
  spare: '#3a3a55',    // spare (dark-theme gray)
  overflow: '#E67300', // orange — overflow / unresolved
} as const;

const INK = '#1A1A1A';
const C = {
  text: '#e0e0e8',
  label: '#a0a0b0',
  muted: '#666680',
  border: '#333355',
  stroke: '#8888aa',
  orange: '#E67300',
} as const;

export type FunctionGroup = 'sensor' | 'drive' | 'power' | 'can';

// Group classification extracted from groupFill so the Connector Inspector can
// reuse the NAME, not just the color. 'h_bridge' added: cut-list v4 registry
// tags ETB TAC motors signal_type=h_bridge_motor — actuator drives per the
// python build-sheet palette ("coil / injector / actuator drives").
export function groupOf(w: DerivedWire): FunctionGroup {
  const st = (w.signalType || '').toLowerCase();
  const from = (w.fromPin || '').toUpperCase();
  if (st.includes('can')) return 'can';
  if (st.includes('injector') || st.includes('ignition') || st.includes('coil') || st.includes('drive') || st.includes('half_bridge') || st.includes('h_bridge')) return 'drive';
  if (from.startsWith('PDM')) return 'power';
  return 'sensor';
}

function groupFill(w: DerivedWire): string {
  return FILL[groupOf(w)];
}

// Tyco Superseal 1.0 staggered grids (generate_connector_build_sheets.py)
export const SUPERSEAL_ROWS_34: number[] = [9, 8, 8, 9];
export const SUPERSEAL_ROWS_26: number[] = [7, 6, 6, 7];

// ── D38999 61-way face ─────────────────────────────────────────────────
function D38999Face({ harness }: { harness: DerivedHarness }) {
  // image coords: center (520,610) r=360 → scale into a 300x300 view, mirror X
  const VB = 320;
  const cx = VB / 2, cy = VB / 2, R = 128;
  const sc = R / 360;
  const used = harness.bulkhead.cavities.filter(c => c.wire).length;
  const overflowN = harness.bulkhead.overflow.length;

  return (
    <svg viewBox={`0 0 ${VB} ${VB + 26}`} style={{ width: '100%', display: 'block' }}>
      {/* shell + insert */}
      <circle cx={cx} cy={cy} r={R + 12} fill="none" stroke={C.stroke} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={R + 1} fill="none" stroke={C.border} strokeWidth={1} />
      {/* master keyway at 12 o'clock */}
      <rect x={cx - 7} y={cy - R - 21} width={14} height={9} fill="none" stroke={C.stroke} strokeWidth={1.5} />
      {D38999_CAV_ORDER.map((cav, i) => {
        const [ix, iy] = D38999_CAV_XY[cav];
        const x = cx - (ix - 520) * sc; // MIRROR X — engine-side view
        const y = cy + (iy - 610) * sc;
        const assignment = harness.bulkhead.cavities[i];
        const wire = assignment?.wire || null;
        const fill = wire ? groupFill(wire) : FILL.spare;
        return (
          <g key={cav}>
            <circle cx={x} cy={y} r={8.6} fill={fill} stroke={wire ? INK : C.border} strokeWidth={0.8}>
              <title>{wire ? `${cav}: #${wire.id} ${wire.label} (${wire.gauge} AWG ${wire.color})` : `${cav}: SPARE`}</title>
            </circle>
            <text x={x} y={y + 2.6} fontFamily="'Courier New', monospace" fontSize={cav.length === 1 ? 7 : 6}
              fontWeight={wire ? 700 : 400} fill={wire ? INK : C.muted} textAnchor="middle">
              {cav}
            </text>
          </g>
        );
      })}
      <text x={cx} y={VB + 8} fontFamily="Arial" fontSize={8} fontWeight={700} letterSpacing={0.5} fill={C.label} textAnchor="middle">
        FIREWALL BULKHEAD — D38999 25-61 (ENGINE-SIDE MATING FACE)
      </text>
      <text x={cx} y={VB + 19} fontFamily="'Courier New', monospace" fontSize={8} fontWeight={700}
        fill={overflowN > 0 ? C.orange : C.label} textAnchor="middle">
        {used}/61 USED — {61 - used} SPARE{overflowN > 0 ? ` — ${overflowN} OVERFLOW` : ''}
      </text>
    </svg>
  );
}

// ── Superseal staggered-grid face (M130 A/B + PDM30 A/B) ──────────────
interface SupersealProps {
  rowsLayout: number[];                  // [9,8,8,9] or [7,6,6,7]
  label: string;
  subLabel: string;
  pinFill: (pin: number) => { fill: string; used: boolean; tooltip: string };
}

function SupersealFace({ rowsLayout, label, subLabel, pinFill }: SupersealProps) {
  const cell = 26, gap = 5;
  const maxCols = Math.max(...rowsLayout);
  const gw = maxCols * cell + (maxCols - 1) * gap;
  const gh = rowsLayout.length * (cell + gap) - gap;
  const pad = 14;
  const W = gw + pad * 2;
  const H = gh + pad * 2 + 40;

  let pinNum = 0;
  const circles: React.ReactNode[] = [];
  rowsLayout.forEach((nCols, r) => {
    const off = (maxCols - nCols) * (cell + gap) / 2;
    for (let col = 0; col < nCols; col++) {
      pinNum += 1;
      const pin = pinNum;
      const px = pad + off + col * (cell + gap) + cell / 2;
      const py = pad + 18 + r * (cell + gap) + cell / 2;
      const { fill, used, tooltip } = pinFill(pin);
      circles.push(
        <g key={pin}>
          <circle cx={px} cy={py} r={cell / 2} fill={fill} stroke={used ? INK : C.border} strokeWidth={0.8}>
            <title>{tooltip}</title>
          </circle>
          <text x={px} y={py + 3} fontFamily="'Courier New', monospace" fontSize={8}
            fontWeight={used ? 700 : 400} fill={used ? INK : C.muted} textAnchor="middle">
            {pin}
          </text>
        </g>,
      );
    }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {/* housing + KEY 1 */}
      <rect x={4} y={16} width={W - 8} height={gh + pad + 12} fill="none" stroke={C.stroke} strokeWidth={2} />
      <rect x={W / 2 - 16} y={8} width={32} height={9} fill="none" stroke={C.stroke} strokeWidth={1} />
      <text x={W / 2} y={15} fontFamily="Arial" fontSize={6} fill={C.muted} textAnchor="middle">KEY 1</text>
      {circles}
      <text x={W / 2} y={H - 14} fontFamily="Arial" fontSize={8} fontWeight={700} letterSpacing={0.5} fill={C.label} textAnchor="middle">
        {label}
      </text>
      <text x={W / 2} y={H - 4} fontFamily="'Courier New', monospace" fontSize={7} fill={C.muted} textAnchor="middle">
        {subLabel}
      </text>
    </svg>
  );
}

// ── PDM30 pin → function maps (PDM30 datasheet Part 14103 via
//    CONNECTOR_DATA_REPORT 2.5; transcribed in generate_connector_build_sheets.py)
export const PDM_A_PIN: Record<number, string> = {
  1: 'OUT1', 2: 'OUT9', 3: 'OUT2', 4: 'OUT10', 5: 'OUT3', 6: 'OUT11', 7: 'OUT4',
  8: 'OUT12', 9: 'OUT5', 10: 'OUT1', 11: 'OUT13', 12: 'OUT2', 13: 'OUT14',
  14: 'OUT3', 15: 'OUT15', 16: 'OUT4', 17: 'OUT5', 18: 'OUT16', 19: 'DIG2',
  20: 'OUT17', 21: 'DIG4', 22: 'OUT18', 23: 'DIG7', 24: 'OUT19', 25: 'OUT20',
  26: 'VBAT-', 27: 'DIG1', 28: 'GND', 29: 'DIG3', 30: 'DIG5', 31: 'DIG6',
  32: 'DIG8', 33: 'DIG9', 34: 'DIG10',
};
export const PDM_B_PIN: Record<number, string> = {
  1: 'OUT21', 2: 'OUT22', 3: 'OUT6', 4: 'OUT23', 5: 'OUT7', 6: 'OUT24', 7: 'OUT8',
  8: 'OUT25', 9: 'OUT6', 10: 'OUT26', 11: 'OUT7', 12: 'OUT27', 13: 'OUT8',
  14: 'OUT28', 15: 'DIG13', 16: 'OUT29', 17: 'DIG15', 18: 'VBAT-', 19: 'OUT30',
  20: 'DIG11', 21: 'DIG12', 22: 'GND', 23: 'DIG14', 24: 'DIG16', 25: 'CANLO',
  26: 'CANHI',
};

// ── Container ──────────────────────────────────────────────────────────
export function ConnectorFaces({ harness }: { harness: DerivedHarness }) {
  // M130 pin usage from active wires (fromPin like "M130:B04" / "ECU")
  const m130Pins = new Map<string, DerivedWire>();
  for (const w of harness.wires) {
    const m = /^M130:([AB])(\d+)/i.exec(w.fromPin);
    if (m) m130Pins.set(`${m[1].toUpperCase()}${parseInt(m[2], 10)}`, w);
  }

  // PDM channel usage from the live channel table
  const liveOuts = new Set(harness.pdm.filter(c => c.devices.length > 0).map(c => `OUT${c.channel}`));
  const freedOuts = new Set(harness.freedChannels.map(ch => `OUT${ch}`));

  const m130Fill = (conn: 'A' | 'B') => (pin: number) => {
    const w = m130Pins.get(`${conn}${pin}`);
    if (!w) return { fill: FILL.spare, used: false, tooltip: `${conn}${String(pin).padStart(2, '0')}: no wire` };
    return { fill: groupFill(w), used: true, tooltip: `${conn}${String(pin).padStart(2, '0')}: #${w.id} ${w.label}` };
  };

  const pdmFill = (map: Record<number, string>) => (pin: number) => {
    const fn = map[pin] || '';
    if (fn.startsWith('OUT')) {
      if (liveOuts.has(fn)) return { fill: FILL.power, used: true, tooltip: `${fn} — live` };
      if (freedOuts.has(fn)) return { fill: FILL.can, used: true, tooltip: `${fn} — FREED by toggles` };
      return { fill: FILL.spare, used: false, tooltip: `${fn} — spare` };
    }
    if (fn.startsWith('CAN')) return { fill: FILL.can, used: true, tooltip: fn };
    if (fn.startsWith('DIG')) return { fill: FILL.spare, used: false, tooltip: `${fn} — no discrete switch wires (keypad is CAN)` };
    return { fill: FILL.sensor, used: true, tooltip: fn }; // VBAT- / GND
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 10 }}>
      <SectionLabel>CONNECTOR FACES — LIVE FILL</SectionLabel>
      <D38999Face harness={harness} />
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SupersealFace
            rowsLayout={[9, 8, 8, 9]}
            label="M130 CONN A — 34W SUPERSEAL"
            subLabel="TE 4-1437290-0 / MoTeC #65044"
            pinFill={m130Fill('A')}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SupersealFace
            rowsLayout={[7, 6, 6, 7]}
            label="M130 CONN B — 26W SUPERSEAL"
            subLabel="TE 3-1437290-7 / MoTeC #65045"
            pinFill={m130Fill('B')}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SupersealFace
            rowsLayout={[9, 8, 8, 9]}
            label="PDM30 CONN A (A1-A34)"
            subLabel="20A OUTS PAIRED PINS"
            pinFill={pdmFill(PDM_A_PIN)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <SupersealFace
            rowsLayout={[7, 6, 6, 7]}
            label="PDM30 CONN B (B1-B26)"
            subLabel="+ C1 M6 STUD VBATT+"
            pinFill={pdmFill(PDM_B_PIN)}
          />
        </div>
      </div>
      {/* legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {([
          ['SENSOR/SIG', FILL.sensor], ['DRIVE', FILL.drive], ['POWER', FILL.power],
          ['CAN/FREED', FILL.can], ['SPARE', FILL.spare], ['OVERFLOW', FILL.overflow],
        ] as const).map(([lbl, col]) => (
          <span key={lbl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, background: col, border: `1px solid ${C.border}`, display: 'inline-block' }} />
            <span style={{ fontFamily: 'Arial', fontSize: 7, fontWeight: 700, letterSpacing: 0.5, color: C.muted }}>{lbl}</span>
          </span>
        ))}
      </div>
      {/* overflow block — orange, mirrors the build-sheet OVERFLOW panel */}
      {harness.bulkhead.overflow.length > 0 && (
        <div style={{ border: `2px solid ${C.orange}`, padding: '6px 8px' }}>
          <div style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: C.orange, marginBottom: 4 }}>
            OVERFLOW — CROSSES FIREWALL, NO CAVITY ({harness.bulkhead.overflow.length})
          </div>
          {harness.bulkhead.overflow.map(w => (
            <div key={w.id} style={{ fontFamily: "'Courier New', monospace", fontSize: 8, color: C.orange }}>
              #{w.id} {w.label}
            </div>
          ))}
        </div>
      )}
      {/* direct-feed block */}
      {harness.bulkhead.directFeed.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, padding: '6px 8px' }}>
          <div style={{ fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: C.label, marginBottom: 4 }}>
            DOES NOT PASS BULKHEAD — DIRECT FEED ({harness.bulkhead.directFeed.length})
          </div>
          {harness.bulkhead.directFeed.map(w => (
            <div key={w.id} style={{ fontFamily: "'Courier New', monospace", fontSize: 8, color: C.muted }}>
              #{w.id} {w.gauge} AWG {w.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Arial', fontSize: 8, fontWeight: 700, letterSpacing: 1,
      color: '#a0a0b0', textTransform: 'uppercase',
      borderBottom: '2px solid #333355', paddingBottom: 4,
    }}>
      {children}
    </div>
  );
}
