import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  // Get all orgs that look like auction sites
  const { data } = await supabase
    .from('businesses')
    .select('id, business_name, website')
    .or('website.ilike.%auction%,website.ilike.%cars%,website.ilike.%bid%,business_name.ilike.%auction%')
    .order('business_name');
  
  console.log('Auction-related organizations:\n');
  for (const b of data || []) {
    console.log(`${b.business_name}`);
    console.log(`  ID: ${b.id}`);
    console.log(`  URL: ${b.website}\n`);
  }
}

check().catch(console.error);
