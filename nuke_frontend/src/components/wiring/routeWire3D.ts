// routeWire3D.ts — 3D wire path routing with zone + grommet + obstacle awareness.
//
// The 3D harness view must not lie. Straight lines between devices pass through
// engine blocks, dashes, and firewall sheet metal — violating the system's own
// HARNESS_RULES.md (R3 no pass-through, R4 no piercing sheet metal, R5 firewall
// crossings via grommets H1–H4 only).
//
// This router produces a polyline of Blender-space waypoints for every wire:
//   1. Classify each endpoint into a zone (engine_bay / cabin / rear / underbody)
//   2. If the wire crosses the firewall boundary, inject a grommet waypoint
//      (H1/H2/H3/H4/FB/WP) picked by minimizing total path length
//   3. Route each 2D top-down leg around blocking objects via the existing
//      routeAroundObstacles() corner-detour algorithm
//   4. Lift back to 3D by assigning each waypoint a Z height based on its
//      zone's canonical channel height (per HARNESS_RULES.md §5.5–5.8)
//   5. Flag unavoidable rule violations (recursion cap hit, no reachable
//      grommet) so the renderer can show them in red — honesty over silence.

import {
  type Bbox,
  type Pt,
  inflate,
  pointInBbox,
  segmentIntersectsBbox,
  routeAroundObstacles,
} from './obstacleRouting';
import { K5_OBJECT_TRAITS, getTraits } from './objectTraits';

export type Route3DStatus = 'ok' | 'detour' | 'violation';

export interface Route3DResult {
  /** Polyline waypoints in Blender meters. First = a, last = b. */
  waypoints: Array<[number, number, number]>;
  status: Route3DStatus;
  /** Id of firewall/body grommet used, if any (H1/H2/H3/H4/FB/WP). */
  grommet?: string;
}

export type Zone = 'engine_bay' | 'cabin' | 'rear' | 'underbody';

// Blender frame: X = width (driver+), Y = length (front-), Z = height (up+).
// Zone thresholds come from inspection of k5-device-positions.json ranges
// and firewall grommet Y (-1.02…-1.05) in K5_OBJECT_TRAITS.Exterior_Body_Blazer.
// Z is used as a tiebreaker near the firewall: dash gauges sit at Z ≥ 1.2
// but the GLB places some of them 1–2 cm forward of Y=-1.05 (modeling noise
// / dash cowl curvature). Treat high-Z near-firewall points as cabin dash
// even if Y technically crosses — they're never in the engine bay.
const DASH_Z = 1.20;
export function classifyZone(p: [number, number, number]): Zone {
  const y = p[1];
  const z = p[2];
  if (y > 1.0) return 'rear';
  if (z < 0.4) return 'underbody';
  if (y < -1.05 && z < DASH_Z) return 'engine_bay';
  return 'cabin';
}

// Canonical channel Z per zone, per HARNESS_RULES.md §5.5–5.8.
//   §5.5 engine bay: over top of intake (Z ≈ 1.05)
//   §5.7 cabin:      behind dash padding (Z ≈ 0.95)
//   §5.8 rear:       inside driver frame rail C-channel (Z ≈ 0.45)
//   underbody:       under floor pan (Z ≈ 0.40)
const ZONE_Z: Record<Zone, number> = {
  engine_bay: 1.05,
  cabin: 0.95,
  rear: 0.45,
  underbody: 0.40,
};

// Driver-side frame rail X per HARNESS_RULES §5.8 / objectTraits Under_Frame_Blazer.
// The rear loom rides inside the C-channel on the driver rail.
const FRAME_RAIL_X = 0.45;
const FRAME_RAIL_Z = 0.45;
// Cab→rear transition Y — at the back of the cab where the bed (or in the
// K5's case, the removable rear) begins.
const REAR_ENTRY_Y = 1.0;

// 1.5-inch safety clearance around obstacles, expressed in Blender meters.
const MARGIN_M = 0.038;

// Categories that are never obstacles — their bboxes are too thin or too
// permeable to block routing in 2D top-down (emblems, license plates,
// headlight lenses, bumpers, single-plane glass). Everything else that
// isn't a channel is treated as solid mass.
const NON_OBSTACLE_CATEGORIES = new Set(['lighting']);

type GeomObj = { min: [number, number, number]; max: [number, number, number] };

/** Build XY-plane obstacles from Blender geometry for a wire routing at
 *  channel height `z` (Blender meters). The Z-aware filter is what makes
 *  the router honest without needing a full 3D graph:
 *    1. channel_along objects are excluded (you route ALONG, not around)
 *    2. objects whose vertical bbox doesn't straddle `z` are excluded —
 *       a wheel (top ≈ 0.7) doesn't block cabin wires at Z=0.95; the
 *       engine (top ≈ 1.0) doesn't block engine-bay wires at Z=1.05
 *    3. channel_over objects that sit ENTIRELY below `z` are excluded
 *       (wire runs over the top, per §5.5 "over intake")
 *    4. trivially thin footprints (emblems, trim strips) are excluded
 *  Anything else — seats, dashes, steering wheels, engine at wire Z —
 *  becomes a 2D obstacle the router must detour around. */
const Z_CLEARANCE = 0.05; // 5 cm vertical wiggle room before counting as "blocked"
function buildObstaclesAtZ(geom: Record<string, GeomObj>, z: number): Bbox[] {
  const out: Bbox[] = [];
  for (const [name, obj] of Object.entries(geom)) {
    const traits = getTraits(name);
    if (traits.channel_along) continue;
    if (NON_OBSTACLE_CATEGORIES.has(traits.category)) continue;
    const dx = obj.max[0] - obj.min[0];
    const dy = obj.max[1] - obj.min[1];
    if (dx < 0.05 || dy < 0.05) continue;
    // Z overlap: skip obstacles entirely above or entirely below this leg.
    if (obj.max[2] < z - Z_CLEARANCE) continue;
    if (obj.min[2] > z + Z_CLEARANCE) continue;
    // channel_over: wire that's at or above the top routes OVER it (§5.5).
    if (traits.channel_over && z >= obj.max[2] - Z_CLEARANCE) continue;
    out.push({
      xMin: obj.min[0],
      yMin: obj.min[1],
      xMax: obj.max[0],
      yMax: obj.max[1],
      name,
    });
  }
  return out;
}

/** Pick the firewall/body grommet that minimizes total path length a→hole→b.
 *  Same pattern as pickDetourCorner() in obstacleRouting.ts. */
function pickGrommet(
  a: [number, number, number],
  b: [number, number, number],
): { id: string; pos: [number, number, number] } | null {
  const holes = K5_OBJECT_TRAITS.Exterior_Body_Blazer.factory_holes;
  if (!holes || holes.length === 0) return null;
  let best: { id: string; pos: [number, number, number] } | null = null;
  let bestLen = Infinity;
  for (const h of holes) {
    const d1 = Math.hypot(h.pos[0] - a[0], h.pos[1] - a[1], h.pos[2] - a[2]);
    const d2 = Math.hypot(h.pos[0] - b[0], h.pos[1] - b[1], h.pos[2] - b[2]);
    const total = d1 + d2;
    if (total < bestLen) {
      bestLen = total;
      best = { id: h.id, pos: h.pos };
    }
  }
  return best;
}

/** Main router. Given two Blender-space device positions and the geometry map,
 *  return the polyline the harness should follow and a status flag. */
export function routeWire3D(
  a: [number, number, number],
  b: [number, number, number],
  geom: Record<string, GeomObj> | null,
): Route3DResult {
  const zoneA = classifyZone(a);
  const zoneB = classifyZone(b);

  // Firewall crossing: any wire with one endpoint in the engine bay must
  // pass through a designated grommet (R5).
  const needsFirewall = (zoneA === 'engine_bay') !== (zoneB === 'engine_bay');

  let grommet: { id: string; pos: [number, number, number] } | null = null;
  if (needsFirewall) {
    grommet = pickGrommet(a, b);
    if (!grommet) {
      // No grommet reachable → rule violation. Render as straight line in red.
      return { waypoints: [a, b], status: 'violation' };
    }
  }

  // Rear-channel injection (HARNESS_RULES §5.8). When exactly one endpoint
  // is in the rear zone, force the path along the driver frame rail: enter
  // at Y=REAR_ENTRY_Y and exit near the rear endpoint. Without the second
  // waypoint, wires cut diagonally across the rear wheel well — rail-then-
  // diagonal is the shape we want instead.
  const rearCrossing = (zoneA === 'rear') !== (zoneB === 'rear');
  const rearPoint = zoneA === 'rear' ? a : b;
  const rearEntry: [number, number, number] | null = rearCrossing
    ? [FRAME_RAIL_X, REAR_ENTRY_Y, FRAME_RAIL_Z]
    : null;
  // Rail-exit: stay on the rail until 15 cm before the rear endpoint's Y,
  // then fork out to the endpoint. Only needed if the endpoint is >30 cm
  // past the entry (short rear-zone runs don't need it).
  const railExit: [number, number, number] | null =
    rearCrossing && Math.abs(rearPoint[1] - REAR_ENTRY_Y) > 0.3
      ? [FRAME_RAIL_X, rearPoint[1] - 0.15, FRAME_RAIL_Z]
      : null;

  // Build the anchor polyline in the correct order from a to b:
  //   [a, ...(grommet if any), ...(rear waypoints if any), b]
  // When a is the REAR endpoint the rear waypoints come BEFORE the grommet
  // (path from rear → cab → engine bay). Otherwise grommet first, then rear.
  const anchors3D: Array<[number, number, number]> = [a];
  if (zoneA === 'rear' && rearCrossing) {
    if (railExit) anchors3D.push(railExit);
    if (rearEntry) anchors3D.push(rearEntry);
    if (grommet) anchors3D.push(grommet.pos);
  } else {
    if (grommet) anchors3D.push(grommet.pos);
    if (rearEntry) anchors3D.push(rearEntry);
    if (railExit) anchors3D.push(railExit);
  }
  anchors3D.push(b);

  // Route each leg with Z-aware obstacles. The leg's routing Z is the
  // higher endpoint Z — wires climb to channel height, they don't dip
  // below it between anchors.
  const routedPts: Pt[] = [];
  const legZs: number[] = []; // Z chosen per-segment, used for lift-to-3D below
  let hadDetour = false;
  for (let i = 0; i < anchors3D.length - 1; i++) {
    const pA = anchors3D[i];
    const pB = anchors3D[i + 1];
    const legZ = Math.max(pA[2], pB[2]);
    const legObstacles = geom ? buildObstaclesAtZ(geom, legZ) : [];
    const leg = routeAroundObstacles(
      { x: pA[0], y: pA[1] },
      { x: pB[0], y: pB[1] },
      legObstacles,
      MARGIN_M,
      4,
    );
    if (leg.length > 2) hadDetour = true;
    if (i === 0) {
      routedPts.push(...leg);
      for (let j = 0; j < leg.length - 1; j++) legZs.push(legZ);
    } else {
      routedPts.push(...leg.slice(1));
      for (let j = 0; j < leg.length - 1; j++) legZs.push(legZ);
    }
  }

  // Violation detection: after routing, if any segment STILL crosses a
  // Z-appropriate obstacle, the corner-detour cap was hit. Check each
  // segment against the obstacle set valid for that segment's Z.
  let violation = false;
  outer: for (let i = 0; i < routedPts.length - 1; i++) {
    const p1 = routedPts[i];
    const p2 = routedPts[i + 1];
    const z = legZs[i] ?? ZONE_Z.cabin;
    const segObstacles = geom ? buildObstaclesAtZ(geom, z) : [];
    const inflated = segObstacles.map(o => inflate(o, MARGIN_M));
    for (const box of inflated) {
      if (pointInBbox(p1, box) || pointInBbox(p2, box)) continue;
      if (segmentIntersectsBbox(p1, p2, box)) {
        violation = true;
        break outer;
      }
    }
  }

  // Lift 2D polyline back to 3D.
  const waypoints: Array<[number, number, number]> = routedPts.map((p, idx) => {
    if (idx === 0) return a;
    if (idx === routedPts.length - 1) return b;
    // Grommet waypoint keeps its own Z (holes are drilled at a known height).
    if (
      grommet &&
      Math.abs(p.x - grommet.pos[0]) < 1e-6 &&
      Math.abs(p.y - grommet.pos[1]) < 1e-6
    ) {
      return grommet.pos;
    }
    // Rear-entry / rail-exit waypoints ride the frame rail at Z=0.45.
    for (const rp of [rearEntry, railExit]) {
      if (rp && Math.abs(p.x - rp[0]) < 1e-6 && Math.abs(p.y - rp[1]) < 1e-6) {
        return rp;
      }
    }
    // Detour corner → Z of whichever zone this XY sits in. We infer zone from
    // Y only here; underbody can't be reached by a detour from an above-floor
    // endpoint, so defaulting to the above-floor channel Z is correct.
    const yOnly: [number, number, number] = [p.x, p.y, ZONE_Z.cabin];
    const z = ZONE_Z[classifyZone(yOnly)];
    return [p.x, p.y, z];
  });

  const status: Route3DStatus = violation ? 'violation' : hadDetour ? 'detour' : 'ok';
  return { waypoints, status, grommet: grommet?.id };
}
