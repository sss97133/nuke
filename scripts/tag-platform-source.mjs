import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PLATFORMS = [
  ['https://bringatrailer.com', 'bringatrailer'],
  ['https://www.mecum.com', 'mecum'],
  ['https://www.barrett-jackson.com', 'barrett-jackson'],
  ['https://rmsothebys.com', 'rm-sothebys'],
  ['https://carsandbids.com', 'cars-and-bids'],
  ['https://collectingcars.com', 'collecting-cars'],
  ['https://www.jamesedition.com', 'jamesedition'],
  ['https://www.hemmings.com', 'hemmings'],
  ['https://www.ebay.com', 'ebay'],
];

for (const [prefix, platform] of PLATFORMS) {
  let total = 0;
  while (true) {
    const { data } = await sb.from('vehicles')
      .select('id')
      .is('platform_source', null)
      .eq('status', 'active')
      .like('listing_url', `${prefix}%`)
      .limit(200);
    if (!data || data.length === 0) break;
    await sb.from('vehicles').update({ platform_source: platform }).in('id', data.map(r => r.id));
    total += data.length;
    if (total % 5000 === 0) process.stdout.write(`\r  ${platform}: ${total}`);
  }
  if (total > 0) console.log(`  ${platform}: ${total}`);
}

// Craigslist uses varying subdomains
let cl = 0;
while (true) {
  const { data } = await sb.from('vehicles')
    .select('id')
    .is('platform_source', null)
    .eq('status', 'active')
    .ilike('listing_url', '%craigslist%')
    .limit(200);
  if (!data || data.length === 0) break;
  await sb.from('vehicles').update({ platform_source: 'craigslist' }).in('id', data.map(r => r.id));
  cl += data.length;
}
if (cl > 0) console.log(`  craigslist: ${cl}`);

console.log('Platform tagging complete.');
