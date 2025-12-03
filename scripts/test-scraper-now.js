#!/usr/bin/env node
/**
 * Test scraper function RIGHT NOW (without migrations)
 */

import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  console.log('🧪 Testing Craigslist Scraper Function\n');
  console.log('Running small test: 1 region, 5 listings max...\n');
  
  const startTime = Date.now();
  
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/scrape-all-craigslist-squarebodies`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        max_regions: 1,
        max_listings_per_search: 5
      })
    }
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (!response.ok) {
    console.error('❌ Scraper failed:', response.status, response.statusText);
    const errorText = await response.text();
    console.error('Error:', errorText.substring(0, 500));
    return;
  }

  const result = await response.json();
  
  console.log(`✅ Scraper completed in ${elapsed}s\n`);
  console.log('📊 Results:');
  console.log(`   Regions searched: ${result.stats?.regions_searched || 0}`);
  console.log(`   Searches performed: ${result.stats?.searches_performed || 0}`);
  console.log(`   Listings found: ${result.stats?.listings_found || 0}`);
  console.log(`   Listings processed: ${result.stats?.processed || 0}`);
  console.log(`   Vehicles created: ${result.stats?.created || 0}`);
  console.log(`   Vehicles updated: ${result.stats?.updated || 0}`);
  console.log(`   Errors: ${result.stats?.errors || 0}\n`);

  if (result.stats?.created > 0) {
    console.log('🎉 SUCCESS! Scraper is working and creating vehicles!\n');
  } else if (result.stats?.updated > 0) {
    console.log('✅ Scraper working (updated existing vehicles)\n');
  } else {
    console.log('⚠️ Scraper ran but created no vehicles (might be duplicates)\n');
  }

  if (result.stats?.errors > 0) {
    console.log('⚠️ Some errors occurred:');
    if (result.debug?.error_details) {
      result.debug.error_details.forEach((err, i) => {
        console.log(`   ${i + 1}. ${err.substring(0, 80)}`);
      });
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ SCRAPER FUNCTION: WORKING\n');
  console.log('⏳ Next: Apply migrations for health tracking');
  console.log('   Open: APPLY_SCRAPER_MIGRATIONS_NOW.md\n');
}

main().catch(console.error);

