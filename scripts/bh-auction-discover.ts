#!/usr/bin/env npx tsx
/**
 * BH Auction Playwright Discovery
 *
 * BH Auction lot listing pages need JS rendering. Static HTML fetch misses lot URLs.
 * This script:
 *   1. Navigates to bhauction.com/en/ and /en/result/ via Playwright
 *   2. Extracts auction slugs from rendered links
 *   3. For each slug → navigates to lots page, extracts lot URLs
 *   4. For each lot → calls extract-bh-auction edge function
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/bh-auction-discover.ts
 */

import { chromium, BrowserContext } from 'playwright';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [BH-DISCOVER] ${msg}`);
}

async function callEdgeFunction(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-bh-auction`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

interface AuctionInfo {
  slug: string;
  type: 'auction' | 'result';
  url: string;
}

async function discoverAuctions(context: BrowserContext): Promise<AuctionInfo[]> {
  const auctions: AuctionInfo[] = [];
  const seen = new Set<string>();
  const page = await context.newPage();

  const discoveryPages = [
    { url: 'https://bhauction.com/en/', type: 'auction' as const },
    { url: 'https://bhauction.com/en/result/', type: 'result' as const },
    { url: 'https://bhauction.com/en/auction/', type: 'auction' as const },
  ];

  for (const { url, type } of discoveryPages) {
    try {
      log(`Discovering auctions from: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Scroll to load all content
      for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(400);
      }

      // Extract auction/result slugs
      const slugs = await page.evaluate((pageType: string) => {
        const found: Array<{ slug: string; type: string }> = [];
        document.querySelectorAll('a[href]').forEach((a: any) => {
          const href = a.href || '';
          // Match /en/auction/{slug}/ or /en/result/{slug}/
          const auctionMatch = href.match(/\/en\/auction\/([^/]+)\/?$/);
          if (auctionMatch && auctionMatch[1] !== '') {
            found.push({ slug: auctionMatch[1], type: 'auction' });
          }
          const resultMatch = href.match(/\/en\/result\/([^/]+)\/?$/);
          if (resultMatch && resultMatch[1] !== '') {
            found.push({ slug: resultMatch[1], type: 'result' });
          }
        });
        return found;
      }, type);

      for (const s of slugs) {
        if (!seen.has(s.slug)) {
          seen.add(s.slug);
          auctions.push({
            slug: s.slug,
            type: s.type as 'auction' | 'result',
            url: `https://bhauction.com/en/${s.type}/${s.slug}/`,
          });
        }
      }
      log(`  Found ${slugs.length} slugs (${auctions.length} unique total)`);
    } catch (err: any) {
      log(`  Error on ${url}: ${err.message}`);
    }
  }

  await page.close();
  return auctions;
}

async function discoverLotUrls(context: BrowserContext, auction: AuctionInfo): Promise<string[]> {
  const page = await context.newPage();
  const lotUrls: string[] = [];

  try {
    const lotsUrl = `${auction.url}lots/`;
    log(`  Discovering lots from: ${lotsUrl}`);
    await page.goto(lotsUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to load all lots
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(400);
    }

    const urls = await page.evaluate((auctionSlug: string) => {
      const found: string[] = [];
      document.querySelectorAll('a[href]').forEach((a: any) => {
        const href = a.href || '';
        // Match individual lot URLs
        if (href.match(/\/en\/(?:result|auction)\/[^/]+\/lots\/[^/]+/)) {
          if (!href.endsWith('/lots/') && !found.includes(href)) {
            found.push(href);
          }
        }
      });
      return found;
    }, auction.slug);

    lotUrls.push(...urls);
    log(`  Found ${urls.length} lot URLs for ${auction.slug}`);
  } catch (err: any) {
    log(`  Error discovering lots for ${auction.slug}: ${err.message}`);
  }

  await page.close();
  return lotUrls;
}

async function main() {
  console.log('='.repeat(50));
  console.log('  BH AUCTION PLAYWRIGHT DISCOVERY');
  console.log('='.repeat(50));

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  // Phase 1: Discover all auctions
  const auctions = await discoverAuctions(context);
  log(`Discovered ${auctions.length} auctions`);

  // Phase 2: For each auction, discover lot URLs
  const allLotUrls: string[] = [];
  for (const auction of auctions) {
    const lotUrls = await discoverLotUrls(context, auction);
    allLotUrls.push(...lotUrls);
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  log(`Total lot URLs discovered: ${allLotUrls.length}`);

  // Phase 3: Call edge function for each lot URL
  let success = 0;
  let failed = 0;

  for (let i = 0; i < allLotUrls.length; i++) {
    const url = allLotUrls[i];
    try {
      log(`[${i + 1}/${allLotUrls.length}] Extracting: ${url.slice(-60)}`);
      const result = await callEdgeFunction({ url, save_to_db: true });

      if (result.success) {
        success++;
        const ext = result.extracted;
        log(`  OK: ${ext?.year || '?'} ${ext?.make || '?'} ${ext?.model || '?'}`);
      } else {
        failed++;
        log(`  FAIL: ${result.error || 'unknown'}`);
      }
    } catch (err: any) {
      failed++;
      log(`  ERROR: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Phase 4: Also try batch mode for any auctions with slugs
  for (const auction of auctions) {
    try {
      log(`Running batch mode for slug: ${auction.slug}`);
      const result = await callEdgeFunction({
        auction_slug: auction.slug,
        batch: true,
        limit: 100,
      });
      if (result.success) {
        log(`  Batch ${auction.slug}: processed=${result.processed}, success=${result.successful}`);
        success += result.successful || 0;
      }
    } catch (err: any) {
      log(`  Batch error for ${auction.slug}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n' + '='.repeat(50));
  console.log('  BH AUCTION DISCOVERY COMPLETE');
  console.log('='.repeat(50));
  console.log(`Auctions found: ${auctions.length}`);
  console.log(`Lot URLs discovered: ${allLotUrls.length}`);
  console.log(`Successful extractions: ${success}`);
  console.log(`Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
