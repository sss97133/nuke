// obstacleRouting.ts — physically-aware wire routing
//
// A wire harness cannot pass through solid mass. This module loads the
// Blender model's world-bounding-boxes (`k5-geometry.json`) and uses them
// as obstacles in a 2D top-down projection. Pigtails and trunk segments
// that would pass through an obstacle get a detour waypoint inserted at
// the nearest corner of the obstacle's inflated bounding box.
//
// The "inflation" margin is the safety clearance (default 1.5 inches —
// roughly the diameter of a wrapped sub-loom). Wires route ALONGSIDE
// solid mass, never THROUGH it.
//
// Coordinate system: 2D point = [x, y] in board inches.

export type Pt = { x: number; y: number };
export type Bbox = { xMin: number; yMin: number; xMax: number; yMax: number; name: string };

/** Inflate a bbox outward by `margin` inches. */
export function inflate(b: Bbox, margin: number): Bbox {
  return {
    xMin: b.xMin - margin,
    yMin: b.yMin - margin,
    xMax: b.xMax + margin,
    yMax: b.yMax + margin,
    name: b.name,
  };
}

/** True if point p is strictly inside bbox b. */
export function pointInBbox(p: Pt, b: Bbox): boolean {
  return p.x > b.xMin && p.x < b.xMax && p.y > b.yMin && p.y < b.yMax;
}

/** Liang-Barsky line-vs-rect intersection. Returns true if segment a→b
 *  enters the bbox (even partially). */
export function segmentIntersectsBbox(a: Pt, b: Pt, box: Bbox): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.xMin, box.xMax - a.x, a.y - box.yMin, box.yMax - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 < t1;
}

/** Squared distance from point p to segment a→b. */
function distToSegSq(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return (p.x - cx) ** 2 + (p.y - cy) ** 2;
}

/** Pick the corner of the inflated bbox that's nearest to the line a→b
 *  but on the outside of the obstacle. Returns the corner that creates
 *  the shortest detour. */
export function pickDetourCorner(a: Pt, b: Pt, box: Bbox): Pt {
  // 4 corners of the inflated bbox
  const corners: Pt[] = [
    { x: box.xMin, y: box.yMin },
    { x: box.xMax, y: box.yMin },
    { x: box.xMin, y: box.yMax },
    { x: box.xMax, y: box.yMax },
  ];
  // Pick the one with the smallest total path length a → corner → b
  let best = corners[0];
  let bestLen = Infinity;
  for (const c of corners) {
    const d1 = Math.hypot(c.x - a.x, c.y - a.y);
    const d2 = Math.hypot(b.x - c.x, b.y - c.y);
    const total = d1 + d2;
    if (total < bestLen) {
      bestLen = total;
      best = c;
    }
  }
  return best;
}

/** Route a path from a → b that avoids ALL obstacles by detouring around
 *  the nearest blocking obstacle's corner. Recursive — if the detour
 *  itself intersects another obstacle, route around that one too.
 *  Capped at maxDepth to prevent infinite loops in pathological geometry. */
export function routeAroundObstacles(
  a: Pt,
  b: Pt,
  obstacles: Bbox[],
  margin = 1.5,
  maxDepth = 4,
): Pt[] {
  if (maxDepth <= 0) return [a, b];

  // Inflate obstacles for safety clearance
  const inflated = obstacles.map(o => inflate(o, margin));

  // Find FIRST blocking obstacle along the segment (closest to a)
  let firstHit: Bbox | null = null;
  let firstHitDist = Infinity;
  for (const box of inflated) {
    // Skip if either endpoint is INSIDE the obstacle (device placed there
    // — usually because device is mounted ON the obstacle, e.g., MAP
    // sensor on intake). Allow the wire to start/end inside.
    if (pointInBbox(a, box) || pointInBbox(b, box)) continue;
    if (segmentIntersectsBbox(a, b, box)) {
      const d = distToSegSq(a, { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 }, a);
      if (d < firstHitDist) {
        firstHitDist = d;
        firstHit = box;
      }
    }
  }
  if (!firstHit) return [a, b];

  const detour = pickDetourCorner(a, b, firstHit);
  // Guard against pathological loops: if the detour corner coincides with
  // either endpoint (a is ON the inflated bbox boundary, e.g. a previous
  // recursion landed exactly on this corner), we can't make progress on
  // this obstacle. Accept the direct segment rather than recurse forever
  // picking the same corner. Caller may still flag it as a violation.
  const EPS = 1e-3;
  const detourAtA = Math.hypot(detour.x - a.x, detour.y - a.y) < EPS;
  const detourAtB = Math.hypot(detour.x - b.x, detour.y - b.y) < EPS;
  if (detourAtA || detourAtB) return [a, b];
  // Recurse on each leg — the detour might itself hit another obstacle
  const left = routeAroundObstacles(a, detour, obstacles, margin, maxDepth - 1);
  const right = routeAroundObstacles(detour, b, obstacles, margin, maxDepth - 1);
  // Concat without duplicating the shared midpoint
  return [...left.slice(0, -1), ...right];
}

// ── K5 Blender bbox → 2D obstacle ────────────────────────────────────
// Object-level blocking is decided by the TRAIT TABLE (objectTraits.ts).
// An object blocks wire passage when its pierceable score is below a
// threshold AND it doesn't have a "channel along/over" traversal route.
// This way, editing one trait row reshapes the whole routing system —
// no hardcoded list of names to keep in sync.
import { getTraits, passThroughScore } from './objectTraits';

const PIERCE_THRESHOLD = 0.3;  // below this = treated as solid obstacle

function isBlockingObject(name: string): boolean {
  const traits = getTraits(name);
  // If the object can be channeled along or over, it's NOT a blocking
  // obstacle to wire routing (you go AROUND or OVER it, not through).
  if (traits.channel_along || traits.channel_over) return false;
  // Otherwise, block if pierceability is below threshold
  return passThroughScore(traits) < PIERCE_THRESHOLD;
}

type GeomObj = {
  min: [number, number, number];
  max: [number, number, number];
};

/** Convert Blender geometry → 2D top-down obstacles in board inches.
 *  Requires the Blender→board projection function from the formboard. */
export function buildK5Obstacles(
  geom: Record<string, GeomObj> | null,
  proj: (bx: number, by: number) => [number, number],
): Bbox[] {
  if (!geom) return [];
  const out: Bbox[] = [];
  for (const [name, obj] of Object.entries(geom)) {
    if (!isBlockingObject(name)) continue;
    // Project the 4 corners of the XY footprint, take min/max in board space
    const corners: Array<[number, number]> = [
      proj(obj.min[0], obj.min[1]),
      proj(obj.max[0], obj.min[1]),
      proj(obj.min[0], obj.max[1]),
      proj(obj.max[0], obj.max[1]),
    ];
    const xs = corners.map(c => c[0]);
    const ys = corners.map(c => c[1]);
    out.push({
      xMin: Math.min(...xs),
      yMin: Math.min(...ys),
      xMax: Math.max(...xs),
      yMax: Math.max(...ys),
      name,
    });
  }
  return out;
}
