// routeWire3D.audit.ts — not a unit test; a REPORT.
//
// Runs the router on a curated list of real K5 LS-swap wire pairs and prints
// what it chose: zone A, zone B, grommet, status, waypoint count, rough path
// length in meters. Compare the output against HARNESS_RULES.md sections
// 5.2 (zone boundaries), 5.5 (engine bay channel), 5.6 (firewall crossings),
// 5.7 (cabin channel), 5.8 (rear/frame channel).
//
// Run: npx tsx src/components/wiring/routeWire3D.audit.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeWire3D, classifyZone } from './routeWire3D';
import { getTraits } from './objectTraits';

type V3 = [number, number, number];
const __dirname_ = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname_, '../../../public/data');
const devs = JSON.parse(readFileSync(join(root, 'k5-device-positions.json'), 'utf8')) as Record<string, V3>;
const geom = JSON.parse(readFileSync(join(root, 'k5-geometry.json'), 'utf8')) as Record<string, { min: V3; max: V3 }>;

// Curated wire pairs — chosen because each exercises a different rule.
// "expect" is a free-text prediction of what HARNESS_RULES says should happen.
const PAIRS: Array<{ from: string; to: string; expect: string }> = [
  // R5 firewall crossings
  { from: 'M130', to: 'Fuel Injector 1', expect: 'engine bay → cabin ECU; must use firewall grommet H1/H2/H3' },
  { from: 'M130', to: 'Electronic Throttle Body', expect: 'cabin ECU → engine bay; grommet required' },
  { from: 'M130', to: 'MAP Sensor', expect: 'cabin ECU → engine bay (on intake); grommet required' },
  { from: 'M130', to: 'Coolant Temp Sensor (ECU)', expect: 'cabin ECU → engine bay; grommet required' },
  { from: 'PDM', to: 'Ignition Coil 1', expect: 'engine bay → engine bay; NO grommet, channel over intake' },

  // §5.8 rear loom — driver frame rail at Z≈0.45
  { from: 'M130', to: 'Fuel Level Sender', expect: 'cabin → rear; should dip to frame rail Z≈0.45' },
  { from: 'M130', to: 'Fuel Pump Relay', expect: 'cabin → engine bay (Y=-1.6); grommet required' },
  { from: 'PDM', to: 'Tail Light Left', expect: 'engine bay → rear; firewall grommet then frame rail' },
  { from: 'PDM', to: 'Third Brake Light', expect: 'engine bay → rear high; firewall + headliner' },

  // §5.5 engine bay channel over intake
  { from: 'Ignition Coil 1', to: 'Ignition Coil 4', expect: 'both engine bay; channel over intake' },
  { from: 'Horn', to: 'Headlight Left', expect: 'both engine bay forward; channel along fender' },
  { from: 'Starter', to: 'PDM', expect: 'both engine bay; straight run under intake' },

  // Cabin-only
  { from: 'Coolant Temp Gauge', to: 'Dome Light', expect: 'both cabin; dash crossbar to headliner' },
  { from: 'Wiper/Washer Switch', to: 'Windshield Wiper Motor', expect: 'cabin switch → engine bay motor; grommet via wiper hole' },
  { from: 'Brake Light Switch', to: 'Tail Light Left', expect: 'cabin switch → rear; frame rail after firewall' },
];

function pathLen(pts: V3[]): number {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[i + 1];
    s += Math.hypot(bx - ax, by - ay, bz - az);
  }
  return s;
}
function fmt(p: V3): string {
  return `[${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)}]`;
}

console.log('='.repeat(88));
console.log('ROUTE AUDIT — K5 LS-SWAP WIRE PAIRS');
console.log(`devices: ${Object.keys(devs).length}  geometry objects: ${Object.keys(geom).length}`);
console.log('='.repeat(88));

let okN = 0, detourN = 0, violationN = 0, missingN = 0;

for (const p of PAIRS) {
  const a = devs[p.from];
  const b = devs[p.to];
  if (!a || !b) {
    console.log(`\n  MISSING ${p.from} → ${p.to}: ${!a ? 'no position for ' + p.from : ''} ${!b ? 'no position for ' + p.to : ''}`);
    missingN++;
    continue;
  }
  const za = classifyZone(a);
  const zb = classifyZone(b);
  const r = routeWire3D(a, b, geom);
  if (r.status === 'ok') okN++;
  else if (r.status === 'detour') detourN++;
  else violationN++;

  const straight = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const routed = pathLen(r.waypoints);
  const stretch = ((routed / straight - 1) * 100).toFixed(0);

  console.log(`\n  ${p.from} → ${p.to}`);
  console.log(`    expect : ${p.expect}`);
  console.log(`    zones  : ${za}  →  ${zb}`);
  console.log(`    a=${fmt(a)}  b=${fmt(b)}`);
  console.log(`    status : ${r.status.toUpperCase()}  grommet: ${r.grommet ?? '—'}  waypoints: ${r.waypoints.length}`);
  console.log(`    length : straight=${straight.toFixed(2)}m  routed=${routed.toFixed(2)}m  (+${stretch}%)`);
  if (r.waypoints.length > 2) {
    for (let i = 1; i < r.waypoints.length - 1; i++) {
      console.log(`      via ${fmt(r.waypoints[i])} zone=${classifyZone(r.waypoints[i])}`);
    }
  }
  if (r.status === 'violation') {
    // Which obstacle still blocks? Check each segment of the routed polyline
    // against the full geometry set (no Z filter) to report what it hits.
    const hits = new Set<string>();
    for (let i = 0; i < r.waypoints.length - 1; i++) {
      const [x1, y1, z1] = r.waypoints[i];
      const [x2, y2, z2] = r.waypoints[i + 1];
      const z = Math.max(z1, z2);
      for (const [name, obj] of Object.entries(geom)) {
        const t = getTraits(name);
        if (t.channel_along) continue;
        if (t.category === 'lighting') continue;
        // z overlap
        if (obj.max[2] < z - 0.05) continue;
        if (obj.min[2] > z + 0.05) continue;
        if (t.channel_over && z >= obj.max[2] - 0.05) continue;
        // simple segment-vs-bbox in XY
        const mx = (obj.min[0] + obj.max[0]) / 2;
        const my = (obj.min[1] + obj.max[1]) / 2;
        // crude: point-to-segment distance to bbox center
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;
        const t0 = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / lenSq));
        const cx = x1 + t0 * dx;
        const cy = y1 + t0 * dy;
        if (cx >= obj.min[0] - 0.04 && cx <= obj.max[0] + 0.04 &&
            cy >= obj.min[1] - 0.04 && cy <= obj.max[1] + 0.04) {
          hits.add(name + ` (Z=${obj.min[2].toFixed(2)}..${obj.max[2].toFixed(2)}, at legZ=${z.toFixed(2)})`);
        }
      }
    }
    if (hits.size) console.log(`    blockers: ${[...hits].join('; ')}`);
  }
}

console.log('\n' + '='.repeat(88));
console.log(`SUMMARY  ok:${okN}  detour:${detourN}  violation:${violationN}  missing:${missingN}`);
console.log('='.repeat(88));
