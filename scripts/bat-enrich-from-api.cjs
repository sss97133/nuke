#!/usr/bin/env node
/**
 * bat-enrich-from-api.cjs
 *
 * Enriches existing BaT vehicles with data from BaT's REST API.
 *
 * The API returns: url, title, current_bid (price), lat, lon, country_code,
 * timestamp_end (sale_date), noreserve, comments count.
 *
 * This script does NOT create new vehicles. It only updates existing ones
 * that are missing fields the API can provide.
 *
 * Usage: dotenvx run -- node scripts/bat-enrich-from-api.cjs
 */

const pg = require('pg');

const client = new pg.Client({
  connectionString: 'postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
  statement_timeout: 55000,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const API_BASE = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';

function parseTitle(title) {
  if (!title) return { year: null, make: null, model: null };
  let clean = title
    .replace(/^\d+k?-mile\s+/i, '')
    .replace(/^no[- ]reserve:?\s*/i, '')
    .replace(/^modified\s+/i, '')
    .replace(/^euro[- ]?spec\s+/i, '')
    .replace(/^original[- ]owner\s+/i, '')
    .replace(/^single[- ]owner\s+/i, '')
    .replace(/^one[- ]owner\s+/i, '')
    .trim();

  const yearMatch = clean.match(/\b(19\d{2}|20[0-2]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  if (!year) return { year: null, make: null, model: null };

  const afterYear = clean.substring(clean.indexOf(String(year)) + 4).trim();
  const parts = afterYear.split(/\s+/);
  if (parts.length === 0) return { year, make: null, model: null };

  const multiMakes = {
    'alfa romeo': 2, 'aston martin': 2, 'austin healey': 2, 'austin-healey': 1,
    'de tomaso': 2, 'land rover': 2, 'mercedes benz': 2, 'mercedes-benz': 1,
    'rolls royce': 2, 'rolls-royce': 1,
  };

  let make, modelStart;
  const twoWord = parts.slice(0, 2).join(' ').toLowerCase();
  if (multiMakes[twoWord]) {
    make = parts.slice(0, 2).join(' ');
    modelStart = 2;
  } else {
    make = parts[0];
    modelStart = 1;
  }

  const model = parts.slice(modelStart).join(' ') || null;
  return { year, make: make || null, model: model || null };
}

async function run() {
  await client.connect();

  // Load vehicles that need enrichment
  console.log('Loading BaT vehicles needing enrichment...');
  const needsEnrich = new Map();
  let lastUrl = '';
  while (true) {
    const r = await client.query(`
      SELECT id, listing_url, year, make, model, sale_price, gps_latitude, sale_date, title
      FROM vehicles
      WHERE auction_source = 'bat' AND deleted_at IS NULL
        AND listing_url IS NOT NULL AND listing_url != ''
        AND listing_url > $1
        AND (
          year IS NULL OR make IS NULL OR make = '' OR
          (sale_price IS NULL OR sale_price = 0) OR
          gps_latitude IS NULL OR
          sale_date IS NULL
        )
      ORDER BY listing_url LIMIT 5000
    `, [lastUrl]);
    if (r.rows.length === 0) break;
    for (const row of r.rows) {
      needsEnrich.set(row.listing_url.replace(/\/$/, ''), row);
    }
    lastUrl = r.rows[r.rows.length - 1].listing_url;
  }
  console.log(`  Vehicles needing enrichment: ${needsEnrich.size.toLocaleString()}`);

  if (needsEnrich.size === 0) {
    console.log('Nothing to enrich!');
    await client.end();
    return;
  }

  // Crawl API and match against vehicles needing enrichment
  console.log('\nCrawling BaT API...');
  let page = 1;
  let emptyPages = 0;
  let matched = 0, updated = 0, skipped = 0;
  let totalPages = null;
  let baseDelay = 2000;
  const startTime = Date.now();

  while (emptyPages < 10) {
    try {
      const res = await fetch(`${API_BASE}?page=${page}&get_items=true`, {
        headers: { 'User-Agent': UA },
      });

      if (res.status === 429) {
        baseDelay = Math.min(baseDelay + 500, 5000);
        const backoff = Math.min(5000 * Math.pow(2, emptyPages), 60000);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        emptyPages++;
        page++;
        await sleep(baseDelay * 2);
        continue;
      }

      const data = await res.json();
      if (!totalPages) totalPages = data.pages_total;
      const items = data.items || [];

      if (items.length === 0) {
        emptyPages++;
        page++;
        continue;
      }
      emptyPages = 0;

      // Match items against vehicles needing enrichment
      for (const item of items) {
        const url = item.url?.replace(/\/$/, '');
        if (!url) continue;

        const vehicle = needsEnrich.get(url);
        if (!vehicle) continue;

        matched++;

        // Build update
        const sets = [];
        const vals = [vehicle.id];
        let paramIdx = 2;

        // Fill missing year from title parse
        if (!vehicle.year && item.title) {
          const parsed = parseTitle(item.title);
          if (parsed.year) {
            sets.push(`year = $${paramIdx}`); vals.push(parsed.year); paramIdx++;
          }
          if ((!vehicle.make || vehicle.make === '') && parsed.make) {
            sets.push(`make = $${paramIdx}`); vals.push(parsed.make); paramIdx++;
          }
          if (!vehicle.model && parsed.model) {
            sets.push(`model = $${paramIdx}`); vals.push(parsed.model); paramIdx++;
          }
        }

        // Fill missing price
        if ((!vehicle.sale_price || vehicle.sale_price === 0) && item.current_bid > 0) {
          sets.push(`sale_price = $${paramIdx}`); vals.push(item.current_bid); paramIdx++;
        }

        // Fill missing GPS
        if (!vehicle.gps_latitude && item.lat && item.lon) {
          sets.push(`gps_latitude = $${paramIdx}`); vals.push(item.lat); paramIdx++;
          sets.push(`gps_longitude = $${paramIdx}`); vals.push(item.lon); paramIdx++;
        }

        // Fill missing sale_date
        if (!vehicle.sale_date && item.timestamp_end) {
          const sd = new Date(item.timestamp_end * 1000).toISOString();
          sets.push(`sale_date = $${paramIdx}`); vals.push(sd); paramIdx++;
        }

        // Fill missing title
        if (!vehicle.title && item.title) {
          sets.push(`title = $${paramIdx}`); vals.push(item.title); paramIdx++;
          sets.push(`listing_title = $${paramIdx}`); vals.push(item.title); paramIdx++;
        }

        // Fill reserve status
        if (item.noreserve) {
          sets.push(`reserve_status = $${paramIdx}`); vals.push('no_reserve'); paramIdx++;
        }

        if (sets.length > 0) {
          await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $1`, vals);
          updated++;
          // Remove from map so we can exit early when all are enriched
          needsEnrich.delete(url);
        } else {
          skipped++;
        }
      }

      if (page % 50 === 0) {
        const elapsed = (Date.now() - startTime) / 1000 / 60;
        const rate = page / elapsed;
        const remaining = totalPages ? (totalPages - page) / rate : 0;
        console.log(`  Page ${page}/${totalPages || '?'}: ${matched} matched, ${updated} updated — ${rate.toFixed(1)} p/min — ETA ${remaining.toFixed(0)} min — remaining: ${needsEnrich.size}`);
      }

      // Exit early if we've enriched everything
      if (needsEnrich.size === 0) {
        console.log(`  All vehicles enriched at page ${page}!`);
        break;
      }

      page++;
      await sleep(baseDelay);
    } catch (e) {
      console.log(`  Page ${page} error: ${e.message}`);
      emptyPages++;
      page++;
      await sleep(baseDelay * 2);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Pages crawled: ${page}`);
  console.log(`Matched: ${matched}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (no new data): ${skipped}`);
  console.log(`Remaining un-enriched: ${needsEnrich.size}`);

  // Final stats
  const stats = await client.query(`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN sale_price > 0 THEN 1 END)::int as with_price,
      COUNT(CASE WHEN year IS NOT NULL THEN 1 END)::int as with_year,
      COUNT(CASE WHEN gps_latitude IS NOT NULL THEN 1 END)::int as with_gps,
      COUNT(CASE WHEN sale_date IS NOT NULL THEN 1 END)::int as with_sale_date
    FROM vehicles WHERE auction_source = 'bat' AND deleted_at IS NULL
  `);
  const s = stats.rows[0];
  console.log(`\nBaT vehicles: ${s.total}`);
  console.log(`  price: ${s.with_price} (${(s.with_price/s.total*100).toFixed(1)}%)`);
  console.log(`  year: ${s.with_year} (${(s.with_year/s.total*100).toFixed(1)}%)`);
  console.log(`  GPS: ${s.with_gps} (${(s.with_gps/s.total*100).toFixed(1)}%)`);
  console.log(`  sale_date: ${s.with_sale_date} (${(s.with_sale_date/s.total*100).toFixed(1)}%)`);

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
