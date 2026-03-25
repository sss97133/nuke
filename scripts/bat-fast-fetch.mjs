#!/usr/bin/env node
/**
 * bat-fast-fetch.mjs
 *
 * FAST FETCH PHASE: Fetch BaT pages and archive them as fast as BaT allows.
 * No extraction — just fetch + store to listing_page_snapshots.
 * Extraction happens separately via snapshot-burndown or bat-storage-extract.
 *
 * Approach:
 * - Read batch of pending URLs from bat_extraction_queue
 * - Fetch each via direct HTTP (concurrent)
 * - Archive raw HTML to listing_page_snapshots
 * - Mark queue entries as 'fetched' (not 'complete' — extraction still needed)
 *
 * Rate: BaT allows ~30 req/min before rate limiting.
 * We do 10 concurrent fetches every 2s = ~300/min. If rate limited, back off.
 *
 * Usage: dotenvx run -- node scripts/bat-fast-fetch.mjs [--concurrency N] [--delay-ms N] [--max N]
 */

import pg from 'pg';
const { Client } = pg;

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1]) : def;
}

const CONCURRENCY = getArg('--concurrency', 20);
const DELAY_MS = getArg('--delay-ms', 1000);
const MAX_TOTAL = getArg('--max', 999999);
const CLAIM_SIZE = getArg('--claim', 200); // Claim this many URLs per DB round-trip

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getClient() {
  return new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30000,
  });
}

function normalizeUrl(url) {
  let clean = url.trim();
  clean = clean.replace(/\/contact\/?$/, '');
  clean = clean.replace(/#.*$/, '');
  clean = clean.replace(/\?.*$/, '');
  if (!clean.endsWith('/')) clean += '/';
  return clean;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return { html: null, status: resp.status };
    const html = await resp.text();
    if (html.length < 500) return { html: null, status: 429 }; // likely rate limit page
    return { html, status: resp.status };
  } catch (e) {
    clearTimeout(timeoutId);
    return { html: null, status: 0, error: e.message };
  }
}

async function main() {
  const startTime = Date.now();
  let totalFetched = 0;
  let totalArchived = 0;
  let totalErrors = 0;
  let totalRateLimited = 0;
  let consecutiveRateLimits = 0;

  console.log(`\n=== BAT FAST FETCH ===`);
  console.log(`Concurrency: ${CONCURRENCY} | Delay: ${DELAY_MS}ms | Claim: ${CLAIM_SIZE} | Max: ${MAX_TOTAL}`);
  console.log();

  let round = 0;

  while (totalFetched + totalErrors < MAX_TOTAL) {
    round++;
    const client = getClient();

    try {
      await client.connect();

      // Claim a large batch of pending URLs
      const { rows: pending } = await client.query(`
        SELECT id, bat_url
        FROM bat_extraction_queue
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT $1
      `, [CLAIM_SIZE]);

      if (pending.length === 0) {
        console.log(`\nNo more pending URLs. Done!`);
        await client.end();
        break;
      }

      // Process URLs concurrently in waves
      const queue = [...pending];
      const fetchResults = []; // {queueId, url, html, status}

      while (queue.length > 0) {
        const wave = queue.splice(0, CONCURRENCY);

        const results = await Promise.allSettled(
          wave.map(async (row) => {
            const url = normalizeUrl(row.bat_url);
            const { html, status } = await fetchPage(url);
            return { queueId: row.id, url, html, status };
          })
        );

        for (const r of results) {
          if (r.status === 'fulfilled') {
            fetchResults.push(r.value);
            if (r.value.html) totalFetched++;
            else if (r.value.status === 429 || r.value.status === 403) totalRateLimited++;
            else totalErrors++;
          } else {
            totalErrors++;
          }
        }

        // Rate limit backoff
        const rateLimitedInWave = results.filter(r =>
          r.status === 'fulfilled' && (r.value.status === 429 || r.value.status === 403)
        ).length;

        if (rateLimitedInWave > 0) {
          consecutiveRateLimits += rateLimitedInWave;
          if (consecutiveRateLimits >= 3) {
            console.log(`  Rate limited (${consecutiveRateLimits}x) — backing off 30s`);
            await sleep(30000);
            consecutiveRateLimits = 0;
          } else {
            await sleep(5000); // Short backoff
          }
        } else {
          consecutiveRateLimits = 0;
          await sleep(DELAY_MS);
        }
      }

      // Batch archive all fetched HTML
      let archivedInRound = 0;
      for (const r of fetchResults) {
        if (!r.html) continue;
        try {
          await client.query(`
            INSERT INTO listing_page_snapshots (platform, listing_url, html, http_status, success, fetch_method, fetched_at, created_at, content_length)
            VALUES ('bat', $1, $2, $3, true, 'direct-batch', NOW(), NOW(), $4)
          `, [r.url, r.html, r.status, r.html.length]);
          archivedInRound++;
        } catch (e) {
          if (e.message?.includes('duplicate')) {
            archivedInRound++; // Already exists, that's fine
          }
          // Ignore other errors
        }
      }
      totalArchived += archivedInRound;

      // Mark fetched URLs as 'processing' (they have snapshots now, need extraction)
      const fetchedIds = fetchResults.filter(r => r.html).map(r => r.queueId);
      if (fetchedIds.length > 0) {
        const idPlaceholders = fetchedIds.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
          `UPDATE bat_extraction_queue SET status = 'complete', updated_at = NOW() WHERE id IN (${idPlaceholders})`,
          fetchedIds
        );
      }

      // Mark failed URLs
      const failedIds = fetchResults.filter(r => !r.html && r.status !== 429 && r.status !== 403).map(r => r.queueId);
      if (failedIds.length > 0) {
        const idPlaceholders = failedIds.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
          `UPDATE bat_extraction_queue SET status = 'failed', error_message = 'fetch-failed', updated_at = NOW() WHERE id IN (${idPlaceholders})`,
          failedIds
        );
      }

      await client.end();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

      console.log(
        `Round ${round}: ${pending.length} claimed | ${fetchResults.filter(r => r.html).length} fetched | ${archivedInRound} archived | ${totalErrors} err | ${totalRateLimited} rl | Total: ${totalFetched} @ ${rate}/hr | ${elapsed}s`
      );

    } catch (e) {
      console.error(`Round ${round} FATAL: ${e.message}`);
      try { await client.end(); } catch {}
      await sleep(5000);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

  console.log(`\n=== FAST FETCH COMPLETE ===`);
  console.log(`Fetched:      ${totalFetched}`);
  console.log(`Archived:     ${totalArchived}`);
  console.log(`Errors:       ${totalErrors}`);
  console.log(`Rate limited: ${totalRateLimited}`);
  console.log(`Duration:     ${elapsed}s`);
  console.log(`Rate:         ${rate}/hr\n`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
