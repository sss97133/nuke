#!/usr/bin/env node

/**
 * Scrape more squarebody sources with longer delays to avoid rate limits
 */

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

const SOURCES = [
  // More Hemmings searches
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/gmc/jimmy', type: 'marketplace', name: 'Hemmings GMC Jimmy' },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/gmc/suburban', type: 'marketplace', name: 'Hemmings GMC Suburban' },
  { url: 'https://www.hemmings.com/classifieds/cars-for-sale/chevrolet/k20', type: 'marketplace', name: 'Hemmings K20' },
  
  // More BaT
  { url: 'https://bringatrailer.com/gmc/suburban/', type: 'auction', name: 'BaT GMC Suburban' },
  { url: 'https://bringatrailer.com/chevrolet/c-30/', type: 'auction', name: 'BaT C30' },
  
  // Autotrader Classics
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/chevrolet-c10-for-sale', type: 'marketplace', name: 'AT Classics C10' },
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/chevrolet-blazer-for-sale', type: 'marketplace', name: 'AT Classics Blazer' },
  { url: 'https://classics.autotrader.com/classic-cars-for-sale/gmc-jimmy-for-sale', type: 'marketplace', name: 'AT Classics Jimmy' },
  
  // ClassicCars.com
  { url: 'https://classiccars.com/listings/find/1973-1987/chevrolet/c-10', type: 'marketplace', name: 'ClassicCars C10' },
  { url: 'https://classiccars.com/listings/find/1973-1991/chevrolet/blazer', type: 'marketplace', name: 'ClassicCars Blazer' },
  { url: 'https://classiccars.com/listings/find/1973-1991/gmc/jimmy', type: 'marketplace', name: 'ClassicCars Jimmy' },
  
  // More KSL
  { url: 'https://cars.ksl.com/v2/search/make/Chevrolet/model/Blazer/yearFrom/1973/yearTo/1991', type: 'classifieds', name: 'KSL Blazer' },
  { url: 'https://cars.ksl.com/v2/search/make/Chevrolet/model/Suburban/yearFrom/1973/yearTo/1991', type: 'classifieds', name: 'KSL Suburban' },
  { url: 'https://cars.ksl.com/v2/search/make/GMC/model/Jimmy/yearFrom/1973/yearTo/1991', type: 'classifieds', name: 'KSL Jimmy' }
];

let stats = { scraped: 0, failed: 0, listings: 0, queued: 0 };

async function scrapeSource(source) {
  console.log(`[${stats.scraped + stats.failed + 1}/${SOURCES.length}] ${source.name}`);
  
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
        use_llm_extraction: true,
        max_listings: 100
      })
    });

    const result = await response.json();
    
    if (result.success) {
      stats.scraped++;
      stats.listings += result.listings_found || 0;
      stats.queued += result.listings_queued || 0;
      console.log(`  OK: ${result.listings_found} found, ${result.listings_queued} queued`);
    } else {
      stats.failed++;
      console.log(`  FAIL: ${result.error?.substring(0, 60)}`);
    }
  } catch (error) {
    stats.failed++;
    console.log(`  ERROR: ${error.message?.substring(0, 60)}`);
  }
}

async function main() {
  console.log('='.repeat(50));
  console.log('MORE SQUAREBODY SOURCES');
  console.log('='.repeat(50));

  for (const source of SOURCES) {
    await scrapeSource(source);
    // 8 second delay to avoid rate limits
    await new Promise(r => setTimeout(r, 8000));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Done: ${stats.scraped} scraped, ${stats.failed} failed`);
  console.log(`Listings: ${stats.listings} found, ${stats.queued} queued`);
}

main().catch(console.error);

