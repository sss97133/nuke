import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: imgs } = await sb.from('vehicle_images')
  .select('taken_at, vehicle_zone')
  .eq('vehicle_id', 'a90c008a-3379-41d8-9eb2-b4eda365d74c')
  .not('taken_at', 'is', null)
  .order('taken_at');

const months = {};
for (const img of imgs) {
  const m = img.taken_at.slice(0, 7);
  if (!months[m]) months[m] = { total: 0, zones: {} };
  months[m].total++;
  const z = img.vehicle_zone || 'unzoned';
  months[m].zones[z] = (months[m].zones[z] || 0) + 1;
}

console.log('=== RESTORATION PHOTO TIMELINE ===');
console.log(`taken_at coverage: ${imgs.length} / 1242\n`);
for (const [m, d] of Object.entries(months).sort()) {
  const top = Object.entries(d.zones).sort((a,b) => b[1]-a[1]).slice(0, 4).map(([z,c]) => `${z}:${c}`).join(', ');
  console.log(`${m.padEnd(8)} ${String(d.total).padStart(4)} | ${top}`);
}

// Also count observations
const { data: obs } = await sb.from('vehicle_observations')
  .select('kind')
  .eq('vehicle_id', 'a90c008a-3379-41d8-9eb2-b4eda365d74c');
console.log(`\n=== OBSERVATIONS: ${obs.length} total ===`);
const kinds = {};
for (const o of obs) kinds[o.kind] = (kinds[o.kind] || 0) + 1;
for (const [k, c] of Object.entries(kinds).sort()) console.log(`  ${k}: ${c}`);
