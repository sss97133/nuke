#!/usr/bin/env node
/**
 * Bring a Trailer Firecrawl Batch Extractor
 *
 * Uses Firecrawl's parallel batch API for fast remote extraction.
 *
 * Usage:
 *   node scripts/bat-firecrawl-batch.js --discover 1 100
 *   node scripts/bat-firecrawl-batch.js --batch urls.txt
 *   node scripts/bat-firecrawl-batch.js --status <batch-id>
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

import fs from 'fs';

const BATCH_SIZE = 50; // Firecrawl batch limit
const POLL_INTERVAL = 5000; // 5 seconds

async function discoverUrls(startPage, endPage) {
  console.log(`[discover] Finding BaT listings, pages ${startPage}-${endPage}...`);

  const urls = new Set();

  for (let page = startPage; page <= endPage; page++) {
    const listUrl = `https://bringatrailer.com/auctions/results/?page=${page}`;
    console.log(`[discover] Page ${page}...`);

    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: listUrl,
          formats: ['links'],
          waitFor: 5000,
        }),
      });

      const data = await response.json();
      if (data.success && data.data?.links) {
        const auctionUrls = data.data.links.filter(link =>
          link.match(/bringatrailer\.com\/listing\/[a-z0-9-]+\/$/)
        );
        auctionUrls.forEach(url => urls.add(url));
        console.log(`[discover] Found ${auctionUrls.length} (total: ${urls.size})`);
      } else {
        console.log(`[discover] No links found on page ${page}`);
      }
    } catch (e) {
      console.error(`[discover] Error on page ${page}: ${e.message}`);
    }

    // Small delay between discovery pages
    await new Promise(r => setTimeout(r, 1000));
  }

  return [...urls];
}

async function submitBatch(urls) {
  console.log(`[batch] Submitting ${urls.length} URLs to Firecrawl...`);

  const response = await fetch('https://api.firecrawl.dev/v1/batch/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      urls: urls,
      formats: ['rawHtml'],
      waitFor: 15000,
      timeout: 60000,
    }),
  });

  const data = await response.json();
  if (!data.success) {
    throw new Error(`Batch submit failed: ${data.error}`);
  }

  console.log(`[batch] Submitted. Batch ID: ${data.id}`);
  return data.id;
}

async function pollBatchStatus(batchId) {
  while (true) {
    const response = await fetch(`https://api.firecrawl.dev/v1/batch/scrape/${batchId}`, {
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
    });

    const data = await response.json();
    console.log(`[batch] Status: ${data.status} (${data.completed}/${data.total})`);

    if (data.status === 'completed') {
      return data;
    }

    if (data.status === 'failed') {
      throw new Error('Batch failed');
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

async function importToSupabase(url, html) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/bat-simple-extract`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, html }),
  });

  return response.json();
}

async function processBatchResults(batchId) {
  console.log(`[process] Fetching batch results...`);

  const response = await fetch(`https://api.firecrawl.dev/v1/batch/scrape/${batchId}`, {
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
    },
  });

  const data = await response.json();

  let success = 0;
  let failed = 0;

  for (const result of data.data || []) {
    const html = result.rawHtml || result.html;
    if (html) {
      const url = result.metadata?.sourceURL || result.url;
      console.log(`[import] ${url}`);

      try {
        const importResult = await importToSupabase(url, html);
        if (importResult.success || importResult.vehicle_id) {
          success++;
          console.log(`  ✓ ${importResult.title || importResult.vehicle_id || 'imported'}`);
        } else {
          failed++;
          console.log(`  ✗ ${importResult.error || 'Unknown error'}`);
        }
      } catch (e) {
        failed++;
        console.log(`  ✗ ${e.message}`);
      }
    }
  }

  console.log(`\n[done] Success: ${success}, Failed: ${failed}`);
  return { success, failed };
}

async function runBatchExtraction(urlsFile) {
  const urls = fs.readFileSync(urlsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .filter(url => url.includes('bringatrailer.com/listing/'));

  console.log(`[batch] Processing ${urls.length} URLs in batches of ${BATCH_SIZE}`);

  let totalSuccess = 0;
  let totalFailed = 0;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    console.log(`\n=== Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(urls.length/BATCH_SIZE)} ===`);

    try {
      const batchId = await submitBatch(batch);
      await pollBatchStatus(batchId);
      const { success, failed } = await processBatchResults(batchId);

      totalSuccess += success;
      totalFailed += failed;
    } catch (e) {
      console.error(`[batch] Error: ${e.message}`);
      totalFailed += batch.length;
    }

    // Brief pause between batches
    if (i + BATCH_SIZE < urls.length) {
      console.log('[batch] Pausing 10s before next batch...');
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total: ${totalSuccess} success, ${totalFailed} failed`);
}

async function main() {
  if (!FIRECRAWL_API_KEY) {
    console.error('Error: FIRECRAWL_API_KEY not set');
    process.exit(1);
  }

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Bring a Trailer Firecrawl Batch Extractor

Usage:
  node scripts/bat-firecrawl-batch.js --discover <start> <end>
  node scripts/bat-firecrawl-batch.js --batch <urls-file>
  node scripts/bat-firecrawl-batch.js --status <batch-id>

Examples:
  --discover 1 100       # Find auctions pages 1-100 (~8000 URLs)
  --batch urls.txt       # Extract URLs from file
  --status abc-123       # Check batch status

Note: BaT has ~5000+ pages with ~80 listings each = 400k+ auctions
`);
    process.exit(1);
  }

  if (args[0] === '--discover') {
    const start = parseInt(args[1]) || 1;
    const end = parseInt(args[2]) || 10;

    const urls = await discoverUrls(start, end);

    const outFile = `/tmp/bat-urls-${start}-${end}.txt`;
    fs.writeFileSync(outFile, urls.join('\n'));

    console.log(`\nDiscovered ${urls.length} URLs`);
    console.log(`Saved to: ${outFile}`);
    console.log(`\nRun extraction with:`);
    console.log(`  dotenvx run -- node scripts/bat-firecrawl-batch.js --batch ${outFile}`);

  } else if (args[0] === '--batch') {
    await runBatchExtraction(args[1]);

  } else if (args[0] === '--status') {
    const data = await pollBatchStatus(args[1]);
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
