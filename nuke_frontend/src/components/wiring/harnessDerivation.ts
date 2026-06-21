// harnessDerivation.ts — PURE derivation engine for the K5 harness.
// The harness is DERIVED, not designed: toggle subsystems and everything
// downstream recalculates. Synchronous, no network, no async.
//
// This file replaced the placeholder (which wrapped computeOverlay) wholesale,
// keeping the contract surface the HarnessWorkbench components consume:
// deriveHarness, SUBSYSTEMS, MECHANICAL_GAUGES_ID, D38999_CAV_ORDER/XY, types.
//
// This is the CORRECTED engine: it carries companion-wire expansion per
// DOC-05 (docs/wiring/chapters/05-build-manifest.md), which no prior compute
// engine implemented — overlayCompute.ts / wiringCompute.ts / generate-cut-list
// all emit 1 wire per device (contradiction C1 in
// docs/wiring/calc-data/rules_extracted.md). Do NOT "fix" this module to match
// them; they undercount wires, terminals, and lengths by roughly 2-4x.
//
// SOURCES (ported faithfully, deviations noted inline):
//   scripts/k5_harness_calc.py — toggle logic, cross-dependency keeps, gauge
//     audit formula, PDM ratings, ProWire price table, bundle OD math
//   docs/wiring/calc-data/rules_extracted.md — DOC-05 companion expansion
//     (analog_5v=3, analog_temp=2, ecu_crank_cam=3 shielded, piezoelectric=2
//     shielded, logic_coil_drive=4 via rails, h_bridge_motor=6) and gauge
//     doctrine (3% Vdrop @ 12V, x1.25 on ALL loads, x2 round trip — the
//     SERVER version; the client motor-only variant is contradiction C2)
//   scripts/generate_connector_build_sheets.py — D38999 bulkhead cavity
//     allocation rules R1-R6 (seed order, gauge gate, function-grouped
//     nearest-free fills, overflow detection, direct-feed block)
//   docs/wiring/calc-data/subsystems.json   → k5Subsystems.ts
//   docs/wiring/output/K5_landmarks_blender_derived.yaml +
//   docs/wiring/output/K5_wire_paths.yaml +
//   docs/wiring/output/K5_cut_list_v4.txt   → k5LandmarkPaths.ts

import type { ManifestDevice } from './overlayCompute';
import { K5_SUBSYSTEMS, V4_WIRE_SUBSYSTEMS, MECHANICAL_GAUGES_NOTE } from './k5Subsystems';
import {
  LANDMARKS_IN, WIRE_PATHS, WIRE_REGISTRY,
  DEFAULT_POSITIONS, LANDMARK_WAYPOINTS, landmarkLengthsIn, landmarksAnchoredTo,
  type RegistryWire, type WirePath, type ComponentPositions, type LandmarkWaypointPath,
} from './k5LandmarkPaths';

// Re-export the positional contract surface (PlanView2D consumes these here).
export { DEFAULT_POSITIONS, LANDMARK_WAYPOINTS, landmarksAnchoredTo };
export type { ComponentPositions, LandmarkWaypointPath };

// ── Contract types ──────────────────────────────────────────────────

export interface DerivationInput {
  devices: ManifestDevice[];
  toggles: Record<string, boolean>;
  mechanicalGauges?: boolean;
  // Optional digital-twin component positions (meters, x driver+, y front−,
  // z up+). When provided, landmark lengths anchored to these nodes are
  // recomputed via computeLandmarksIn() and everything downstream (lengthFt,
  // gauge via Vdrop, cost, bundle OD) reflows. Omitted = baked twin values.
  positions?: ComponentPositions;
}

export interface DerivedWire {
  id: string;
  label: string;
  subsystem: string;
  fromPin: string;
  toDest: string;
  signalType: string;
  gauge: number;          // cut-list registry gauge (as documented)
  // Gauge after the Vdrop doctrine audit at the DERIVED length: when the wire
  // has known device amps and the registry gauge fails 3%@12V / 1.25x ampacity,
  // this is the smallest passing gauge; otherwise equals `gauge`. Footage,
  // cost and bundle OD are computed from this so they reflow with positions.
  effectiveGauge: number;
  // true iff effectiveGauge !== gauge — the derived gauge diverged from the
  // cut-list spec at the derived length. UI highlights these rows.
  gaugeChangedFromSpec: boolean;
  // true iff a supplied position moved a battery-anchored landmark (L14/L15
  // power spine) under this wire's path — battery-class lengths re-derived.
  powerSpineAffected: boolean;
  color: string;
  spec: string;
  lengthFt: number;
  lengthMethod: 'landmark_derived' | 'landmark_derived_parent' | 'cutlist_estimate';
  companions: string[];
}

export interface PdmChannel {
  channel: number;
  rating: number; // MoTeC PDM manual p39 (VALIDATED): OUT1-8 = 20A dual-pin, OUT9-30 = 8A
  label: string;
  devices: string[];
  loadAmps: number;
  subsystem: string;
  wireIds: string[];
  overloaded: boolean;
}

export interface CavityAssignment {
  cavity: string;                     // D38999 25-61 designator (A..Z, a..z, AA..PP)
  wire: DerivedWire | null;           // null = spare (seal plug)
  source: 'seed' | 'fill' | null;     // R1 seed vs R3 fill
}

export interface DerivedHarness {
  wires: DerivedWire[];
  pdm: PdmChannel[];
  freedChannels: number[];
  bulkhead: {
    cavities: CavityAssignment[];     // all 61, aligned to D38999_CAV_ORDER
    overflow: DerivedWire[];          // R6: crossing, gauge-OK, no cavity
    directFeed: DerivedWire[];        // R2: crossing but outside 20-24 AWG / battery-class
  };
  budget: {
    nameplateAmps: number;
    alternatorRequired: number;
    warnings: string[];
  };
  byGauge: Record<string, number>;    // bare gauge → feet (UI chips)
  costUsd: number;
  // Extras beyond the minimum contract (ported from k5_harness_calc.py):
  bySpec: Record<string, number>;     // 'M22759/32-22' → feet (python report keys)
  droppedWireIds: string[];
  totalLengthFt: number;
  trunkOdIn: Record<string, number>;
  alternatorRecommendation: string;
}

// ── Subsystem registry surface for the workbench UI ─────────────────

export interface SubsystemDef {
  id: string;
  label: string;
  toggleable: boolean;
  nameplateAmps: number;
  deviceNames: string[];
}

export const MECHANICAL_GAUGES_ID = 'MECHANICAL_GAUGES';

const SUBSYSTEM_LABELS: Record<string, string> = {
  CORE_ENGINE: 'Core Engine (LS3/M130)', FUEL: 'Fuel', COOLING: 'Cooling',
  CHARGING_STARTING: 'Charging / Starting', BRAKES_IBOOSTER: 'Brakes (iBooster)',
  EPARKING_BRAKE: 'E-Parking Brake', TRANS_6L80E: 'Trans (6L80E/T43)',
  LIGHTING_EXTERIOR: 'Lighting Exterior', LIGHTING_INTERIOR: 'Lighting Interior',
  DOME_COURTESY: 'Dome / Courtesy', POWER_WINDOWS: 'Power Windows',
  POWER_LOCKS: 'Power Locks', AUDIO: 'Audio', HVAC_AC: 'HVAC / A/C',
  WIPERS_WASHER: 'Wipers / Washer', AMP_STEPS: 'AMP Power Steps',
  CAMERA_REAR: 'Rear Camera', DASH_CLUSTER_DAKOTA: 'Dash Cluster (Dakota VHX)',
  ACCESSORY_12V: '12V Accessory', EXHAUST_CUTOUTS_QTP: 'Exhaust Cutouts (QTP)',
  HARNESS_INFRA: 'Harness Infrastructure',
};

export const SUBSYSTEMS: SubsystemDef[] = Object.entries(K5_SUBSYSTEMS).map(([id, s]) => ({
  id,
  label: SUBSYSTEM_LABELS[id] || id,
  toggleable: s.toggleable,
  nameplateAmps: s.totalAmps,
  deviceNames: s.devices,
}));

// ── Rule constants (SERVER wiringCompute.ts — doctrine version) ─────
// DOC-06: 3% max drop @ 12V = 0.36V allowance; +25% safety on ALL loads
// (server behavior; client motor-only is contradiction C2); x2 round trip.
const VDROP_PCT = 3.0;
const SYS_V = 12.0;
const SAFETY = 1.25;
const ROUND_TRIP = 2.0;

// AWG table: ohms/ft @20C, ampacity (chassis wiring, enclosed bundle).
// Identical constants in harnessConstants.ts, wiringCompute.ts, generate-cut-list.
const AWG: Record<number, { ohmsPerFt: number; maxAmps: number }> = {
  22: { ohmsPerFt: 0.01614, maxAmps: 5 },
  20: { ohmsPerFt: 0.01015, maxAmps: 7.5 },
  18: { ohmsPerFt: 0.00639, maxAmps: 10 },
  16: { ohmsPerFt: 0.00402, maxAmps: 15 },
  14: { ohmsPerFt: 0.00253, maxAmps: 20 },
  12: { ohmsPerFt: 0.00159, maxAmps: 25 },
  10: { ohmsPerFt: 0.001, maxAmps: 35 },
  8: { ohmsPerFt: 0.000628, maxAmps: 50 },
  6: { ohmsPerFt: 0.000395, maxAmps: 65 },
  4: { ohmsPerFt: 0.000249, maxAmps: 85 },
  2: { ohmsPerFt: 0.000156, maxAmps: 115 },
  0: { ohmsPerFt: 0.0000983, maxAmps: 150 },
};

// Length allowances — scripts/compute_wire_lengths.py (established constants)
const SERVICE_LOOP_IN = 12;
const SHIELD_IN = 6;
const DOOR_IN = 6;
const BEND_LIGHT = 1.05; // lighter than 12 AWG
const BEND_HEAVY = 1.1;  // 12 AWG and heavier

// PDM30 channel ratings — VALIDATED against MoTeC PDM manual p39:
// OUT1-8 = 20A dual-pin (115A transient), OUT9-30 = 8A (60A transient).
// Server's 20/15/10 banding and harnessCalculations' variant are stale (C6).
const pdmRating = (ch: number): number => (ch <= 8 ? 20 : 8);

// ProWire catalog snapshot avg $/ft by (spec family | AWG) —
// docs/wiring/calc-data/prowire_index.md (catalog_parts, last scrape 2026-05-11).
const PRICE: Record<string, number> = {
  '/32|22': 0.41, '/32|20': 0.27, '/32|18': 0.48, '/32|16': 0.49,
  '/32|14': 0.84, '/32|12': 1.52, '/16|10': 2.01, '/16|8': 9.25,
  '/16|12': 1.0, '/16|14': 0.68, '/16|16': 0.47, '/16|18': 0.87,
  '/16|4': 10.5, '/16|2': 15.8, '/16|0': 15.8,
};

// M22759 nominal finished OD inches — published spec NOMINALS; verify
// against ProWire product pages before trusting bundle diameters.
const OD_IN: Record<number, number> = {
  22: 0.042, 20: 0.051, 18: 0.06, 16: 0.07, 14: 0.083, 12: 0.099,
  10: 0.142, 8: 0.18, 6: 0.22, 4: 0.275, 2: 0.34, 0: 0.415,
};
// Standard round-bundle packing approximation (engine-introduced; no doctrine
// rule exists — rules_extracted.md §11).
const BUNDLE_FILL = 0.65;

// Trunk classification by first path landmark (k5_harness_calc.py TRUNKS)
const TRUNKS: Record<string, string[]> = {
  ENGINE_LOOM: ['L01', 'L02'],
  DASH_LOOM: ['L17', 'L18', 'L19', 'L28'],
  REAR_LOOM: ['L24'],
  DOOR_L: ['L20'],
  DOOR_R: ['L22'],
  FRONT_LIGHTS: ['L14'],
  POWER: ['L15'],
  ROOF: ['L23'],
  FW_JUMP: ['L16'],
};

// DOC-05 signal-type → companion-wire expansion (the C1 correction).
// Suffixes: g = ground return (22 AWG BLK), r = 5V ref (22 AWG GRY),
// s = shield drain (bare). These are the MINIMUM doctrine companions; the
// cut list may carry extras (#99r — the 3-pin Metri-Pack CKP needs 5V).
const DOC05_COMPANIONS: Record<string, string[]> = {
  analog_5v: ['g', 'r'],     // 3 wires: signal + 5V ref + ground
  analog_temp: ['g'],        // 2 wires: signal + ground return
  ecu_crank_cam: ['g', 's'], // 3 wires shielded: signal + ground + drain
  piezoelectric: ['g', 's'], // 2 conductors + drain, shielded, no 5V
};
// Bus-rail companions (DOC-05): low_side_drive injectors share #INJ_PWR;
// logic_coil_drive coils share #COIL_PWR + #COIL_GND (the 4-wire coil rule
// = signal + shared power + grounds via the DEL-Stributor bracket rails).
const RAIL_COMPANIONS: Record<string, string[]> = {
  low_side_drive: ['INJ_PWR'],
  logic_coil_drive: ['COIL_PWR', 'COIL_GND'],
};

// ── D38999 bulkhead data (generate_connector_build_sheets.py) ───────
// 61-way, insert arrangement 25-61 (MIL-STD-1560), all #20 contacts.
// Shells: receptacle D38999/24WJ61SN + plug D38999/26WJ61PN; contacts
// M39029/56-351 / M39029/58-363 (CONNECTOR_DATA_REPORT.md verified PNs —
// the 2026-04-13 spec PN "D38999/26WA98SN" is MALFORMED, superseded).
// R2 GAUGE GATE: #20 contacts accept 20-24 AWG ONLY (18/16 AWG = oversized).
const CAVITY_GAUGES = new Set([20, 22, 24]);

// Insert-face coordinates transcribed from the MILNEC insert-arrangement
// drawing p. B-22 (front face of pin insert, image coords, center 520,610
// r360) — used for the R3 nearest-free-cavity metric and SVG rendering.
export const D38999_CAV_XY: Record<string, [number, number]> = {
  A: [642, 326], B: [708, 360], C: [758, 413], D: [800, 481], E: [821, 551],
  F: [832, 623], G: [818, 696], H: [780, 766], J: [737, 819], K: [682, 860],
  L: [622, 889], M: [526, 903], N: [432, 894], P: [362, 860], R: [306, 818],
  S: [262, 765], T: [231, 696], U: [219, 622], V: [222, 550], W: [244, 480],
  X: [284, 412], Y: [335, 366], Z: [400, 330],
  a: [470, 352], b: [573, 352], c: [628, 402], d: [690, 449], e: [734, 506],
  f: [750, 580], g: [756, 652], h: [728, 722], i: [674, 776], j: [614, 814],
  k: [524, 818], m: [434, 814], n: [370, 775], p: [326, 724], q: [294, 657],
  r: [294, 580], s: [310, 510], t: [352, 448], u: [414, 402], v: [526, 416],
  w: [616, 477], x: [666, 533], y: [680, 612], z: [654, 680],
  AA: [606, 731], BB: [526, 752], CC: [436, 732], DD: [390, 678], EE: [365, 608],
  FF: [378, 537], GG: [428, 482], HH: [526, 491], JJ: [584, 553], KK: [608, 622],
  LL: [526, 678], MM: [436, 623], NN: [454, 553], PP: [526, 598],
};

export const D38999_CAV_ORDER: string[] = [
  ...'ABCDEFGHJKLMNPRSTUVWXYZ'.split(''),
  ...'abcdefghijkmnpqrstuvwxyz'.split(''),
  'AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'JJ', 'KK', 'LL', 'MM', 'NN', 'PP',
];

// R1 SEED — 2026-04-13 bulkhead pins 1-54 → MIL-STD-1560 designators,
// reconciled to cut-list v4 wire IDs (SEED_KEEP in the build-sheet script;
// the 12 freed seed rows are direct-feed or deleted circuits). A wire keeps
// its seeded cavity iff it is still active and passes the R2 gauge gate.
const SEED_KEEP: [string, string][] = [
  ['A', '23'],                                          // A/C compressor clutch
  ['C', '4a'],                                          // ETB TAC2 drive
  ['D', '13'], ['E', '14'], ['F', '15'], ['G', '16'],   // Injectors 1-4
  ['H', '17'], ['J', '18'], ['K', '19'], ['L', '20'],   // Injectors 5-8
  ['M', '24'], ['N', '9'], ['P', '5'], ['R', '10'],     // Coils 1-4
  ['S', '7'], ['T', '11'], ['U', '8'], ['V', '12'],     // Coils 5-8
  ['a', '50'],                                          // Washer pump
  ['c', '64'],                                          // Wideband controller
  ['d', '73'],                                          // Underhood light
  ['g', '83'], ['h', '84'],                             // Parking lights front
  ['i', '87'], ['j', '88'],                             // Side markers front
  ['k', '80'], ['m', '82'],                             // Turn signals front
  ['n', '94'],                                          // Fuel pump relay
  ['t', '111'], ['u', '105'],                           // A/C pressure hi/lo
  ['v', '101'],                                         // CMP (shielded set anchor)
  ['w', '110'],                                         // CLT
  ['x', '99'],                                          // CKP
  ['y', '112'],                                         // Fuel pressure
  ['z', '109'],                                         // IAT
  ['AA', '103'], ['BB', '104'],                         // Knock 1/2
  ['CC', '108'],                                        // MAP
  ['DD', '102'],                                        // Oil pressure
  ['EE', '113'],                                        // Oil temp
  ['FF', '4c'], ['GG', '4d'],                           // TPS1/TPS2
];

// R3 FILLS — priority-ordered (wireId, anchor cavity); greedy nearest-free.
// P1 ETB completion (run-critical), P2 shielded sets (R4 — adjacent to the
// signal cavity), P3 CKP/CMP 5V refs, P4 MAP pair, P5 analog-temp grounds,
// P6 iBooster relay coil (R5 — a complete single-wire circuit outranks half
// a pair for the last cavities).
const FILLS: [string, string][] = [
  ['4b', 'C'], ['4e', 'C'], ['4f', 'C'],
  ['99g', 'x'], ['99s', 'x'], ['101g', 'v'], ['101s', 'v'],
  ['103g', 'AA'], ['103s', 'AA'], ['104g', 'BB'], ['104s', 'BB'],
  ['99r', 'x'], ['101r', 'v'],
  ['108g', 'CC'], ['108r', 'CC'],
  ['109g', 'z'], ['110g', 'w'], ['113g', 'EE'],
  ['95', 'n'],
];

// R2 DOES-NOT-PASS — crossing wires outside the 20-24 AWG contact range or
// battery-class; fed through grommets / MIDI fuses, not the D38999.
// (#49 wiper and the PDM rails are listed per the 2026-04-13 seed
// reconciliation even though their landmark paths don't reach L02-L15.)
const DIRECT_FEED_IDS = new Set([
  '21', '22', '25', '51', '48', '49',
  '85a', '85b', '86a', '86b',
  'INJ_PWR', 'COIL_PWR',
  '6', '59', '63', '52',
]);

// Firewall-crossing rule (build sheets, source [8] = K5_wire_paths.yaml):
// a wire crosses the bulkhead iff its path reaches an engine-bay landmark
// L02-L15. L01 is the M130→bulkhead CAB-side leg; L16+ are cab/floor/rear.
const ENGINE_LANDMARKS = new Set([
  'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10',
  'L11', 'L12', 'L13', 'L14', 'L15',
]);

// ── Helpers ─────────────────────────────────────────────────────────

const REGISTRY_BY_ID = new Map(WIRE_REGISTRY.map(w => [w.id, w]));

// "99g" → "99", "4c" → "4", "26b" → "26", "85a" → "85".
// Rail IDs and unsuffixed IDs return themselves.
function stem(id: string): string {
  const m = /^(\d+)[a-z]+$/.exec(id);
  return m ? m[1] : id;
}

// Effective routing path: own entry, else the parent's. Companion wires
// inherit the parent path per the 2026-05-14 companion addendum convention
// (cut list v4 lines 203-205) — a deliberate improvement over
// k5_harness_calc.py, which fell back to the cut-list estimate for them.
function effectivePath(id: string): { p: WirePath; method: DerivedWire['lengthMethod'] } | null {
  const own = WIRE_PATHS[id];
  if (own) return { p: own, method: 'landmark_derived' };
  const parent = WIRE_PATHS[stem(id)];
  if (parent) return { p: parent, method: 'landmark_derived_parent' };
  return null;
}

// ── Positional landmark reflow ──────────────────────────────────────
// Landmark inches under a set of component positions: each landmark's length
// is recomputed from its LANDMARK_WAYPOINTS polyline (exact Blender-session
// waypoints, node-anchored endpoints) plus its calibration offset. Default
// positions reproduce the baked table EXACTLY (parity invariant); moving a
// node changes only the polyline segments touching that node. positions
// omitted → baked table unchanged.
export function computeLandmarksIn(positions?: ComponentPositions): Record<string, number> {
  return landmarkLengthsIn(positions);
}

// Port of k5_harness_calc.py wire_len_ft: landmark sum + 12" service loop
// (+6" shielded, +6" door crossing), bend multiplier by gauge, inches → ft.
function wireLengthFt(
  id: string, gauge: number, estFt: number,
  landmarks: Record<string, number>,
): { lengthFt: number; method: DerivedWire['lengthMethod'] } {
  const eff = effectivePath(id);
  if (!eff) return { lengthFt: estFt, method: 'cutlist_estimate' };
  const base = eff.p.path.reduce((s, lm) => s + (landmarks[lm] || 0), 0);
  let extras = SERVICE_LOOP_IN;
  const flags = eff.p.flags || [];
  if (flags.includes('shielded')) extras += SHIELD_IN;
  if (flags.includes('door_crossing')) extras += DOOR_IN;
  const mult = gauge <= 12 ? BEND_HEAVY : BEND_LIGHT;
  return { lengthFt: Math.round(((base + extras) * mult / 12) * 100) / 100, method: eff.method };
}

// Port of k5_harness_calc.py gauge_check (SERVER selectWireGauge doctrine):
// pass iff vdrop <= 3% of 12V AND ampacity >= 1.25x amps; on failure report
// the smallest gauge that passes (fallback 0 AWG, SERVER behavior).
function gaugeCheck(gauge: number, amps: number, lengthFt: number): { vdrop: number; ok: boolean; needAwg: number } | null {
  if (!amps || !lengthFt || !(gauge in AWG)) return null;
  const eff = amps * SAFETY;
  const vAllow = (SYS_V * VDROP_PCT) / 100;
  const spec = AWG[gauge];
  const vdrop = eff * spec.ohmsPerFt * lengthFt * ROUND_TRIP;
  const ok = vdrop <= vAllow && spec.maxAmps >= eff;
  let needAwg = 0;
  if (!ok) {
    for (const g of Object.keys(AWG).map(Number).sort((a, b) => b - a)) {
      const s = AWG[g];
      if (eff * s.ohmsPerFt * lengthFt * ROUND_TRIP <= vAllow && s.maxAmps >= eff) {
        needAwg = g;
        break;
      }
    }
  }
  return { vdrop: Math.round(vdrop * 1000) / 1000, ok, needAwg };
}

// M22759/32 for 12-22 AWG, M22759/16 heavier (wire-closure protocol §5).
const specFamily = (gauge: number): string => (gauge >= 12 ? '/32' : '/16');

// Cross-dependencies (subsystems.json cross_dependency notes, ported from
// k5_harness_calc.py cross_keep): #53 brake switch feeds brake lamps + TC
// unlock; #57 reverse switch feeds backup lights + camera trigger.
function crossKeep(wireId: string, on: Record<string, boolean>): boolean {
  if (wireId === '53' && (on.LIGHTING_EXTERIOR || on.TRANS_6L80E)) return true;
  if (wireId === '57' && (on.LIGHTING_EXTERIOR || on.CAMERA_REAR)) return true;
  return false;
}

function wireCrossesFirewall(id: string): boolean {
  const eff = effectivePath(id);
  return !!eff && eff.p.path.some(lm => ENGINE_LANDMARKS.has(lm));
}

// Wire → subsystem map (v3 wire_ids + v4 addendum assignments)
const WIRE_SUBSYSTEM = new Map<string, string>();
for (const [name, sub] of Object.entries(K5_SUBSYSTEMS)) {
  for (const id of sub.wireIds) WIRE_SUBSYSTEM.set(id, name);
}
for (const [id, name] of Object.entries(V4_WIRE_SUBSYSTEMS)) WIRE_SUBSYSTEM.set(id, name);

// companionsOf: parent id → suffix-companion ids present in the registry
const COMPANIONS_OF = new Map<string, string[]>();
for (const w of WIRE_REGISTRY) {
  const parent = stem(w.id);
  if (parent !== w.id) {
    const list = COMPANIONS_OF.get(parent) || [];
    list.push(w.id);
    COMPANIONS_OF.set(parent, list);
  }
}

// ── The derivation ──────────────────────────────────────────────────

export function deriveHarness(input: DerivationInput): DerivedHarness {
  const { devices, toggles } = input;
  const warnings: string[] = [];

  // Device nameplate amps by lowercased name (k5_harness_calc.py dev_amps)
  const devAmps = new Map<string, number>();
  for (const d of devices) {
    if ((d.power_draw_amps || 0) > 0) devAmps.set(d.device_name.toLowerCase(), d.power_draw_amps as number);
  }

  // Toggle resolution: non-toggleable subsystems are always ON; toggleable
  // default ON unless explicitly false (k5_harness_calc.py compute()).
  const on: Record<string, boolean> = {};
  for (const [name, sub] of Object.entries(K5_SUBSYSTEMS)) {
    on[name] = sub.toggleable ? toggles[name] !== false : true;
  }

  // Active / dropped wire sets — registry order = cut-list order.
  const active: RegistryWire[] = [];
  const dropped: RegistryWire[] = [];
  for (const w of WIRE_REGISTRY) {
    const sub = WIRE_SUBSYSTEM.get(w.id);
    if (!sub) {
      warnings.push(`#${w.id} ${w.label}: no subsystem assignment — included unconditionally`);
      active.push(w);
      continue;
    }
    if (on[sub] || crossKeep(w.id, on)) active.push(w);
    else dropped.push(w);
  }
  const activeIds = new Set(active.map(w => w.id));

  // DOC-05 companion audit: every active primary with an expansion-table
  // signal type must have its doctrine companions in the registry AND active.
  for (const w of active) {
    if (stem(w.id) !== w.id) continue; // companions don't expand further
    const expected = DOC05_COMPANIONS[w.signalType];
    if (expected) {
      for (const suffix of expected) {
        const cid = `${w.id}${suffix}`;
        if (!REGISTRY_BY_ID.has(cid)) {
          warnings.push(`DOC-05 GAP: #${w.id} ${w.label} (${w.signalType}) missing companion #${cid}`);
        } else if (!activeIds.has(cid)) {
          warnings.push(`DOC-05 GAP: #${w.id} active but companion #${cid} dropped`);
        }
      }
    }
    for (const rid of RAIL_COMPANIONS[w.signalType] || []) {
      if (!activeIds.has(rid)) warnings.push(`DOC-05 GAP: #${w.id} ${w.label} needs bus rail #${rid} (inactive)`);
    }
  }

  // Positional landmark reflow (baked table when no positions supplied)
  const landmarks = computeLandmarksIn(input.positions);

  // Battery power spine: landmarks anchored to the BAT node (L14 BAT→ALT,
  // L15 BAT→STARTER) whose lengths actually moved under the supplied
  // positions. Wires routed through them get flagged row-by-row.
  const movedSpine = new Set<string>();
  if (input.positions) {
    for (const lid of landmarksAnchoredTo('BAT')) {
      if (Math.abs((landmarks[lid] ?? 0) - (LANDMARKS_IN[lid] ?? 0)) > 0.05) movedSpine.add(lid);
    }
  }

  // Lengths, footage, gauge audit, derived rows. Footage/cost/OD are keyed on
  // effectiveGauge (Vdrop-audited at derived length) so they reflow when
  // positions stretch a run past its registry gauge.
  const byGauge: Record<string, number> = {};
  const bySpec: Record<string, number> = {};
  let totalLengthFt = 0;
  const derived: DerivedWire[] = active.map(w => {
    const { lengthFt, method } = wireLengthFt(w.id, w.gauge, w.estFt, landmarks);
    totalLengthFt += lengthFt;
    const powerSpineAffected =
      movedSpine.size > 0 && !!effectivePath(w.id)?.p.path.some(lm => movedSpine.has(lm));

    const amps = devAmps.get(w.label.toLowerCase());
    let effectiveGauge = w.gauge;
    if (amps) {
      const chk = gaugeCheck(w.gauge, amps, lengthFt);
      if (chk && !chk.ok) {
        effectiveGauge = chk.needAwg;
        warnings.push(`#${w.id} ${w.label}: ${w.gauge} AWG fails at ${amps}A x ${lengthFt}ft (vdrop ${chk.vdrop}V) -> needs ${chk.needAwg} AWG`);
      }
    }

    const gKey = String(effectiveGauge);
    byGauge[gKey] = Math.round(((byGauge[gKey] || 0) + lengthFt) * 100) / 100;
    const sKey = `M22759${specFamily(effectiveGauge)}-${String(effectiveGauge).padStart(2, '0')}`;
    bySpec[sKey] = Math.round(((bySpec[sKey] || 0) + lengthFt) * 100) / 100;

    // Companion listing: suffix wires hang off the numeric stem; the head
    // sibling (the parent row, or the 'a' leg when no parent row exists)
    // lists them, plus any DOC-05 bus rails for its signal type.
    const isHead = stem(w.id) === w.id || (!REGISTRY_BY_ID.has(stem(w.id)) && w.id.endsWith('a'));
    const companions = isHead
      ? [
          ...(COMPANIONS_OF.get(stem(w.id)) || []).filter(c => c !== w.id && activeIds.has(c)),
          ...(RAIL_COMPANIONS[w.signalType] || []).filter(r => activeIds.has(r)),
        ]
      : [];

    return {
      id: w.id,
      label: w.label,
      subsystem: WIRE_SUBSYSTEM.get(w.id) || 'UNASSIGNED',
      fromPin: w.fromPin,
      toDest: w.toDest,
      signalType: w.signalType,
      gauge: w.gauge,
      effectiveGauge,
      gaugeChangedFromSpec: effectiveGauge !== w.gauge,
      powerSpineAffected,
      color: w.color,
      spec: w.spec,
      lengthFt,
      lengthMethod: method,
      companions,
    };
  });
  const derivedById = new Map(derived.map(d => [d.id, d]));

  // Battery moved → surface the power-spine rows in one warning so the UI
  // (and the cut plan) can't miss that battery-class lengths re-derived.
  if (movedSpine.size > 0) {
    const affected = derived.filter(d => d.powerSpineAffected).map(d => '#' + d.id);
    warnings.push(
      `POWER SPINE: battery position moved — ${[...movedSpine].sort().join('/')} re-derived from waypoint polylines; ` +
      `affected rows: ${affected.join(', ')} — verify lug-to-lug on the vehicle before cutting battery-class cable`,
    );
  }

  // PDM channel loading: parse OUTn from the FROM column (python parity —
  // 'PDM30:OUT?' rails and bare 'PDM30' rows have no channel yet).
  const chMap = new Map<number, { wireIds: string[]; devices: string[]; loadAmps: number }>();
  for (const w of active) {
    const m = /OUT(\d+)/.exec(w.fromPin);
    if (!m) continue;
    const ch = parseInt(m[1], 10);
    const entry = chMap.get(ch) || { wireIds: [], devices: [], loadAmps: 0 };
    entry.wireIds.push(w.id);
    entry.devices.push(w.label);
    entry.loadAmps += devAmps.get(w.label.toLowerCase()) || 0;
    chMap.set(ch, entry);
  }
  const pdm: PdmChannel[] = [];
  for (let ch = 1; ch <= 30; ch++) {
    const used = chMap.get(ch);
    const rating = pdmRating(ch);
    const loadAmps = used ? Math.round(used.loadAmps * 100) / 100 : 0;
    const overloaded = loadAmps > rating;
    if (overloaded) warnings.push(`PDM OVERLOAD OUT${ch}: ${loadAmps}A > ${rating}A rating`);
    pdm.push({
      channel: ch,
      rating,
      label: used
        ? used.devices.length > 1 ? `${used.devices[0]} +${used.devices.length - 1}` : used.devices[0]
        : '— SPARE —',
      devices: used ? used.devices : [],
      loadAmps,
      subsystem: used ? derivedById.get(used.wireIds[0])?.subsystem || '' : '',
      wireIds: used ? used.wireIds : [],
      overloaded,
    });
  }

  // Freed channels: referenced only by dropped wires (python pdm_freed)
  const freedChannels = [
    ...new Set(
      dropped
        .map(w => /OUT(\d+)/.exec(w.fromPin))
        .filter((m): m is RegExpExecArray => !!m)
        .map(m => parseInt(m[1], 10))
        .filter(ch => !chMap.has(ch)),
    ),
  ].sort((a, b) => a - b);

  // Power budget: subsystem nameplate sums for ON subsystems; starter
  // cranking peak (CHARGING_STARTING) excluded from continuous.
  const nameplateAmps = Math.round(
    Object.entries(on)
      .filter(([name, v]) => v && name !== 'CHARGING_STARTING')
      .reduce((s, [name]) => s + (K5_SUBSYSTEMS[name]?.totalAmps || 0), 0) * 10,
  ) / 10;
  const alternatorRequired = Math.ceil(nameplateAmps * SAFETY);
  // Alternator ladder (CLIENT + SERVER agree; CALC legacy ladder ignored)
  const alternatorRecommendation =
    alternatorRequired <= 80 ? '80A stock'
    : alternatorRequired <= 105 ? '105A stock high-output'
    : alternatorRequired <= 145 ? '145A CS130D'
    : alternatorRequired <= 180 ? '180A AD244'
    : alternatorRequired <= 220 ? '220A AD244'
    : `${alternatorRequired}A+ (dual alternator / custom)`;
  warnings.push(
    'Nameplate sum is worst-case simultaneous peak — coils/injectors are pulsed; ' +
    'channel-plan continuous budget is 299A vs 250A alt (calc-data/pdm_power_budget.md)',
  );
  if (input.mechanicalGauges || toggles[MECHANICAL_GAUGES_ID]) warnings.push(MECHANICAL_GAUGES_NOTE);

  // Conductor cost (ProWire snapshot $/ft x per-gauge footage)
  let costUsd = 0;
  for (const [gKey, ft] of Object.entries(byGauge)) {
    const gauge = parseInt(gKey, 10);
    costUsd += (PRICE[`${specFamily(gauge)}|${gauge}`] || 0) * ft;
  }
  costUsd = Math.round(costUsd * 100) / 100;

  // Trunk bundle ODs: classify by first path landmark; OD = sqrt(sum(d^2)/fill)
  // (effectiveGauge so OD reflows when a positional stretch upsizes a wire)
  const trunkGauges: Record<string, number[]> = {};
  for (const w of derived) {
    const first = effectivePath(w.id)?.p.path[0];
    if (!first) continue;
    for (const [trunk, lms] of Object.entries(TRUNKS)) {
      if (lms.includes(first)) {
        (trunkGauges[trunk] = trunkGauges[trunk] || []).push(w.effectiveGauge);
        break;
      }
    }
  }
  const trunkOdIn: Record<string, number> = {};
  for (const trunk of Object.keys(trunkGauges).sort()) {
    const sumSq = trunkGauges[trunk].reduce((s, g) => s + Math.pow(OD_IN[g] ?? 0.06, 2), 0);
    trunkOdIn[trunk] = Math.round(Math.sqrt(sumSq / BUNDLE_FILL) * 1000) / 1000;
  }

  // ── Bulkhead cavity allocation (build-sheet rules R1-R6) ──
  const gaugeGate = (id: string): boolean => CAVITY_GAUGES.has(REGISTRY_BY_ID.get(id)?.gauge ?? -1);

  // R2: direct feed — baked seed-reconciliation list plus any crossing wire
  // that fails the gauge gate.
  const directFeed = derived.filter(
    d => DIRECT_FEED_IDS.has(d.id) || (wireCrossesFirewall(d.id) && !gaugeGate(d.id)),
  );
  const directFeedIds = new Set(directFeed.map(d => d.id));

  // R1: seeds keep their cavities iff active + gauge gate.
  const assigned = new Map<string, { wireId: string; source: 'seed' | 'fill' }>();
  for (const [cavity, wireId] of SEED_KEEP) {
    if (activeIds.has(wireId) && gaugeGate(wireId)) assigned.set(cavity, { wireId, source: 'seed' });
  }
  // R3/R4/R5: priority fills take the nearest free cavity to their anchor.
  let free = D38999_CAV_ORDER.filter(c => !assigned.has(c));
  const unplacedFills: string[] = [];
  for (const [wireId, anchor] of FILLS) {
    if (!activeIds.has(wireId) || !gaugeGate(wireId)) continue;
    if (free.length === 0) {
      unplacedFills.push(wireId);
      continue;
    }
    const [ax, ay] = D38999_CAV_XY[anchor];
    free = free
      .map((c, i) => ({ c, i, d: Math.pow(D38999_CAV_XY[c][0] - ax, 2) + Math.pow(D38999_CAV_XY[c][1] - ay, 2) }))
      .sort((p, q) => p.d - q.d || p.i - q.i)
      .map(p => p.c);
    assigned.set(free.shift() as string, { wireId, source: 'fill' });
  }
  const cavityWireIds = new Set([...assigned.values()].map(a => a.wireId));
  const cavities: CavityAssignment[] = D38999_CAV_ORDER.map(cavity => {
    const a = assigned.get(cavity);
    return {
      cavity,
      wire: a ? derivedById.get(a.wireId) || null : null,
      source: a ? a.source : null,
    };
  });

  // R6: overflow — active crossing candidates (gauge-gated) with no cavity.
  const overflow = derived
    .filter(d =>
      (wireCrossesFirewall(d.id) || unplacedFills.includes(d.id)) &&
      gaugeGate(d.id) &&
      !cavityWireIds.has(d.id) &&
      !directFeedIds.has(d.id),
    )
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (overflow.length > 0) {
    warnings.push(
      `BULKHEAD OVERFLOW: ${overflow.length} crossing wire(s) with no D38999 cavity ` +
      `(${[...assigned.keys()].length}/61 used) — decision required: ${overflow.map(w => '#' + w.id).join(', ')}`,
    );
  }

  return {
    wires: derived,
    pdm,
    freedChannels,
    bulkhead: { cavities, overflow, directFeed },
    budget: { nameplateAmps, alternatorRequired, warnings },
    byGauge,
    costUsd,
    bySpec,
    droppedWireIds: dropped.map(w => w.id),
    totalLengthFt: Math.round(totalLengthFt * 10) / 10,
    trunkOdIn,
    alternatorRecommendation,
  };
}
