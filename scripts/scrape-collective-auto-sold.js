/**
 * Scrape Collective Auto Group Sold Inventory
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

async function scrapeSoldInventory() {
  console.log('🚀 Scraping Collective Auto Group Sold Inventory...\n');

  try {
    const { data, error } = await supabase.functions.invoke('scrape-collective-auto-sold', {
      body: { max_pages: 24 }, // They have 24 pages of sold inventory
    });

    if (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }

    if (!data || !data.success) {
      console.error('❌ Scraping failed:', data?.error || 'Unknown error');
      process.exit(1);
    }

    console.log('\n✅ SCRAPING COMPLETE!\n');
    console.log('📊 Results:');
    console.log(`   Vehicles Found: ${data.vehicles_found}`);
    console.log(`   Queued: ${data.queued}`);
    console.log(`   Duplicates: ${data.duplicates}`);
    
    if (data.listings && data.listings.length > 0) {
      console.log('\n📋 Sample vehicles:');
      data.listings.slice(0, 5).forEach((v) => {
        console.log(`   - ${v.year || '?'} ${v.make || ''} ${v.model || ''} (VIN: ${v.vin || 'N/A'})`);
      });
    }

    console.log('\n🎯 Next: Process import_queue to create vehicle profiles');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

scrapeSoldInventory();

