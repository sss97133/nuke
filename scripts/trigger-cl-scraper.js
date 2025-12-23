#!/usr/bin/env node
/**
 * Trigger Craigslist scraper for vehicles 2000 and older
 * Runs in batches to avoid timeouts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Regions to process in batches
const REGION_BATCHES = [
  ['sfbay', 'newyork', 'losangeles', 'chicago', 'atlanta'],
  ['dallas', 'denver', 'seattle', 'portland', 'phoenix'],
  ['boston', 'minneapolis', 'detroit', 'philadelphia', 'houston'],
  ['miami', 'sacramento', 'sandiego', 'orangecounty', 'raleigh'],
  ['tampa', 'baltimore', 'stlouis', 'pittsburgh', 'cleveland'],
];

async function runScraper(regions, strategy = 'decades') {
  console.log(`\n🚀 Running scraper for ${regions.length} regions (${regions.join(', ')})...`);
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-all-craigslist-2000-and-older', {
      body: {
        regions,
        max_listings_per_search: 120,
        search_strategy: strategy
      },
      timeout: 180000 // 3 minutes
    });

    if (error) {
      console.error(`❌ Error:`, error.message);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`❌ Failed:`, error.message);
    return null;
  }
}

async function main() {
  console.log('🔥 Craigslist Scraper - Triggering in batches\n');
  console.log('='.repeat(60));
  
  const totalStats = {
    batches: 0,
    listings_found: 0,
    listings_queued: 0,
    listings_skipped: 0,
    errors: 0
  };

  // Run each batch
  for (let i = 0; i < REGION_BATCHES.length; i++) {
    const batch = REGION_BATCHES[i];
    console.log(`\n📦 Batch ${i + 1}/${REGION_BATCHES.length}`);
    
    const result = await runScraper(batch, 'decades');
    
    if (result?.stats) {
      totalStats.batches++;
      totalStats.listings_found += result.stats.listings_found || 0;
      totalStats.listings_queued += result.stats.listings_queued || 0;
      totalStats.listings_skipped += result.stats.listings_skipped || 0;
      totalStats.errors += result.stats.errors || 0;
      
      console.log(`✅ Batch ${i + 1} complete:`);
      console.log(`   Found: ${result.stats.listings_found}`);
      console.log(`   Queued: ${result.stats.listings_queued}`);
      console.log(`   Skipped: ${result.stats.listings_skipped}`);
    }
    
    // Wait between batches
    if (i < REGION_BATCHES.length - 1) {
      console.log(`\n⏳ Waiting 5 seconds before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL STATS:');
  console.log(`   Batches: ${totalStats.batches}`);
  console.log(`   Total Listings Found: ${totalStats.listings_found}`);
  console.log(`   Total Queued: ${totalStats.listings_queued}`);
  console.log(`   Total Skipped: ${totalStats.listings_skipped}`);
  console.log(`   Errors: ${totalStats.errors}`);
  console.log('='.repeat(60));
  
  if (totalStats.listings_queued > 0) {
    console.log('\n✅ Scraper complete! Listings added to import_queue.');
    console.log('💡 Run process-import-queue to process them.');
  }
}

main().catch(console.error);

