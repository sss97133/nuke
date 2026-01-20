import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  // Get a sample vehicle to see what fields we have
  const { data: sample } = await supabase
    .from('vehicles')
    .select('*')
    .eq('listing_source', 'intelligent_extractor')
    .limit(1);

  if (sample && sample[0]) {
    console.log('Vehicle schema - non-null fields:');
    const keys = Object.keys(sample[0]).sort();
    for (const k of keys) {
      const v = sample[0][k];
      if (v !== null && v !== undefined) {
        const display = typeof v === 'string' ? v.substring(0, 60) : JSON.stringify(v);
        console.log(`  ${k}: ${display}`);
      }
    }
  }

  // Check for auction-related fields in schema
  console.log('\n--- Checking for auction fields in vehicles table ---');
  const { data: cols } = await supabase.rpc('get_table_columns', { table_name: 'vehicles' }).catch(() => ({ data: null }));

  // Just query to see auction-related columns
  const { data: auctionSample } = await supabase
    .from('vehicles')
    .select('id, listing_title, price, listing_url')
    .ilike('listing_url', '%bringatrailer%')
    .limit(3);

  console.log('\nBring a Trailer vehicles:');
  if (auctionSample) {
    for (const v of auctionSample) {
      console.log(`  - ${v.listing_title?.substring(0, 50)}`);
      console.log(`    Price: ${v.price || 'N/A'}`);
      console.log(`    URL: ${v.listing_url}`);
    }
  }

  // Check what auction sites we have
  const { data: sources } = await supabase
    .from('vehicles')
    .select('listing_url')
    .eq('listing_source', 'intelligent_extractor')
    .limit(100);

  const domains: Record<string, number> = {};
  for (const v of sources || []) {
    try {
      const url = new URL(v.listing_url);
      domains[url.hostname] = (domains[url.hostname] || 0) + 1;
    } catch {}
  }

  console.log('\nExtracted vehicles by domain:');
  for (const [domain, count] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${domain}: ${count}`);
  }
}

check();
