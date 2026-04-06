// harnessRouting.ts — Harness-aware wire routing through trunk lines
// Routes wires along realistic harness trunk paths instead of direct spider web.
// Trunk → branch model: wires travel along major trunks, branching at junction points.

export interface TrunkNode {
  id: string;
  x: number;  // canvas coords (0-1000)
  y: number;
  zone: string;
  label: string;
}

export interface TrunkSegment {
  from: string;  // node id
  to: string;
  zone: string;
}

export interface HarnessGraph {
  nodes: TrunkNode[];
  segments: TrunkSegment[];
}

export interface HarnessRoutedWire {
  wireNumber: number;
  path: { x: number; y: number }[];  // ordered waypoints
  trunkSegments: string[];  // segment IDs used (for bundle rendering)
  branchFrom: string;  // trunk node where wire branches to device
  branchTo: { x: number; y: number };  // device position
}

// ── K5 Blazer Harness Trunk Graph ────────────────────────────────────
// Defines the main harness trunks and junction points.
// Positions in 1000x1000 canvas space (top-down view).
//
// The K5 has 4 main trunks:
//   1. Engine trunk — along the driver-side valve cover to firewall
//   2. Front trunk — across front of engine bay (headlights, horns)
//   3. Dash trunk — behind dash, left to right
//   4. Rear trunk — along frame rail to tail lights
//
// Grommets (firewall pass-through):
//   H1 — Driver side (main engine harness)
//   H2 — Center (HVAC, wiper)
//   H3 — Passenger side (A/C)
//   H4 — Lower center (trans, ground)

export const K5_HARNESS_GRAPH: HarnessGraph = {
  nodes: [
    // ── Front Crossbar (headlights, horns, radiator) ──
    { id: 'front-l', x: 200, y: 60, zone: 'engine_bay', label: 'Front Left Junction' },
    { id: 'front-c', x: 500, y: 55, zone: 'engine_bay', label: 'Front Center' },
    { id: 'front-r', x: 800, y: 60, zone: 'engine_bay', label: 'Front Right Junction' },

    // ── Engine Bay Main Trunk ──
    { id: 'eng-front-l', x: 350, y: 120, zone: 'engine_bay', label: 'Engine Front Left' },
    { id: 'eng-front-r', x: 650, y: 120, zone: 'engine_bay', label: 'Engine Front Right' },
    { id: 'eng-center', x: 500, y: 160, zone: 'engine_bay', label: 'Engine Center (Intake)' },
    { id: 'eng-mid-l', x: 380, y: 200, zone: 'engine_bay', label: 'Engine Mid Left' },
    { id: 'eng-mid-r', x: 620, y: 200, zone: 'engine_bay', label: 'Engine Mid Right' },
    { id: 'eng-lower-l', x: 380, y: 260, zone: 'engine_bay', label: 'Engine Lower Left' },
    { id: 'eng-lower-r', x: 620, y: 260, zone: 'engine_bay', label: 'Engine Lower Right' },
    { id: 'acc-drive', x: 700, y: 180, zone: 'engine_bay', label: 'Accessory Drive' },

    // ── Firewall Grommets ──
    { id: 'grommet-h1', x: 350, y: 310, zone: 'firewall', label: 'Grommet H1 (Driver)' },
    { id: 'grommet-h2', x: 480, y: 310, zone: 'firewall', label: 'Grommet H2 (Center)' },
    { id: 'grommet-h3', x: 620, y: 310, zone: 'firewall', label: 'Grommet H3 (Passenger)' },
    { id: 'grommet-h4', x: 500, y: 320, zone: 'firewall', label: 'Grommet H4 (Lower)' },

    // ── Dash Trunk ──
    { id: 'dash-l', x: 280, y: 380, zone: 'dash', label: 'Dash Left (Driver)' },
    { id: 'dash-cl', x: 400, y: 380, zone: 'dash', label: 'Dash Center-Left' },
    { id: 'dash-c', x: 500, y: 380, zone: 'dash', label: 'Dash Center' },
    { id: 'dash-cr', x: 600, y: 380, zone: 'dash', label: 'Dash Center-Right' },
    { id: 'dash-r', x: 720, y: 380, zone: 'dash', label: 'Dash Right (Passenger)' },

    // ── Under-Dash / Console ──
    { id: 'under-dash', x: 500, y: 450, zone: 'dash', label: 'Under Dash Center' },
    { id: 'console', x: 500, y: 500, zone: 'dash', label: 'Console / Tunnel' },

    // ── Door Branches ──
    { id: 'door-l', x: 170, y: 450, zone: 'doors', label: 'Door Left Junction' },
    { id: 'door-r', x: 830, y: 450, zone: 'doors', label: 'Door Right Junction' },

    // ── Rear Trunk (along frame rails) ──
    { id: 'rear-start', x: 500, y: 600, zone: 'rear', label: 'Rear Harness Start' },
    { id: 'rear-mid-l', x: 350, y: 700, zone: 'rear', label: 'Rear Mid Left' },
    { id: 'rear-mid-r', x: 650, y: 700, zone: 'rear', label: 'Rear Mid Right' },
    { id: 'rear-fuel', x: 550, y: 780, zone: 'rear', label: 'Fuel Pump Area' },
    { id: 'rear-tail-l', x: 220, y: 900, zone: 'rear', label: 'Tail Left' },
    { id: 'rear-tail-c', x: 500, y: 920, zone: 'rear', label: 'Tail Center' },
    { id: 'rear-tail-r', x: 780, y: 900, zone: 'rear', label: 'Tail Right' },
  ],
  segments: [
    // Front crossbar
    { from: 'front-l', to: 'front-c', zone: 'engine_bay' },
    { from: 'front-c', to: 'front-r', zone: 'engine_bay' },

    // Front to engine
    { from: 'front-l', to: 'eng-front-l', zone: 'engine_bay' },
    { from: 'front-r', to: 'eng-front-r', zone: 'engine_bay' },
    { from: 'front-c', to: 'eng-center', zone: 'engine_bay' },

    // Engine trunk (left side)
    { from: 'eng-front-l', to: 'eng-mid-l', zone: 'engine_bay' },
    { from: 'eng-mid-l', to: 'eng-lower-l', zone: 'engine_bay' },
    { from: 'eng-lower-l', to: 'grommet-h1', zone: 'engine_bay' },

    // Engine trunk (right side)
    { from: 'eng-front-r', to: 'eng-mid-r', zone: 'engine_bay' },
    { from: 'eng-mid-r', to: 'eng-lower-r', zone: 'engine_bay' },
    { from: 'eng-lower-r', to: 'grommet-h3', zone: 'engine_bay' },
    { from: 'eng-mid-r', to: 'acc-drive', zone: 'engine_bay' },

    // Center vertical trunk
    { from: 'eng-center', to: 'eng-mid-l', zone: 'engine_bay' },
    { from: 'eng-center', to: 'eng-mid-r', zone: 'engine_bay' },
    { from: 'eng-center', to: 'grommet-h2', zone: 'engine_bay' },

    // Lower crossbar to grommets
    { from: 'eng-lower-l', to: 'eng-lower-r', zone: 'engine_bay' },
    { from: 'grommet-h1', to: 'grommet-h2', zone: 'firewall' },
    { from: 'grommet-h2', to: 'grommet-h3', zone: 'firewall' },
    { from: 'grommet-h2', to: 'grommet-h4', zone: 'firewall' },

    // Firewall to dash
    { from: 'grommet-h1', to: 'dash-l', zone: 'dash' },
    { from: 'grommet-h2', to: 'dash-c', zone: 'dash' },
    { from: 'grommet-h3', to: 'dash-r', zone: 'dash' },
    { from: 'grommet-h4', to: 'under-dash', zone: 'dash' },

    // Dash crossbar
    { from: 'dash-l', to: 'dash-cl', zone: 'dash' },
    { from: 'dash-cl', to: 'dash-c', zone: 'dash' },
    { from: 'dash-c', to: 'dash-cr', zone: 'dash' },
    { from: 'dash-cr', to: 'dash-r', zone: 'dash' },

    // Dash to under-dash
    { from: 'dash-c', to: 'under-dash', zone: 'dash' },
    { from: 'under-dash', to: 'console', zone: 'dash' },

    // Door branches
    { from: 'dash-l', to: 'door-l', zone: 'doors' },
    { from: 'dash-r', to: 'door-r', zone: 'doors' },

    // Console to rear
    { from: 'console', to: 'rear-start', zone: 'rear' },

    // Rear trunk
    { from: 'rear-start', to: 'rear-mid-l', zone: 'rear' },
    { from: 'rear-start', to: 'rear-mid-r', zone: 'rear' },
    { from: 'rear-mid-l', to: 'rear-mid-r', zone: 'rear' },
    { from: 'rear-mid-r', to: 'rear-fuel', zone: 'rear' },
    { from: 'rear-mid-l', to: 'rear-tail-l', zone: 'rear' },
    { from: 'rear-mid-r', to: 'rear-tail-r', zone: 'rear' },
    { from: 'rear-tail-l', to: 'rear-tail-c', zone: 'rear' },
    { from: 'rear-tail-c', to: 'rear-tail-r', zone: 'rear' },
  ],
};

// ── Graph utilities ──

interface GraphNode {
  id: string;
  x: number;
  y: number;
  neighbors: string[];
}

function buildAdjacency(graph: HarnessGraph): Map<string, GraphNode> {
  const adj = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    adj.set(n.id, { id: n.id, x: n.x, y: n.y, neighbors: [] });
  }
  for (const s of graph.segments) {
    adj.get(s.from)?.neighbors.push(s.to);
    adj.get(s.to)?.neighbors.push(s.from);
  }
  return adj;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Find nearest trunk node to a point
function findNearestNode(x: number, y: number, graph: HarnessGraph): TrunkNode {
  let best = graph.nodes[0];
  let bestDist = Infinity;
  for (const n of graph.nodes) {
    const d = dist({ x, y }, n);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

// Dijkstra shortest path through trunk graph
function shortestPath(
  adj: Map<string, GraphNode>,
  startId: string,
  endId: string,
): string[] | null {
  if (startId === endId) return [startId];

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const unvisited = new Set<string>();

  for (const id of adj.keys()) {
    distances.set(id, Infinity);
    unvisited.add(id);
  }
  distances.set(startId, 0);

  while (unvisited.size > 0) {
    // Find nearest unvisited
    let current = '';
    let minDist = Infinity;
    for (const id of unvisited) {
      const d = distances.get(id)!;
      if (d < minDist) {
        minDist = d;
        current = id;
      }
    }
    if (!current || minDist === Infinity) return null;
    if (current === endId) break;

    unvisited.delete(current);
    const node = adj.get(current)!;

    for (const neighborId of node.neighbors) {
      if (!unvisited.has(neighborId)) continue;
      const neighbor = adj.get(neighborId)!;
      const edgeDist = dist(node, neighbor);
      const alt = minDist + edgeDist;
      if (alt < distances.get(neighborId)!) {
        distances.set(neighborId, alt);
        previous.set(neighborId, current);
      }
    }
  }

  // Reconstruct path
  const path: string[] = [];
  let curr: string | undefined = endId;
  while (curr) {
    path.unshift(curr);
    curr = previous.get(curr);
  }
  return path[0] === startId ? path : null;
}

// ── Main routing function ──

export interface HarnessRouteRequest {
  wireNumber: number;
  fromX: number;  // source device (ECU/PDM) position in canvas coords
  fromY: number;
  toX: number;    // target device position
  toY: number;
}

export function routeWiresAlongHarness(
  requests: HarnessRouteRequest[],
  graph: HarnessGraph = K5_HARNESS_GRAPH,
): HarnessRoutedWire[] {
  const adj = buildAdjacency(graph);
  const results: HarnessRoutedWire[] = [];

  // Count wires per trunk segment for bundle rendering
  const segmentUsage = new Map<string, number>();

  for (const req of requests) {
    const from = { x: req.fromX, y: req.fromY };
    const to = { x: req.toX, y: req.toY };

    // Find nearest trunk nodes
    const startNode = findNearestNode(from.x, from.y, graph);
    const endNode = findNearestNode(to.x, to.y, graph);

    // Route through trunk graph
    const trunkPath = shortestPath(adj, startNode.id, endNode.id);

    if (!trunkPath || trunkPath.length < 2) {
      // Fallback: direct line
      results.push({
        wireNumber: req.wireNumber,
        path: [from, to],
        trunkSegments: [],
        branchFrom: startNode.id,
        branchTo: to,
      });
      continue;
    }

    // Build full path: source → entry node → trunk → exit node → device
    const fullPath: { x: number; y: number }[] = [from];
    const segments: string[] = [];

    for (let i = 0; i < trunkPath.length; i++) {
      const node = adj.get(trunkPath[i])!;
      fullPath.push({ x: node.x, y: node.y });

      if (i < trunkPath.length - 1) {
        const segKey = [trunkPath[i], trunkPath[i + 1]].sort().join('→');
        segments.push(segKey);
        segmentUsage.set(segKey, (segmentUsage.get(segKey) ?? 0) + 1);
      }
    }

    fullPath.push(to);

    results.push({
      wireNumber: req.wireNumber,
      path: fullPath,
      trunkSegments: segments,
      branchFrom: endNode.id,
      branchTo: to,
    });
  }

  return results;
}

// ── Trunk segment rendering data ──
// Returns segments with wire counts for bundle thickness rendering

export interface TrunkRenderSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  wireCount: number;
  zone: string;
}

export function computeTrunkSegments(
  routedWires: HarnessRoutedWire[],
  graph: HarnessGraph = K5_HARNESS_GRAPH,
): TrunkRenderSegment[] {
  const adj = buildAdjacency(graph);
  const segmentCounts = new Map<string, number>();

  for (const wire of routedWires) {
    for (const segKey of wire.trunkSegments) {
      segmentCounts.set(segKey, (segmentCounts.get(segKey) ?? 0) + 1);
    }
  }

  const renderSegments: TrunkRenderSegment[] = [];
  for (const seg of graph.segments) {
    const key = [seg.from, seg.to].sort().join('→');
    const count = segmentCounts.get(key) ?? 0;
    if (count === 0) continue;

    const fromNode = adj.get(seg.from)!;
    const toNode = adj.get(seg.to)!;
    renderSegments.push({
      x1: fromNode.x,
      y1: fromNode.y,
      x2: toNode.x,
      y2: toNode.y,
      wireCount: count,
      zone: seg.zone,
    });
  }

  return renderSegments;
}
