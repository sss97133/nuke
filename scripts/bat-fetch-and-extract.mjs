#!/usr/bin/env node
/**
 * bat-fetch-and-extract.mjs
 *
 * STEP 3: Fetch BaT pages that have NO cached snapshot, archive them,
 * and extract vehicle data immediately.
 *
 * BaT pages are static HTML with JSON-LD structured data.
 * Direct fetch works (no Firecrawl needed).
 * Rate limit: ~30 req/min, so we do batches of 10 with 2s delays.
 *
 * Usage: dotenvx run -- node scripts/bat-fetch-and-extract.mjs [--batch N] [--concurrency N] [--delay-ms N] [--max N]
 */

import pg from 'pg';
const { Client } = pg;

// ─── CLI args ───
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1]) : def;
}

const BATCH_SIZE = getArg('--batch', 10);
const CONCURRENCY = getArg('--concurrency', 10);
const DELAY_MS = getArg('--delay-ms', 2500); // 2.5s between batches (~240/min with concurrency 10)
const MAX_TOTAL = getArg('--max', 999999);
const VERSION = 'bat-fetch-extract:1.0.0';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
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

// ─── BaT HTML Parser ───
// Extracts all fields from BaT listing HTML (title, JSON-LD, meta tags, body patterns)

function extractBatFields(html, url) {
  const fields = {};

  // 1. Title tag — contains "YEAR MAKE MODEL" and "Sold for $XX,XXX" or "Bid to $XX,XXX"
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

  // 2. JSON-LD structured data (most reliable)
  const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of jsonLdMatches) {
    try {
      const ld = JSON.parse(m[1].trim());
      const items = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'Car' || item['@type'] === 'Vehicle') {
          if (item.name && !fields.title) fields.title = item.name;
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
              if (price > 0) {
                fields.sale_price = price;
                fields.auction_outcome = 'sold';
              }
            }
          }
          if (item.vehicleIdentificationNumber) {
            fields.vin = item.vehicleIdentificationNumber.toUpperCase();
          }
          if (item.mileageFromOdometer) {
            const mi = parseInt(String(item.mileageFromOdometer.value || item.mileageFromOdometer).replace(/[^0-9]/g, ''));
            if (mi > 0 && mi < 500000) fields.mileage = mi;
          }
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  // 3. og:image
  if (!fields.primary_image_url) {
    const ogImage = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogImage?.[1] && ogImage[1].startsWith('http') && !ogImage[1].includes('logo')) {
      fields.primary_image_url = ogImage[1].replace(/&amp;/g, '&');
    }
  }

  // 4. og:description
  if (!fields.description) {
    const ogDesc = html.match(/property=["']og:description["'][^>]+content=["']([^"']{40,})["']/i)
      || html.match(/content=["']([^"']{40,})["'][^>]+property=["']og:description["']/i);
    if (ogDesc?.[1]) {
      fields.description = ogDesc[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 2000);
    }
  }

  // 5. "description" field from inline JSON
  if (!fields.description) {
    const descMatch = html.match(/"description"\s*:\s*"([^"]{20,})"/);
    if (descMatch) {
      fields.description = descMatch[1].substring(0, 2000)
        .replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)))
        .replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }

  // 6. Transmission
  if (html.match(/\bautomatic\b|auto\s*trans|tiptronic|powerglide|turbo.?hydramatic/i)) {
    fields.transmission = 'Automatic';
  } else if (html.match(/\bmanual\b|stick.?shift|[3-6]-speed\s*manual|[3-6]-speed\s*gearbox/i)) {
    fields.transmission = 'Manual';
  }

  // 7. Mileage (if not from JSON-LD)
  if (!fields.mileage) {
    const mileMatch = html.match(/~?([0-9][0-9,]+)\s*(?:miles|mi\.?\b)/i);
    if (mileMatch) {
      const miles = parseInt(mileMatch[1].replace(/,/g, ''));
      if (miles > 0 && miles < 500000) fields.mileage = miles;
    }
  }

  // 8. Location
  const locMatch = html.match(/"location"\s*:\s*"([^"]+)"/i);
  if (locMatch) fields.location = locMatch[1];

  // 9. VIN (if not from JSON-LD)
  if (!fields.vin) {
    const vinMatch = html.match(/(?:VIN|Chassis)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i);
    if (vinMatch) fields.vin = vinMatch[1].toUpperCase();
  }

  // 10. Comment count from the page
  const commentMatch = html.match(/"commentCount"\s*:\s*"?(\d+)"?/);
  if (commentMatch) fields.comment_count = parseInt(commentMatch[1]);

  // 11. Auction end date
  const endMatch = html.match(/"endDate"\s*:\s*"([^"]+)"/);
  if (endMatch) fields.auction_end_date = endMatch[1];

  // 12. Extract ALL gallery images
  const images = new Set();
  if (fields.primary_image_url) images.add(fields.primary_image_url);

  // BaT gallery: data-large= attributes or srcset
  const imgRe = /https?:\/\/[^"'\s<>]*bringatrailer\.com\/wp-content\/uploads\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const url = m[0].replace(/&amp;/g, '&');
    if (!url.includes('logo') && !url.includes('favicon') && !url.includes('icon') && !url.includes('avatar')) {
      images.add(url);
    }
  }

  // Also get images from JSON patterns
  const jsonImgRe = /"(?:image|photo|img|src|url)"\s*:\s*"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
  while ((m = jsonImgRe.exec(html)) !== null) {
    const url = m[1].replace(/\\\//g, '/');
    if (!url.includes('logo') && !url.includes('favicon') && url.includes('bringatrailer.com')) {
      images.add(url);
    }
  }

  fields.image_urls = [...images];

  return fields;
}

// ─── Normalize URL ───
function normalizeUrl(url) {
  let clean = url.trim();
  clean = clean.replace(/\/contact\/?$/, '');
  clean = clean.replace(/#.*$/, '');
  clean = clean.replace(/\?.*$/, '');
  if (!clean.endsWith('/')) clean += '/';
  return clean;
}

// ─── Fetch a single BaT page ───
async function fetchBatPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeoutId);

    if (!resp.ok) {
      return { html: null, status: resp.status, error: `HTTP ${resp.status}` };
    }

    const html = await resp.text();

    // Check for login wall / rate limit page
    if (html.length < 1000 && (html.includes('rate limit') || html.includes('captcha'))) {
      return { html: null, status: 429, error: 'Rate limited' };
    }

    return { html, status: resp.status, error: null };
  } catch (e) {
    clearTimeout(timeoutId);
    return { html: null, status: 0, error: e.message };
  }
}

// ─── Archive HTML to listing_page_snapshots ───
// Note: unique index is (platform, listing_url, html_sha256) WHERE html_sha256 IS NOT NULL
// Since we're inserting without html_sha256 (it's computed later), no unique conflict will occur.
// We do a quick existence check to avoid duplicating the same URL.
async function archiveSnapshot(client, url, html, status) {
  try {
    // Check if we already have a snapshot for this URL
    const { rows } = await client.query(
      `SELECT id FROM listing_page_snapshots WHERE platform = 'bat' AND listing_url = $1 LIMIT 1`,
      [url]
    );
    if (rows.length > 0) return; // Already archived

    const contentLength = html ? html.length : 0;
    await client.query(`
      INSERT INTO listing_page_snapshots (platform, listing_url, html, http_status, success, fetch_method, fetched_at, created_at, content_length)
      VALUES ('bat', $1, $2, $3, $4, 'direct', NOW(), NOW(), $5)
    `, [url, html, status, status >= 200 && status < 400, contentLength]);
  } catch (e) {
    // Ignore — snapshot archival is best-effort
    if (!e.message?.includes('duplicate')) {
      console.log(`  Archive error for ${url}: ${e.message.slice(0, 100)}`);
    }
  }
}

// ─── Update vehicle record ───
// Uses conditional SET for each field — only overwrites NULL/empty/zero values.
async function updateVehicle(client, listingUrl, fields) {
  const fieldMap = {
    sale_price: 'sale_price',
    high_bid: 'high_bid',
    auction_outcome: 'auction_outcome',
    description: 'description',
    primary_image_url: 'primary_image_url',
    transmission: 'transmission',
    mileage: 'mileage',
    location: 'location',
    vin: 'vin',
    comment_count: 'comment_count',
  };

  // Build conditional SET clauses — only fill missing fields
  const setClauses = [];
  const vals = [];
  let i = 1;

  for (const [fieldKey, dbCol] of Object.entries(fieldMap)) {
    const val = fields[fieldKey];
    if (val === undefined || val === null || val === '') continue;

    // Use CASE to only update if the existing value is NULL/empty
    if (typeof val === 'number') {
      setClauses.push(`${dbCol} = CASE WHEN ${dbCol} IS NULL OR ${dbCol} = 0 THEN $${i++} ELSE ${dbCol} END`);
    } else {
      setClauses.push(`${dbCol} = CASE WHEN ${dbCol} IS NULL OR ${dbCol} = '' THEN $${i++} ELSE ${dbCol} END`);
    }
    vals.push(val);
  }

  if (setClauses.length === 0) return { updated: false, fieldsCount: 0 };

  // Match on listing_url with or without trailing slash
  const urlNoSlash = listingUrl.replace(/\/$/, '');
  const urlWithSlash = urlNoSlash + '/';
  vals.push(urlNoSlash, urlWithSlash);

  try {
    const result = await client.query(`
      UPDATE vehicles SET ${setClauses.join(', ')}, extractor_version = '${VERSION}', updated_at = NOW()
      WHERE (listing_url = $${i} OR listing_url = $${i + 1})
    `, vals);
    return { updated: result.rowCount > 0, fieldsCount: setClauses.length };
  } catch (e) {
    // VIN uniqueness conflict — retry without VIN
    if (e.message?.includes('unique') && fields.vin) {
      delete fields.vin;
      return updateVehicle(client, listingUrl, fields);
    }
    return { updated: false, fieldsCount: 0, error: e.message };
  }
}

// ─── Insert images ───
async function insertImages(client, listingUrl, imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return 0;

  try {
    // Get vehicle_id from listing_url (with or without trailing slash)
    const urlNoSlash = listingUrl.replace(/\/$/, '');
    const urlWithSlash = urlNoSlash + '/';
    const { rows } = await client.query(
      `SELECT id FROM vehicles WHERE listing_url = $1 OR listing_url = $2 LIMIT 1`,
      [urlNoSlash, urlWithSlash]
    );
    if (rows.length === 0) return 0;

    const vehicleId = rows[0].id;
    let inserted = 0;

    // Check existing images for this vehicle to avoid duplicates
    const { rows: existingRows } = await client.query(
      `SELECT image_url FROM vehicle_images WHERE vehicle_id = $1`,
      [vehicleId]
    );
    const existingUrls = new Set(existingRows.map(r => r.image_url));
    const newImages = imageUrls.filter(u => !existingUrls.has(u));

    if (newImages.length === 0) return 0;

    // Batch insert in groups of 50
    for (let i = 0; i < newImages.length; i += 50) {
      const chunk = newImages.slice(i, i + 50);
      const values = [];
      const placeholders = chunk.map((imgUrl, idx) => {
        values.push(vehicleId, imgUrl, 'bat', true);
        return `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`;
      }).join(',');

      try {
        const result = await client.query(
          `INSERT INTO vehicle_images (vehicle_id, image_url, source, is_external) VALUES ${placeholders}`,
          values
        );
        inserted += result.rowCount;
      } catch (e) {
        // If batch fails, try one by one
        for (const imgUrl of chunk) {
          try {
            await client.query(
              `INSERT INTO vehicle_images (vehicle_id, image_url, source, is_external) VALUES ($1, $2, $3, $4)`,
              [vehicleId, imgUrl, 'bat', true]
            );
            inserted++;
          } catch { /* skip individual failures */ }
        }
      }
    }
    return inserted;
  } catch { return 0; }
}

// ─── Mark queue entry as complete ───
async function markQueueComplete(client, queueId) {
  try {
    await client.query(
      `UPDATE bat_extraction_queue SET status = 'complete', updated_at = NOW() WHERE id = $1`,
      [queueId]
    );
  } catch { /* best effort */ }
}

async function markQueueFailed(client, queueId, error) {
  try {
    await client.query(
      `UPDATE bat_extraction_queue SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [queueId, (error || '').slice(0, 500)]
    );
  } catch { /* best effort */ }
}

// ─── Main loop ───
async function main() {
  const startTime = Date.now();
  let totalFetched = 0;
  let totalUpdated = 0;
  let totalImages = 0;
  let totalErrors = 0;
  let totalRateLimited = 0;
  let totalSkipped = 0;
  let consecutiveRateLimits = 0;

  console.log(`\n=== BAT FETCH & EXTRACT ===`);
  console.log(`Batch: ${BATCH_SIZE} | Concurrency: ${CONCURRENCY} | Delay: ${DELAY_MS}ms | Max: ${MAX_TOTAL}`);
  console.log(`Version: ${VERSION}\n`);

  let batchNum = 0;

  while (totalFetched + totalErrors + totalSkipped < MAX_TOTAL) {
    batchNum++;
    const client = getClient();

    try {
      await client.connect();

      // Get a batch of pending URLs that DON'T have snapshots and DO have vehicle records
      const { rows: pending } = await client.query(`
        SELECT beq.id as queue_id, beq.bat_url, v.id as vehicle_id
        FROM bat_extraction_queue beq
        LEFT JOIN vehicles v ON v.listing_url = beq.bat_url
          OR v.listing_url = beq.bat_url || '/'
          OR v.listing_url = regexp_replace(beq.bat_url, '/$', '')
        LEFT JOIN listing_page_snapshots lps ON lps.listing_url = beq.bat_url AND lps.platform = 'bat'
        WHERE beq.status = 'pending'
          AND lps.id IS NULL
        ORDER BY beq.created_at
        LIMIT $1
      `, [BATCH_SIZE]);

      if (pending.length === 0) {
        console.log(`\nNo more pending URLs without snapshots. Done!`);
        await client.end();
        break;
      }

      // Fetch pages concurrently (respecting concurrency limit)
      let batchFetched = 0;
      let batchUpdated = 0;
      let batchImages = 0;
      let batchErrors = 0;
      let batchRateLimited = 0;

      // Process in sub-batches for concurrency control
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        const subBatch = pending.slice(i, i + CONCURRENCY);

        const results = await Promise.allSettled(
          subBatch.map(async (row) => {
            const url = normalizeUrl(row.bat_url);
            const { html, status, error } = await fetchBatPage(url);

            if (!html) {
              if (status === 429 || status === 403) {
                batchRateLimited++;
                return { url, queueId: row.queue_id, rateLimited: true };
              }
              batchErrors++;
              await markQueueFailed(client, row.queue_id, error || `HTTP ${status}`);
              return { url, queueId: row.queue_id, error: error || `HTTP ${status}` };
            }

            // Archive the HTML
            await archiveSnapshot(client, url, html, status);

            // Extract fields
            const fields = extractBatFields(html, url);

            // Update vehicle if it exists (CASE-based update handles both URL formats)
            let updateResult = { updated: false, fieldsCount: 0 };
            if (row.vehicle_id) {
              updateResult = await updateVehicle(client, url, fields);
            }

            // Insert images
            const imgCount = await insertImages(client, url, fields.image_urls);

            // Mark queue as complete
            await markQueueComplete(client, row.queue_id);

            batchFetched++;
            if (updateResult.updated) batchUpdated++;
            batchImages += imgCount;

            return { url, fields: Object.keys(fields).length, images: imgCount, updated: updateResult.updated };
          })
        );

        // Check for rate limiting
        const rateLimitedResults = results.filter(r =>
          r.status === 'fulfilled' && r.value?.rateLimited
        );

        if (rateLimitedResults.length > 0) {
          consecutiveRateLimits += rateLimitedResults.length;
          if (consecutiveRateLimits >= 5) {
            console.log(`  Rate limited ${consecutiveRateLimits} times — backing off 30s`);
            await sleep(30000);
            consecutiveRateLimits = 0;
          }
        } else {
          consecutiveRateLimits = 0;
        }

        // Delay between sub-batches to respect rate limits
        if (i + CONCURRENCY < pending.length) {
          await sleep(DELAY_MS);
        }
      }

      await client.end();

      totalFetched += batchFetched;
      totalUpdated += batchUpdated;
      totalImages += batchImages;
      totalErrors += batchErrors;
      totalRateLimited += batchRateLimited;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

      console.log(
        `Batch ${batchNum}: ${pending.length} claimed | ${batchFetched} fetched | ${batchUpdated} updated | ${batchImages} imgs | ${batchErrors} err | ${batchRateLimited} rate-limited | Total: ${totalFetched} @ ${rate}/hr | ${elapsed}s`
      );

      // Delay between batches
      await sleep(DELAY_MS);

    } catch (e) {
      console.error(`Batch ${batchNum} FATAL: ${e.message}`);
      try { await client.end(); } catch {}
      await sleep(5000);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

  console.log(`\n=== FETCH & EXTRACT COMPLETE ===`);
  console.log(`Fetched:      ${totalFetched}`);
  console.log(`Updated:      ${totalUpdated}`);
  console.log(`Images:       ${totalImages}`);
  console.log(`Errors:       ${totalErrors}`);
  console.log(`Rate limited: ${totalRateLimited}`);
  console.log(`Duration:     ${elapsed}s`);
  console.log(`Rate:         ${rate}/hr\n`);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
