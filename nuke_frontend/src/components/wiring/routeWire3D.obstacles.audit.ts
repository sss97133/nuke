// Print every object the router considers an obstacle. If this list is too
// short, the 2D obstacle set is empty and detours never fire.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTraits, passThroughScore, K5_OBJECT_TRAITS } from './objectTraits';

type V3 = [number, number, number];
const __d = dirname(fileURLToPath(import.meta.url));
const geom = JSON.parse(readFileSync(join(__d, '../../../public/data/k5-geometry.json'), 'utf8')) as Record<string, { min: V3; max: V3 }>;

const PIERCE_THRESHOLD = 0.3;
console.log('object                                  category    material                     pierce  along  over   → ROLE');
console.log('-'.repeat(120));
let blockN = 0, channelN = 0, pierceableN = 0;
for (const [name, obj] of Object.entries(geom)) {
  const t = getTraits(name);
  const pierce = passThroughScore(t);
  const hasEntry = K5_OBJECT_TRAITS[name] ? '*' : ' ';
  let role = '';
  if (t.channel_along || t.channel_over) { role = 'CHANNEL'; channelN++; }
  else if (pierce >= PIERCE_THRESHOLD) { role = 'pierceable'; pierceableN++; }
  else { role = 'OBSTACLE'; blockN++; }
  const dx = (obj.max[0] - obj.min[0]).toFixed(2);
  const dy = (obj.max[1] - obj.min[1]).toFixed(2);
  console.log(
    `${hasEntry}${name.padEnd(40)} ${t.category.padEnd(11)} ${t.material.padEnd(27)} ${pierce.toFixed(2).padStart(5)}  ${String(t.channel_along).padEnd(5)}  ${String(t.channel_over).padEnd(5)}  → ${role.padEnd(10)}  xy=${dx}×${dy}m`
  );
}
console.log('-'.repeat(120));
console.log(`total=${Object.keys(geom).length}  obstacles=${blockN}  channels=${channelN}  pierceable=${pierceableN}`);
console.log('(*  = entry in K5_OBJECT_TRAITS; otherwise trait inferred from name)');
