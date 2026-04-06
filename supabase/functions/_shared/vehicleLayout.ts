// vehicleLayout.ts — Vehicle-layout SVG diagram generator (v2)
// Generates plan-view SVGs showing wires routed on the actual truck.
// Design: truck outline is the canvas. Devices are dots at physical positions.
// Trunks are the primary visual. Labels only on key devices.

import type { WireSpec, ComputeResult } from './wiringCompute.ts';

// ── Types ─────────────────────────────────────────────────────────────

interface TrunkNode { id: string; x: number; y: number; zone: string; label: string }
interface TrunkSegment { from: string; to: string; zone: string }
interface HarnessGraph { nodes: TrunkNode[]; segments: TrunkSegment[] }

export interface HarnessRoutedWire {
  wireNumber: number;
  path: { x: number; y: number }[];
  trunkSegments: string[];
  branchFrom: string;
  branchTo: { x: number; y: number };
  wire: WireSpec;
}

interface TrunkRenderSeg { x1: number; y1: number; x2: number; y2: number; wireCount: number; zone: string }

export interface VehicleDiagramOptions {
  showBulkhead?: boolean;
  highlightZone?: string | null;
  view?: 'plan' | 'engine_bay' | 'power';
  width?: number;
  height?: number;
}

// ── Canvas layout ─────────────────────────────────────────────────────
// Landscape 4200×1800. Truck on left (200-2400), legend on right (2500-4100).
// Truck oriented front-at-top. ~2.3:1 aspect ratio preserved.
// pos_x_pct (0=driver/left, 100=passenger/right) → X across truck width
// pos_y_pct (0=front, 100=rear) → Y along truck length

const CW = 4200;
const CH = 1800;

// Truck bounding box on canvas
const TRUCK = { x: 300, y: 80, w: 1800, h: 1640 }; // 2.3:1 width matches GM proportions
// The truck is narrower than tall in plan view, so body width ~ 780 units within the 1800 horizontal space
const BODY_LEFT = TRUCK.x + 510;   // 810 — left body edge
const BODY_RIGHT = TRUCK.x + 1290; // 1590 — right body edge
const BODY_W = BODY_RIGHT - BODY_LEFT; // 780

// Zone Y bands (within truck Y range)
const ZONE_Y: Record<string, { y0: number; y1: number }> = {
  engine_bay: { y0: 80,   y1: 500  },
  firewall:   { y0: 500,  y1: 560  },
  dash:       { y0: 560,  y1: 960  },
  doors:      { y0: 620,  y1: 900  },
  rear:       { y0: 960,  y1: 1600 },
  underbody:  { y0: 400,  y1: 1400 },
  roof:       { y0: 600,  y1: 900  },
};

const ZONE_COLORS: Record<string, string> = {
  engine_bay: '#cc3333', firewall: '#cc6600', dash: '#3377dd',
  doors: '#8855bb', rear: '#33aa44', underbody: '#aa6633', roof: '#777777',
};

// Convert manifest position to canvas coords (directly on the truck, not in zone boxes)
function toCanvas(xPct: number | null, yPct: number | null, zone: string): { x: number; y: number } {
  const zy = ZONE_Y[zone] || { y0: 400, y1: 1200 };
  const x = BODY_LEFT + ((xPct ?? 50) / 100) * BODY_W;
  const y = zy.y0 + ((yPct ?? 50) / 100) * (zy.y1 - zy.y0);
  return { x, y };
}

// ── K5 body outline (plan view, front at top) ─────────────────────────
// Scaled so body sits within BODY_LEFT..BODY_RIGHT, Y: 80..1640

function bodyPath(): string {
  const L = BODY_LEFT, R = BODY_RIGHT, cx = (L + R) / 2;
  return [
    `M ${cx - 200},100`,                       // Front bumper left
    `Q ${cx},70 ${cx + 200},100`,              // Front bumper curve
    `L ${R + 30},120`,                          // R fender start
    `Q ${R + 60},140 ${R + 70},180`,           // R fender round
    `L ${R + 70},270`,                          // R fender side
    `Q ${R + 75},310 ${R + 70},350`,           // R wheel well front
    `Q ${R + 60},390 ${R + 50},400`,           // R wheel well peak
    `Q ${R + 40},415 ${R + 30},430`,           // R wheel well rear
    `L ${R + 20},500`,                          // Pre-door
    `L ${R + 30},540`,                          // Door step out
    `L ${R + 30},880`,                          // Door panel
    `L ${R + 20},920`,                          // Post-door
    `L ${R + 30},1100`,                         // R rear fender
    `Q ${R + 60},1150 ${R + 70},1200`,         // R rear wheel front
    `Q ${R + 75},1240 ${R + 70},1280`,         // R rear wheel peak
    `Q ${R + 60},1320 ${R + 50},1340`,         // R rear wheel rear
    `L ${R + 30},1440`,                         // R quarter
    `Q ${R + 20},1520 ${R},1580`,              // R tailgate corner
    `Q ${cx},1620 ${L},1580`,                  // Tailgate curve
    `Q ${L - 20},1520 ${L - 30},1440`,         // L quarter
    `L ${L - 50},1340`,                         // L rear wheel rear
    `Q ${L - 60},1320 ${L - 70},1280`,
    `Q ${L - 75},1240 ${L - 70},1200`,
    `Q ${L - 60},1150 ${L - 30},1100`,
    `L ${L - 20},920`,                          // Post-door
    `L ${L - 30},880`,                          // Door
    `L ${L - 30},540`,
    `L ${L - 20},500`,                          // Pre-door
    `L ${L - 30},430`,                          // L wheel well rear
    `Q ${L - 40},415 ${L - 50},400`,
    `Q ${L - 60},390 ${L - 70},350`,
    `Q ${L - 75},310 ${L - 70},270`,
    `L ${L - 70},180`,
    `Q ${L - 60},140 ${L - 30},120`,
    `L ${cx - 200},100 Z`,
  ].join(' ');
}

// Frame rails
function frameRails(): string[] {
  const lx = BODY_LEFT + 100, rx = BODY_RIGHT - 100;
  return [
    `M ${lx},100 L ${lx},1600`,
    `M ${rx},100 L ${rx},1600`,
  ];
}

// Firewall line
function firewallY(): number { return ZONE_Y.firewall.y0 + 30; }

// Wheel positions (for wheel circles)
function wheels(): { cx: number; cy: number }[] {
  return [
    { cx: BODY_LEFT - 40, cy: 370 }, { cx: BODY_RIGHT + 40, cy: 370 },    // front
    { cx: BODY_LEFT - 40, cy: 1250 }, { cx: BODY_RIGHT + 40, cy: 1250 },  // rear
  ];
}

// ── Harness trunk graph ───────────────────────────────────────────────
// Node positions directly in canvas space

const K5_GRAPH: HarnessGraph = {
  nodes: [
    // Front crossbar
    { id: 'fl', x: BODY_LEFT + 50,  y: 130, zone: 'engine_bay', label: 'Front L' },
    { id: 'fc', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 120, zone: 'engine_bay', label: 'Front C' },
    { id: 'fr', x: BODY_RIGHT - 50, y: 130, zone: 'engine_bay', label: 'Front R' },
    // Engine bay
    { id: 'el', x: BODY_LEFT + 150, y: 220, zone: 'engine_bay', label: 'Eng L' },
    { id: 'ec', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 260, zone: 'engine_bay', label: 'Eng C' },
    { id: 'er', x: BODY_RIGHT - 150, y: 220, zone: 'engine_bay', label: 'Eng R' },
    { id: 'ell', x: BODY_LEFT + 150, y: 380, zone: 'engine_bay', label: 'Eng Lower L' },
    { id: 'elr', x: BODY_RIGHT - 150, y: 380, zone: 'engine_bay', label: 'Eng Lower R' },
    { id: 'acc', x: BODY_RIGHT - 80, y: 300, zone: 'engine_bay', label: 'Accessory' },
    // Firewall grommets
    { id: 'g1', x: BODY_LEFT + 120, y: firewallY(), zone: 'firewall', label: 'H1' },
    { id: 'g2', x: (BODY_LEFT + BODY_RIGHT) / 2 - 40, y: firewallY(), zone: 'firewall', label: 'H2' },
    { id: 'g3', x: BODY_RIGHT - 120, y: firewallY(), zone: 'firewall', label: 'H3' },
    { id: 'g4', x: (BODY_LEFT + BODY_RIGHT) / 2, y: firewallY() + 20, zone: 'firewall', label: 'H4' },
    // Dash trunk
    { id: 'dl', x: BODY_LEFT + 80, y: 640, zone: 'dash', label: 'Dash L' },
    { id: 'dcl', x: BODY_LEFT + 230, y: 640, zone: 'dash', label: 'Dash CL' },
    { id: 'dc', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 640, zone: 'dash', label: 'Dash C' },
    { id: 'dcr', x: BODY_RIGHT - 230, y: 640, zone: 'dash', label: 'Dash CR' },
    { id: 'dr', x: BODY_RIGHT - 80, y: 640, zone: 'dash', label: 'Dash R' },
    // Under-dash
    { id: 'ud', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 760, zone: 'dash', label: 'Under Dash' },
    { id: 'cn', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 880, zone: 'dash', label: 'Console' },
    // Doors
    { id: 'drl', x: BODY_LEFT - 20, y: 750, zone: 'doors', label: 'Door L' },
    { id: 'drr', x: BODY_RIGHT + 20, y: 750, zone: 'doors', label: 'Door R' },
    // Rear trunk
    { id: 'rs', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 1020, zone: 'rear', label: 'Rear Start' },
    { id: 'rml', x: BODY_LEFT + 150, y: 1160, zone: 'rear', label: 'Rear Mid L' },
    { id: 'rmr', x: BODY_RIGHT - 150, y: 1160, zone: 'rear', label: 'Rear Mid R' },
    { id: 'rf', x: (BODY_LEFT + BODY_RIGHT) / 2 + 40, y: 1300, zone: 'rear', label: 'Fuel' },
    { id: 'tl', x: BODY_LEFT + 60, y: 1500, zone: 'rear', label: 'Tail L' },
    { id: 'tc', x: (BODY_LEFT + BODY_RIGHT) / 2, y: 1540, zone: 'rear', label: 'Tail C' },
    { id: 'tr', x: BODY_RIGHT - 60, y: 1500, zone: 'rear', label: 'Tail R' },
  ],
  segments: [
    { from: 'fl', to: 'fc', zone: 'engine_bay' }, { from: 'fc', to: 'fr', zone: 'engine_bay' },
    { from: 'fl', to: 'el', zone: 'engine_bay' }, { from: 'fr', to: 'er', zone: 'engine_bay' },
    { from: 'fc', to: 'ec', zone: 'engine_bay' },
    { from: 'el', to: 'ec', zone: 'engine_bay' }, { from: 'er', to: 'ec', zone: 'engine_bay' },
    { from: 'el', to: 'ell', zone: 'engine_bay' }, { from: 'er', to: 'elr', zone: 'engine_bay' },
    { from: 'er', to: 'acc', zone: 'engine_bay' },
    { from: 'ell', to: 'elr', zone: 'engine_bay' },
    { from: 'ell', to: 'g1', zone: 'engine_bay' }, { from: 'elr', to: 'g3', zone: 'engine_bay' },
    { from: 'ec', to: 'g2', zone: 'engine_bay' },
    { from: 'g1', to: 'g2', zone: 'firewall' }, { from: 'g2', to: 'g3', zone: 'firewall' },
    { from: 'g2', to: 'g4', zone: 'firewall' },
    { from: 'g1', to: 'dl', zone: 'dash' }, { from: 'g2', to: 'dc', zone: 'dash' },
    { from: 'g3', to: 'dr', zone: 'dash' }, { from: 'g4', to: 'ud', zone: 'dash' },
    { from: 'dl', to: 'dcl', zone: 'dash' }, { from: 'dcl', to: 'dc', zone: 'dash' },
    { from: 'dc', to: 'dcr', zone: 'dash' }, { from: 'dcr', to: 'dr', zone: 'dash' },
    { from: 'dc', to: 'ud', zone: 'dash' }, { from: 'ud', to: 'cn', zone: 'dash' },
    { from: 'dl', to: 'drl', zone: 'doors' }, { from: 'dr', to: 'drr', zone: 'doors' },
    { from: 'cn', to: 'rs', zone: 'rear' },
    { from: 'rs', to: 'rml', zone: 'rear' }, { from: 'rs', to: 'rmr', zone: 'rear' },
    { from: 'rml', to: 'rmr', zone: 'rear' }, { from: 'rmr', to: 'rf', zone: 'rear' },
    { from: 'rml', to: 'tl', zone: 'rear' }, { from: 'rmr', to: 'tr', zone: 'rear' },
    { from: 'tl', to: 'tc', zone: 'rear' }, { from: 'tc', to: 'tr', zone: 'rear' },
  ],
};

// ── Graph utilities (Dijkstra) ────────────────────────────────────────

interface GN { id: string; x: number; y: number; neighbors: string[] }
function buildAdj(g: HarnessGraph): Map<string, GN> {
  const m = new Map<string, GN>();
  for (const n of g.nodes) m.set(n.id, { ...n, neighbors: [] });
  for (const s of g.segments) { m.get(s.from)?.neighbors.push(s.to); m.get(s.to)?.neighbors.push(s.from); }
  return m;
}
function d(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function nearest(x: number, y: number, g: HarnessGraph): TrunkNode {
  let b = g.nodes[0], bd = Infinity;
  for (const n of g.nodes) { const dd = d({ x, y }, n); if (dd < bd) { bd = dd; b = n; } }
  return b;
}
function dijkstra(adj: Map<string, GN>, s: string, e: string): string[] | null {
  if (s === e) return [s];
  const dist = new Map<string, number>(), prev = new Map<string, string>(), vis = new Set<string>();
  for (const id of adj.keys()) { dist.set(id, Infinity); vis.add(id); }
  dist.set(s, 0);
  while (vis.size > 0) {
    let cur = '', md = Infinity;
    for (const id of vis) { const dd = dist.get(id)!; if (dd < md) { md = dd; cur = id; } }
    if (!cur || md === Infinity) return null;
    if (cur === e) break;
    vis.delete(cur);
    const n = adj.get(cur)!;
    for (const nb of n.neighbors) {
      if (!vis.has(nb)) continue;
      const alt = md + d(n, adj.get(nb)!);
      if (alt < dist.get(nb)!) { dist.set(nb, alt); prev.set(nb, cur); }
    }
  }
  const p: string[] = []; let c: string | undefined = e;
  while (c) { p.unshift(c); c = prev.get(c); }
  return p[0] === s ? p : null;
}

// ── Route wires through trunks ────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export function routeWiresThroughTrunks(wires: WireSpec[], devices: any[]): HarnessRoutedWire[] {
  const adj = buildAdj(K5_GRAPH);
  const results: HarnessRoutedWire[] = [];
  // deno-lint-ignore no-explicit-any
  const dpos = new Map<string, { x: number; y: number }>();
  for (const dd of devices) dpos.set(dd.device_name, toCanvas(dd.pos_x_pct ? parseFloat(dd.pos_x_pct) : null, dd.pos_y_pct ? parseFloat(dd.pos_y_pct) : null, dd.location_zone || 'dash'));
  const ecuP = dpos.get('ECU') || toCanvas(35, 44, 'dash');
  const pdmP = dpos.get('Power Distribution Module') || toCanvas(35, 44, 'dash');

  for (const w of wires) {
    const from = w.fromDevice.startsWith('PDM') ? pdmP : ecuP;
    const to = dpos.get(w.toDevice) || toCanvas(50, 50, w.toLocation);
    const sn = nearest(from.x, from.y, K5_GRAPH);
    const en = nearest(to.x, to.y, K5_GRAPH);
    const tp = dijkstra(adj, sn.id, en.id);
    if (!tp || tp.length < 2) {
      results.push({ wireNumber: w.wireNumber, path: [from, to], trunkSegments: [], branchFrom: sn.id, branchTo: to, wire: w });
      continue;
    }
    const fp: { x: number; y: number }[] = [from];
    const segs: string[] = [];
    for (let i = 0; i < tp.length; i++) {
      const n = adj.get(tp[i])!;
      fp.push({ x: n.x, y: n.y });
      if (i < tp.length - 1) segs.push([tp[i], tp[i + 1]].sort().join('>'));
    }
    fp.push(to);
    results.push({ wireNumber: w.wireNumber, path: fp, trunkSegments: segs, branchFrom: en.id, branchTo: to, wire: w });
  }
  return results;
}

function computeTrunks(rw: HarnessRoutedWire[]): TrunkRenderSeg[] {
  const adj = buildAdj(K5_GRAPH);
  const cnt = new Map<string, number>();
  for (const w of rw) for (const s of w.trunkSegments) cnt.set(s, (cnt.get(s) ?? 0) + 1);
  const out: TrunkRenderSeg[] = [];
  for (const seg of K5_GRAPH.segments) {
    const k = [seg.from, seg.to].sort().join('>');
    const c = cnt.get(k) ?? 0;
    if (c === 0) continue;
    const f = adj.get(seg.from)!, t = adj.get(seg.to)!;
    out.push({ x1: f.x, y1: f.y, x2: t.x, y2: t.y, wireCount: c, zone: seg.zone });
  }
  return out;
}

// ── SVG helpers ───────────────────────────────────────────────────────

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

const WIRE_CSS: Record<string, string> = {
  'RED': '#cc0000', 'BLK': '#222', 'WHT': '#ddd', 'GRN': '#228b22', 'BLU': '#2266cc',
  'YEL': '#ccaa00', 'ORG': '#cc6600', 'BRN': '#8b4513', 'VIO': '#7744aa', 'PNK': '#cc6688',
  'GRY': '#888', 'TAN': '#d2b48c', 'LT GRN': '#90ee90', 'DK GRN': '#006400',
  'LT BLU': '#87ceeb', 'DK BLU': '#003366', 'PPL': '#660099',
};
function wireCol(c: string): string { return WIRE_CSS[c.split('/')[0]] || '#888'; }

// ── Main renderer ─────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export function renderPlanViewSvg(devices: any[], result: ComputeResult, opts: VehicleDiagramOptions = {}): string {
  const showBulk = opts.showBulkhead !== false;
  const hlZone = opts.highlightZone || null;

  const wires = showBulk ? result.wires : result.wires.map(w => ({ ...w, routesThroughBulkhead: false, bulkheadPin: null }));
  const routed = routeWiresThroughTrunks(wires, devices);
  const trunks = computeTrunks(routed);

  // Device positions
  // deno-lint-ignore no-explicit-any
  const devs: { name: string; x: number; y: number; zone: string; amps: number; sig: string }[] = [];
  for (const dd of devices) {
    if (dd.signal_type === 'bulkhead_passthrough' && !showBulk) continue;
    const p = toCanvas(dd.pos_x_pct ? parseFloat(dd.pos_x_pct) : null, dd.pos_y_pct ? parseFloat(dd.pos_y_pct) : null, dd.location_zone || 'dash');
    devs.push({ name: dd.device_name, x: p.x, y: p.y, zone: dd.location_zone || 'dash', amps: parseFloat(dd.power_draw_amps) || 0, sig: dd.signal_type || '' });
  }

  // Key devices get labels (>5A, ECU, PDM, bulkhead, controllers)
  const keyDevices = new Set<string>();
  for (const dd of devs) {
    if (dd.amps >= 5 || dd.sig === 'ecu' || dd.name === 'Power Distribution Module' || dd.sig === 'bulkhead_passthrough' || dd.sig === 'controller' || dd.sig === 'can_bus' || dd.sig === 'can_display' || dd.name.includes('Battery') || dd.name.includes('Alternator')) {
      keyDevices.add(dd.name);
    }
  }

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}">`);
  o.push(`<defs><style>
text{font-family:'Courier New',monospace;fill:#ccc}
.t{font-size:28px;font-weight:bold;fill:#fff;letter-spacing:3px}
.s{font-size:14px;fill:#999}
.zl{font-size:13px;font-weight:bold;letter-spacing:2px;fill-opacity:0.7}
.dl{font-size:10px;fill:#ddd}
.wl{font-size:9px;fill:#aaa}
.kd{font-size:11px;fill:#fff;font-weight:bold}
</style></defs>`);

  // Background
  o.push(`<rect width="${CW}" height="${CH}" fill="#111"/>`);

  // ── Body outline ──
  o.push(`<g id="body" opacity="0.35">`);
  o.push(`  <path d="${bodyPath()}" fill="none" stroke="#666" stroke-width="3"/>`);
  for (const r of frameRails()) o.push(`  <path d="${r}" stroke="#444" stroke-width="6" stroke-dasharray="16,8"/>`);
  // Wheels
  for (const w of wheels()) o.push(`  <circle cx="${w.cx}" cy="${w.cy}" r="40" fill="#222" stroke="#555" stroke-width="2"/>`);
  o.push('</g>');

  // ── Zone bands (subtle horizontal bands) ──
  o.push('<g id="zones">');
  for (const [zid, zy] of Object.entries(ZONE_Y)) {
    if (zid === 'underbody' || zid === 'roof') continue; // skip overlay zones
    const op = hlZone === zid ? 0.15 : 0.04;
    const sw = hlZone === zid ? 2 : 0.5;
    const zc = ZONE_COLORS[zid] || '#888';
    o.push(`  <rect x="${BODY_LEFT - 80}" y="${zy.y0}" width="${BODY_W + 160}" height="${zy.y1 - zy.y0}" fill="${zc}" fill-opacity="${op}" stroke="${zc}" stroke-width="${sw}" stroke-opacity="0.3" rx="3"/>`);
    o.push(`  <text x="${BODY_LEFT - 90}" y="${zy.y0 + 16}" text-anchor="end" class="zl" fill="${zc}">${zid.replace('_', ' ').toUpperCase()}</text>`);
  }
  // Firewall line
  const fwy = firewallY();
  o.push(`  <line x1="${BODY_LEFT - 80}" y1="${fwy}" x2="${BODY_RIGHT + 80}" y2="${fwy}" stroke="#cc6600" stroke-width="3" stroke-dasharray="12,6"/>`);
  o.push('</g>');

  // ── Trunk bundles (the main visual) ──
  o.push('<g id="trunks">');
  for (const t of trunks) {
    const th = Math.min(3 + t.wireCount * 1.2, 18);
    const c = ZONE_COLORS[t.zone] || '#888';
    o.push(`  <line x1="${r2(t.x1)}" y1="${r2(t.y1)}" x2="${r2(t.x2)}" y2="${r2(t.y2)}" stroke="${c}" stroke-width="${r2(th)}" stroke-opacity="0.55" stroke-linecap="round"/>`);
    // Wire count badge on significant trunks
    if (t.wireCount >= 4) {
      const mx = r2((t.x1 + t.x2) / 2), my = r2((t.y1 + t.y2) / 2);
      o.push(`  <circle cx="${mx}" cy="${my}" r="11" fill="#1a1a1a" stroke="${c}" stroke-width="1.5"/>`);
      o.push(`  <text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="9" fill="#fff">${t.wireCount}</text>`);
    }
  }
  o.push('</g>');

  // ── Branch stubs (trunk → device, thin dashed) ──
  o.push('<g id="branches" opacity="0.35">');
  for (const rw of routed) {
    if (rw.path.length < 3) continue;
    // First branch (source → first trunk node)
    const a = rw.path[0], b = rw.path[1];
    o.push(`  <line x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}" stroke="${wireCol(rw.wire.color)}" stroke-width="0.7" stroke-dasharray="3,3"/>`);
    // Last branch (last trunk node → device)
    const p = rw.path[rw.path.length - 2], q = rw.path[rw.path.length - 1];
    o.push(`  <line x1="${r2(p.x)}" y1="${r2(p.y)}" x2="${r2(q.x)}" y2="${r2(q.y)}" stroke="${wireCol(rw.wire.color)}" stroke-width="0.7" stroke-dasharray="3,3"/>`);
  }
  o.push('</g>');

  // ── Device dots ──
  o.push('<g id="devices">');
  for (const dd of devs) {
    const c = ZONE_COLORS[dd.zone] || '#888';
    const r = dd.sig === 'ecu' || dd.name === 'Power Distribution Module' ? 8 : dd.sig === 'bulkhead_passthrough' ? 10 : dd.amps >= 10 ? 5 : 3;
    o.push(`  <circle cx="${r2(dd.x)}" cy="${r2(dd.y)}" r="${r}" fill="${c}" fill-opacity="0.7" stroke="${c}" stroke-width="1"/>`);
  }
  o.push('</g>');

  // ── Key device labels (only important ones, with leader lines) ──
  o.push('<g id="device-labels">');
  const labelledY: number[] = []; // track Y positions to avoid overlap
  for (const dd of devs) {
    if (!keyDevices.has(dd.name)) continue;
    // Determine label side: devices left of center → label goes further left, else right
    const cx = (BODY_LEFT + BODY_RIGHT) / 2;
    const labelOnRight = dd.x >= cx;
    let lx = labelOnRight ? BODY_RIGHT + 120 : BODY_LEFT - 120;
    let ly = dd.y;

    // Simple vertical deconflict
    for (const prev of labelledY) { if (Math.abs(ly - prev) < 18) ly = prev + 18; }
    labelledY.push(ly);

    const anchor = labelOnRight ? 'start' : 'end';
    const ampStr = dd.amps > 0 ? ` ${dd.amps}A` : '';
    o.push(`  <line x1="${r2(dd.x)}" y1="${r2(dd.y)}" x2="${r2(lx)}" y2="${r2(ly)}" stroke="#555" stroke-width="0.5" stroke-dasharray="2,2"/>`);
    o.push(`  <text x="${r2(lx)}" y="${r2(ly + 4)}" text-anchor="${anchor}" class="kd">${esc(dd.name)}${ampStr}</text>`);
  }
  o.push('</g>');

  // ── Bulkhead connector (special circle at firewall) ──
  if (showBulk && result.bulkhead.present) {
    const bx = (BODY_LEFT + BODY_RIGHT) / 2;
    const by = fwy;
    o.push('<g id="bulkhead">');
    o.push(`  <circle cx="${bx}" cy="${by}" r="24" fill="#1a1a1a" stroke="#cc6600" stroke-width="3"/>`);
    o.push(`  <circle cx="${bx}" cy="${by}" r="19" fill="none" stroke="#cc6600" stroke-width="1" stroke-dasharray="3,2"/>`);
    o.push(`  <text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="10" fill="#fff">${result.bulkhead.pins_used}/${result.bulkhead.pins_available}</text>`);
    o.push(`  <text x="${bx}" y="${by - 32}" text-anchor="middle" font-size="11" fill="#cc6600" font-weight="bold">MILSPEC BULKHEAD</text>`);
    o.push('</g>');
  }

  // ── Legend panel (right side) ──
  const LX = 2500, LY = 80, LW = 1600, LH = 1640;
  o.push('<g id="legend">');
  o.push(`  <rect x="${LX}" y="${LY}" width="${LW}" height="${LH}" fill="#161616" stroke="#333" stroke-width="1" rx="4"/>`);

  // Title
  o.push(`  <text x="${LX + 30}" y="${LY + 40}" class="t">HARNESS ROUTING PLAN</text>`);
  o.push(`  <text x="${LX + 30}" y="${LY + 62}" class="s">1977 K5 Blazer — LS3 Swap — Top Down</text>`);
  o.push(`  <line x1="${LX + 30}" y1="${LY + 72}" x2="${LX + LW - 30}" y2="${LY + 72}" stroke="#333" stroke-width="1"/>`);

  // Stats
  let sy = LY + 100;
  const stats = [
    ['Wires', `${result.summary.total_wires}`],
    ['Total Length', `${result.summary.total_wire_length_ft} ft`],
    ['ECU', result.ecu.model],
    ['PDM', `${result.pdm.model} (${result.pdm.channels_used}/${result.pdm.channels_available} ch)`],
    ['Alternator', `${result.alternator.amps}A (${result.alternator.recommendation})`],
    ['Continuous Draw', `${result.summary.total_continuous_amps}A`],
    ['Shielded', `${result.summary.shielded_wires}`],
    ['Twisted Pairs', `${result.summary.twisted_pairs}`],
  ];
  if (result.bulkhead.present) {
    stats.push(['Bulkhead', `${result.bulkhead.pins_used}/${result.bulkhead.pins_available} pins`]);
  }
  for (const [k, v] of stats) {
    o.push(`  <text x="${LX + 30}" y="${sy}" class="s">${k}:</text>`);
    o.push(`  <text x="${LX + 200}" y="${sy}" font-size="14" fill="#fff">${v}</text>`);
    sy += 22;
  }
  sy += 10;
  o.push(`  <line x1="${LX + 30}" y1="${sy}" x2="${LX + LW - 30}" y2="${sy}" stroke="#333" stroke-width="1"/>`);
  sy += 20;

  // Zone key
  o.push(`  <text x="${LX + 30}" y="${sy}" font-size="13" fill="#888" font-weight="bold">ZONES</text>`);
  sy += 20;
  for (const [zid, zc] of Object.entries(ZONE_COLORS)) {
    if (zid === 'underbody' || zid === 'roof') continue;
    const count = devs.filter(dd => dd.zone === zid).length;
    const wireCount = wires.filter(w => w.toLocation === zid || w.fromLocation === zid).length;
    o.push(`  <rect x="${LX + 30}" y="${sy - 10}" width="14" height="14" fill="${zc}" fill-opacity="0.6" rx="2"/>`);
    o.push(`  <text x="${LX + 52}" y="${sy + 1}" font-size="12" fill="#ccc">${zid.replace('_', ' ').toUpperCase()}</text>`);
    o.push(`  <text x="${LX + 250}" y="${sy + 1}" font-size="11" fill="#888">${count} devices, ${wireCount} wires</text>`);
    sy += 20;
  }
  sy += 10;
  o.push(`  <line x1="${LX + 30}" y1="${sy}" x2="${LX + LW - 30}" y2="${sy}" stroke="#333" stroke-width="1"/>`);
  sy += 20;

  // Device list by zone (compact two-column)
  o.push(`  <text x="${LX + 30}" y="${sy}" font-size="13" fill="#888" font-weight="bold">ALL DEVICES (${devs.length})</text>`);
  sy += 16;
  const zones = ['engine_bay', 'firewall', 'dash', 'doors', 'rear', 'underbody'];
  const col2x = LX + 800;
  let col = 0;
  for (const z of zones) {
    const zdevs = devs.filter(dd => dd.zone === z);
    if (zdevs.length === 0) continue;
    const startX = col === 0 ? LX + 30 : col2x;
    const zc = ZONE_COLORS[z] || '#888';
    o.push(`  <text x="${startX}" y="${sy}" font-size="11" fill="${zc}" font-weight="bold">${z.replace('_', ' ').toUpperCase()} (${zdevs.length})</text>`);
    sy += 14;
    for (const dd of zdevs) {
      if (sy > LY + LH - 30) break;
      const ampStr = dd.amps > 0 ? ` ${dd.amps}A` : '';
      o.push(`  <text x="${startX + 8}" y="${sy}" font-size="9" fill="#999">${esc(dd.name)}${ampStr}</text>`);
      sy += 12;
    }
    sy += 6;
    if (sy > LY + LH / 2 && col === 0) { col = 1; sy = LY + 100 + stats.length * 22 + zones.slice(0, zones.indexOf(z) + 1).reduce((a, zz) => a + devs.filter(dd => dd.zone === zz).length * 12 + 20, 0); sy = LY + 340; }
  }

  // Warnings
  if (result.warnings.length > 0) {
    const wy = LY + LH - 20 - result.warnings.length * 16;
    o.push(`  <line x1="${LX + 30}" y1="${wy - 10}" x2="${LX + LW - 30}" y2="${wy - 10}" stroke="#442222" stroke-width="1"/>`);
    let wyi = wy;
    for (const w of result.warnings.slice(0, 6)) {
      o.push(`  <text x="${LX + 30}" y="${wyi}" font-size="10" fill="#cc4444">${esc(w)}</text>`);
      wyi += 16;
    }
  }

  o.push('</g>');

  // ── Footer ──
  o.push(`<text x="20" y="${CH - 10}" font-size="9" fill="#444">Generated ${new Date().toISOString().substring(0, 10)} | Nuke Vehicle Data Platform | ${result.vehicle_id.substring(0, 8)}</text>`);

  o.push('</svg>');
  return o.join('\n');
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

// ── Zone detail view ──────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export function renderZoneDetailSvg(zone: string, devices: any[], result: ComputeResult): string {
  const zWires = result.wires.filter(w => w.fromLocation === zone || w.toLocation === zone);
  // deno-lint-ignore no-explicit-any
  const zDevs = devices.filter((dd: any) => dd.location_zone === zone);
  const zc = ZONE_COLORS[zone] || '#888';
  const vw = 1600, vh = 1000;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}">`);
  o.push(`<style>text{font-family:'Courier New',monospace;fill:#eee}</style>`);
  o.push(`<rect width="${vw}" height="${vh}" fill="#111"/>`);
  o.push(`<rect x="20" y="20" width="${vw - 40}" height="${vh - 40}" fill="${zc}" fill-opacity="0.06" stroke="${zc}" stroke-width="2" rx="4"/>`);
  o.push(`<text x="40" y="55" font-size="22" font-weight="bold" fill="${zc}">${zone.replace('_', ' ').toUpperCase()} — ${zDevs.length} DEVICES, ${zWires.length} WIRES</text>`);

  const cols = Math.min(Math.ceil(Math.sqrt(zDevs.length)), 6);
  // deno-lint-ignore no-explicit-any
  zDevs.forEach((dd: any, i: number) => {
    const col = i % cols, row = Math.floor(i / cols);
    const dx = 80 + col * ((vw - 160) / Math.max(cols, 1));
    const dy = 100 + row * 50;
    if (dy > vh - 60) return;
    const amps = parseFloat(dd.power_draw_amps) || 0;
    const ampStr = amps > 0 ? ` (${amps}A)` : '';
    o.push(`<circle cx="${dx - 40}" cy="${dy}" r="4" fill="${zc}"/>`);
    o.push(`<text x="${dx - 30}" y="${dy + 4}" font-size="11" fill="#ccc">${esc(dd.device_name)}${ampStr}</text>`);
  });

  o.push(`<text x="40" y="${vh - 25}" font-size="11" fill="#666">${zWires.length} wires | ${zWires.filter(w => w.routesThroughBulkhead).length} through bulkhead</text>`);
  o.push('</svg>');
  return o.join('\n');
}
