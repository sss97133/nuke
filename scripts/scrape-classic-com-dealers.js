#!/usr/bin/env node

/**
 * Scrape CLASSIC.COM dealer directory and import dealers + squarebody listings
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Known squarebody-focused dealers from CLASSIC.COM
const PRIORITY_DEALERS = [
  { name: '4-Wheel Classics', url: 'https://4-wheelclassics.com/' },
  { name: '4X4 Hawaii', url: 'https://4x4-hawaii.com/' },
  { name: '4x4 Rides', url: 'https://www.4x4rides.com/' },
  { name: 'Adventure Classic Cars', url: 'https://adventureclassiccars.com/' },
  { name: 'Affordable Classics', url: 'https://www.affordableclassicsinc.com/' },
  { name: 'Gateway Classic Cars', url: 'https://www.gatewayclassiccars.com/' },
  { name: 'Classic Car Liquidators', url: 'https://classiccarliquidators.com/' },
  { name: 'Streetside Classics', url: 'https://www.streetsideclassics.com/' },
  { name: 'Fast Lane Classic Cars', url: 'https://www.fastlanecars.com/' },
  { name: 'Restore A Muscle Car', url: 'https://www.restoreamusclecar.com/' },
  { name: 'RK Motors', url: 'https://www.rkmotorscharlotte.com/' },
  { name: 'Vanguard Motor Sales', url: 'https://www.vanguardmotorsales.com/' },
  { name: 'Classic Auto Mall', url: 'https://www.classicautomall.com/' },
  { name: 'Ideal Classic Cars', url: 'https://www.idealclassiccars.com/' },
  { name: 'Hemmings Motor News', url: 'https://www.hemmings.com/' }
];

// Direct squarebody search URLs
const SQUAREBODY_SEARCHES = [
  'https://www.classic.com/m/chevrolet/c10/?yearMin=1973&yearMax=1987',
  'https://www.classic.com/m/chevrolet/k10/?yearMin=1973&yearMax=1987',
  'https://www.classic.com/m/chevrolet/c20/?yearMin=1973&yearMax=1987',
  'https://www.classic.com/m/chevrolet/k20/?yearMin=1973&yearMax=1987',
  'https://www.classic.com/m/chevrolet/blazer/?yearMin=1973&yearMax=1991',
  'https://www.classic.com/m/chevrolet/suburban/?yearMin=1973&yearMax=1991',
  'https://www.classic.com/m/gmc/c1500/?yearMin=1973&yearMax=1987',
  'https://www.classic.com/m/gmc/k1500/?yearMin=1973&yearMax=1987',
  'https://www.classic.com/m/gmc/jimmy/?yearMin=1973&yearMax=1991'
];

async function scrapeSource(url, sourceType = 'dealer') {
  console.log(`\nScraping: ${url}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        source_url: url,
        source_type: sourceType,
        extract_listings: true,
        extract_dealer_info: true,
        use_llm_extraction: true,
        max_listings: 200
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`  SUCCESS: ${result.listings_found} listings found, ${result.listings_queued} queued`);
      if (result.organization_id) {
        console.log(`  Created/updated organization: ${result.dealer_info?.name || 'Unknown'}`);
      }
      return result;
    } else {
      console.log(`  FAILED: ${result.error}`);
      return null;
    }
  } catch (error) {
    console.log(`  ERROR: ${error.message}`);
    return null;
  }
}

async function processQueue(batchSize = 20) {
  console.log(`\nProcessing import queue (batch size: ${batchSize})...`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        batch_size: batchSize,
        priority_only: false
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`  Processed: ${result.processed}, Succeeded: ${result.succeeded}, Failed: ${result.failed}`);
      if (result.vehicles_created?.length > 0) {
        console.log(`  Vehicles created: ${result.vehicles_created.join(', ')}`);
      }
      return result;
    } else {
      console.log(`  FAILED: ${result.error}`);
      return null;
    }
  } catch (error) {
    console.log(`  ERROR: ${error.message}`);
    return null;
  }
}

async function getQueueStats() {
  const { data, error } = await supabase
    .from('import_queue')
    .select('status')
    .then(res => {
      if (res.error) return res;
      const stats = {};
      res.data.forEach(item => {
        stats[item.status] = (stats[item.status] || 0) + 1;
      });
      return { data: stats, error: null };
    });

  return data || {};
}

async function main() {
  console.log('='.repeat(60));
  console.log('CLASSIC.COM & Multi-Source Squarebody Scraper');
  console.log('='.repeat(60));

  const stats = {
    dealers_scraped: 0,
    listings_found: 0,
    listings_queued: 0,
    organizations_created: 0,
    vehicles_imported: 0
  };

  // Phase 1: Scrape priority dealers
  console.log('\n--- PHASE 1: Priority Dealers ---');
  for (const dealer of PRIORITY_DEALERS) {
    const result = await scrapeSource(dealer.url, 'dealer');
    if (result) {
      stats.dealers_scraped++;
      stats.listings_found += result.listings_found || 0;
      stats.listings_queued += result.listings_queued || 0;
      if (result.organization_id) stats.organizations_created++;
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  // Phase 2: Scrape CLASSIC.COM squarebody searches
  console.log('\n--- PHASE 2: CLASSIC.COM Squarebody Searches ---');
  for (const searchUrl of SQUAREBODY_SEARCHES) {
    const result = await scrapeSource(searchUrl, 'marketplace');
    if (result) {
      stats.listings_found += result.listings_found || 0;
      stats.listings_queued += result.listings_queued || 0;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Phase 3: Process import queue
  console.log('\n--- PHASE 3: Processing Import Queue ---');
  const queueStats = await getQueueStats();
  console.log('Queue status:', queueStats);

  // Process in batches
  let totalProcessed = 0;
  while (totalProcessed < 100) { // Limit to 100 for this run
    const result = await processQueue(10);
    if (!result || result.processed === 0) break;
    totalProcessed += result.processed;
    stats.vehicles_imported += result.succeeded || 0;
    
    // Rate limit between batches
    await new Promise(r => setTimeout(r, 3000));
  }

  // Final stats
  console.log('\n' + '='.repeat(60));
  console.log('FINAL STATS:');
  console.log('='.repeat(60));
  console.log(`Dealers scraped: ${stats.dealers_scraped}`);
  console.log(`Organizations created: ${stats.organizations_created}`);
  console.log(`Listings found: ${stats.listings_found}`);
  console.log(`Listings queued: ${stats.listings_queued}`);
  console.log(`Vehicles imported: ${stats.vehicles_imported}`);

  const finalQueueStats = await getQueueStats();
  console.log('\nQueue status:', finalQueueStats);
}

main().catch(console.error);

