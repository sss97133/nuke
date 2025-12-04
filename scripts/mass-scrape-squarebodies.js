#!/usr/bin/env node

/**
 * Mass scraper - hits ALL known squarebody sources aggressively
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// ALL SOURCES TO SCRAPE
const SOURCES = [
  // Classifieds
  { url: 'https://cars.ksl.com/v2/search/make/Chevrolet/yearFrom/1973/yearTo/1987', type: 'classifieds', name: 'KSL C10' },
  { url: 'https://cars.ksl.com/v2/search/make/GMC/yearFrom/1973/yearTo/1987', type: 'classifieds', name: 'KSL GMC' },
  
  // Facebook Marketplace via Firecrawl (might work)
  { url: 'https://www.facebook.com/marketplace/category/vehicles?make=chevrolet&model=c10', type: 'marketplace', name: 'FB C10' },
  
  // Craigslist aggregators
  { url: 'https://www.searchtempest.com/results.php?search=chevrolet+c10&category=cta', type: 'classifieds', name: 'SearchTempest C10' },
  
  // Auction sites
  { url: 'https://bringatrailer.com/chevrolet/c10/', type: 'auction', name: 'BaT C10' },
  { url: 'https://bringatrailer.com/chevrolet/k10/', type: 'auction', name: 'BaT K10' },
  { url: 'https://bringatrailer.com/chevrolet/c20/', type: 'auction', name: 'BaT C20' },
  { url: 'https://bringatrailer.com/chevrolet/k20/', type: 'auction', name: 'BaT K20' },
  { url: 'https://bringatrailer.com/chevrolet/blazer/', type: 'auction', name: 'BaT Blazer' },
  { url: 'https://bringatrailer.com/gmc/jimmy/', type: 'auction', name: 'BaT Jimmy' },
  
  // Cars & Bids
  { url: 'https://carsandbids.com/search?make=Chevrolet&model=C10', type: 'auction', name: 'C&B C10' },
  { url: 'https://carsandbids.com/search?make=Chevrolet&model=K10', type: 'auction', name: 'C&B K10' },
  
  // Hemmings
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c10', type: 'marketplace', name: 'Hemmings C10' },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/k10', type: 'marketplace', name: 'Hemmings K10' },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/c20', type: 'marketplace', name: 'Hemmings C20' },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/blazer', type: 'marketplace', name: 'Hemmings Blazer' },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/gmc/c1500', type: 'marketplace', name: 'Hemmings GMC' },
  
  // Classic.com searches
  { url: 'https://www.classic.com/m/chevrolet/c10/', type: 'marketplace', name: 'Classic.com C10' },
  { url: 'https://www.classic.com/m/chevrolet/k10/', type: 'marketplace', name: 'Classic.com K10' },
  { url: 'https://www.classic.com/m/chevrolet/c20/', type: 'marketplace', name: 'Classic.com C20' },
  { url: 'https://www.classic.com/m/chevrolet/blazer/', type: 'marketplace', name: 'Classic.com Blazer' },
  
  // Autotrader Classics
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/chevrolet-c10-for-sale', type: 'marketplace', name: 'AT Classics C10' },
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/chevrolet-k10-for-sale', type: 'marketplace', name: 'AT Classics K10' },
  
  // Classiccars.com
  { url: 'https://classiccars.com/listings/find/1973-1987/chevrolet/c-10', type: 'marketplace', name: 'ClassicCars C10' },
  { url: 'https://classiccars.com/listings/find/1973-1987/chevrolet/k-10', type: 'marketplace', name: 'ClassicCars K10' },
  
  // eBay Motors
  { url: 'https://www.ebay.com/b/Chevrolet-C-10/6001/bn_55186424', type: 'auction', name: 'eBay C10' },
  { url: 'https://www.ebay.com/b/Chevrolet-K-10/6001/bn_55186428', type: 'auction', name: 'eBay K10' },
  
  // Major dealers with truck inventory
  { url: 'https://www.gatewayclassiccars.com/vehicles?make=chevrolet&model=c10', type: 'dealer', name: 'Gateway C10' },
  { url: 'https://www.streetsideclassics.com/vehicles?make=chevrolet&model=c10', type: 'dealer', name: 'Streetside C10' },
  { url: 'https://www.fastlanecars.com/vehicles?make=chevrolet', type: 'dealer', name: 'Fast Lane' },
  { url: 'https://www.vanguardmotorsales.com/vehicles?make=chevrolet', type: 'dealer', name: 'Vanguard' },
  { url: 'https://www.classicautomall.com/vehicles?make=chevrolet', type: 'dealer', name: 'Classic Auto Mall' },
  { url: 'https://www.idealclassiccars.com/vehicles?make=chevrolet', type: 'dealer', name: 'Ideal Classics' }
];

let stats = {
  sources_scraped: 0,
  sources_failed: 0,
  listings_found: 0,
  listings_queued: 0,
  orgs_created: 0
};

async function scrapeSource(source) {
  console.log(`[${stats.sources_scraped + 1}/${SOURCES.length}] ${source.name}: ${source.url}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        source_url: source.url,
        source_type: source.type,
        extract_listings: true,
        extract_dealer_info: source.type === 'dealer',
        use_llm_extraction: true,
        max_listings: 200
      })
    });

    const result = await response.json();
    
    if (result.success) {
      stats.sources_scraped++;
      stats.listings_found += result.listings_found || 0;
      stats.listings_queued += result.listings_queued || 0;
      if (result.organization_id) stats.orgs_created++;
      
      console.log(`  OK: ${result.listings_found} found, ${result.listings_queued} queued`);
      return true;
    } else {
      stats.sources_failed++;
      console.log(`  FAIL: ${result.error?.substring(0, 100)}`);
      return false;
    }
  } catch (error) {
    stats.sources_failed++;
    console.log(`  ERROR: ${error.message?.substring(0, 100)}`);
    return false;
  }
}

async function processQueue() {
  console.log('\nProcessing import queue...');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-import-queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        batch_size: 20,
        priority_only: false
      })
    });

    const result = await response.json();
    if (result.success) {
      console.log(`  Processed: ${result.processed}, Succeeded: ${result.succeeded}, Failed: ${result.failed}`);
      return result.succeeded || 0;
    }
    return 0;
  } catch (error) {
    console.log(`  Queue error: ${error.message}`);
    return 0;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('MASS SQUAREBODY SCRAPER');
  console.log(`Targeting ${SOURCES.length} sources`);
  console.log('='.repeat(60));
  console.log('');

  // Scrape all sources
  for (const source of SOURCES) {
    await scrapeSource(source);
    // 2 second delay between sources
    await new Promise(r => setTimeout(r, 2000));
    
    // Every 5 sources, process the queue
    if (stats.sources_scraped % 5 === 0) {
      await processQueue();
    }
  }

  // Final queue processing
  console.log('\n--- Final Queue Processing ---');
  let totalImported = 0;
  for (let i = 0; i < 10; i++) {
    const imported = await processQueue();
    totalImported += imported;
    if (imported === 0) break;
    await new Promise(r => setTimeout(r, 3000));
  }

  // Final stats
  console.log('\n' + '='.repeat(60));
  console.log('FINAL STATS:');
  console.log('='.repeat(60));
  console.log(`Sources scraped: ${stats.sources_scraped}`);
  console.log(`Sources failed: ${stats.sources_failed}`);
  console.log(`Listings found: ${stats.listings_found}`);
  console.log(`Listings queued: ${stats.listings_queued}`);
  console.log(`Organizations created: ${stats.orgs_created}`);
  console.log(`Vehicles imported: ${totalImported}`);
}

main().catch(console.error);

