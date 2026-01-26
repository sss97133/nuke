#!/usr/bin/env node
/**
 * Mecum Discovery with Checkpointing
 * 
 * Saves progress to .ralph/mecum_checkpoint.json
 * Can resume from any interruption
 * Idempotent - safe to re-run
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHECKPOINT_FILE = '.ralph/mecum_checkpoint.json';
const WORKERS = parseInt(process.argv[2]) || 2;

// All Mecum auctions to discover
const LOCATIONS = [
  'kissimmee', 'monterey', 'indy', 'glendale', 'las-vegas',
  'houston', 'harrisburg', 'dallas-fort-worth', 'kansas-city',
  'denver', 'portland', 'tulsa', 'dallas', 'phoenix', 'chicago',
  'louisville', 'chattanooga', 'austin', 'anaheim', 'seattle'
];
const YEARS = ['2026','2025','2024','2023','2022','2021','2020','2019','2018','2017','2016','2015','2014','2013','2012','2011','2010'];

// Generate auction list
const ALL_AUCTIONS = LOCATIONS.flatMap(loc => YEARS.map(y => `${loc}-${y}`));

// --- Checkpoint Management ---
function loadCheckpoint() {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
    } catch (e) {
      console.log('Checkpoint corrupted, starting fresh');
    }
  }
  return {
    auctions: {},  // { slug: { lastPage: N, complete: bool, vehiclesFound: N } }
    totalDiscovered: 0,
    lastUpdated: null
  };
}

function saveCheckpoint(checkpoint) {
  checkpoint.lastUpdated = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

// --- URL Deduplication ---
let existingUrls = new Set();

async function loadExistingUrls() {
  console.log('Loading existing URLs...');
  let offset = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.mecum&select=discovery_url&limit=1000&offset=${offset}`, {
      headers: { 'apikey': SUPABASE_KEY }
    });
    const data = await res.json();
    if (data.length === 0) break;
    data.forEach(v => v.discovery_url && existingUrls.add(v.discovery_url.toLowerCase().replace(/\/$/, '')));
    offset += 1000;
  }
  console.log(`Loaded ${existingUrls.size} existing URLs`);
}

// --- Scraping ---
async function scrapeAuctionPage(page, auctionSlug, pageNum) {
  const url = `https://www.mecum.com/auctions/${auctionSlug}/lots/?page=${pageNum}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    
    const listings = await page.evaluate(() => {
      const results = [];
      const seen = new Set();
      document.querySelectorAll('a[href*="/lots/"]').forEach(link => {
        const match = link.href.match(/\/lots\/(\d+)\/(\d{4})-([^\/]+)/);
        if (!match || seen.has(match[1])) return;
        seen.add(match[1]);
        
        const card = link.closest('div, article, li') || link.parentElement;
        const text = card?.innerText || '';
        const priceMatch = text.match(/\$[\d,]+/);
        const img = card?.querySelector('img[src*="mecum"], img[src*="cloudfront"]');
        
        results.push({
          url: link.href.split('?')[0].replace(/\/$/, ''),
          year: parseInt(match[2]),
          make: match[3].split('-')[0],
          model: match[3].split('-').slice(1).join(' '),
          price: priceMatch ? parseInt(priceMatch[0].replace(/[$,]/g, '')) : null,
          thumbnail: img?.src || null,
        });
      });
      return results;
    });
    
    return { success: true, listings };
  } catch (e) {
    return { success: false, listings: [], error: e.message };
  }
}

async function saveListings(listings) {
  let saved = 0;
  for (const listing of listings) {
    const normalizedUrl = listing.url.toLowerCase().replace(/\/$/, '');
    if (existingUrls.has(normalizedUrl)) continue;
    
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/vehicles`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          year: listing.year,
          make: listing.make,
          model: listing.model,
          sale_price: listing.price,
          discovery_url: normalizedUrl,
          discovery_source: 'mecum',
          listing_source: 'mecum-checkpoint-discover',
          status: 'pending'
        }),
      });
      
      if (res.ok) {
        saved++;
        existingUrls.add(normalizedUrl);
      }
    } catch (e) {}
  }
  return saved;
}

// --- Main Discovery Loop ---
async function discoverAuction(browser, auctionSlug, checkpoint) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();
  
  // Resume from checkpoint or start at page 1
  const auctionState = checkpoint.auctions[auctionSlug] || { lastPage: 0, complete: false, vehiclesFound: 0 };
  if (auctionState.complete) {
    await context.close();
    return 0;
  }
  
  let startPage = auctionState.lastPage + 1;
  let totalSaved = 0;
  let emptyPages = 0;
  const MAX_EMPTY_PAGES = 3;  // Stop after 3 consecutive empty pages
  
  console.log(`[${auctionSlug}] Starting from page ${startPage}`);
  
  for (let pageNum = startPage; pageNum <= 300; pageNum++) {
    const result = await scrapeAuctionPage(page, auctionSlug, pageNum);
    
    if (!result.success || result.listings.length === 0) {
      emptyPages++;
      if (emptyPages >= MAX_EMPTY_PAGES) {
        console.log(`[${auctionSlug}] Complete at page ${pageNum} (${MAX_EMPTY_PAGES} empty pages)`);
        auctionState.complete = true;
        break;
      }
      continue;
    }
    
    emptyPages = 0;  // Reset on successful page
    const saved = await saveListings(result.listings);
    totalSaved += saved;
    auctionState.vehiclesFound += saved;
    auctionState.lastPage = pageNum;
    
    // Save checkpoint every 5 pages
    if (pageNum % 5 === 0) {
      checkpoint.auctions[auctionSlug] = auctionState;
      checkpoint.totalDiscovered += saved;
      saveCheckpoint(checkpoint);
    }
    
    if (saved > 0) {
      console.log(`[${auctionSlug}] p${pageNum}: +${saved} new (${auctionState.vehiclesFound} total)`);
    }
  }
  
  // Final checkpoint save
  checkpoint.auctions[auctionSlug] = auctionState;
  saveCheckpoint(checkpoint);
  
  await context.close();
  return totalSaved;
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  Mecum Discovery with Checkpointing                           ║');
  console.log('║  Progress saved to .ralph/mecum_checkpoint.json               ║');
  console.log('║  Safe to interrupt - will resume where it left off            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  
  const checkpoint = loadCheckpoint();
  console.log(`Checkpoint: ${Object.keys(checkpoint.auctions).length} auctions tracked, ${checkpoint.totalDiscovered} discovered`);
  
  await loadExistingUrls();
  
  const browser = await chromium.launch({ headless: true });
  
  // Find auctions that aren't complete
  const pendingAuctions = ALL_AUCTIONS.filter(slug => 
    !checkpoint.auctions[slug]?.complete
  );
  
  console.log(`\n${pendingAuctions.length} auctions remaining\n`);
  
  // Process sequentially for stability (can parallelize later)
  for (const auction of pendingAuctions) {
    try {
      await discoverAuction(browser, auction, checkpoint);
    } catch (e) {
      console.log(`[${auction}] Error: ${e.message}`);
      // Continue to next auction
    }
  }
  
  await browser.close();
  console.log(`\n✅ Discovery complete. Total: ${checkpoint.totalDiscovered} vehicles`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
