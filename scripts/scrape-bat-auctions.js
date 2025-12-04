#!/usr/bin/env node

/**
 * Scrape Bring a Trailer for squarebody listings
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// BaT squarebody search URLs
const BAT_SEARCHES = [
  'https://bringatrailer.com/chevrolet/c10/',
  'https://bringatrailer.com/chevrolet/k10/',
  'https://bringatrailer.com/chevrolet/c20/',
  'https://bringatrailer.com/chevrolet/k20/',
  'https://bringatrailer.com/chevrolet/blazer/',
  'https://bringatrailer.com/chevrolet/suburban/',
  'https://bringatrailer.com/gmc/c1500/',
  'https://bringatrailer.com/gmc/k1500/',
  'https://bringatrailer.com/gmc/jimmy/'
];

async function scrapeSource(url) {
  console.log(`Scraping: ${url}`);
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/scrape-multi-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        source_url: url,
        source_type: 'auction',
        extract_listings: true,
        extract_dealer_info: false,
        use_llm_extraction: true,
        max_listings: 100
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`  Found ${result.listings_found} listings, queued ${result.listings_queued}`);
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

async function main() {
  console.log('='.repeat(50));
  console.log('Bring a Trailer Squarebody Scraper');
  console.log('='.repeat(50));

  let totalFound = 0;
  let totalQueued = 0;

  for (const url of BAT_SEARCHES) {
    const result = await scrapeSource(url);
    if (result) {
      totalFound += result.listings_found || 0;
      totalQueued += result.listings_queued || 0;
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Total found: ${totalFound}, Total queued: ${totalQueued}`);
}

main().catch(console.error);

