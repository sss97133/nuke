#!/usr/bin/env npx tsx
/**
 * Barrett-Jackson Queue Extractor
 *
 * Resilient Playwright-based processor for BJ URLs in import_queue.
 * Key improvements over bj-docket-extractor.ts:
 *   - NEW page per URL (no reusing dead pages)
 *   - Restarts browser after 5 consecutive crashes
 *   - Claims batches from import_queue using claim_import_queue_batch RPC
 *   - --workers N flag for parallel browser instances
 *   - 2s delay between URLs per worker
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/bj-queue-extractor.ts
 *   dotenvx run -- npx tsx scripts/bj-queue-extractor.ts --workers 3
 *   dotenvx run -- npx tsx scripts/bj-queue-extractor.ts --workers 5 --batch-size 50
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultVal;
}

const NUM_WORKERS = getArg('workers', 3);
const BATCH_SIZE = getArg('batch-size', 50);
const DELAY_MS = getArg('delay', 2000);
const MAX_CONSECUTIVE_CRASHES = 5;

// Stats
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  skipped: 0,
  browserRestarts: 0,
};

function log(worker: number | string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [BJ-Q:${worker}] ${msg}`);
}

async function createStealthContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
}

async function extractLotPage(context: BrowserContext, url: string): Promise<any> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      function getText(selector: string): string | null {
        return document.querySelector(selector)?.textContent?.trim() || null;
      }

      const title = getText('h1') || getText('[class*="title"]') || '';

      const yearMatch = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      const lotText = document.body.innerText;
      const lotMatch = lotText.match(/Lot\s*#?\s*(\d+)/i);
      const lotNumber = lotMatch ? lotMatch[1] : null;

      const vinMatch = lotText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      const vin = vinMatch ? vinMatch[1] : null;

      const images: string[] = [];
      document.querySelectorAll('img').forEach((img) => {
        const src = img.src || img.dataset.src;
        if (src && (src.includes('cloudinary') || src.includes('barrett-jackson')) &&
            !src.includes('logo') && !src.includes('icon') && img.width > 200) {
          images.push(src);
        }
      });

      const specs: Record<string, string> = {};
      const specPatterns = [
        /Engine[:\s]*([^\n]+)/i,
        /Transmission[:\s]*([^\n]+)/i,
        /Mileage[:\s]*([\d,]+)/i,
        /Miles[:\s]*([\d,]+)/i,
        /Exterior[:\s]*([^\n]+)/i,
        /Interior[:\s]*([^\n]+)/i,
      ];
      specPatterns.forEach((pattern) => {
        const match = lotText.match(pattern);
        if (match) {
          const key = pattern.source.split('[')[0].toLowerCase();
          specs[key] = match[1].trim();
        }
      });

      const descEl = document.querySelector('[class*="description"]') ||
                     document.querySelector('[class*="highlights"]');
      const description = descEl?.textContent?.trim().slice(0, 2000) || null;

      const priceMatch = lotText.match(/\$[\d,]+(?:\.\d{2})?/g);
      const hammerPrice = priceMatch ? priceMatch[priceMatch.length - 1] : null;

      return {
        title,
        year,
        lotNumber,
        vin,
        images: [...new Set(images)].slice(0, 20),
        specs,
        description,
        hammerPrice,
        url: window.location.href,
      };
    });

    return data;
  } finally {
    await page.close().catch(() => {});
  }
}

async function saveLot(lot: any, queueItemId: string): Promise<string | null> {
  let make = '';
  let model = '';

  if (lot.title) {
    const titleParts = lot.title.replace(/^\d{4}\s*/, '').split(/\s+/);
    if (titleParts.length >= 1) make = titleParts[0];
    if (titleParts.length >= 2) model = titleParts.slice(1).join(' ').slice(0, 100);
  }

  const mileage = lot.specs?.mileage ? parseInt(lot.specs.mileage.replace(/,/g, '')) : null;
  const price = lot.hammerPrice ? parseInt(lot.hammerPrice.replace(/[$,]/g, '')) : null;

  // Check for existing vehicle by discovery_url
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('discovery_url', lot.url)
    .maybeSingle();

  let vehicleId: string | null = null;

  if (existing) {
    vehicleId = existing.id;
    await supabase.from('vehicles').update({
      title: lot.title?.slice(0, 200),
      year: lot.year,
      make,
      model,
      vin: lot.vin,
      mileage,
      sale_price: price,
      engine: lot.specs?.engine,
      transmission: lot.specs?.transmission,
      color: lot.specs?.exterior,
      interior_color: lot.specs?.interior,
      description: lot.description,
      status: price ? 'sold' : 'active',
      updated_at: new Date().toISOString(),
    }).eq('id', vehicleId);
  } else {
    const { data: newVehicle, error } = await supabase.from('vehicles').insert({
      title: lot.title?.slice(0, 200),
      year: lot.year,
      make,
      model,
      vin: lot.vin,
      mileage,
      sale_price: price,
      engine: lot.specs?.engine,
      transmission: lot.specs?.transmission,
      color: lot.specs?.exterior,
      interior_color: lot.specs?.interior,
      description: lot.description,
      discovery_source: 'barrett-jackson',
      discovery_url: lot.url,
      status: price ? 'sold' : 'active',
      is_public: true,
    }).select('id').single();

    if (error) {
      throw new Error(`DB insert error: ${error.message}`);
    }
    vehicleId = newVehicle.id;
  }

  // Save images
  if (lot.images?.length > 0 && vehicleId) {
    const imageRecords = lot.images.map((img_url: string, i: number) => ({
      vehicle_id: vehicleId,
      image_url: img_url,
      position: i,
      source: 'barrett_jackson_import',
      is_external: true,
    }));
    await supabase.from('vehicle_images').insert(imageRecords);
  }

  // Mark queue item complete
  await supabase.from('import_queue').update({
    status: 'complete',
    vehicle_id: vehicleId,
    processed_at: new Date().toISOString(),
  }).eq('id', queueItemId);

  return vehicleId;
}

async function claimBatch(workerId: string): Promise<any[]> {
  const { data, error } = await supabase.rpc('claim_import_queue_batch', {
    p_batch_size: BATCH_SIZE,
    p_max_attempts: 3,
    p_worker_id: workerId,
    p_lock_ttl_seconds: 600,
  });

  if (error) {
    log(workerId, `Claim error: ${error.message}`);
    return [];
  }

  // Filter to BJ URLs only
  const bjItems = (data || []).filter((item: any) =>
    item.listing_url?.includes('barrett-jackson')
  );

  // Release non-BJ items back to pending
  const nonBjItems = (data || []).filter((item: any) =>
    !item.listing_url?.includes('barrett-jackson')
  );
  if (nonBjItems.length > 0) {
    await supabase.from('import_queue').update({
      status: 'pending',
      locked_at: null,
      locked_by: null,
    }).in('id', nonBjItems.map((i: any) => i.id));
  }

  return bjItems;
}

async function markFailed(queueItemId: string, errorMsg: string) {
  await supabase.from('import_queue').update({
    status: 'failed',
    error_message: errorMsg.slice(0, 500),
    locked_at: null,
    locked_by: null,
  }).eq('id', queueItemId);
}

async function runWorker(workerId: number) {
  const wid = `bj-pw-${workerId}`;
  log(wid, 'Starting worker');

  let browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  let context = await createStealthContext(browser);
  let consecutiveCrashes = 0;

  while (true) {
    const batch = await claimBatch(wid);
    if (batch.length === 0) {
      log(wid, 'No more BJ items in queue');
      break;
    }

    log(wid, `Claimed ${batch.length} items`);

    for (const item of batch) {
      try {
        const lot = await extractLotPage(context, item.listing_url);

        if (!lot.title && !lot.year) {
          stats.skipped++;
          await markFailed(item.id, 'No data extracted from page');
          log(wid, `SKIP (no data): ${item.listing_url}`);
          continue;
        }

        await saveLot(lot, item.id);
        stats.success++;
        consecutiveCrashes = 0;
        log(wid, `OK: ${lot.year || '?'} ${lot.title?.slice(0, 50) || '?'}`);
      } catch (err: any) {
        stats.failed++;
        consecutiveCrashes++;
        await markFailed(item.id, err.message);
        log(wid, `FAIL: ${item.listing_url} — ${err.message.slice(0, 80)}`);

        // Restart browser after too many consecutive crashes
        if (consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES) {
          log(wid, `${consecutiveCrashes} consecutive crashes — restarting browser`);
          stats.browserRestarts++;
          try { await context.close(); } catch {}
          try { await browser.close(); } catch {}
          browser = await chromium.launch({
            headless: true,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
          });
          context = await createStealthContext(browser);
          consecutiveCrashes = 0;
        }
      }

      stats.total++;
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  try { await context.close(); } catch {}
  try { await browser.close(); } catch {}
  log(wid, 'Worker done');
}

async function main() {
  console.log('='.repeat(50));
  console.log('  BARRETT-JACKSON QUEUE EXTRACTOR');
  console.log(`  Workers: ${NUM_WORKERS} | Batch: ${BATCH_SIZE} | Delay: ${DELAY_MS}ms`);
  console.log('='.repeat(50));

  // Check pending count
  const { count } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .like('listing_url', '%barrett-jackson%')
    .eq('status', 'pending');

  console.log(`\nPending BJ URLs in queue: ${count || 0}\n`);

  if (!count || count === 0) {
    console.log('Nothing to process. Exiting.');
    return;
  }

  // Launch workers in parallel
  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => runWorker(i));
  await Promise.all(workers);

  console.log('\n' + '='.repeat(50));
  console.log('  EXTRACTION COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total processed: ${stats.total}`);
  console.log(`  Success: ${stats.success}`);
  console.log(`  Failed:  ${stats.failed}`);
  console.log(`  Skipped: ${stats.skipped}`);
  console.log(`  Browser restarts: ${stats.browserRestarts}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
