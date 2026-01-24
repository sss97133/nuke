#!/usr/bin/env node
/**
 * BaT Wayback Machine Batch Extractor
 *
 * Pulls archived BaT listings from Wayback Machine (not BaT directly)
 * Uses Firecrawl batch API for fast parallel extraction.
 *
 * Usage:
 *   node scripts/bat-wayback-batch-extract.js [batch-size] [concurrent-batches]
 *   node scripts/bat-wayback-batch-extract.js 50 3   # 50 URLs per batch, 3 concurrent
 */

import fs from 'fs';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH_SIZE = parseInt(process.argv[2]) || 50;
const CONCURRENT_BATCHES = parseInt(process.argv[3]) || 3;
const POLL_INTERVAL = 3000;

// Stats
let totalSuccess = 0;
let totalFailed = 0;
let totalProcessed = 0;

async function fetchPendingUrls(limit) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/import_queue?select=id,listing_url&listing_url=ilike.*bringatrailer*&status=eq.pending&limit=${limit}`,
    {
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
      },
    }
  );
  return response.json();
}

function toWaybackUrl(originalUrl) {
  // Use wildcard timestamp to get latest available snapshot
  const cleanUrl = originalUrl.replace(/\/$/, '');
  return `https://web.archive.org/web/2024/${cleanUrl}/`;
}

async function submitBatch(urls) {
  const waybackUrls = urls.map(u => toWaybackUrl(u.listing_url));

  const response = await fetch('https://api.firecrawl.dev/v1/batch/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      urls: waybackUrls,
      formats: ['rawHtml'],
      waitFor: 10000,
      timeout: 60000,
    }),
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`Batch submit failed: ${data.error}`);
  }
  return data.id;
}

async function pollBatchStatus(batchId) {
  while (true) {
    const response = await fetch(`https://api.firecrawl.dev/v1/batch/scrape/${batchId}`, {
      headers: { 'Authorization': `Bearer ${FIRECRAWL_API_KEY}` },
    });

    const data = await response.json();
    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error('Batch failed');

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

async function updateQueueStatus(id, status, vehicleId = null) {
  const body = { status };
  if (vehicleId) body.vehicle_id = vehicleId;

  await fetch(`${SUPABASE_URL}/rest/v1/import_queue?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function processResult(queueItem, html) {
  if (!html || html.length < 1000) {
    await updateQueueStatus(queueItem.id, 'failed');
    return { success: false, error: 'No HTML content' };
  }

  // Strip Wayback Machine wrapper/toolbar from HTML
  let cleanHtml = html;

  // Remove Wayback toolbar
  cleanHtml = cleanHtml.replace(/<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/gi, '');
  cleanHtml = cleanHtml.replace(/<script[^>]*wombat[^>]*>[\s\S]*?<\/script>/gi, '');
  cleanHtml = cleanHtml.replace(/<script[^>]*archive\.org[^>]*>[\s\S]*?<\/script>/gi, '');

  // Fix Wayback URL rewrites back to original
  cleanHtml = cleanHtml.replace(/https?:\/\/web\.archive\.org\/web\/\d+\//g, '');

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/bat-simple-extract`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: queueItem.listing_url,
        html: cleanHtml,
        save_to_db: true
      }),
    });

    const result = await response.json();

    if (result.success || result.vehicle_id) {
      await updateQueueStatus(queueItem.id, 'complete', result.vehicle_id);
      return { success: true, title: result.title || result.vehicle_id };
    } else {
      await updateQueueStatus(queueItem.id, 'failed');
      return { success: false, error: result.error };
    }
  } catch (e) {
    await updateQueueStatus(queueItem.id, 'failed');
    return { success: false, error: e.message };
  }
}

async function processBatch(batchNum, queueItems) {
  console.log(`\n[Batch ${batchNum}] Submitting ${queueItems.length} URLs to Firecrawl...`);

  try {
    const batchId = await submitBatch(queueItems);
    console.log(`[Batch ${batchNum}] ID: ${batchId}`);

    const result = await pollBatchStatus(batchId);
    console.log(`[Batch ${batchNum}] Scraping complete, processing results...`);

    let success = 0, failed = 0;

    for (let i = 0; i < (result.data || []).length; i++) {
      const scraped = result.data[i];
      const queueItem = queueItems[i];
      const html = scraped?.rawHtml || scraped?.html;

      const processResult2 = await processResult(queueItem, html);

      if (processResult2.success) {
        success++;
        console.log(`  ✓ ${processResult2.title?.slice(0, 60) || 'imported'}`);
      } else {
        failed++;
        // Only log first few failures to avoid spam
        if (failed <= 3) console.log(`  ✗ ${processResult2.error?.slice(0, 50) || 'failed'}`);
      }
    }

    console.log(`[Batch ${batchNum}] Done: ${success} success, ${failed} failed`);
    return { success, failed };

  } catch (e) {
    console.error(`[Batch ${batchNum}] Error: ${e.message}`);
    // Mark all as failed
    for (const item of queueItems) {
      await updateQueueStatus(item.id, 'failed');
    }
    return { success: 0, failed: queueItems.length };
  }
}

async function main() {
  if (!FIRECRAWL_API_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing env vars: FIRECRAWL_API_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  console.log(`
╔════════════════════════════════════════════════════╗
║  BaT Wayback Machine Batch Extractor               ║
║  Batch size: ${BATCH_SIZE.toString().padEnd(5)} | Concurrent: ${CONCURRENT_BATCHES.toString().padEnd(5)}         ║
╚════════════════════════════════════════════════════╝
`);

  let batchNum = 0;

  while (true) {
    // Fetch enough URLs for concurrent batches
    const pendingUrls = await fetchPendingUrls(BATCH_SIZE * CONCURRENT_BATCHES);

    if (pendingUrls.length === 0) {
      console.log('\n✓ No more pending URLs!');
      break;
    }

    console.log(`\nFetched ${pendingUrls.length} pending URLs`);

    // Split into batches and run concurrently
    const batches = [];
    for (let i = 0; i < pendingUrls.length; i += BATCH_SIZE) {
      batches.push(pendingUrls.slice(i, i + BATCH_SIZE));
    }

    // Process batches concurrently
    const promises = batches.map((batch, i) => processBatch(++batchNum, batch));
    const results = await Promise.all(promises);

    for (const r of results) {
      totalSuccess += r.success;
      totalFailed += r.failed;
      totalProcessed += r.success + r.failed;
    }

    console.log(`\n━━━ Progress: ${totalProcessed} processed | ${totalSuccess} success | ${totalFailed} failed ━━━`);

    // Brief pause between rounds
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`
╔════════════════════════════════════════════════════╗
║  COMPLETE                                          ║
║  Total processed: ${totalProcessed.toString().padEnd(10)}                      ║
║  Success: ${totalSuccess.toString().padEnd(10)} | Failed: ${totalFailed.toString().padEnd(10)}       ║
╚════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);
