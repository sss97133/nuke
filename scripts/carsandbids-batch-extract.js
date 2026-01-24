#!/usr/bin/env node
/**
 * Cars & Bids Batch Extractor
 *
 * Discovers sold listings from C&B and extracts them via Firecrawl.
 * Uses sitemap/pagination to find all sold auction URLs.
 *
 * Usage:
 *   node scripts/carsandbids-batch-extract.js [batch-size] [max-pages]
 *   node scripts/carsandbids-batch-extract.js 20 100
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH_SIZE = parseInt(process.argv[2]) || 20;
const MAX_PAGES = parseInt(process.argv[3]) || 500;
const ORG_ID = 'c124e282-a99c-4c9a-971d-65a0ddc03224';

let totalSuccess = 0;
let totalFailed = 0;
let totalDiscovered = 0;

async function getExistingUrls() {
  const urls = new Set();
  let offset = 0;

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vehicles?discovery_url=ilike.*carsandbids*&select=discovery_url&limit=1000&offset=${offset}`,
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

  console.log(`Found ${urls.size} existing C&B vehicles`);
  return urls;
}

async function discoverSoldListings(page) {
  // C&B past auctions page with pagination
  const url = page === 1
    ? `https://carsandbids.com/past-auctions/`
    : `https://carsandbids.com/past-auctions/?page=${page}`;

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['rawHtml', 'markdown'],
        waitFor: 15000, // Longer wait for JS-heavy page
        timeout: 60000,
        actions: [
          { type: 'wait', milliseconds: 5000 }, // Extra wait after load
          { type: 'scroll', direction: 'down', amount: 2000 } // Trigger lazy-load
        ],
      }),
    });

    const data = await res.json();
    if (!data.success) {
      console.log(`    Firecrawl failed: ${data.error || 'unknown'}`);
      return [];
    }

    const html = data.data?.rawHtml || '';
    const markdown = data.data?.markdown || '';

    if (page === 1) {
      console.log(`    HTML length: ${html.length}, MD length: ${markdown.length}`);
    }

    // C&B URLs look like: carsandbids.com/auctions/[id]/[year]-[make]-[model]
    // Try multiple patterns
    const listings = new Set();

    // Pattern 1: Full URLs in HTML
    const fullUrlPattern = /https:\/\/carsandbids\.com\/auctions\/([A-Za-z0-9]+\/[^"'\s<>]+)/g;
    for (const m of html.matchAll(fullUrlPattern)) {
      const cleanUrl = `https://carsandbids.com/auctions/${m[1]}`.split('?')[0];
      listings.add(cleanUrl);
    }

    // Pattern 2: Relative URLs
    const relPattern = /href="\/auctions\/([A-Za-z0-9]+\/[^"]+)"/g;
    for (const m of html.matchAll(relPattern)) {
      const cleanUrl = `https://carsandbids.com/auctions/${m[1]}`.split('?')[0];
      listings.add(cleanUrl);
    }

    // Pattern 3: From markdown links
    const mdPattern = /\(https:\/\/carsandbids\.com\/auctions\/([^)]+)\)/g;
    for (const m of markdown.matchAll(mdPattern)) {
      const cleanUrl = `https://carsandbids.com/auctions/${m[1]}`.split('?')[0];
      listings.add(cleanUrl);
    }

    return [...listings];
  } catch (e) {
    console.error(`  Discovery error page ${page}: ${e.message}`);
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
        formats: ['rawHtml'],
        waitFor: 8000,
        timeout: 45000,
      }),
    });

    const scrapeData = await scrapeRes.json();
    if (!scrapeData.success) {
      return { success: false, error: 'Scrape failed' };
    }

    const html = scrapeData.data?.rawHtml || '';
    if (html.length < 1000) {
      return { success: false, error: 'No content' };
    }

    // Call edge function to extract and save
    const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/extract-cars-and-bids-core`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        html,
        save_to_db: true,
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
║  Cars & Bids Batch Extractor                       ║
║  Batch size: ${BATCH_SIZE.toString().padEnd(5)} | Max pages: ${MAX_PAGES.toString().padEnd(5)}        ║
╚════════════════════════════════════════════════════╝
`);

  // Get existing URLs to avoid duplicates
  const existingUrls = await getExistingUrls();

  let page = 1;
  let consecutiveEmpty = 0;

  while (page <= MAX_PAGES && consecutiveEmpty < 3) {
    console.log(`\n[Page ${page}] Discovering listings...`);

    const listings = await discoverSoldListings(page);

    if (listings.length === 0) {
      consecutiveEmpty++;
      console.log(`  No listings found (${consecutiveEmpty}/3 empty)`);
      page++;
      continue;
    }

    consecutiveEmpty = 0;

    // Filter to new listings
    const newListings = listings.filter(u => !existingUrls.has(u));
    totalDiscovered += newListings.length;

    console.log(`  Found ${listings.length} listings, ${newListings.length} new`);

    if (newListings.length === 0) {
      page++;
      continue;
    }

    // Process in batches
    for (let i = 0; i < newListings.length; i += BATCH_SIZE) {
      const batch = newListings.slice(i, i + BATCH_SIZE);

      console.log(`  Processing batch of ${batch.length}...`);

      for (const url of batch) {
        const result = await extractListing(url);

        if (result.success) {
          totalSuccess++;
          existingUrls.add(url);
          console.log(`    ✓ ${result.title?.slice(0, 50) || 'imported'}`);
        } else {
          totalFailed++;
          if (totalFailed <= 5) console.log(`    ✗ ${result.error?.slice(0, 40)}`);
        }
      }

      // Brief pause between batches
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`  Progress: ${totalSuccess} success, ${totalFailed} failed`);
    page++;

    // Pause between pages
    await new Promise(r => setTimeout(r, 2000));
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
