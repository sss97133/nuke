// k5LandmarkPaths.ts — K5 landmark distances + per-wire routing paths + the
// 162-wire cut-list registry (typed data, no logic).
//
// PROVENANCE
//   Landmarks: docs/wiring/output/K5_landmarks_blender_derived.yaml
//     method blender_polyline_derived_v2, derived 2026-06-09 from the digital
//     twin K5_harness_workspace_v2.blend (TurboSquid 1978 Blazer #1764639,
//     wheelbase verified 2,703mm vs FR-88 2,705mm). NOT tape-measured —
//     prototype max lengths only; verify on vehicle before final cut.
//     Position assumptions A1-A6 baked in (M130 passenger firewall, PDM30
//     under dash passenger, battery side OPEN — L14/L15 flip if battery
//     moves to passenger side).
//   Paths: docs/wiring/output/K5_wire_paths.yaml (113 base + 17 v4 = 130
//     entries). Companion wires (g/r/s suffix) inherit the parent wire's
//     path per the 2026-05-14 companion addendum convention (cut list v4
//     lines 203-205). flags: shielded = +6" EMI bypass, door_crossing =
//     +6" boot flex.
//   Wire registry: docs/wiring/output/K5_cut_list_v4.txt (2026-06-09,
//     162 wires, 1098.2 ft) — canonical registry per the wire-closure
//     protocol. estFt is the cut-list LENGTH column (zone estimate).

// ── Landmark inches (tape-routed-equivalent, no service loop) ───────
export const LANDMARKS_IN: Record<string, number> = {
  // 3.1 Engine bay
  L01: 7.2,   // M130 → FWG-MAIN (H3)                            [A1, A3]
  L02: 24.7,  // FWG-MAIN → intake valley junction               [A3, A5]
  L03: 7.2,   // valley junction → Cyl 1 coil, DEL-Stributor bracket
  L04: 4.3,   // coil-to-coil pitch, driver row
  L05: 7.2,   // valley junction → Cyl 2 coil
  L06: 4.3,   // coil-to-coil pitch, passenger row
  L07: 7.1,   // coil bracket → injector at same cylinder
  L08: 17.5,  // valley junction → throttle body (90mm DBW)
  L09: 8.0,   // valley junction → MAP sensor port
  L10: 32.5,  // M130 B-conn → CKP at FRONT timing cover (Gen IV LS3)
  L11: 30.1,  // M130 B-conn → CMP front timing cover
  L12: 44.2,  // M130 B-conn → KS1 driver block (around engine rear)
  L13: 21.5,  // M130 B-conn → KS2 passenger block
  L14: 61.6,  // BAT+ → ALT stud (along core support)            [A4 — flips if battery moves]
  L15: 68.7,  // BAT+ → STARTER stud                             [A4]
  // 3.2 Cab / dash
  L16: 8.7,   // PDM30 → FWG-MAIN interior side                  [A2, A3]
  L17: 38.5,  // PDM30 → steering column
  L18: 43.4,  // PDM30 → headlight switch (real dash position)
  L19: 34.7,  // PDM30 → brake pedal switch
  L20: 55.2,  // PDM30 → driver door boot
  L21: 19.2,  // door boot → in-door devices
  L22: 20.7,  // PDM30 → passenger door boot
  L23: 153.5, // PDM30 → dome light (A-pillar → headliner cavity)
  L24: 76.8,  // PDM30 → FLOOR-RR grommet                        [A2, A6]
  L25: 54.1,  // FLOOR-RR → rear axle junction (driver C-channel)
  L26: 50.3,  // rear junction → tailgate cluster
  L27: 27.5,  // rear junction → fuel tank sender/pump
  L28: 35.6,  // PDM30 → 6L80E switches via tunnel grommet
  // 3.4 Engine bay → underbody
  L29: 52.8,  // M130 → O2 bung driver exhaust
  L30: 33.4,  // M130 → O2 bung passenger exhaust
};

// ── Positional model (PlanView2D / positional derivation contract) ──
// Digital-twin coordinates in METERS: x driver+, y front−, z up+.
//
// Node anchors AND the L01-L30 waypoint polylines below are the EXACT data
// from the 2026-06-09 Blender derivation session (transcript 13a6bb90,
// execute_blender_code blocks that built the K5H_LM_* curves in
// K5_harness_workspace_v2.blend), including the FWG-MAIN H3 re-anchor
// (x=-0.35, z=0.90 @ probed firewall plane y=-1.46) and the Gen IV CKP
// front-cover correction (L10 23.7→32.5, CKP at -0.12,-2.00,0.65). These are
// the same polylines that PRODUCED the baked LANDMARKS_IN values — every
// landmark reproduces its baked value within 0.05" (1-decimal rounding
// residue), absorbed by calibrationIn so DEFAULT_POSITIONS reproduces
// today's table EXACTLY. Position assumptions A1-A6 still apply.
export interface ComponentPositions {
  [nodeId: string]: { x: number; y: number; z: number };
}

export const DEFAULT_POSITIONS: ComponentPositions = {
  // Draggable component nodes
  M130:         { x: -0.45,  y: -1.44,  z: 1.05 },  // A1 passenger firewall (ASSERTED)
  PDM30:        { x: -0.45,  y: -1.28,  z: 0.82 },  // A2 under dash passenger (ASSERTED)
  FWG_MAIN:     { x: -0.35,  y: -1.46,  z: 0.90 },  // A3 hole H3 lateral/height @ probed firewall plane
  FLOOR_RR:     { x: 0.82,   y: -0.30,  z: 0.74 },  // A6 driver seat rocker grommet
  BAT:          { x: 0.65,   y: -2.25,  z: 1.05 },  // A4 driver-front PLACEHOLDER — side is an OPEN decision; Skylar working stmt 2026-06-10 = passenger corner
  ALT:          { x: -0.30,  y: -2.06,  z: 1.03 },  // ALT stud (model)
  STARTER:      { x: -0.30,  y: -1.45,  z: 0.57 },  // STARTER stud (model)
  FUEL_TANK:    { x: 0.15,   y: 1.45,   z: 0.62 },  // tank sender/pump (model FSND)
  TAIL_CLUSTER: { x: 0.0,    y: 1.78,   z: 0.985 }, // Tail_Lights_Main y=+1.78 (model anchor)
  DASH_CLUSTER: { x: 0.62,   y: -1.24,  z: 1.05 },  // headlight-switch dash region (model HLS, real dash position)
  // Fixed routing anchors (NOT draggable — polyline endpoints only)
  VALLEY:       { x: 0.0,    y: -1.655, z: 1.31 },  // intake valley junction
  COIL1:        { x: 0.065,  y: -1.825, z: 1.31 },  // cyl 1 coil @ DEL-Stributor bracket
  COIL2:        { x: -0.065, y: -1.825, z: 1.31 },  // cyl 2 coil @ bracket
  THROTTLE_BODY:{ x: 0.0,    y: -1.95,  z: 0.984 }, // 90mm DBW
  MAP_SENSOR:   { x: 0.0,    y: -1.455, z: 1.28 },
  REAR_JCT:     { x: 0.40,   y: 0.81,   z: 0.66 },  // rear axle junction, driver C-channel
  CKP:          { x: -0.12,  y: -2.00,  z: 0.65 },  // front timing cover (Gen IV)
  CMP:          { x: 0.0,    y: -1.97,  z: 0.87 },
  KS1:          { x: 0.27,   y: -1.655, z: 0.77 },  // knock, driver block
  KS2:          { x: -0.27,  y: -1.655, z: 0.77 },  // knock, passenger block
  STEER_COL:    { x: 0.50,   y: -1.20,  z: 0.95 },
  BRAKE_SW:     { x: 0.42,   y: -1.30,  z: 0.70 },
  DOOR_BOOT_L:  { x: 0.92,   y: -1.13,  z: 1.00 },  // driver door hinge line
  DOOR_BOOT_R:  { x: -0.92,  y: -1.13,  z: 1.00 },
  DOOR_IN_L:    { x: 0.97,   y: -0.65,  z: 0.95 },  // in-door devices, driver
  DOME:         { x: 0.0,    y: 0.20,   z: 1.88 },  // headliner cavity
  TUNNEL_6L80E: { x: 0.17,   y: -0.95,  z: 0.62 },  // 6L80E switches via tunnel grommet
  O2_L:         { x: 0.36,   y: -1.00,  z: 0.53 },  // driver exhaust bung
  O2_R:         { x: -0.36,  y: -1.00,  z: 0.53 },
};

// A waypoint is either a node id (string — anchored, moves with positions)
// or a fixed routing point [x,y,z] meters (does not move). The segment-wise
// rule falls out of the data: when an anchored node moves, ONLY the segments
// adjacent to that node change length; fixed intermediate waypoints hold.
export type LandmarkWaypoint = string | [number, number, number];

export interface LandmarkWaypointPath {
  points: LandmarkWaypoint[];
  // waypoint_exact: full polyline recovered from the Blender session history —
  //   calibrationIn is pure 1-decimal rounding residue (|cal| <= 0.05").
  // endpoint_calibrated: exact waypoints NOT recoverable — endpoints only,
  //   baked length preserved via calibrationIn. (None currently: all 30
  //   polylines were recovered from the 2026-06-09 session transcript.)
  method: 'waypoint_exact' | 'endpoint_calibrated';
  calibrationIn: number; // baked − polyline(DEFAULT_POSITIONS), inches; set at init
}

const WP = (...points: LandmarkWaypoint[]): LandmarkWaypointPath =>
  ({ points, method: 'waypoint_exact', calibrationIn: 0 });

// Landmark → waypoint polyline with node-anchored endpoints. When
// deriveHarness() receives positions, each landmark's length is recomputed
// from this polyline (+ calibrationIn) instead of the baked value; everything
// downstream (lengthFt, gauge via Vdrop, cost, bundle OD) reflows.
export const LANDMARK_WAYPOINTS: Record<string, LandmarkWaypointPath> = {
  // 3.1 Engine bay
  L01: WP('M130', [-0.40, -1.46, 0.98], 'FWG_MAIN'),
  L02: WP('FWG_MAIN', [-0.30, -1.55, 1.10], [-0.15, -1.60, 1.28], 'VALLEY'),
  L03: WP('VALLEY', 'COIL1'),
  L04: WP('COIL1', [0.065, -1.715, 1.31]),                      // coil pitch, driver row
  L05: WP('VALLEY', 'COIL2'),
  L06: WP('COIL2', [-0.065, -1.715, 1.31]),                     // coil pitch, passenger row
  L07: WP('COIL1', [0.155, -1.85, 1.22], [0.155, -1.86, 1.17]), // bracket → injector
  L08: WP('VALLEY', [0.0, -1.80, 1.10], 'THROTTLE_BODY'),
  L09: WP('VALLEY', 'MAP_SENSOR'),
  L10: WP('M130', [-0.45, -1.55, 0.90], [-0.30, -1.90, 0.72], 'CKP'),
  L11: WP('M130', [-0.35, -1.60, 1.05], [-0.20, -1.90, 0.95], 'CMP'),
  L12: WP('M130', [-0.40, -1.40, 0.80], [-0.20, -1.36, 0.70], [0.20, -1.45, 0.70], 'KS1'),
  L13: WP('M130', [-0.40, -1.40, 0.80], 'KS2'),
  L14: WP('BAT', [0.55, -2.40, 1.05], [0.30, -2.48, 1.08], [-0.30, -2.48, 1.08], [-0.45, -2.30, 1.05], 'ALT'),
  L15: WP('BAT', [0.45, -2.10, 0.70], [0.40, -1.70, 0.62], [0.40, -1.50, 0.60], [-0.10, -1.46, 0.57], 'STARTER'),
  // 3.2 Cab / dash
  L16: WP('PDM30', [-0.40, -1.36, 0.86], 'FWG_MAIN'),
  L17: WP('PDM30', [0.0, -1.26, 0.80], [0.35, -1.22, 0.88], 'STEER_COL'),
  L18: WP('PDM30', [0.0, -1.26, 0.85], 'DASH_CLUSTER'),
  L19: WP('PDM30', [0.0, -1.26, 0.78], [0.30, -1.28, 0.72], 'BRAKE_SW'),
  L20: WP('PDM30', [0.0, -1.26, 0.80], [0.55, -1.20, 0.90], 'DOOR_BOOT_L'),
  L21: WP('DOOR_BOOT_L', [0.95, -0.90, 0.95], 'DOOR_IN_L'),
  L22: WP('PDM30', [-0.70, -1.20, 0.90], 'DOOR_BOOT_R'),
  L23: WP('PDM30', [0.20, -1.26, 0.85], [0.80, -1.22, 1.25], [0.78, -1.05, 1.80], [0.0, -0.95, 1.93], [0.0, 0.0, 1.90], 'DOME'),
  L24: WP('PDM30', [0.0, -1.24, 0.76], [0.75, -1.00, 0.76], [0.82, -0.60, 0.75], 'FLOOR_RR'),
  L25: WP('FLOOR_RR', [0.50, -0.20, 0.62], [0.42, 0.40, 0.62], 'REAR_JCT'),
  L26: WP('REAR_JCT', [0.40, 1.40, 0.62], [0.20, 1.70, 0.80], 'TAIL_CLUSTER'),
  L27: WP('REAR_JCT', [0.30, 1.20, 0.60], 'FUEL_TANK'),
  L28: WP('PDM30', [0.0, -1.24, 0.78], [0.15, -1.05, 0.80], [0.17, -1.00, 0.70], 'TUNNEL_6L80E'),
  // 3.4 Engine bay → underbody
  L29: WP('M130', [-0.42, -1.40, 0.62], [0.10, -1.25, 0.55], 'O2_L'),
  L30: WP('M130', [-0.42, -1.40, 0.62], 'O2_R'),
};

const IN_PER_M = 1 / 0.0254;

function resolveWaypoint(p: LandmarkWaypoint, pos: ComponentPositions): [number, number, number] {
  if (typeof p === 'string') {
    const n = pos[p];
    if (!n) throw new Error(`LANDMARK_WAYPOINTS references unknown node '${p}'`);
    return [n.x, n.y, n.z];
  }
  return p;
}

function polylineLengthIn(points: LandmarkWaypoint[], pos: ComponentPositions): number {
  let m = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = resolveWaypoint(points[i], pos);
    const b = resolveWaypoint(points[i + 1], pos);
    m += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return m * IN_PER_M;
}

// Init-time calibration: baked − polyline(DEFAULT_POSITIONS). By construction
// landmarkLengthsIn(DEFAULT_POSITIONS) === LANDMARKS_IN exactly — the parity
// invariant. Moving a node changes only its adjacent segments; the constant
// calibration rides along.
for (const [lid, wp] of Object.entries(LANDMARK_WAYPOINTS)) {
  wp.calibrationIn = (LANDMARKS_IN[lid] ?? 0) - polylineLengthIn(wp.points, DEFAULT_POSITIONS);
}

// Landmark inch table for a position set. No positions → the baked
// LANDMARKS_IN table, unchanged.
export function landmarkLengthsIn(positions?: ComponentPositions): Record<string, number> {
  if (!positions) return LANDMARKS_IN;
  const merged: ComponentPositions = { ...DEFAULT_POSITIONS, ...positions };
  const out: Record<string, number> = {};
  for (const [lid, wp] of Object.entries(LANDMARK_WAYPOINTS)) {
    out[lid] = Math.round((polylineLengthIn(wp.points, merged) + wp.calibrationIn) * 1000) / 1000;
  }
  return out;
}

// Landmarks whose polylines are anchored to a node (BAT → L14/L15 = the
// battery power spine).
export function landmarksAnchoredTo(nodeId: string): string[] {
  return Object.entries(LANDMARK_WAYPOINTS)
    .filter(([, wp]) => wp.points.includes(nodeId))
    .map(([lid]) => lid);
}

// ── Per-wire landmark paths ──────────────────────────────────────────
export interface WirePath {
  path: string[];
  flags?: ('shielded' | 'door_crossing')[];
}

export const WIRE_PATHS: Record<string, WirePath> = {
  // Engine loom: M130 → FWG → intake valley → bank-side → cyl position.
  // Repeating a landmark is intentional (L04 x3 = 3 cyl pitches).
  '24': { path: ['L01', 'L02', 'L03'] },
  '5': { path: ['L01', 'L02', 'L03', 'L04'] },
  '10': { path: ['L01', 'L02', 'L03', 'L04', 'L04'] },
  '7': { path: ['L01', 'L02', 'L03', 'L04', 'L04', 'L04'] },
  '9': { path: ['L01', 'L02', 'L05'] },
  '8': { path: ['L01', 'L02', 'L05', 'L06'] },
  '11': { path: ['L01', 'L02', 'L05', 'L06', 'L06'] },
  '12': { path: ['L01', 'L02', 'L05', 'L06', 'L06', 'L06'] },
  '13': { path: ['L01', 'L02', 'L03', 'L07'] },
  '15': { path: ['L01', 'L02', 'L03', 'L04', 'L07'] },
  '17': { path: ['L01', 'L02', 'L03', 'L04', 'L04', 'L07'] },
  '19': { path: ['L01', 'L02', 'L03', 'L04', 'L04', 'L04', 'L07'] },
  '14': { path: ['L01', 'L02', 'L05', 'L07'] },
  '16': { path: ['L01', 'L02', 'L05', 'L06', 'L07'] },
  '18': { path: ['L01', 'L02', 'L05', 'L06', 'L06', 'L07'] },
  '20': { path: ['L01', 'L02', 'L05', 'L06', 'L06', 'L06', 'L07'] },
  '4': { path: ['L01', 'L02', 'L08'] }, // ETB — #4a-#4f inherit via stem
  '108': { path: ['L01', 'L02', 'L09'] },
  '109': { path: ['L01', 'L02', 'L09'] },
  '110': { path: ['L01', 'L02', 'L03'] },
  '112': { path: ['L01', 'L02', 'L03', 'L07'] },
  '113': { path: ['L01', 'L02', 'L10'] },
  '102': { path: ['L01', 'L02', 'L10'] },
  '99': { path: ['L01', 'L02', 'L10'], flags: ['shielded'] },
  '101': { path: ['L01', 'L02', 'L11'], flags: ['shielded'] },
  '103': { path: ['L01', 'L02', 'L12'], flags: ['shielded'] },
  '104': { path: ['L01', 'L02', 'L13'], flags: ['shielded'] },
  // Exterior / body
  '33': { path: ['L17'] },
  '39': { path: ['L18'] },
  '46': { path: ['L17'] },
  '53': { path: ['L19'] },
  '54': { path: ['L16', 'L24', 'L25'] },
  '48': { path: ['L16', 'L08'] },
  '49': { path: ['L16', 'L23'] },
  '50': { path: ['L16', 'L08'] },
  '80': { path: ['L16', 'L14'] },
  '82': { path: ['L16', 'L05', 'L14'] },
  '83': { path: ['L16', 'L14'] },
  '84': { path: ['L16', 'L05', 'L14'] },
  '85': { path: ['L16', 'L19'] }, // v4: terminates at floor dimmer COMMON (~L19)
  '86': { path: ['L16', 'L19'] },
  '87': { path: ['L16', 'L23'] },
  '88': { path: ['L16', 'L23'] },
  '75': { path: ['L16', 'L24', 'L25', 'L26'] },
  '76': { path: ['L16', 'L24', 'L25', 'L26'] },
  '77': { path: ['L16', 'L24', 'L25'] },
  '78': { path: ['L16', 'L24', 'L25', 'L26'] },
  '79': { path: ['L16', 'L24', 'L25', 'L26'] },
  '81': { path: ['L16', 'L24', 'L25', 'L26'] },
  '89': { path: ['L16', 'L24', 'L25', 'L26'] },
  '90': { path: ['L16', 'L24', 'L25'] },
  '91': { path: ['L16', 'L24', 'L25', 'L26'] },
  '92': { path: ['L16', 'L24', 'L25'] },
  '93': { path: ['L16', 'L24', 'L25', 'L26'] },
  // Interior / dash
  '34': { path: ['L16', 'L20', 'L21'], flags: ['door_crossing'] },
  '35': { path: ['L16', 'L22', 'L21'], flags: ['door_crossing'] },
  '36': { path: ['L18'] },
  '37': { path: ['L18'] },
  '38': { path: ['L16', 'L20', 'L21'], flags: ['door_crossing'] },
  '47': { path: ['L16', 'L22', 'L21'], flags: ['door_crossing'] },
  '42': { path: ['L18'] },
  '43': { path: ['L18'] },
  '44': { path: ['L20', 'L21'], flags: ['door_crossing'] },
  '45': { path: ['L22', 'L21'], flags: ['door_crossing'] },
  '51': { path: ['L16', 'L08'] },
  '65': { path: ['L18'] },
  '67': { path: ['L23'] },
  '68': { path: ['L18'] },
  '69': { path: ['L19'] },
  '70': { path: ['L18'] },
  '71': { path: ['L18'] },
  '72': { path: ['L18'] },
  // Chassis / underbody
  '21': { path: ['L16', 'L14'] },
  '22': { path: ['L16', 'L05', 'L14'] },
  '25': { path: ['L01', 'L02', 'L03'] },
  '64': { path: ['L16', 'L08'] },
  '1': { path: ['L16', 'L24', 'L25'] },
  '2': { path: ['L16', 'L24', 'L25'] },
  '3': { path: ['L16', 'L24'] },
  '100': { path: ['L01', 'L02', 'L28'] },
  '106': { path: ['L01', 'L29'], flags: ['shielded'] },
  '107': { path: ['L01', 'L30'], flags: ['shielded'] },
  '66': { path: ['L16', 'L24', 'L25', 'L27'] },
  '94': { path: ['L16', 'L08'] },
  // Audio — speaker pairs #26a/b..#30a/b inherit via stem
  '26': { path: ['L16', 'L20', 'L21'], flags: ['door_crossing'] },
  '27': { path: ['L16', 'L22', 'L21'], flags: ['door_crossing'] },
  '28': { path: ['L16', 'L24', 'L25', 'L26'] },
  '29': { path: ['L16', 'L24', 'L25', 'L26'] },
  '30': { path: ['L16', 'L24', 'L25', 'L26'] },
  '31': { path: ['L18'] },
  '32': { path: ['L16', 'L24', 'L25', 'L26'] },
  '96': { path: ['L16', 'L24', 'L25', 'L26'] },
  // Power / comm
  '6': { path: ['L15'] },
  '59': { path: ['L14'] },
  '62': { path: ['L01', 'L16'] }, // M130→FW→PDM30 (both cab side)
  '63': { path: ['L15'] },
  // Misc
  '40': { path: ['L17'] },
  '41': { path: ['L18'] },
  '61': { path: ['L01', 'L16'] },
  '58': { path: ['L18'] },
  '60': { path: ['L01', 'L14'] }, // M130 → BAT
  '95': { path: ['L01'] },
  '52': { path: ['L01', 'L14'] },
  '23': { path: ['L16', 'L08'] },
  '105': { path: ['L01', 'L02', 'L08'] },
  '111': { path: ['L01', 'L02', 'L08'] },
  '73': { path: ['L16', 'L08'] },
  '74': { path: ['L16', 'L24', 'L25', 'L26'] },
  '98': { path: ['L16', 'L24', 'L25', 'L27'] },
  '55': { path: ['L16', 'L28'] },
  '56': { path: ['L16', 'L28'] },
  '57': { path: ['L16', 'L28'] },
  '97': { path: ['L16', 'L24', 'L25', 'L26'] },
  // V4 addendum (2026-06-09) — ALL estimates, none measured
  '114': { path: ['L18', 'L16', 'L02', 'L03'] }, // cluster ← FW ← valley ← driver head boss
  '115': { path: ['L18', 'L16', 'L02', 'L10'] }, // cluster ← FW ← valley ← oil galley
  '116': { path: ['L01', 'L16', 'L18'] },        // M130:A31 → FW → dash cluster
  '117': { path: ['L18', 'L16', 'L24', 'L25', 'L27'] }, // cluster ← tank sender
  '118': { path: ['L01', 'L16', 'L18'] },        // M130:A32 → FW → dash cluster
  '119': { path: ['L18'] },
  '120': { path: ['L18'] },
  '121': { path: ['L19', 'L18'] },
  '122': { path: ['L18'] },
  '123': { path: ['L18'] },
  '124': { path: ['L18'] },
  '125': { path: ['L18'] },
  '126': { path: ['L16', 'L24', 'L25'] },
  '85a': { path: ['L19', 'L16', 'L14'] },
  '85b': { path: ['L19', 'L16', 'L14'] },
  '86a': { path: ['L19', 'L16', 'L05', 'L14'] },
  '86b': { path: ['L19', 'L16', 'L05', 'L14'] },
};

// ── 162-wire cut-list registry (K5_cut_list_v4.txt, transcribed) ─────
export interface RegistryWire {
  id: string;
  label: string;
  fromPin: string; // FROM column ('ECU' = unassigned ECU pin per cut list)
  gauge: number;
  spec: string;    // 'M22759/32' | 'M22759/16' | 'SHIELDED 2C' | 'TWISTED PAIR' | 'bare/BLK'
  color: string;
  estFt: number;   // cut-list LENGTH column
  signalType: string; // DOC-05 classification (chapters/05-build-manifest.md)
  toDest: string;  // destination hint (engine-side dest per connector build sheets where known)
}

const W = (id: string, label: string, fromPin: string, gauge: number, spec: string, color: string, estFt: number, signalType: string, toDest?: string): RegistryWire =>
  ({ id, label, fromPin, gauge, spec, color, estFt, signalType, toDest: toDest ?? label });

export const WIRE_REGISTRY: RegistryWire[] = [
  // >> ENGINE LOOM (33)
  W('4a', 'ETB TAC Motor 2', 'M130:A01', 20, 'M22759/32', 'BRN', 4.6, 'h_bridge_motor', 'ETB GM 12605109 pin A'),
  W('4b', 'ETB TAC Motor 1', 'M130:A18', 20, 'M22759/32', 'YEL', 4.6, 'h_bridge_motor', 'ETB GM 12605109 pin B'),
  W('4c', 'ETB TPS1 Signal', 'M130:A14', 22, 'M22759/32', 'DK GRN', 4.6, 'h_bridge_motor', 'ETB GM 12605109 pin C'),
  W('4d', 'ETB TPS2 Signal', 'M130:A17', 22, 'M22759/32', 'PPL', 4.6, 'h_bridge_motor', 'ETB GM 12605109 pin D'),
  W('4e', 'ETB 5V Reference', 'M130:A02', 22, 'M22759/32', 'GRY', 4.6, 'h_bridge_motor', 'ETB GM 12605109 pin E'),
  W('4f', 'ETB Signal Ground', 'M130:B15', 22, 'M22759/32', 'BLK', 4.6, 'h_bridge_motor', 'ETB GM 12605109 pin F'),
  W('5', 'Ignition Coil 3', 'M130:A03', 22, 'M22759/32', 'WHT', 2.5, 'logic_coil_drive', 'D510C coil 3 @ DEL-Stributor'),
  W('7', 'Ignition Coil 5', 'M130:A04', 22, 'M22759/32', 'WHT/WHT', 2.5, 'logic_coil_drive', 'D510C coil 5 @ DEL-Stributor'),
  W('8', 'Ignition Coil 7', 'M130:A05', 22, 'M22759/32', 'WHT/BLK', 2.5, 'logic_coil_drive', 'D510C coil 7 @ DEL-Stributor'),
  W('9', 'Ignition Coil 2', 'M130:A06', 22, 'M22759/32', 'WHT/RED', 2.5, 'logic_coil_drive', 'D510C coil 2 @ DEL-Stributor'),
  W('10', 'Ignition Coil 4', 'M130:A07', 22, 'M22759/32', 'WHT/BLU', 2.5, 'logic_coil_drive', 'D510C coil 4 @ DEL-Stributor'),
  W('11', 'Ignition Coil 6', 'M130:A08', 22, 'M22759/32', 'WHT/YEL', 2.5, 'logic_coil_drive', 'D510C coil 6 @ DEL-Stributor'),
  W('12', 'Ignition Coil 8', 'M130:A12', 22, 'M22759/32', 'WHT/VIO', 2.5, 'logic_coil_drive', 'D510C coil 8 @ DEL-Stributor'),
  W('13', 'Fuel Injector 1', 'M130:A19', 22, 'M22759/32', 'GRN', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 1'),
  W('14', 'Fuel Injector 2', 'M130:A20', 22, 'M22759/32', 'GRN/WHT', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 2'),
  W('15', 'Fuel Injector 3', 'M130:A21', 22, 'M22759/32', 'GRN/BLK', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 3'),
  W('16', 'Fuel Injector 4', 'M130:A22', 22, 'M22759/32', 'GRN/RED', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 4'),
  W('17', 'Fuel Injector 5', 'M130:A27', 22, 'M22759/32', 'GRN/BLU', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 5'),
  W('18', 'Fuel Injector 6', 'M130:A28', 22, 'M22759/32', 'GRN/YEL', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 6'),
  W('19', 'Fuel Injector 7', 'M130:A29', 22, 'M22759/32', 'GRN/VIO', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 7'),
  W('20', 'Fuel Injector 8', 'M130:A30', 22, 'M22759/32', 'GRN/ORG', 4.6, 'low_side_drive', 'EV6 inj @ rail cyl 8'),
  W('24', 'Ignition Coil 1', 'M130:A13', 22, 'M22759/32', 'WHT/ORG', 2.5, 'logic_coil_drive', 'D510C coil 1 @ DEL-Stributor'),
  W('97', 'Rear Backup Camera', 'PDM30:OUT15', 22, 'M22759/32', 'BLU/WHT', 18.4, 'controller'),
  W('99', 'Crank Position Sensor', 'M130:B01', 22, 'SHIELDED 2C', 'BLU/WHT/WHT', 4.6, 'ecu_crank_cam', 'CKP @ front timing cover (Gen IV)'),
  W('101', 'Cam Position Sensor', 'M130:B02', 22, 'SHIELDED 2C', 'BLU/WHT/BLK', 4.6, 'ecu_crank_cam', 'CMP @ front cover'),
  W('102', 'Oil Pressure Sensor (ECU)', 'M130:A25', 22, 'M22759/32', 'VIO', 4.6, 'analog_5v', 'OPS @ galley boss (WP0IL40 pigtail)'),
  W('103', 'Knock Sensor Bank 1', 'M130:B07', 22, 'SHIELDED 2C', 'GRY', 4.6, 'piezoelectric', 'Knock B1 below exhaust'),
  W('104', 'Knock Sensor Bank 2', 'M130:B13', 22, 'SHIELDED 2C', 'GRY/WHT', 4.6, 'piezoelectric', 'Knock B2 below exhaust'),
  W('108', 'MAP Sensor', 'M130:A15', 22, 'M22759/32', 'VIO/WHT', 4.6, 'analog_5v', 'MAP (ACDelco PT2293 pigtail)'),
  W('109', 'Intake Air Temp Sensor', 'M130:B03', 22, 'M22759/32', 'TAN', 4.6, 'analog_temp', 'IAT in intake tract'),
  W('110', 'Coolant Temp Sensor (ECU)', 'M130:B04', 22, 'M22759/32', 'TAN/WHT', 4.6, 'analog_temp', 'CLT @ driver head'),
  W('112', 'Fuel Pressure Sensor', 'M130:A16', 22, 'M22759/32', 'VIO/BLK', 4.6, 'analog_5v', 'FPS @ fuel rail'),
  W('113', 'Oil Temperature Sensor', 'M130:B05', 22, 'M22759/32', 'TAN/BLK', 4.6, 'analog_temp', 'OTS @ oil galley'),
  // >> EXTERIOR / BODY (27)
  W('33', 'Turn Signal Switch', 'ECU', 22, 'M22759/32', 'ORN/BLU', 3.5, 'pdm_input'),
  W('39', 'Headlight Switch', 'ECU', 22, 'M22759/32', 'ORN/ORG', 3.5, 'pdm_input'),
  W('46', 'Wiper/Washer Switch', 'ECU', 22, 'M22759/32', 'ORN/VIO', 3.5, 'pdm_input'),
  W('48', 'Horn', 'PDM30:OUT14', 16, 'M22759/32', 'ORN/ORG', 4.6, 'accessory'),
  W('49', 'Windshield Wiper Motor', 'PDM30:OUT12', 18, 'M22759/32', 'PPL', 4.6, 'motor'),
  W('50', 'Washer Pump', 'PDM30:OUT26', 22, 'M22759/32', 'ORN/BLK/RED', 4.6, 'motor'),
  W('53', 'Brake Light Switch', 'ECU', 22, 'M22759/32', 'ORN/WHT', 3.5, 'ecu_digital_input'),
  W('54', 'Electric Parking Brake', 'PDM30:OUT7', 16, 'M22759/32', 'ORN/BLK/YEL', 18.4, 'controller'),
  W('75', 'Tail Light Right', 'PDM30:OUT13', 22, 'M22759/32', 'BRN/YEL', 18.4, 'led_lighting'),
  W('76', 'Backup Light Right', 'PDM30:OUT15', 22, 'M22759/32', 'BRN/VIO', 18.4, 'led_lighting'),
  W('77', 'Side Marker Rear Left', 'PDM30:OUT19', 22, 'M22759/32', 'BRN/ORG', 18.4, 'led_lighting'),
  W('78', 'Side Marker Rear Right', 'PDM30:OUT19', 22, 'M22759/32', 'BRN', 18.4, 'led_lighting'),
  W('79', 'Cab Clearance Light Left', 'PDM30:OUT19', 22, 'M22759/32', 'BRN/WHT', 3.5, 'led_lighting'),
  W('80', 'Turn Signal Left Front', 'PDM30:OUT27', 22, 'M22759/32', 'LT BLU', 4.6, 'led_lighting'),
  W('81', 'Tail Light Left', 'PDM30:OUT13', 22, 'M22759/32', 'BRN/BLK', 18.4, 'led_lighting'),
  W('82', 'Turn Signal Right Front', 'PDM30:OUT28', 22, 'M22759/32', 'DK BLU', 4.6, 'led_lighting'),
  W('83', 'Parking Light Left Front', 'PDM30:OUT13', 22, 'M22759/32', 'BRN/RED', 4.6, 'led_lighting'),
  W('84', 'Parking Light Right Front', 'PDM30:OUT13', 22, 'M22759/32', 'BRN/BLU', 4.6, 'led_lighting'),
  W('85', 'LED Headlight Left', 'PDM30:OUT17', 20, 'M22759/32', 'LT GRN', 4.6, 'led_lighting', 'Floor dimmer COMMON (legs #85a/#85b continue to lamp)'),
  W('86', 'LED Headlight Right', 'PDM30:OUT18', 20, 'M22759/32', 'LT GRN/WHT', 4.6, 'led_lighting', 'Floor dimmer COMMON (legs #86a/#86b continue to lamp)'),
  W('87', 'Side Marker Front Left', 'PDM30:OUT19', 22, 'M22759/32', 'BRN/YEL', 4.6, 'led_lighting'),
  W('88', 'Side Marker Front Right', 'PDM30:OUT19', 22, 'M22759/32', 'BRN/VIO', 4.6, 'led_lighting'),
  W('89', 'Backup Light Left', 'PDM30:OUT15', 22, 'M22759/32', 'BRN/ORG', 18.4, 'led_lighting'),
  W('90', 'Cab Clearance Light Center', 'PDM30:OUT19', 22, 'M22759/32', 'BRN', 3.5, 'led_lighting'),
  W('91', 'Cab Clearance Light Right', 'PDM30:OUT19', 22, 'M22759/32', 'BRN/WHT', 3.5, 'led_lighting'),
  W('92', 'License Plate Light', 'PDM30:OUT19', 22, 'M22759/32', 'BRN/BLK', 18.4, 'led_lighting'),
  W('93', 'Third Brake Light', 'PDM30:OUT15', 22, 'M22759/32', 'BRN/RED', 18.4, 'led_lighting'),
  // >> INTERIOR / DASH (18)
  W('34', 'Power Window Motor Left', 'PDM30:OUT3', 16, 'M22759/32', 'DK BLU', 6.9, 'motor'),
  W('35', 'Power Window Motor Right', 'PDM30:OUT4', 16, 'M22759/32', 'DK BLU/WHT', 6.9, 'motor'),
  W('36', 'Window Switch Master (Driver)', 'ECU', 22, 'M22759/32', 'ORN/YEL', 6.9, 'standalone_switch'),
  W('37', 'Window Switch Passenger', 'ECU', 22, 'M22759/32', 'ORN/VIO', 6.9, 'standalone_switch'),
  W('38', 'Power Lock Actuator Left', 'PDM30:OUT21', 20, 'M22759/32', 'BLK', 6.9, 'motor'),
  W('42', 'Door Switch Left', 'ECU', 22, 'M22759/32', 'ORN/BLK', 6.9, 'ecu_digital_input'),
  W('43', 'Door Switch Right', 'ECU', 22, 'M22759/32', 'ORN/RED', 6.9, 'ecu_digital_input'),
  W('44', 'Lock Switch', 'ECU', 22, 'M22759/32', 'ORN/BLU', 6.9, 'standalone_switch'),
  W('45', 'Blower Speed Switch/Control', 'ECU', 22, 'M22759/32', 'ORN/YEL', 3.5, 'standalone_switch'),
  W('47', 'Power Lock Actuator Right', 'PDM30:OUT22', 20, 'M22759/32', 'BLK/WHT', 6.9, 'motor'),
  W('51', 'Heater Blower Motor', 'PDM30:OUT6', 10, 'M22759/32', 'ORN/BLK/BLU', 4.6, 'motor'),
  W('65', 'Display/Dash', 'PDM30:OUT29', 22, 'M22759/32', 'ORN/RED', 3.5, 'can_display'),
  W('67', 'Dome Light', 'PDM30:OUT25', 22, 'M22759/32', 'BRN', 3.5, 'led_lighting'),
  W('68', 'Under-Dash LED Lights', 'PDM30:OUT25', 22, 'M22759/32', 'BRN/WHT', 3.5, 'led_lighting'),
  W('69', 'Footwell Lights', 'PDM30:OUT25', 22, 'M22759/32', 'BRN/BLK', 3.5, 'led_lighting'),
  W('70', 'USB Charging Port', 'PDM30:OUT30', 22, 'M22759/32', 'ORN/YEL', 3.5, 'power_outlet'),
  W('71', 'Dakota Digital Gauge Cluster', 'PDM30', 22, 'M22759/32', 'ORN/VIO', 3.5, 'can_display'),
  W('72', 'Cigarette Lighter / 12V Outlet', 'PDM30:OUT8', 14, 'M22759/32', 'ORN/ORG', 3.5, 'power_outlet'),
  // >> CHASSIS / UNDERBODY (12)
  W('1', 'AMP Research Step Left', 'PDM30:OUT9', 18, 'M22759/32', 'ORN/BLK', 11.5, 'motor'),
  W('2', 'AMP Research Step Right', 'PDM30:OUT10', 18, 'M22759/32', 'ORN/BLK/WHT', 11.5, 'motor'),
  W('3', 'AMP Research Controller', 'PDM30:OUT11', 22, 'M22759/32', 'ORN/BLK/BLK', 11.5, 'controller'),
  W('21', 'Radiator Fan 1', 'PDM30:OUT1', 12, 'M22759/32', 'ORN/WHT', 4.6, 'motor'),
  W('22', 'Radiator Fan 2', 'PDM30:OUT2', 12, 'M22759/32', 'ORN/BLK', 4.6, 'motor'),
  W('25', 'Electric Water Pump', 'PDM30:OUT5', 14, 'M22759/32', 'ORN/BLU', 4.6, 'motor'),
  W('64', 'Wideband Lambda Controller', 'PDM30:OUT24', 22, 'M22759/32', 'ORN/BLK', 4.6, 'controller', 'Wideband lambda controller (engine bay)'),
  W('66', 'Fuel Pump', 'ECU', 8, 'M22759/16', 'ORN/BLU', 18.4, 'motor'),
  W('94', 'Fuel Pump Relay', 'PDM30', 22, 'M22759/32', 'ORN', 4.6, 'relay', 'Fuel pump relay (engine bay)'),
  W('100', 'Vehicle Speed Sensor', 'ECU', 22, 'M22759/32', 'ORN/BLU', 11.5, 'ecu_digital_input'),
  W('106', 'Wideband O2 Sensor 1', 'ECU', 22, 'M22759/32', 'VIO/BLU', 11.5, 'wideband_lambda'),
  W('107', 'Wideband O2 Sensor 2', 'ECU', 22, 'M22759/32', 'VIO/BLU/WHT', 11.5, 'wideband_lambda'),
  // >> AUDIO (13)
  W('26a', 'Speaker Front Left (+)', 'AMP CH1+', 18, 'M22759/32', 'ORN/YEL', 6.9, 'audio'),
  W('26b', 'Speaker Front Left (-)', 'AMP CH1-', 18, 'M22759/32', 'ORN/YEL/BLK', 6.9, 'audio'),
  W('27a', 'Speaker Front Right (+)', 'AMP CH2+', 18, 'M22759/32', 'ORN/VIO', 6.9, 'audio'),
  W('27b', 'Speaker Front Right (-)', 'AMP CH2-', 18, 'M22759/32', 'ORN/VIO/BLK', 6.9, 'audio'),
  W('28a', 'Speaker Rear Left (+)', 'AMP CH3+', 16, 'M22759/32', 'ORN/ORG', 18.4, 'audio'),
  W('28b', 'Speaker Rear Left (-)', 'AMP CH3-', 16, 'M22759/32', 'ORN/ORG/BLK', 18.4, 'audio'),
  W('29a', 'Speaker Rear Right (+)', 'AMP CH4+', 16, 'M22759/32', 'ORN', 18.4, 'audio'),
  W('29b', 'Speaker Rear Right (-)', 'AMP CH4-', 16, 'M22759/32', 'ORN/BLK', 18.4, 'audio'),
  W('30a', 'Subwoofer (+)', 'AMP SUB+', 10, 'M22759/32', 'ORN/WHT', 18.4, 'audio'),
  W('30b', 'Subwoofer (-)', 'AMP SUB-', 10, 'M22759/32', 'ORN/WHT/BLK', 18.4, 'audio'),
  W('31', 'Radio/Head Unit', 'PDM30:OUT20', 22, 'M22759/32', 'ORN/BLK', 3.5, 'audio'),
  W('32', 'Amplifier', 'ECU', 8, 'M22759/16', 'ORN/RED', 18.4, 'audio'),
  W('96', 'Amplifier Relay', 'ECU', 22, 'M22759/32', 'ORN/BLK', 18.4, 'relay'),
  // >> POWER / COMM (4)
  W('6', 'Starter Motor', 'ECU', 0, 'M22759/16', 'ORN', 4.6, 'power_source'),
  W('59', 'Alternator', 'ECU', 0, 'M22759/16', 'ORN/VIO', 4.6, 'alternator'),
  W('62', 'CAN Bus Network', 'ECU', 24, 'TWISTED PAIR', 'WHT/GRN', 3.5, 'can_bus', 'PDM30 B26/B25 + C125/Dakota; 120R each end'),
  W('63', 'Battery Disconnect', 'ECU', 0, 'M22759/16', 'ORN/WHT', 4.6, 'power_source'),
  // >> MISC (16)
  W('23', 'A/C Compressor Clutch', 'PDM30:OUT16', 20, 'M22759/32', 'ORN/RED', 4.6, 'motor', 'A/C compressor clutch coil'),
  W('40', 'Ignition Switch', 'ECU', 22, 'M22759/32', 'ORN', 3.5, 'pdm_input'),
  W('41', 'Hazard Flasher', 'ECU', 22, 'M22759/32', 'ORN/WHT', 3.5, 'standalone_module'),
  W('52', 'Bosch V4 Electric Brake Booster', 'ECU', 8, 'M22759/16', 'ORN', 4.6, 'controller', 'iBooster feed BAT->firewall'),
  W('55', 'Transfer Case Indicator', 'PDM30', 22, 'M22759/32', 'ORN/BLK', 11.5, 'pdm_input'),
  W('56', 'Neutral Safety Switch', 'PDM30', 22, 'M22759/32', 'ORN/RED', 11.5, 'pdm_input'),
  W('57', 'Reverse Light Switch', 'PDM30', 22, 'M22759/32', 'ORN/BLU', 11.5, 'pdm_input'),
  W('58', 'Transmission Controller', 'PDM30:OUT23', 22, 'M22759/32', 'ORN/YEL', 3.5, 'controller', 'Holley 558-499 T43 module'),
  W('60', 'ECU', 'ECU', 22, 'M22759/32', 'ORN/ORG', 4.6, 'power_source', "ECU power — 22 AWG 'ECU' semantics unclear; M130 BAT_POS A26 has NO wire in v4"),
  W('61', 'Power Distribution Module', 'ECU', 22, 'M22759/32', 'ORN', 3.5, 'power_source'),
  W('73', 'Underhood Light', 'PDM30:OUT25', 22, 'M22759/32', 'BRN/RED', 4.6, 'led_lighting'),
  W('74', 'Cargo/Bed Light', 'PDM30:OUT25', 22, 'M22759/32', 'BRN/BLU', 18.4, 'led_lighting'),
  W('95', 'Bosch iBooster Relay', 'PDM30', 22, 'M22759/32', 'ORN/WHT', 2.3, 'relay', 'iBooster relay @ firewall'),
  W('98', 'Fuel Level Sender', 'ECU', 22, 'M22759/32', 'ORN/RED', 18.4, 'analog_sender', 'GM tank sender; AV pin UNASSIGNED (v4 open item)'),
  W('105', 'A/C Pressure Switch Low', 'ECU', 22, 'M22759/32', 'ORN/YEL', 4.6, 'ecu_digital_input', 'A/C pressure switch LOW'),
  W('111', 'A/C Pressure Switch High', 'ECU', 22, 'M22759/32', 'ORN/VIO', 4.6, 'ecu_digital_input', 'A/C pressure switch HIGH'),
  // >> COMPANION ADDENDUM 2026-05-14 (22) — DOC-05 expansion, Option B receipt
  W('109g', 'IAT Sensor Ground', 'M130:B15', 22, 'M22759/32', 'BLK', 4.6, 'analog_temp', 'IAT pin 2 (gnd return)'),
  W('110g', 'CLT Sensor Ground', 'M130:B16', 22, 'M22759/32', 'BLK', 4.6, 'analog_temp', 'CLT pin 2 (gnd return)'),
  W('113g', 'OTS Sensor Ground', 'M130:B15', 22, 'M22759/32', 'BLK', 4.6, 'analog_temp', 'OTS pin 2 (gnd return)'),
  W('102g', 'OPS Sensor Ground', 'M130:B16', 22, 'M22759/32', 'BLK', 4.6, 'analog_5v', 'OPS pin (gnd, WP0IL40 pigtail)'),
  W('102r', 'OPS 5V Reference', 'M130:A02', 22, 'M22759/32', 'GRY', 4.6, 'analog_5v', 'OPS pin (5V, SEN_5V_A)'),
  W('108g', 'MAP Sensor Ground', 'M130:B15', 22, 'M22759/32', 'BLK', 4.6, 'analog_5v', 'MAP pin (gnd)'),
  W('108r', 'MAP 5V Reference', 'M130:A09', 22, 'M22759/32', 'GRY', 4.6, 'analog_5v', 'MAP pin (5V, SEN_5V_B)'),
  W('112g', 'Fuel Pressure Ground', 'M130:B16', 22, 'M22759/32', 'BLK', 4.6, 'analog_5v', 'FPS pin (gnd)'),
  W('112r', 'Fuel Pressure 5V Reference', 'M130:A02', 22, 'M22759/32', 'GRY', 4.6, 'analog_5v', 'FPS pin (5V, SEN_5V_A)'),
  W('99g', 'CKP Sensor Ground (cond 2)', 'M130:B15', 22, 'SHIELDED 2C', 'BLK', 4.6, 'ecu_crank_cam', 'CKP pin (cond 2 of #99 cable)'),
  W('99r', 'CKP 5V Reference', 'M130:A02', 22, 'M22759/32', 'GRY', 4.6, 'ecu_crank_cam', 'CKP 5V supply (3-pin Metri-Pack)'),
  W('99s', 'CKP Shield Drain', 'M130:B15', 22, 'bare/BLK', 'BARE', 4.6, 'ecu_crank_cam', 'CKP shield (drain @ ECU end only)'),
  W('101g', 'CMP Sensor Ground (cond 2)', 'M130:B16', 22, 'SHIELDED 2C', 'BLK', 4.6, 'ecu_crank_cam', 'CMP pin (cond 2 of #101 cable)'),
  W('101r', 'CMP 5V Reference', 'M130:A09', 22, 'M22759/32', 'GRY', 4.6, 'ecu_crank_cam', 'CMP 5V supply (SEN_5V_B)'),
  W('101s', 'CMP Shield Drain', 'M130:B16', 22, 'bare/BLK', 'BARE', 4.6, 'ecu_crank_cam', 'CMP shield (drain @ ECU end only)'),
  W('103g', 'Knock B1 Sensor Ground (cond 2)', 'M130:B15', 22, 'SHIELDED 2C', 'BLK', 4.6, 'piezoelectric', 'Knock B1 pin 2 (cond 2)'),
  W('103s', 'Knock B1 Shield Drain', 'M130:B15', 22, 'bare/BLK', 'BARE', 4.6, 'piezoelectric', 'Knock B1 shield'),
  W('104g', 'Knock B2 Sensor Ground (cond 2)', 'M130:B16', 22, 'SHIELDED 2C', 'BLK', 4.6, 'piezoelectric', 'Knock B2 pin 2 (cond 2)'),
  W('104s', 'Knock B2 Shield Drain', 'M130:B16', 22, 'bare/BLK', 'BARE', 4.6, 'piezoelectric', 'Knock B2 shield'),
  W('INJ_PWR', 'Injector +12V Rail', 'PDM30:OUT?', 16, 'M22759/32', 'RED', 5.0, 'power_rail', '8x EV6 injectors via WPINJ40 daisy-chain; PDM channel TBD'),
  W('COIL_PWR', 'Coil +12V Rail', 'PDM30:OUT?', 16, 'M22759/32', 'RED', 3.0, 'power_rail', '8x D510C coils via DEL-Stributor bracket bus; PDM channel TBD'),
  W('COIL_GND', 'Coil Ground Rail', 'ENGINE BLOCK', 16, 'M22759/32', 'BLK', 3.0, 'ground', 'Engine block star ground (bell housing bolt)'),
  // >> V4 ADDENDUM 2026-06-09 (17) — Dakota / TCU / E-Stopp / high-beam legs
  W('114', 'Dakota CTS Sender (factory)', 'GM CTS SNDR', 22, 'M22759/32', 'BRN/WHT', 8.0, 'analog_sender', 'Factory GM CTS, driver head boss (PN UNKNOWN)'),
  W('115', 'Dakota Oil Pressure Sender', 'GM OPS SNDR', 22, 'M22759/32', 'VIO/WHT', 8.0, 'analog_sender', 'Factory GM 0-90 PSI sender, galley boss (PN UNKNOWN)'),
  W('116', 'Dakota Tach Signal', 'M130:A31', 22, 'M22759/32', 'WHT/BLK', 8.0, 'ecu_digital_output', 'Dakota VHX tach input (OUT_HB3 spare as tach pulse)'),
  W('117', 'Dakota Fuel Level Sender', 'GM FUEL SNDR', 22, 'M22759/32', 'ORN/RED', 18.4, 'analog_sender', 'GM 0-90 ohm tank sender tap, parallel with #98'),
  W('118', 'Dakota VSS / Speedo', 'M130:A32', 22, 'M22759/32', 'WHT/YEL', 11.5, 'ecu_digital_output', 'Dakota VHX speedo input (OUT_HB4 spare as VSS mirror)'),
  W('119', 'Dakota Turn Signal Left Input', 'TAP #80 DASH', 22, 'M22759/32', 'LT BLU', 1.5, 'tap', 'Dash-side splice on #80'),
  W('120', 'Dakota Turn Signal Right Input', 'TAP #82 DASH', 22, 'M22759/32', 'DK BLU', 1.5, 'tap', 'Dash-side splice on #82'),
  W('121', 'Dakota High Beam Input', 'TAP #85b', 22, 'M22759/32', 'LT GRN/BLK', 2.0, 'tap', 'Tap at floor dimmer high-out terminal'),
  W('122', 'Dakota Brake Indicator', 'TAP #53 DASH', 22, 'M22759/32', 'ORN/WHT', 1.5, 'tap', 'Dash-side splice on #53'),
  W('123', 'Dakota Ground', 'DASH STAR GND', 22, 'M22759/32', 'BLK', 3.0, 'ground', 'Dedicated dash star-ground'),
  W('124', 'Dakota Switched +12V Backup', 'OUT29 SPLICE', 22, 'M22759/32', 'ORN/RED', 3.0, 'power_rail', 'Splice on PDM30:OUT29; COLOR COLLISION with #117 — reassign at mockup'),
  W('125', 'Holley T43 TCU CAN Stub', 'SPLICE #62', 22, 'TWISTED PAIR', 'WHT/GRN', 2.0, 'can_bus', 'CAN-H/L stub to T43 (Holley 19303772); 22 vs 24 AWG trunk flagged'),
  W('126', 'E-Stopp Dash Button Trigger', 'DASH BUTTON', 22, 'M22759/32', 'ORN/WHT', 10.0, 'standalone_switch', 'Latching dash button -> E-Stopp signal pin (button PN TBD)'),
  W('85a', 'LED Headlight Left LOW Beam', 'DIMMER LO-OUT', 16, 'M22759/32', 'LT GRN', 4.0, 'led_lighting', 'Dimmer LOW -> left lamp LOW pin (Truck-Lite 27270C)'),
  W('85b', 'LED Headlight Left HIGH Beam', 'DIMMER HI-OUT', 16, 'M22759/32', 'LT GRN/BLK', 4.0, 'led_lighting', 'Dimmer HIGH -> left lamp HIGH pin; #121 taps here'),
  W('86a', 'LED Headlight Right LOW Beam', 'DIMMER LO-OUT', 16, 'M22759/32', 'LT GRN/WHT', 4.0, 'led_lighting', 'Paralleled with #85a at dimmer'),
  W('86b', 'LED Headlight Right HIGH Beam', 'DIMMER HI-OUT', 16, 'M22759/32', 'LT GRN/WHT/BLK', 4.0, 'led_lighting', 'Paralleled with #85b; 3-stripe remaps to 2-color at purchase'),
];
