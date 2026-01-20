import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('Attempting to update platform constraint via stored function...');
  
  // First, let's check what constraint exists
  const { data: constraints } = await supabase
    .from('external_listings')
    .select('platform')
    .limit(0);
  
  console.log('Table accessible:', constraints !== null);
  
  // Try inserting with a test platform to see the constraint
  const { error: testError } = await supabase
    .from('external_listings')
    .insert({
      vehicle_id: '00000000-0000-0000-0000-000000000000', // Will fail foreign key
      organization_id: '00000000-0000-0000-0000-000000000000',
      platform: 'gooding',
      listing_url: 'test',
      listing_status: 'active',
    });
  
  console.log('Test insert error:', testError?.message || 'none');
  
  if (testError?.message?.includes('platform_check')) {
    console.log('\nPlatform constraint needs to be updated.');
    console.log('Please run this SQL in the Supabase dashboard SQL editor:\n');
    console.log(`
ALTER TABLE public.external_listings
  DROP CONSTRAINT IF EXISTS external_listings_platform_check;

ALTER TABLE public.external_listings
  ADD CONSTRAINT external_listings_platform_check
  CHECK (
    platform = ANY (ARRAY[
      'bat', 'cars_and_bids', 'mecum', 'barrettjackson', 'russoandsteele',
      'pcarmarket', 'sbx', 'bonhams', 'rmsothebys',
      'collecting_cars', 'broad_arrow', 'gooding',
      'ebay_motors', 'facebook_marketplace', 'autotrader', 'hemmings',
      'classic_com', 'craigslist', 'copart', 'iaai'
    ])
  );
    `);
  }
}

main().catch(console.error);
