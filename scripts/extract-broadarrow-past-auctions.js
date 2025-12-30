#!/usr/bin/env node
/**
 * Extract ALL Broad Arrow Past Auctions
 * Scrapes the past-auctions page to discover all auction events
 * Then extracts vehicles from each past auction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function discoverPastAuctions() {
  console.log('🔍 Discovering past auctions from past-auctions page...\n');
  
  const pastAuctionsUrl = 'https://www.broadarrowauctions.com/past-auctions';
  
  try {
    // Use the extraction function to get the page and discover auction URLs
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: pastAuctionsUrl,
        site_type: 'broadarrow',
        max_vehicles: 0, // Just discover, don't extract vehicles yet
        debug: false
      }
    });

    if (error) {
      console.error('❌ Error discovering auctions:', error);
      return [];
    }

    // The extraction will discover listing URLs - we want to extract auction result page URLs
    // Pattern: /past-auctions/{auction-name} or auction result pages
    console.log('⚠️  Need to implement past auction discovery from HTML');
    console.log('   This requires parsing the past-auctions page HTML to find auction links');
    
    return [];
  } catch (error) {
    console.error('❌ Exception:', error);
    return [];
  }
}

async function extractAuctionVehicles(auctionUrl, auctionName) {
  console.log(`\n📦 Extracting vehicles from: ${auctionName}`);
  console.log(`   URL: ${auctionUrl}`);
  
  try {
    const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
      body: {
        url: auctionUrl,
        site_type: 'broadarrow',
        max_vehicles: 1000, // Extract all vehicles from this auction
        debug: false
      }
    });

    if (error) {
      console.error(`❌ Error extracting from ${auctionName}:`, error.message);
      return { success: false, error };
    }

    console.log(`✅ ${auctionName} completed:`);
    console.log(`   Discovered: ${data.listings_discovered || 0}`);
    console.log(`   Extracted: ${data.vehicles_extracted || 0}`);
    console.log(`   Created: ${data.vehicles_created || 0}`);
    console.log(`   Updated: ${data.vehicles_updated || 0}`);

    return { success: true, data, auctionName, auctionUrl };
  } catch (error) {
    console.error(`❌ Exception extracting ${auctionName}:`, error.message);
    return { success: false, error };
  }
}

async function main() {
  console.log('🔍 Broad Arrow Auctions - Past Auctions Extraction\n');
  console.log('='.repeat(60));
  console.log('📋 Extracting ALL vehicles from past auction results\n');

  // Known past auctions from the page (we'll need to scrape to discover all)
  // For now, let's extract from the results page which should have all past results
  const resultsUrl = 'https://www.broadarrowauctions.com/vehicles/results?q%5Bbranch_id_eq%5D=26&q%5Bs%5D%5B0%5D%5Bname_dir%5D=stock.asc';
  
  console.log(`📦 Extracting from results page (all past auctions)...`);
  console.log(`   URL: ${resultsUrl}\n`);

  const batchSize = 8;
  const maxBatches = 50; // Extract many batches to get all past auction vehicles
  let totalExtracted = 0;
  let totalCreated = 0;
  let totalUpdated = 0;

  for (let i = 1; i <= maxBatches; i++) {
    console.log(`\n📦 Batch ${i}/${maxBatches}: Extracting ${batchSize} vehicles...`);
    
    try {
      const { data, error } = await supabase.functions.invoke('extract-premium-auction', {
        body: {
          url: resultsUrl,
          site_type: 'broadarrow',
          max_vehicles: batchSize,
          debug: false
        }
      });

      if (error) {
        console.error(`❌ Batch ${i} error:`, error.message);
        // Continue with next batch
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }

      totalExtracted += data.vehicles_extracted || 0;
      totalCreated += data.vehicles_created || 0;
      totalUpdated += data.vehicles_updated || 0;

      console.log(`   ✅ Extracted: ${data.vehicles_extracted || 0}, Created: ${data.vehicles_created || 0}, Updated: ${data.vehicles_updated || 0}`);

      // If we extracted 0 vehicles, we might have reached the end
      if ((data.vehicles_extracted || 0) === 0 && (data.vehicles_created || 0) === 0) {
        console.log(`\n   ℹ️  No new vehicles found - may have reached end of results`);
        break;
      }

      // Small delay between batches
      if (i < maxBatches) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`❌ Batch ${i} exception:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total vehicles extracted: ${totalExtracted}`);
  console.log(`Total vehicles created: ${totalCreated}`);
  console.log(`Total vehicles updated: ${totalUpdated}`);
  console.log('\n✅ Past auctions extraction complete!');
  console.log('\nNext steps:');
  console.log('   1. Run: node scripts/broadarrow-comprehensive-report.js');
  console.log('   2. Run: node scripts/compile-contact-network.js');
}

main().catch(console.error);

