#!/usr/bin/env node
/**
 * bat-extract-direct.mjs
 *
 * FAST EXTRACTION: Fetch BaT pages + extract vehicle data directly.
 * Skips archiving full HTML (600KB per page) to maximize throughput.
 * Archives only metadata (price, outcome, field counts) for tracking.
 *
 * Target: ~10K/hr (limited by BaT rate limits)
 *
 * Usage: dotenvx run -- node scripts/bat-extract-direct.mjs [--concurrency N] [--delay-ms N] [--max N]
 */

import pg from 'pg';
const { Client } = pg;

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1]) : def;
}

const CONCURRENCY = getArg('--concurrency', 15);
const DELAY_MS = getArg('--delay-ms', 500); // 500ms between waves
const MAX_TOTAL = getArg('--max', 999999);
const CLAIM_SIZE = getArg('--claim', 200);
const VERSION = 'bat-extract-direct:1.0.0';
const ARCHIVE_HTML = args.includes('--archive'); // Optional: also archive full HTML

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
  let clean = url.trim().replace(/\/contact\/?$/, '').replace(/#.*$/, '').replace(/\?.*$/, '');
  if (!clean.endsWith('/')) clean += '/';
  return clean;
}

// ─── BaT HTML Parser ───
function extractBatFields(html) {
  const fields = {};

  // Title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Price from title
  const soldMatch = title.match(/sold\s+for\s+\$([0-9,]+)/i);
  if (soldMatch) {
    fields.sale_price = parseInt(soldMatch[1].replace(/,/g, ''));
    fields.auction_outcome = 'sold';
  } else {
    const bidMatch = title.match(/bid\s+to\s+\$([0-9,]+)/i);
    if (bidMatch) {
      fields.high_bid = parseInt(bidMatch[1].replace(/,/g, ''));
      fields.auction_outcome = 'not_sold';
    }
  }

  // JSON-LD
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonLdMatches) {
    try {
      const ld = JSON.parse(m[1].trim());
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (['Product', 'Car', 'Vehicle'].includes(item['@type'])) {
          if (item.description && !fields.description) {
            fields.description = item.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000);
          }
          if (item.image && !fields.primary_image_url) {
            const img = Array.isArray(item.image) ? item.image[0] : item.image;
            if (typeof img === 'string') fields.primary_image_url = img;
            else if (img?.url) fields.primary_image_url = img.url;
          }
          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (offers.price && !fields.sale_price) {
              const price = parseInt(String(offers.price).replace(/[^0-9]/g, ''));
              if (price > 0) { fields.sale_price = price; fields.auction_outcome = 'sold'; }
            }
          }
          if (item.vehicleIdentificationNumber) fields.vin = item.vehicleIdentificationNumber.toUpperCase();
          if (item.mileageFromOdometer) {
            const mi = parseInt(String(item.mileageFromOdometer.value || item.mileageFromOdometer).replace(/[^0-9]/g, ''));
            if (mi > 0 && mi < 500000) fields.mileage = mi;
          }
        }
      }
    } catch { }
  }

  // og:image
  if (!fields.primary_image_url) {
    const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (og?.[1] && og[1].startsWith('http') && !og[1].includes('logo')) {
      fields.primary_image_url = og[1].replace(/&amp;/g, '&');
    }
  }

  // og:description
  if (!fields.description) {
    const og = html.match(/(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{40,})["']/i);
    if (og?.[1]) fields.description = og[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').slice(0, 2000);
  }

  // Inline JSON description
  if (!fields.description) {
    const d = html.match(/"description"\s*:\s*"([^"]{20,})"/);
    if (d) fields.description = d[1].substring(0, 2000).replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16))).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }

  // Transmission
  if (html.match(/\bautomatic\b|auto\s*trans|tiptronic|powerglide|turbo.?hydramatic/i)) fields.transmission = 'Automatic';
  else if (html.match(/\bmanual\b|stick.?shift|[3-6]-speed\s*manual|[3-6]-speed\s*gearbox/i)) fields.transmission = 'Manual';

  // Mileage
  if (!fields.mileage) {
    const mi = html.match(/~?([0-9][0-9,]+)\s*(?:miles|mi\.?\b)/i);
    if (mi) { const v = parseInt(mi[1].replace(/,/g, '')); if (v > 0 && v < 500000) fields.mileage = v; }
  }

  // Location
  const loc = html.match(/"location"\s*:\s*"([^"]+)"/i);
  if (loc) fields.location = loc[1];

  // VIN
  if (!fields.vin) {
    const v = html.match(/(?:VIN|Chassis)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i);
    if (v) fields.vin = v[1].toUpperCase();
  }

  // Comment count
  const cc = html.match(/"commentCount"\s*:\s*"?(\d+)"?/);
  if (cc) fields.comment_count = parseInt(cc[1]);

  // Image URLs for vehicle_images
  const images = new Set();
  if (fields.primary_image_url) images.add(fields.primary_image_url);
  const imgRe = /https?:\/\/[^"'\s<>]*bringatrailer\.com\/wp-content\/uploads\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
  let mm;
  while ((mm = imgRe.exec(html)) !== null) {
    const u = mm[0].replace(/&amp;/g, '&');
    if (!u.includes('logo') && !u.includes('favicon') && !u.includes('icon') && !u.includes('avatar')) images.add(u);
  }
  fields.image_urls = [...images];

  return fields;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal, redirect: 'follow' });
    clearTimeout(timeoutId);
    if (!resp.ok) return { html: null, status: resp.status };
    const html = await resp.text();
    if (html.length < 1000) return { html: null, status: 429 };
    return { html, status: resp.status };
  } catch (e) {
    clearTimeout(timeoutId);
    return { html: null, status: 0, error: e.message };
  }
}

async function main() {
  const startTime = Date.now();
  let totalFetched = 0;
  let totalUpdated = 0;
  let totalImages = 0;
  let totalErrors = 0;
  let totalRateLimited = 0;
  let consecutiveRateLimits = 0;
  let round = 0;

  console.log(`\n=== BAT EXTRACT DIRECT ===`);
  console.log(`Concurrency: ${CONCURRENCY} | Delay: ${DELAY_MS}ms | Claim: ${CLAIM_SIZE} | Max: ${MAX_TOTAL} | Archive: ${ARCHIVE_HTML}`);
  console.log();

  while (totalFetched + totalErrors < MAX_TOTAL) {
    round++;
    const client = getClient();

    try {
      await client.connect();

      // Claim batch
      const { rows: pending } = await client.query(`
        SELECT beq.id as queue_id, beq.bat_url
        FROM bat_extraction_queue beq
        WHERE beq.status = 'pending'
        ORDER BY beq.created_at
        LIMIT $1
      `, [CLAIM_SIZE]);

      if (pending.length === 0) {
        console.log(`\nNo more pending. Done!`);
        await client.end();
        break;
      }

      // Process in concurrent waves
      const queue = [...pending];
      const allResults = []; // {queueId, url, fields, fetched, rateLimited, error}

      while (queue.length > 0 && totalFetched + totalErrors < MAX_TOTAL) {
        const wave = queue.splice(0, CONCURRENCY);

        const results = await Promise.allSettled(
          wave.map(async (row) => {
            const url = normalizeUrl(row.bat_url);
            const { html, status } = await fetchPage(url);

            if (!html) {
              if (status === 429 || status === 403) {
                return { queueId: row.id, url, rateLimited: true };
              }
              return { queueId: row.id, url, error: `HTTP ${status}` };
            }

            const fields = extractBatFields(html);
            return { queueId: row.id, url, fields, htmlLen: html.length, html: ARCHIVE_HTML ? html : null };
          })
        );

        // Collect results
        let waveRateLimited = 0;
        for (const r of results) {
          if (r.status === 'fulfilled') {
            allResults.push(r.value);
            if (r.value.fields) totalFetched++;
            else if (r.value.rateLimited) { totalRateLimited++; waveRateLimited++; }
            else totalErrors++;
          } else {
            totalErrors++;
          }
        }

        if (waveRateLimited > 0) {
          consecutiveRateLimits += waveRateLimited;
          if (consecutiveRateLimits >= 5) {
            console.log(`  Rate limited ${consecutiveRateLimits}x — backing off 30s`);
            await sleep(30000);
            consecutiveRateLimits = 0;
          } else {
            await sleep(3000);
          }
        } else {
          consecutiveRateLimits = 0;
          await sleep(DELAY_MS);
        }
      }

      // ═══ Batch DB updates ═══
      const fetched = allResults.filter(r => r.fields);
      let roundUpdated = 0;
      let roundImages = 0;

      for (const r of fetched) {
        const f = r.fields;
        const urlNoSlash = r.url.replace(/\/$/, '');
        const urlWithSlash = urlNoSlash + '/';

        // Build conditional update
        const setClauses = [];
        const vals = [];
        let i = 1;
        const fieldMap = {
          sale_price: 'number', high_bid: 'number', mileage: 'number', comment_count: 'number',
          auction_outcome: 'text', description: 'text', primary_image_url: 'text',
          transmission: 'text', location: 'text', vin: 'text',
        };

        for (const [key, type] of Object.entries(fieldMap)) {
          const val = f[key];
          if (val === undefined || val === null || val === '') continue;
          if (type === 'number') {
            setClauses.push(`${key} = CASE WHEN ${key} IS NULL OR ${key} = 0 THEN $${i++} ELSE ${key} END`);
          } else {
            setClauses.push(`${key} = CASE WHEN ${key} IS NULL OR ${key} = '' THEN $${i++} ELSE ${key} END`);
          }
          vals.push(val);
        }

        if (setClauses.length > 0) {
          vals.push(urlNoSlash, urlWithSlash);
          try {
            const result = await client.query(`
              UPDATE vehicles SET ${setClauses.join(', ')}, extractor_version = '${VERSION}', updated_at = NOW()
              WHERE (listing_url = $${i} OR listing_url = $${i + 1})
            `, vals);
            if (result.rowCount > 0) roundUpdated++;
          } catch (e) {
            if (e.message?.includes('unique') && f.vin) {
              // Retry without VIN
              delete f.vin;
              const retrySetClauses = [];
              const retryVals = [];
              let ri = 1;
              for (const [key, type] of Object.entries(fieldMap)) {
                const val = f[key];
                if (val === undefined || val === null || val === '' || key === 'vin') continue;
                if (type === 'number') retrySetClauses.push(`${key} = CASE WHEN ${key} IS NULL OR ${key} = 0 THEN $${ri++} ELSE ${key} END`);
                else retrySetClauses.push(`${key} = CASE WHEN ${key} IS NULL OR ${key} = '' THEN $${ri++} ELSE ${key} END`);
                retryVals.push(val);
              }
              if (retrySetClauses.length > 0) {
                retryVals.push(urlNoSlash, urlWithSlash);
                try {
                  await client.query(`UPDATE vehicles SET ${retrySetClauses.join(', ')}, extractor_version = '${VERSION}', updated_at = NOW() WHERE (listing_url = $${ri} OR listing_url = $${ri + 1})`, retryVals);
                  roundUpdated++;
                } catch { }
              }
            }
          }
        }

        // Insert images
        if (f.image_urls && f.image_urls.length > 0) {
          try {
            const { rows: vRows } = await client.query(
              `SELECT id FROM vehicles WHERE listing_url = $1 OR listing_url = $2 LIMIT 1`,
              [urlNoSlash, urlWithSlash]
            );
            if (vRows.length > 0) {
              const vid = vRows[0].id;
              const { rows: existing } = await client.query(
                `SELECT image_url FROM vehicle_images WHERE vehicle_id = $1`, [vid]
              );
              const existingSet = new Set(existing.map(e => e.image_url));
              const newImgs = f.image_urls.filter(u => !existingSet.has(u));

              for (let ci = 0; ci < newImgs.length; ci += 50) {
                const chunk = newImgs.slice(ci, ci + 50);
                const vals = [];
                const phs = chunk.map((u, idx) => {
                  vals.push(vid, u, 'bat', true);
                  return `($${idx*4+1}, $${idx*4+2}, $${idx*4+3}, $${idx*4+4})`;
                }).join(',');
                try {
                  const ir = await client.query(
                    `INSERT INTO vehicle_images (vehicle_id, image_url, source, is_external) VALUES ${phs}`, vals
                  );
                  roundImages += ir.rowCount;
                } catch { }
              }
            }
          } catch { }
        }

        // Archive HTML if requested
        if (ARCHIVE_HTML && r.html) {
          try {
            await client.query(`
              INSERT INTO listing_page_snapshots (platform, listing_url, html, http_status, success, fetch_method, fetched_at, created_at, content_length)
              VALUES ('bat', $1, $2, 200, true, 'direct-batch', NOW(), NOW(), $3)
            `, [r.url, r.html, r.html.length]);
          } catch { }
        }
      }

      totalUpdated += roundUpdated;
      totalImages += roundImages;

      // Mark queue entries
      const completedIds = fetched.map(r => r.queueId);
      if (completedIds.length > 0) {
        for (let ci = 0; ci < completedIds.length; ci += 200) {
          const chunk = completedIds.slice(ci, ci + 200);
          const phs = chunk.map((_, i) => `$${i+1}`).join(',');
          await client.query(`UPDATE bat_extraction_queue SET status = 'complete', updated_at = NOW() WHERE id IN (${phs})`, chunk);
        }
      }

      const failedIds = allResults.filter(r => r.error).map(r => r.queueId);
      if (failedIds.length > 0) {
        const phs = failedIds.map((_, i) => `$${i+1}`).join(',');
        await client.query(`UPDATE bat_extraction_queue SET status = 'failed', error_message = 'fetch-failed', updated_at = NOW() WHERE id IN (${phs})`, failedIds);
      }

      await client.end();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;
      console.log(
        `Round ${round}: ${pending.length} claimed | ${fetched.length} fetched | ${roundUpdated} updated | ${roundImages} imgs | ${totalErrors} err | ${totalRateLimited} rl | Total: ${totalFetched} @ ${rate}/hr | ${elapsed}s`
      );

    } catch (e) {
      console.error(`Round ${round} FATAL: ${e.message}`);
      try { await client.end(); } catch {}
      await sleep(5000);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;
  console.log(`\n=== EXTRACT DIRECT COMPLETE ===`);
  console.log(`Fetched:      ${totalFetched}`);
  console.log(`Updated:      ${totalUpdated}`);
  console.log(`Images:       ${totalImages}`);
  console.log(`Errors:       ${totalErrors}`);
  console.log(`Rate limited: ${totalRateLimited}`);
  console.log(`Duration:     ${elapsed}s`);
  console.log(`Rate:         ${rate}/hr\n`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
