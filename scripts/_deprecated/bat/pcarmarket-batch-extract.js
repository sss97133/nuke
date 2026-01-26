#!/usr/bin/env node
/**
 * PCarMarket Batch Extractor
 *
 * Discovers sold listings from PCarMarket and extracts them via Firecrawl.
 * Scrapes pagination to find all sold Porsche auction URLs.
 *
 * Usage:
 *   node scripts/pcarmarket-batch-extract.js [batch-size] [max-pages]
 *   node scripts/pcarmarket-batch-extract.js 20 200
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH_SIZE = parseInt(process.argv[2]) || 20;
const MAX_PAGES = parseInt(process.argv[3]) || 300;
const ORG_ID = 'd3bd67bb-0c19-4304-8a6b-89d384328eac';

let totalSuccess = 0;
let totalFailed = 0;
let totalDiscovered = 0;

async function getExistingUrls() {
  const urls = new Set();
  let offset = 0;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vehicles?discovery_url=ilike.*pcarmarket*&select=discovery_url&limit=1000&offset=${offset}`,
      {
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
        },
      }
    );
    const data = await res.json();
    if (data.length === 0) break;
    data.forEach(v => urls.add(v.discovery_url));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Found ${urls.size} existing PCarMarket vehicles`);
  return urls;
}

// Fetch all auction URLs from sitemap (much more reliable than scraping pagination)
async function discoverFromSitemap() {
  console.log('Fetching sitemap...');

  try {
    const res = await fetch('https://www.pcarmarket.com/sitemap.xml');
    const xml = await res.text();

    // Extract all auction URLs from sitemap
    // Pattern: /auction/[slug]/ (note: singular "auction", not "auctions")
    const urlPattern = /<loc>(https?:\/\/www\.pcarmarket\.com\/auction\/[^<]+)<\/loc>/g;
    const matches = [...xml.matchAll(urlPattern)];

    const listings = matches
      .map(m => {
        // Normalize URL: remove www, trailing slash, use https
        let url = m[1]
          .replace('http://', 'https://')
          .replace('www.pcarmarket.com', 'pcarmarket.com')
          .replace(/\/$/, ''); // Remove trailing slash
        return url;
      })
      .filter(u => !u.includes('?'));

    console.log(`  Sitemap contains ${listings.length} auction URLs`);
    return [...new Set(listings)];
  } catch (e) {
    console.error(`  Sitemap fetch error: ${e.message}`);
    return [];
  }
}

async function extractListing(url) {
  try {
    // Use Firecrawl to scrape
    const scrapeRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['rawHtml', 'markdown'],
        waitFor: 8000,
        timeout: 45000,
      }),
    });

    const scrapeData = await scrapeRes.json();
    if (!scrapeData.success) {
      return { success: false, error: 'Scrape failed' };
    }

    const html = scrapeData.data?.rawHtml || '';
    const markdown = scrapeData.data?.markdown || '';
    if (html.length < 1000) {
      return { success: false, error: 'No content' };
    }

    // Call edge function to extract and save
    const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/import-pcarmarket-listing`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        listing_url: url,
        html,
      }),
    });

    const result = await extractRes.json();

    if (result.success && result.vehicle_id) {
      // Link to org
      await fetch(`${SUPABASE_URL}/rest/v1/organization_vehicles`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({
          organization_id: ORG_ID,
          vehicle_id: result.vehicle_id,
          relationship_type: 'sold_by',
          auto_tagged: true,
        }),
      });

      return { success: true, title: result.title || result.vehicle?.title };
    }

    return { success: false, error: result.error || 'Extract failed' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  if (!FIRECRAWL_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing env vars: FIRECRAWL_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log(`
╔════════════════════════════════════════════════════╗
║  PCarMarket Batch Extractor                        ║
║  Batch size: ${BATCH_SIZE.toString().padEnd(5)} | Max pages: ${MAX_PAGES.toString().padEnd(5)}        ║
╚════════════════════════════════════════════════════╝
`);

  // Get existing URLs to avoid duplicates
  const existingUrls = await getExistingUrls();

  // Discover all listings from sitemap (much more reliable)
  const allListings = await discoverFromSitemap();

  if (allListings.length === 0) {
    console.log('No listings found in sitemap!');
    return;
  }

  // Filter to new listings
  const newListings = allListings.filter(u => !existingUrls.has(u));
  totalDiscovered = newListings.length;

  console.log(`\nFound ${allListings.length} total listings, ${newListings.length} new to process`);

  if (newListings.length === 0) {
    console.log('All listings already extracted!');
    return;
  }

  // Process in batches
  for (let i = 0; i < newListings.length; i += BATCH_SIZE) {
    const batch = newListings.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(newListings.length / BATCH_SIZE);

    console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing ${batch.length} listings...`);

    for (const url of batch) {
      const result = await extractListing(url);

      if (result.success) {
        totalSuccess++;
        existingUrls.add(url);
        console.log(`  ✓ ${result.title?.slice(0, 50) || 'imported'}`);
      } else {
        totalFailed++;
        if (totalFailed <= 10) console.log(`  ✗ ${result.error?.slice(0, 40)}`);
      }
    }

    // Brief pause between batches
    await new Promise(r => setTimeout(r, 2000));

    // Progress update every 5 batches
    if (batchNum % 5 === 0) {
      console.log(`\n  === Progress: ${totalSuccess} success, ${totalFailed} failed (${Math.round((totalSuccess + totalFailed) / totalDiscovered * 100)}%) ===`);
    }
  }

  console.log(`
╔════════════════════════════════════════════════════╗
║  COMPLETE                                          ║
║  Discovered: ${totalDiscovered.toString().padEnd(10)}                         ║
║  Success: ${totalSuccess.toString().padEnd(10)} | Failed: ${totalFailed.toString().padEnd(10)}    ║
╚════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);
