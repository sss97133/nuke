import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  // Check for auction platform organizations
  const platforms = ['bat', 'bring a trailer', 'cars_and_bids', 'cars and bids', 'pcarmarket', 'collecting cars', 'broad arrow', 'rm sotheby', 'gooding', 'sbx'];
  
  console.log('=== Checking for auction platform organizations ===\n');
  
  for (const p of platforms) {
    const { data } = await supabase
      .from('businesses')
      .select('id, business_name, website')
      .or(`business_name.ilike.%${p}%,website.ilike.%${p}%`)
      .limit(3);
    
    if (data && data.length > 0) {
      console.log(`${p}:`);
      for (const b of data) {
        console.log(`  ${b.id}: ${b.business_name} (${b.website})`);
      }
    } else {
      console.log(`${p}: NOT FOUND`);
    }
  }
  
  // Get platforms count from external_listings
  const { data: platformCounts } = await supabase
    .from('external_listings')
    .select('platform');
  
  if (platformCounts) {
    const counts: Record<string, number> = {};
    for (const l of platformCounts) {
      counts[l.platform] = (counts[l.platform] || 0) + 1;
    }
    console.log('\n=== Existing external_listings by platform ===');
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`);
    }
  }
  
  // Check total count
  const { count } = await supabase.from('external_listings').select('*', { count: 'exact', head: true });
  console.log(`\nTotal external_listings: ${count}`);
}

check().catch(console.error);
