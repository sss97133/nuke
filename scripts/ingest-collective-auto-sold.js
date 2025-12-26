/**
 * Ingest Collective Auto Group Sold Inventory
 * Uses scrape-multi-source which handles Speed Digital sites better
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function ingestSoldInventory() {
  console.log('🚀 Ingesting Collective Auto Group Sold Inventory...\n');

  try {
    // Get organization ID
    const { data: org } = await supabase
      .from('businesses')
      .select('id')
      .eq('website', 'https://www.collectiveauto.com')
      .single();

    if (!org) {
      console.error('❌ Collective Auto Group not found');
      process.exit(1);
    }

    console.log(`📋 Organization ID: ${org.id}\n`);

    // Use scrape-multi-source to handle the sold inventory page
    // It will detect it's a Speed Digital site and extract properly
    const soldUrl = 'https://www.collectiveauto.com/vehicles/sold';
    
    console.log(`🔍 Scraping: ${soldUrl}\n`);

    const { data, error } = await supabase.functions.invoke('scrape-multi-source', {
      body: {
        source_url: soldUrl,
        source_type: 'dealer_website',
        organization_id: org.id,
        force_listing_status: 'sold',
        max_listings_to_process: 500, // They have ~240 vehicles across 24 pages
        start_offset: 0,
      },
    });

    if (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }

    if (!data || !data.success) {
      console.error('❌ Scraping failed:', data?.error || 'Unknown error');
      process.exit(1);
    }

    console.log('\n✅ INGESTION COMPLETE!\n');
    console.log('📊 Results:');
    console.log(`   Listings Found: ${data.listings_found || 0}`);
    console.log(`   Vehicles Created: ${data.vehicles_created || 0}`);
    console.log(`   Vehicles Updated: ${data.vehicles_updated || 0}`);
    console.log(`   Inventory Created: ${data.inventory_created || 0}`);
    console.log(`   Errors: ${data.errors?.length || 0}`);

    if (data.errors && data.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      data.errors.slice(0, 5).forEach((err) => console.log(`   - ${err}`));
    }

    console.log('\n🎯 Next: Check vehicles in database');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

ingestSoldInventory();

