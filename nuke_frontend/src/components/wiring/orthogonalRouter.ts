// orthogonalRouter.ts — Channel-based orthogonal routing for wiring diagrams
// Pure TypeScript, zero React dependencies. Deterministic output.

export interface RouteRequest {
  wireNumber: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  gauge: number;
}

export interface ObstacleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  direction: 'horizontal' | 'vertical';
}

export interface RoutedWire {
  wireNumber: number;
  segments: PathSegment[];
  corners: { x: number; y: number }[];
  totalLength: number;
}

// ── Single wire routing ──────────────────────────────────────────────

export function routeSingleWire(
  from: { x: number; y: number },
  to: { x: number; y: number },
): PathSegment[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Same point — no route
  if (dx === 0 && dy === 0) return [];

  // Pure horizontal
  if (dy === 0) {
    return [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y, direction: 'horizontal' }];
  }

  // Pure vertical
  if (dx === 0) {
    return [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y, direction: 'vertical' }];
  }

  // L-route: prefer horizontal-first when |dx| >= |dy|, vertical-first otherwise
  if (Math.abs(dx) >= Math.abs(dy)) {
    return [
      { x1: from.x, y1: from.y, x2: to.x, y2: from.y, direction: 'horizontal' },
      { x1: to.x, y1: from.y, x2: to.x, y2: to.y, direction: 'vertical' },
    ];
  }
  return [
    { x1: from.x, y1: from.y, x2: from.x, y2: to.y, direction: 'vertical' },
    { x1: from.x, y1: to.y, x2: to.x, y2: to.y, direction: 'horizontal' },
  ];
}

// ── Z-route: 3-segment midpoint routing ──────────────────────────────

function zRoute(
  from: { x: number; y: number },
  to: { x: number; y: number },
  midX: number,
): PathSegment[] {
  const segments: PathSegment[] = [];

  // Horizontal to midpoint X
  if (midX !== from.x) {
    segments.push({ x1: from.x, y1: from.y, x2: midX, y2: from.y, direction: 'horizontal' });
  }

  // Vertical to destination Y
  if (to.y !== from.y) {
    segments.push({ x1: midX, y1: from.y, x2: midX, y2: to.y, direction: 'vertical' });
  }

  // Horizontal to destination X
  if (to.x !== midX) {
    segments.push({ x1: midX, y1: to.y, x2: to.x, y2: to.y, direction: 'horizontal' });
  }

  return segments;
}

// ── Channel grouping key ─────────────────────────────────────────────

function channelKey(r: RouteRequest): string {
  // Bucket endpoints into 50-unit zones to detect wires sharing a channel
  const fromZoneX = Math.round(r.fromX / 50);
  const fromZoneY = Math.round(r.fromY / 50);
  const toZoneX = Math.round(r.toX / 50);
  const toZoneY = Math.round(r.toY / 50);
  return `${fromZoneX},${fromZoneY}->${toZoneX},${toZoneY}`;
}

// ── Extract corners from segments ────────────────────────────────────

function extractCorners(segments: PathSegment[]): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    corners.push({ x: segments[i].x2, y: segments[i].y2 });
  }
  return corners;
}

// ── Compute total length ─────────────────────────────────────────────

function totalLength(segments: PathSegment[]): number {
  let len = 0;
  for (const s of segments) {
    len += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
  }
  return len;
}

// ── Offset segments perpendicular to travel for parallel wires ───────

function offsetSegments(segments: PathSegment[], offset: number): PathSegment[] {
  return segments.map((s) => {
    if (s.direction === 'horizontal') {
      return { ...s, y1: s.y1 + offset, y2: s.y2 + offset };
    }
    return { ...s, x1: s.x1 + offset, x2: s.x2 + offset };
  });
}

// ── Main: route all wires ────────────────────────────────────────────

export function routeWires(
  requests: RouteRequest[],
  obstacles: ObstacleRect[],
  channelSpacing: number = 3,
): RoutedWire[] {
  if (requests.length === 0) return [];

  // Group wires by channel to detect parallel runs
  const channelCounts = new Map<string, number>();
  for (const r of requests) {
    const key = channelKey(r);
    channelCounts.set(key, (channelCounts.get(key) ?? 0) + 1);
  }

  const channelIndex = new Map<string, number>();
  const results: RoutedWire[] = [];

  for (const req of requests) {
    const from = { x: req.fromX, y: req.fromY };
    const to = { x: req.toX, y: req.toY };

    // Same point
    if (from.x === to.x && from.y === to.y) {
      results.push({ wireNumber: req.wireNumber, segments: [], corners: [], totalLength: 0 });
      continue;
    }

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const key = channelKey(req);
    const peerCount = channelCounts.get(key) ?? 1;
    const idx = channelIndex.get(key) ?? 0;
    channelIndex.set(key, idx + 1);

    let segments: PathSegment[];

    // Pure horizontal or vertical — simple route
    if (dy === 0 || dx === 0) {
      segments = routeSingleWire(from, to);
    } else if (peerCount <= 1) {
      // No channel peers — use L-route or Z-route based on geometry
      if (Math.abs(dx) < 40 || Math.abs(dy) < 40) {
        segments = routeSingleWire(from, to);
      } else {
        const midX = from.x + dx * 0.5;
        segments = zRoute(from, to, midX);
      }
    } else {
      // Multiple wires in same channel — alternate L/Z routing + offset
      const useZ = idx % 2 === 0;
      if (useZ) {
        // Stagger midpoints so Z-routes don't overlap
        const ratio = 0.35 + (idx / peerCount) * 0.3;
        const midX = from.x + dx * ratio;
        segments = zRoute(from, to, midX);
      } else {
        // Alternating H-V vs V-H L-routes
        const hvFirst = idx % 4 < 2;
        if (hvFirst) {
          segments = [
            { x1: from.x, y1: from.y, x2: to.x, y2: from.y, direction: 'horizontal' },
            { x1: to.x, y1: from.y, x2: to.x, y2: to.y, direction: 'vertical' },
          ];
        } else {
          segments = [
            { x1: from.x, y1: from.y, x2: from.x, y2: to.y, direction: 'vertical' },
            { x1: from.x, y1: to.y, x2: to.x, y2: to.y, direction: 'horizontal' },
          ];
        }
      }

      // Offset parallel wires
      if (peerCount > 1) {
        const centerOffset = ((peerCount - 1) * channelSpacing) / 2;
        const wireOffset = idx * channelSpacing - centerOffset;
        segments = offsetSegments(segments, wireOffset);
      }
    }

    results.push({
      wireNumber: req.wireNumber,
      segments,
      corners: extractCorners(segments),
      totalLength: totalLength(segments),
    });
  }

  return results;
}
