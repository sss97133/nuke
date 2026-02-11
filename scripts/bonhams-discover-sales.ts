#!/usr/bin/env npx tsx
/**
 * Bonhams Sale Discovery via Playwright
 *
 * cars.bonhams.com/auctions/ is a JS SPA — static fetch returns no sale IDs.
 * This script uses Playwright to render the page, discover all sale IDs,
 * then calls the extract-bonhams edge function for each catalog.
 *
 * Also widens the sequential scan range to 27000-33000 for any sales
 * not found on the auctions page.
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/bonhams-discover-sales.ts
 */

import { chromium } from 'playwright';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [BONHAMS-DISCOVER] ${msg}`);
}

async function callEdgeFunction(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-bonhams`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function discoverSalesViaPlaywright(): Promise<Set<string>> {
  const saleIds = new Set<string>();
  log('Launching browser for Bonhams discovery...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  // Try multiple discovery pages
  const discoveryUrls = [
    'https://cars.bonhams.com/auctions/',
    'https://cars.bonhams.com/auctions/?status=past',
    'https://www.bonhams.com/department/MOT/',
    'https://www.bonhams.com/auctions/?department=MOT',
  ];

  for (const url of discoveryUrls) {
    try {
      log(`Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Scroll to load lazy content
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(500);
      }

      // Extract all auction/sale URLs
      const ids = await page.evaluate(() => {
        const found: string[] = [];
        // Look for /auction/{id}/ pattern in all links
        document.querySelectorAll('a[href]').forEach((a: any) => {
          const href = a.href || '';
          const match = href.match(/\/auction\/(\d+)\/?/);
          if (match) found.push(match[1]);
        });
        // Also check the HTML for inline references
        const html = document.body.innerHTML;
        const matches = html.matchAll(/\/auction\/(\d+)\/?/g);
        for (const m of matches) {
          found.push(m[1]);
        }
        return [...new Set(found)];
      });

      for (const id of ids) {
        saleIds.add(id);
      }
      log(`  Found ${ids.length} sale IDs from ${url}`);
    } catch (err: any) {
      log(`  Error fetching ${url}: ${err.message}`);
    }
  }

  await browser.close();
  return saleIds;
}

async function main() {
  console.log('='.repeat(50));
  console.log('  BONHAMS SALE DISCOVERY');
  console.log('='.repeat(50));

  // Phase 1: Playwright discovery
  const discoveredIds = await discoverSalesViaPlaywright();
  log(`Playwright discovered ${discoveredIds.size} unique sale IDs`);

  // Phase 2: Widen sequential scan range (27000-33000)
  // Only try IDs not already found via Playwright
  log('Scanning sequential range 27000-33000...');
  const sequentialIds = new Set<string>();
  for (let id = 27000; id <= 33000; id++) {
    if (!discoveredIds.has(String(id))) {
      sequentialIds.add(String(id));
    }
  }
  log(`${sequentialIds.size} IDs to probe from sequential range`);

  // Combine all IDs (Playwright-discovered first since they're confirmed)
  const allIds = [...discoveredIds, ...sequentialIds];
  log(`Total sale IDs to process: ${allIds.length}`);

  // Phase 3: Call edge function for each sale
  let totalLots = 0;
  let successfulSales = 0;
  let failedSales = 0;

  // Process Playwright-discovered first (high confidence)
  for (const saleId of discoveredIds) {
    try {
      log(`Extracting confirmed sale: ${saleId}`);
      const result = await callEdgeFunction({
        catalog_url: `https://cars.bonhams.com/auction/${saleId}/`,
      });

      if (result.success) {
        const lots = result.lots_processed || 0;
        totalLots += lots;
        successfulSales++;
        log(`  Sale ${saleId}: ${lots} lots extracted`);
      } else {
        log(`  Sale ${saleId}: ${result.error || 'failed'}`);
      }
    } catch (err: any) {
      log(`  Sale ${saleId} error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Probe sequential range (low confidence — many will 404)
  // Do these in quick succession since most will fail fast
  let probeHits = 0;
  for (const saleId of sequentialIds) {
    try {
      const result = await callEdgeFunction({
        catalog_url: `https://cars.bonhams.com/auction/${saleId}/`,
      });

      if (result.success && (result.lots_processed || 0) > 0) {
        const lots = result.lots_processed || 0;
        totalLots += lots;
        successfulSales++;
        probeHits++;
        log(`  PROBE HIT: Sale ${saleId}: ${lots} lots`);
      }
    } catch {
      // Expected — most IDs won't exist
    }
    // Faster delay for probing since most fail quickly
    await new Promise(r => setTimeout(r, 300));
  }
  log(`Sequential probe found ${probeHits} additional sales`);

  console.log('\n' + '='.repeat(50));
  console.log('  BONHAMS DISCOVERY COMPLETE');
  console.log('='.repeat(50));
  console.log(`Successful sales: ${successfulSales}`);
  console.log(`Total lots extracted: ${totalLots}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
