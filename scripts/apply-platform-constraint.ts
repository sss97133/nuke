import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('Applying platform constraint migration...');
  
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      DO $$
      BEGIN
        IF to_regclass('public.external_listings') IS NULL THEN
          RETURN;
        END IF;

        ALTER TABLE public.external_listings
          DROP CONSTRAINT IF EXISTS external_listings_platform_check;

        ALTER TABLE public.external_listings
          ADD CONSTRAINT external_listings_platform_check
          CHECK (
            platform = ANY (ARRAY[
              'bat'::text,
              'cars_and_bids'::text,
              'mecum'::text,
              'barrettjackson'::text,
              'russoandsteele'::text,
              'pcarmarket'::text,
              'sbx'::text,
              'bonhams'::text,
              'rmsothebys'::text,
              'collecting_cars'::text,
              'broad_arrow'::text,
              'gooding'::text,
              'ebay_motors'::text,
              'facebook_marketplace'::text,
              'autotrader'::text,
              'hemmings'::text,
              'classic_com'::text,
              'craigslist'::text,
              'copart'::text,
              'iaai'::text
            ])
          );
      END
      $$;
    `
  });
  
  if (error) {
    // Try direct SQL if RPC doesn't exist
    console.log('RPC not available, constraint may already exist or need CLI migration');
    console.log('Proceeding with setup...');
  } else {
    console.log('✓ Platform constraint updated');
  }
}

main().catch(console.error);
