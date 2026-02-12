#!/usr/bin/env npx tsx
/**
 * Barrett-Jackson Queue Extractor
 *
 * Uses Playwright for page extraction + direct PostgreSQL for DB operations.
 * Bypasses PostgREST (which has persistent schema cache issues).
 *
 * Usage:
 *   dotenvx run -- npx tsx scripts/bj-queue-extractor.ts
 *   dotenvx run -- npx tsx scripts/bj-queue-extractor.ts --workers 2 --batch-size 30
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// Build connection string from Supabase env vars
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;
const DATABASE_URL = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return defaultVal;
}

const NUM_WORKERS = getArg('workers', 2);
const BATCH_SIZE = getArg('batch-size', 30);
const DELAY_MS = getArg('delay', 2000);
const MAX_CONSECUTIVE_CRASHES = 5;

// Create a connection pool
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: NUM_WORKERS + 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

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

    // Use string-based evaluate to avoid tsx __name transformation bug
    // Check for Cloudflare block
    const pageTitle = await page.title();
    if (pageTitle.includes('blocked') || pageTitle.includes('Attention Required') || pageTitle.includes('Just a moment')) {
      throw new Error('BLOCKED by Cloudflare/bot protection');
    }

    const bodyText = await page.evaluate('document.body.innerText.slice(0, 200)');
    if (bodyText.includes('Sorry, you have been blocked') || bodyText.includes('ray ID')) {
      throw new Error('BLOCKED by Cloudflare/bot protection');
    }

    const data = await page.evaluate(`(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      const title = getText('h1') || getText('[class*="title"]') || '';
      const yearMatch = title.match(/\\b(19\\d{2}|20[0-2]\\d)\\b/);
      const year = yearMatch ? parseInt(yearMatch[1]) : null;

      const lotText = document.body.innerText;
      const lotMatch = lotText.match(/Lot\\s*#?\\s*(\\d+)/i);
      const lotNumber = lotMatch ? lotMatch[1] : null;

      const vinMatch = lotText.match(/VIN[:\\s]*([A-HJ-NPR-Z0-9]{17})/i);
      const vin = vinMatch ? vinMatch[1] : null;

      const images = [];
      document.querySelectorAll('img').forEach((img) => {
        const src = img.src || img.dataset.src;
        if (src && (src.includes('cloudinary') || src.includes('barrett-jackson')) &&
            !src.includes('logo') && !src.includes('icon') && img.width > 200) {
          images.push(src);
        }
      });

      const specs = {};
      const specKeys = ['Engine', 'Transmission', 'Mileage', 'Miles', 'Exterior', 'Interior'];
      specKeys.forEach((key) => {
        const re = new RegExp(key + '[:\\\\s]*([^\\\\n]+)', 'i');
        const match = lotText.match(re);
        if (match) specs[key.toLowerCase()] = match[1].trim();
      });

      const descEl = document.querySelector('[class*="description"]') ||
                     document.querySelector('[class*="highlights"]');
      const description = descEl ? descEl.textContent.trim().slice(0, 2000) : null;

      const priceMatch = lotText.match(/\\$[\\d,]+(?:\\.\\d{2})?/g);
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
    })()`);

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

  const client = await pool.connect();
  try {
    // Check for existing vehicle
    const existing = await client.query(
      'SELECT id FROM vehicles WHERE discovery_url = $1 LIMIT 1',
      [lot.url]
    );

    let vehicleId: string | null = null;

    const metadata = JSON.stringify({
      source: 'bj_queue_extractor',
      engine: lot.specs?.engine || null,
      lot_number: lot.lotNumber || null,
      imported_at: new Date().toISOString(),
    });

    if (existing.rows.length > 0) {
      vehicleId = existing.rows[0].id;
      await client.query(
        `UPDATE vehicles SET title=$1, year=$2, make=$3, model=$4, vin=$5, mileage=$6,
         sale_price=$7, transmission=$8, color=$9, interior_color=$10,
         description=$11, status=$12, origin_metadata=$13, updated_at=NOW()
         WHERE id=$14`,
        [lot.title?.slice(0, 200), lot.year, make, model, lot.vin, mileage,
         price, lot.specs?.transmission, lot.specs?.exterior,
         lot.specs?.interior, lot.description, price ? 'sold' : 'active', metadata, vehicleId]
      );
    } else {
      const insertResult = await client.query(
        `INSERT INTO vehicles (title, year, make, model, vin, mileage, sale_price,
         transmission, color, interior_color, description,
         discovery_source, discovery_url, status, is_public, origin_metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [lot.title?.slice(0, 200), lot.year, make, model, lot.vin, mileage, price,
         lot.specs?.transmission, lot.specs?.exterior, lot.specs?.interior,
         lot.description, 'barrett-jackson', lot.url, price ? 'sold' : 'active', true, metadata]
      );
      vehicleId = insertResult.rows[0].id;
    }

    // Save images
    if (lot.images?.length > 0 && vehicleId) {
      const values: any[] = [];
      const placeholders: string[] = [];
      lot.images.forEach((imgUrl: string, i: number) => {
        const offset = i * 4;
        placeholders.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4})`);
        values.push(vehicleId, imgUrl, i, 'barrett_jackson_import');
      });
      await client.query(
        `INSERT INTO vehicle_images (vehicle_id, image_url, position, source)
         VALUES ${placeholders.join(',')}
         ON CONFLICT DO NOTHING`,
        values
      );
    }

    // Mark queue item complete
    await client.query(
      `UPDATE import_queue SET status='complete', vehicle_id=$1, processed_at=NOW()
       WHERE id=$2`,
      [vehicleId, queueItemId]
    );

    return vehicleId;
  } finally {
    client.release();
  }
}

async function claimBatch(workerId: string): Promise<any[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      WITH candidates AS (
        SELECT id FROM import_queue
        WHERE status = 'pending'
          AND COALESCE(attempts, 0) < 10
          AND source_id = '23b5bd94-bbe3-441e-8688-3ab1aec30680'
          AND listing_url LIKE '%barrett-jackson%'
        ORDER BY COALESCE(priority, 0) DESC, created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      ),
      claimed AS (
        UPDATE import_queue iq
        SET status = 'processing',
            attempts = COALESCE(iq.attempts, 0) + 1,
            locked_at = NOW(),
            locked_by = $2
        FROM candidates c
        WHERE iq.id = c.id
        RETURNING iq.*
      )
      SELECT * FROM claimed
    `, [BATCH_SIZE, workerId]);

    return result.rows;
  } finally {
    client.release();
  }
}

async function markFailed(queueItemId: string, errorMsg: string) {
  await pool.query(
    `UPDATE import_queue SET status='failed', error_message=$1, locked_at=NULL, locked_by=NULL
     WHERE id=$2`,
    [errorMsg.slice(0, 500), queueItemId]
  );
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

  let emptyBatchCount = 0;
  while (true) {
    let batch: any[];
    try {
      batch = await claimBatch(wid);
    } catch (err: any) {
      log(wid, `Claim error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
      emptyBatchCount++;
      if (emptyBatchCount >= 5) break;
      continue;
    }

    if (batch.length === 0) {
      emptyBatchCount++;
      if (emptyBatchCount >= 3) {
        log(wid, 'No more BJ items in queue after 3 retries');
        break;
      }
      log(wid, `Empty batch (${emptyBatchCount}/3), retrying in 10s...`);
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    emptyBatchCount = 0;
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
        const isBlocked = err.message?.includes('BLOCKED');

        if (isBlocked) {
          // Don't mark as failed — reset to pending and wait longer
          try {
            await pool.query(
              `UPDATE import_queue SET status='pending', locked_at=NULL, locked_by=NULL WHERE id=$1`,
              [item.id]
            );
          } catch {}
          log(wid, `BLOCKED: ${item.listing_url} — waiting 30s before retry`);
          await new Promise(r => setTimeout(r, 30000));
          consecutiveCrashes++;
        } else {
          stats.failed++;
          consecutiveCrashes++;
          try { await markFailed(item.id, err.message); } catch {}
          log(wid, `FAIL: ${item.listing_url} — ${err.message.slice(0, 80)}`);
        }

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
      // Add random jitter to delay to avoid bot detection
      const jitter = Math.random() * DELAY_MS * 0.5;
      await new Promise(r => setTimeout(r, DELAY_MS + jitter));
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

  // Test DB connection
  try {
    const res = await pool.query("SELECT count(*) FROM import_queue WHERE status='pending' AND source_id='23b5bd94-bbe3-441e-8688-3ab1aec30680'");
    console.log(`\nPending BJ URLs: ${res.rows[0].count}\n`);
  } catch (err: any) {
    console.error(`DB connection failed: ${err.message}`);
    process.exit(1);
  }

  console.log('Starting workers...\n');

  const workers = Array.from({ length: NUM_WORKERS }, (_, i) => runWorker(i));
  await Promise.all(workers);

  await pool.end();

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
