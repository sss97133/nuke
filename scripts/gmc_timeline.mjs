import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const VID = 'a90c008a-3379-41d8-9eb2-b4eda365d74c';

// 1. Photo timeline
const { data: imgs } = await sb.from('vehicle_images')
  .select('taken_at, created_at, vehicle_zone, source, file_name')
  .eq('vehicle_id', VID)
  .order('created_at');

const months = {};
for (const img of imgs) {
  const dt = img.taken_at || img.created_at;
  const m = dt ? dt.slice(0, 7) : 'unknown';
  if (!months[m]) months[m] = { total: 0, zones: {} };
  months[m].total++;
  const z = img.vehicle_zone || 'unzoned';
  months[m].zones[z] = (months[m].zones[z] || 0) + 1;
}

console.log('\n=== PHOTO TIMELINE BY MONTH ===');
for (const [m, d] of Object.entries(months).sort()) {
  const top = Object.entries(d.zones).sort((a,b) => b[1]-a[1]).slice(0, 4).map(([z,c]) => `${z}:${c}`).join(', ');
  console.log(`${m} | ${d.total} photos | ${top}`);
}

// 2. Check taken_at coverage
const withTaken = imgs.filter(i => i.taken_at).length;
console.log(`\n=== METADATA COVERAGE ===`);
console.log(`taken_at: ${withTaken}/${imgs.length} (${Math.round(withTaken/imgs.length*100)}%)`);

// 3. BaT auction data
const { data: vehicle } = await sb.from('vehicles')
  .select('*')
  .eq('id', VID)
  .single();

console.log('\n=== VEHICLE RECORD ===');
console.log('year:', vehicle.year);
console.log('make:', vehicle.make);
console.log('model:', vehicle.model);
console.log('engine:', vehicle.engine);
console.log('transmission:', vehicle.transmission);
console.log('sale_price:', vehicle.sale_price);
console.log('auction_status:', vehicle.auction_status);
console.log('vin:', vehicle.vin);
console.log('exterior_color:', vehicle.exterior_color);
console.log('interior_color:', vehicle.interior_color);
console.log('mileage:', vehicle.mileage);

// 4. Check what BaT comments say
const { data: comments } = await sb.from('auction_comments')
  .select('comment_text, posted_at, username')
  .eq('vehicle_id', VID)
  .order('posted_at');

console.log(`\n=== AUCTION COMMENTS: ${comments?.length || 0} ===`);
for (const c of (comments || []).slice(0, 10)) {
  console.log(`[${c.username}] ${c.comment_text?.slice(0, 150)}`);
}
