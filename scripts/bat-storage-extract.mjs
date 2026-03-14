#!/usr/bin/env node
/**
 * BaT Storage Extraction
 * Downloads HTML from Supabase Storage and extracts ALL possible fields.
 * Handles both "sold for" and "bid to" (unsold) price patterns.
 */
import pg from 'pg';
const { Client } = pg;

const BATCH = 100;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function downloadHtml(storagePath) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/listing-snapshots/${storagePath}`,
      { headers: { Authorization: `Bearer ${KEY}` } }
    );
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function extractBatFields(html) {
  const fields = {};

  // Title tag analysis
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';

  // Price: "sold for $XX,XXX" or "bid to $XX,XXX"
  const soldMatch = title.match(/sold for \$([0-9,]+)/i);
  if (soldMatch) {
    fields.sale_price = parseInt(soldMatch[1].replace(/,/g, ''));
    fields.auction_outcome = 'sold';
  } else {
    const bidMatch = title.match(/bid to \$([0-9,]+)/i);
    if (bidMatch) {
      fields.high_bid = parseInt(bidMatch[1].replace(/,/g, ''));
      fields.auction_outcome = 'not_sold';
    }
  }

  // Image
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
    || html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1];
  if (ogImage && ogImage.includes('http')) fields.primary_image_url = ogImage;

  // Description from JSON-LD
  const descMatch = html.match(/"description"\s*:\s*"([^"]{20,})"/);
  if (descMatch) fields.description = descMatch[1].substring(0, 2000)
    .replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2), 16)))
    .replace(/\\n/g, '\n').replace(/\\"/g, '"');

  // Transmission from listing body
  if (html.match(/automatic|auto\s*trans|tiptronic|powerglide|turbo.?hydramatic/i)) {
    fields.transmission = 'Automatic';
  } else if (html.match(/manual|stick.?shift|[3-6]-speed\s*manual|[3-6]-speed\s*gearbox/i)) {
    fields.transmission = 'Manual';
  }

  // Mileage
  const mileMatch = html.match(/~?([0-9][0-9,]+)\s*(?:miles|mi\.?\b)/i);
  if (mileMatch) {
    const miles = parseInt(mileMatch[1].replace(/,/g, ''));
    if (miles > 0 && miles < 500000) fields.mileage = miles;
  }

  // Location
  const locMatch = html.match(/"location"\s*:\s*"([^"]+)"/i);
  if (locMatch) fields.location = locMatch[1];

  // VIN
  const vinMatch = html.match(/(?:VIN|Chassis)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) fields.vin = vinMatch[1].toUpperCase();

  return fields;
}

async function run() {
  let client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 30000,
  });
  client.on('error', () => {}); // Prevent unhandled error crash
  await client.connect();

  async function reconnect() {
    try { await client.end(); } catch {}
    client = new Client({
      host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
      user: 'postgres.qkgaybvrernstplzjaam',
      password: process.env.SUPABASE_DB_PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      statement_timeout: 30000,
    });
    client.on('error', () => {});
    await client.connect();
    console.log('  Reconnected to DB.');
  }
  console.log('Connected.\n');

  try { await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER'); } catch {}
  console.log('Triggers disabled.\n');

  const stats = { processed: 0, updated: 0, skipped: 0, errors: 0, fields: {} };
  let offset = 0;

  while (true) {
    let rows;
    try {
      const result = await client.query(`
        SELECT v.id, v.listing_url, lps.html_storage_path,
          v.sale_price, v.primary_image_url, v.description, v.transmission, v.mileage,
          v.vin, v.high_bid, v.auction_outcome, v.location
        FROM listing_page_snapshots lps
        JOIN vehicles v ON v.listing_url = lps.listing_url
        WHERE v.deleted_at IS NULL
          AND lps.html_storage_path IS NOT NULL
          AND lps.html_storage_path LIKE 'bat/%'
          AND (
            (v.primary_image_url IS NULL OR v.primary_image_url = '')
            OR (v.description IS NULL OR v.description = '')
            OR (v.transmission IS NULL OR v.transmission = '')
            OR (v.mileage IS NULL OR v.mileage = 0)
            OR (v.vin IS NULL OR v.vin = '')
            OR (v.sale_price IS NULL OR v.sale_price = 0)
            OR (v.auction_outcome IS NULL OR v.auction_outcome = '')
          )
        OFFSET ${offset} LIMIT ${BATCH}
      `);
      rows = result.rows;
    } catch (err) {
      console.log(`  Query error: ${err.message} — reconnecting...`);
      try { await reconnect(); } catch { console.log('  Reconnect failed, exiting loop.'); break; }
      continue;
    }

    if (rows.length === 0) break;
    offset += rows.length;

    let batchUpdates = 0;
    for (const row of rows) {
      const html = await downloadHtml(row.html_storage_path);
      if (!html) { stats.errors++; continue; }

      stats.processed++;
      const extracted = extractBatFields(html);

      const sets = [];
      const vals = [];
      let i = 1;

      // Only update fields that are currently missing
      if (extracted.primary_image_url && !row.primary_image_url) {
        sets.push(`primary_image_url = $${i++}`); vals.push(extracted.primary_image_url);
        stats.fields.image = (stats.fields.image || 0) + 1;
      }
      if (extracted.description && !row.description) {
        sets.push(`description = $${i++}`); vals.push(extracted.description);
        stats.fields.description = (stats.fields.description || 0) + 1;
      }
      if (extracted.transmission && !row.transmission) {
        sets.push(`transmission = $${i++}`); vals.push(extracted.transmission);
        stats.fields.transmission = (stats.fields.transmission || 0) + 1;
      }
      if (extracted.mileage && (!row.mileage || row.mileage === 0)) {
        sets.push(`mileage = $${i++}`); vals.push(extracted.mileage);
        stats.fields.mileage = (stats.fields.mileage || 0) + 1;
      }
      if (extracted.auction_outcome && !row.auction_outcome) {
        sets.push(`auction_outcome = $${i++}`); vals.push(extracted.auction_outcome);
        stats.fields.auction_outcome = (stats.fields.auction_outcome || 0) + 1;
      }
      if (extracted.high_bid && (!row.high_bid || row.high_bid === 0)) {
        sets.push(`high_bid = $${i++}`); vals.push(extracted.high_bid);
        stats.fields.high_bid = (stats.fields.high_bid || 0) + 1;
      }
      if (extracted.location && !row.location) {
        sets.push(`location = $${i++}`); vals.push(extracted.location);
        stats.fields.location = (stats.fields.location || 0) + 1;
      }
      if (extracted.vin && !row.vin) {
        sets.push(`vin = $${i++}`); vals.push(extracted.vin);
        stats.fields.vin = (stats.fields.vin || 0) + 1;
      }
      if (extracted.sale_price && (!row.sale_price || row.sale_price === 0)) {
        sets.push(`sale_price = $${i++}`); vals.push(extracted.sale_price);
        stats.fields.sale_price = (stats.fields.sale_price || 0) + 1;
      }

      if (sets.length > 0) {
        vals.push(row.id);
        try {
          await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $${i}`, vals);
          batchUpdates++;
          stats.updated++;
        } catch (err) {
          stats.errors++;
          if (err.code === 'EADDRNOTAVAIL' || err.code === '57P01' || err.message?.includes('Connection terminated')) {
            try { await reconnect(); } catch { console.log('  Reconnect failed.'); }
          }
        }
      } else {
        stats.skipped++;
      }
    }

    const batchNum = Math.ceil(offset / BATCH);
    console.log(`Batch ${batchNum}: ${rows.length} processed, ${batchUpdates} updated (total: ${stats.updated}/${stats.processed})`);

    // Lock check
    if (batchNum % 5 === 0) {
      const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
      if (locks.rows[0].c > 2) {
        console.log(`  ⚠️  ${locks.rows[0].c} locks — pausing 5s`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  try { await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER'); } catch {
    try { await reconnect(); await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER'); } catch {}
  }
  console.log('\nTriggers re-enabled.');

  console.log('\n━━━ BAT STORAGE EXTRACTION RESULTS ━━━');
  console.log(`Processed: ${stats.processed}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Skipped: ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);
  for (const [k, v] of Object.entries(stats.fields)) {
    console.log(`  ${k}: ${v}`);
  }

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
