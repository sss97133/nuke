#!/usr/bin/env node
/**
 * C&B Local Extractor - FREE (uses Playwright instead of Firecrawl)
 * 
 * 10x faster, zero cost, runs locally.
 * Usage: node scripts/cab-local-extract.js [batch-size] [max-pages]
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = parseInt(process.argv[2]) || 20;
const MAX_PAGES = parseInt(process.argv[3]) || 100;

const CAB_ORG_ID = "4dac1878-b3fc-424c-9e92-3cf552f1e053";

async function getExistingUrls() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.carsandbids&select=discovery_url`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });
  const data = await res.json();
  return new Set(data.map(v => v.discovery_url?.replace(/\/$/, '')));
}

async function discoverListings(page, pageNum) {
  const url = `https://carsandbids.com/past-auctions/?page=${pageNum}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  const links = await page.$$eval('a[href*="/auctions/"]', els => 
    els.map(el => el.href).filter(h => h.match(/\/auctions\/[A-Za-z0-9]+\//))
  );
  
  return [...new Set(links)];
}

async function extractListing(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    
    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 1500));
    await page.waitForTimeout(1000);
    
    const data = await page.evaluate(() => {
      const getMeta = (prop) => document.querySelector(`meta[property="${prop}"]`)?.content || 
                                document.querySelector(`meta[name="${prop}"]`)?.content;
      
      const ogTitle = getMeta('og:title') || '';
      const ymmMatch = ogTitle.match(/^(\d{4})\s+(\S+)\s+([^-]+)/);
      
      // Get mileage from og:title
      const mileageMatch = ogTitle.match(/~?([\d,]+)\s*Miles/i);
      const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null;
      
      // Get images
      const images = [...document.querySelectorAll('img[src*="media.carsandbids.com"]')]
        .map(img => img.src)
        .filter(src => !src.includes('width=80') && !src.includes('_thumb'));
      
      // Get VIN from page text
      const pageText = document.body.innerText;
      const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      
      // Get current bid
      const bidMatch = pageText.match(/(?:Sold for|Bid to|High Bid)\s*\$?([\d,]+)/i);
      const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;
      
      return {
        year: ymmMatch ? parseInt(ymmMatch[1]) : null,
        make: ymmMatch ? ymmMatch[2].trim() : null,
        model: ymmMatch ? ymmMatch[3].trim() : null,
        mileage,
        vin: vinMatch ? vinMatch[1].toUpperCase() : null,
        images: [...new Set(images)].slice(0, 50),
        currentBid,
        description: getMeta('og:description'),
      };
    });
    
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function saveVehicle(data, url) {
  const vehicleData = {
    year: data.year,
    make: data.make,
    model: data.model,
    vin: data.vin,
    mileage: data.mileage,
    sale_price: data.currentBid,
    description: data.description,
    discovery_url: url.replace(/\/$/, ''),
    discovery_source: 'carsandbids',
    listing_source: 'cab-local-extract',
    status: 'active',
  };
  
  // Check if already exists by URL or VIN
  const cleanUrl = url.replace(/\/$/, '');
  let existRes = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?or=(discovery_url.eq.${encodeURIComponent(cleanUrl)},discovery_url.eq.${encodeURIComponent(cleanUrl + '/')})&select=id`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  let existing = await existRes.json();
  if (existing?.[0]?.id) {
    return { ...existing[0], isNew: false }; // Already exists
  }

  // Also check by VIN if we have one
  if (data.vin) {
    existRes = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?vin=eq.${data.vin}&select=id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    existing = await existRes.json();
    if (existing?.[0]?.id) {
      return { ...existing[0], isNew: false }; // Already exists by VIN
    }
  }

  // Insert new vehicle
  const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(vehicleData),
  });

  if (!res.ok) {
    const err = await res.text();
    // Handle duplicate gracefully - just find existing
    if (err.includes('23505') || err.includes('duplicate')) {
      const findRes = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?or=(discovery_url.eq.${encodeURIComponent(cleanUrl)},discovery_url.eq.${encodeURIComponent(cleanUrl + '/')})&select=id`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      });
      const found = await findRes.json();
      if (found?.[0]?.id) return found[0];
    }
    throw new Error(`Insert failed: ${err.slice(0, 60)}`);
  }

  const [vehicle] = await res.json();
  
  // Insert images
  if (data.images.length > 0 && vehicle?.id) {
    const imageRows = data.images.map((url, idx) => ({
      vehicle_id: vehicle.id,
      image_url: url,
      source: 'external_import',
      source_url: url,
      is_external: true,
      approval_status: 'auto_approved',
      is_approved: true,
      redaction_level: 'none',
      position: idx,
      display_order: idx,
      is_primary: idx === 0,
    }));
    
    await fetch(`${SUPABASE_URL}/rest/v1/vehicle_images`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(imageRows),
    });
  }
  
  // Link to C&B org
  if (vehicle?.id) {
    await fetch(`${SUPABASE_URL}/rest/v1/organization_vehicles`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        organization_id: CAB_ORG_ID,
        vehicle_id: vehicle.id,
        relationship_type: 'consigner',
        status: 'active',
        auto_tagged: true,
      }),
    });
  }
  
  return vehicle;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  C&B Local Extractor (FREE - Playwright)           ║');
  console.log(`║  Batch: ${BATCH_SIZE.toString().padEnd(8)} | Max pages: ${MAX_PAGES.toString().padEnd(14)}║`);
  console.log('╚════════════════════════════════════════════════════╝');
  
  const existing = await getExistingUrls();
  console.log(`\nFound ${existing.size} existing C&B vehicles\n`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  
  let totalExtracted = 0;
  
  const START_PAGE = parseInt(process.argv[4]) || 1;
  for (let pageNum = START_PAGE; pageNum <= MAX_PAGES; pageNum++) {
    console.log(`[Page ${pageNum}] Discovering listings...`);
    
    const listings = await discoverListings(page, pageNum);
    const newListings = listings.filter(url => !existing.has(url.replace(/\/$/, '')));
    
    console.log(`  Found ${listings.length} listings, ${newListings.length} new`);
    
    if (newListings.length === 0) {
      console.log('  No new listings, moving to next page...');
      continue;
    }
    
    // Process in batches
    for (let i = 0; i < newListings.length; i += BATCH_SIZE) {
      const batch = newListings.slice(i, i + BATCH_SIZE);
      console.log(`  Processing batch of ${batch.length}...`);
      
      for (const url of batch) {
        const result = await extractListing(page, url);
        
        if (result.success && result.data.year && result.data.make) {
          try {
            const vehicle = await saveVehicle(result.data, url);
            const title = `${result.data.year} ${result.data.make} ${result.data.model || ''}`.toLowerCase();
            if (vehicle?.isNew !== false) {
              console.log(`    ✓ ${title}`);
              totalExtracted++;
            } else {
              console.log(`    ~ ${title} (exists)`);
            }
            existing.add(url.replace(/\/$/, ''));
          } catch (e) {
            // Skip duplicate errors silently, they're fine
            if (e.message?.includes('23505') || e.message?.includes('duplicate')) {
              existing.add(url.replace(/\/$/, ''));
            } else {
              console.log(`    ✗ Save failed: ${e.message.slice(0, 50)}`);
            }
          }
        } else {
          console.log(`    ✗ Extract failed: ${result.error?.slice(0, 50) || 'no data'}`);
        }
        
        // Small delay between extractions
        await page.waitForTimeout(500);
      }
    }
    
    console.log(`  Page ${pageNum} complete. Total extracted: ${totalExtracted}\n`);
  }
  
  await browser.close();
  console.log(`\n✅ Done! Extracted ${totalExtracted} new vehicles (FREE)`);
}

main().catch(console.error);
