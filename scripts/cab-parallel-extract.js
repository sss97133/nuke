#!/usr/bin/env node
/**
 * C&B Parallel Extractor - FREE & FAST
 * Runs multiple browser contexts in parallel for 3-5x speedup
 */

import { chromium } from 'playwright';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PARALLEL = parseInt(process.argv[2]) || 5;
const MAX_PAGES = parseInt(process.argv[3]) || 600;
const START_PAGE = parseInt(process.argv[4]) || 1;

const CAB_ORG_ID = "4dac1878-b3fc-424c-9e92-3cf552f1e053";

async function getExistingUrls() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.carsandbids&select=discovery_url`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  const data = await res.json();
  return new Set(data.map(v => v.discovery_url?.replace(/\/$/, '')));
}

async function discoverListings(page, pageNum) {
  const url = `https://carsandbids.com/past-auctions/?page=${pageNum}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Wait for auction cards to appear
    await page.waitForSelector('a[href*="/auctions/"]', { timeout: 10000 }).catch(() => {});

    const links = await page.$$eval('a[href*="/auctions/"]', els =>
      els.map(el => el.href).filter(h => h.match(/\/auctions\/[A-Za-z0-9]+\//))
    );
    return [...new Set(links)];
  } catch (e) {
    console.error(`  Page ${pageNum} discovery failed: ${e.message.slice(0, 50)}`);
    return [];
  }
}

async function extractListing(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(500);
    
    const data = await page.evaluate(() => {
      const getMeta = (prop) => document.querySelector(`meta[property="${prop}"]`)?.content || 
                                document.querySelector(`meta[name="${prop}"]`)?.content;
      const ogTitle = getMeta('og:title') || document.title || '';
      const ymmMatch = ogTitle.match(/^(\d{4})\s+(\S+)\s+([^-]+)/);
      const mileageMatch = ogTitle.match(/~?([\d,]+)\s*Miles/i);
      const pageText = document.body?.innerText || '';
      const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      const bidMatch = pageText.match(/(?:Sold for|Bid to|High Bid)\s*\$?([\d,]+)/i);
      const images = [...document.querySelectorAll('img[src*="media.carsandbids.com"]')]
        .map(img => img.src).filter(src => !src.includes('width=80') && !src.includes('_thumb'));
      
      return {
        year: ymmMatch ? parseInt(ymmMatch[1]) : null,
        make: ymmMatch ? ymmMatch[2].trim() : null,
        model: ymmMatch ? ymmMatch[3].trim() : null,
        mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
        vin: vinMatch ? vinMatch[1].toUpperCase() : null,
        images: [...new Set(images)].slice(0, 50),
        currentBid: bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null,
        description: getMeta('og:description'),
      };
    });
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function saveVehicle(data, url, supabaseUrl, supabaseKey) {
  const cleanUrl = url.replace(/\/$/, '');
  
  // Check existing
  let existRes = await fetch(`${supabaseUrl}/rest/v1/vehicles?or=(discovery_url.eq.${encodeURIComponent(cleanUrl)},discovery_url.eq.${encodeURIComponent(cleanUrl + '/')})&select=id`, {
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
  });
  let existing = await existRes.json();
  if (existing?.[0]?.id) return { ...existing[0], isNew: false };
  
  if (data.vin) {
    existRes = await fetch(`${supabaseUrl}/rest/v1/vehicles?vin=eq.${data.vin}&select=id`, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` },
    });
    existing = await existRes.json();
    if (existing?.[0]?.id) return { ...existing[0], isNew: false };
  }

  const vehicleData = {
    year: data.year, make: data.make, model: data.model, vin: data.vin,
    mileage: data.mileage, sale_price: data.currentBid, description: data.description,
    discovery_url: cleanUrl, discovery_source: 'carsandbids',
    listing_source: 'cab-parallel-extract', status: 'active',
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/vehicles`, {
    method: 'POST',
    headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(vehicleData),
  });

  if (!res.ok) {
    const err = await res.text();
    if (err.includes('23505') || err.includes('duplicate')) return { isNew: false };
    throw new Error(err.slice(0, 60));
  }
  
  const [vehicle] = await res.json();
  
  // Images
  if (data.images.length > 0 && vehicle?.id) {
    const imageRows = data.images.map((imgUrl, idx) => ({
      vehicle_id: vehicle.id, image_url: imgUrl, source: 'external_import',
      source_url: imgUrl, is_external: true, approval_status: 'auto_approved',
      is_approved: true, redaction_level: 'none', position: idx, display_order: idx, is_primary: idx === 0,
    }));
    await fetch(`${supabaseUrl}/rest/v1/vehicle_images`, {
      method: 'POST', headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(imageRows),
    });
  }
  
  // Org link
  if (vehicle?.id) {
    await fetch(`${supabaseUrl}/rest/v1/organization_vehicles`, {
      method: 'POST',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json', 'Prefer': 'resolution=ignore-duplicates' },
      body: JSON.stringify({ organization_id: CAB_ORG_ID, vehicle_id: vehicle.id,
        relationship_type: 'consigner', status: 'active', auto_tagged: true }),
    });
  }
  
  return { ...vehicle, isNew: true };
}

async function logHealth(success, url, errorMsg = null) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/scraping_health`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'carsandbids', url, success,
        error_message: errorMsg?.slice(0, 200),
        error_type: errorMsg?.includes('Timeout') ? 'timeout' : (errorMsg ? 'parse_error' : null),
        function_name: 'cab-parallel-extract',
      }),
    });
  } catch {}
}

async function worker(workerId, browser, queue, existing, stats) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || existing.has(url.replace(/\/$/, ''))) continue;
    
    const result = await extractListing(page, url);
    
    if (result.success && result.data.year && result.data.make) {
      try {
        const vehicle = await saveVehicle(result.data, url, SUPABASE_URL, SUPABASE_KEY);
        const title = `${result.data.year} ${result.data.make} ${result.data.model || ''}`.toLowerCase();
        if (vehicle?.isNew !== false) {
          console.log(`  [W${workerId}] ✓ ${title}`);
          stats.extracted++;
          await logHealth(true, url);
        }
        existing.add(url.replace(/\/$/, ''));
        stats.processed++;
      } catch (e) {
        if (!e.message?.includes('duplicate')) {
          console.log(`  [W${workerId}] ✗ ${e.message.slice(0, 40)}`);
          await logHealth(false, url, e.message);
        }
        stats.errors++;
      }
    } else {
      stats.errors++;
      await logHealth(false, url, result.error || 'no data');
    }
  }
  
  await context.close();
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  C&B PARALLEL Extractor (FREE - Playwright)        ║');
  console.log(`║  Workers: ${PARALLEL.toString().padEnd(6)} | Pages: ${START_PAGE}-${MAX_PAGES.toString().padEnd(14)}║`);
  console.log('╚════════════════════════════════════════════════════╝');
  
  const existing = await getExistingUrls();
  console.log(`Found ${existing.size} existing C&B vehicles\n`);
  
  const browser = await chromium.launch({ headless: true });
  const discoveryCtx = await browser.newContext();
  const discoveryPage = await discoveryCtx.newPage();
  
  const stats = { extracted: 0, processed: 0, errors: 0 };
  
  for (let pageNum = START_PAGE; pageNum <= MAX_PAGES; pageNum++) {
    console.log(`[Page ${pageNum}] Discovering...`);
    const listings = await discoverListings(discoveryPage, pageNum);
    const newListings = listings.filter(url => !existing.has(url.replace(/\/$/, '')));
    
    console.log(`  Found ${listings.length} listings, ${newListings.length} new`);
    if (newListings.length === 0) continue;
    
    // Process in parallel
    const queue = [...newListings];
    const workers = [];
    for (let i = 0; i < PARALLEL; i++) {
      workers.push(worker(i, browser, queue, existing, stats));
    }
    await Promise.all(workers);
    
    console.log(`  Page ${pageNum} done. Total: ${stats.extracted} extracted, ${stats.errors} errors\n`);
  }
  
  await browser.close();
  console.log(`\n✅ Done! Extracted ${stats.extracted} vehicles (FREE)`);
}

main().catch(console.error);
