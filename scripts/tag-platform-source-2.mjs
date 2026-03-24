import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PLATFORMS = [
  ['%mecum.com%', 'mecum'],
  ['%pcarmarket.com%', 'pcarmarket'],
  ['%bonhams%', 'bonhams'],
  ['%barrett-jackson.com%', 'barrett-jackson'],
  ['%goodingco.com%', 'gooding'],
  ['%broadarrow%', 'broad-arrow'],
  ['%broad-arrow%', 'broad-arrow'],
  ['%cars.ksl.com%', 'ksl'],
  ['%gaaclassiccars.com%', 'gaa-classic-cars'],
  ['%sbxcars.com%', 'sbx-cars'],
  ['%historics.co.uk%', 'historics'],
  ['%motorious.com%', 'motorious'],
  ['%jamesedition.com%', 'jamesedition'],
];

for (const [pattern, platform] of PLATFORMS) {
  let total = 0;
  while (true) {
    const { data } = await sb.from('vehicles')
      .select('id')
      .is('platform_source', null)
      .eq('status', 'active')
      .ilike('listing_url', pattern)
      .limit(200);
    if (!data || data.length === 0) break;
    await sb.from('vehicles').update({ platform_source: platform }).in('id', data.map(r => r.id));
    total += data.length;
    if (total % 5000 === 0) process.stdout.write(`\r  ${platform}: ${total}`);
  }
  if (total > 0) console.log(`  ${platform}: ${total}`);
}

console.log('Platform tagging round 2 complete.');
