#!/usr/bin/env node
/**
 * Storage-Backed Snapshot Extraction
 *
 * Downloads HTML from Supabase Storage, extracts fields via regex,
 * and updates vehicles in batches.
 *
 * This handles snapshots where html_storage_path is set but html is NULL.
 */
import pg from 'pg';
const { Client } = pg;

const BATCH = 50; // Small batches since we're downloading from storage
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function extractFields(html, source) {
  const fields = {};

  // Price from title tag (BaT: "sold for $XX,XXX")
  if (source === 'bat') {
    const priceMatch = html.match(/sold for \$([0-9,]+)/i);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/,/g, ''));
      if (price > 100 && price < 100000000) fields.sale_price = price;
    }
  }

  // Price from Mecum
  if (source === 'mecum') {
    // Try JSON-LD price
    const jsonPrice = html.match(/"price"\s*:\s*"?([0-9,]+\.?\d*)"?/);
    if (jsonPrice) {
      const price = parseInt(jsonPrice[1].replace(/,/g, ''));
      if (price > 100 && price < 100000000) fields.sale_price = price;
    }
    // Try "Sold" text
    if (!fields.sale_price) {
      const soldMatch = html.match(/(?:Sold|SOLD)[^$]*\$([0-9,]+)/);
      if (soldMatch) {
        const price = parseInt(soldMatch[1].replace(/,/g, ''));
        if (price > 100 && price < 100000000) fields.sale_price = price;
      }
    }
  }

  // Price from BJ
  if (source === 'bj') {
    // Try hammer price
    const hammerMatch = html.match(/(?:hammer|sold|sale)\s*(?:price)?\s*[:\s]*\$([0-9,]+)/i);
    if (hammerMatch) {
      const price = parseInt(hammerMatch[1].replace(/,/g, ''));
      if (price > 100 && price < 100000000) fields.sale_price = price;
    }
    // Try JSON data
    if (!fields.sale_price) {
      const jsonPrice = html.match(/"(?:finalPrice|hammerPrice|soldPrice|price)"\s*:\s*"?(\d+)"?/);
      if (jsonPrice) {
        const price = parseInt(jsonPrice[1]);
        if (price > 100 && price < 100000000) fields.sale_price = price;
      }
    }
  }

  // og:image (universal)
  const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
    || html.match(/property="og:image"\s+content="([^"]+)"/i)
    || html.match(/content="([^"]+)"\s+property="og:image"/i);
  if (ogImage) fields.primary_image_url = ogImage[1];

  // Description
  if (source === 'bat') {
    // BaT: JSON-LD description
    const descMatch = html.match(/"description"\s*:\s*"([^"]{20,4000})"/);
    if (descMatch) fields.description = descMatch[1].substring(0, 2000);
  }
  // og:description (universal fallback)
  if (!fields.description) {
    const ogDesc = html.match(/property="og:description"\s+content="([^"]{20,4000})"/i)
      || html.match(/content="([^"]{20,4000})"\s+property="og:description"/i)
      || html.match(/name="description"\s+content="([^"]{20,4000})"/i);
    if (ogDesc) fields.description = ogDesc[1].substring(0, 2000);
  }

  // Transmission (from body text)
  if (html.match(/automatic|auto\s*trans|tiptronic|powerglide|turbo.?hydramatic|hydra.matic/i)) {
    fields.transmission = 'Automatic';
  } else if (html.match(/manual|stick.?shift|[3-6]-speed\s*manual|[3-6]-speed\s*gearbox/i)) {
    fields.transmission = 'Manual';
  }

  // Mileage
  const mileageMatch = html.match(/([0-9][0-9,]+)\s+(?:miles|mi\.?\b)/i);
  if (mileageMatch) {
    const miles = parseInt(mileageMatch[1].replace(/,/g, ''));
    if (miles > 0 && miles < 500000) fields.mileage = miles;
  }

  // VIN (17-char alphanumeric, no I/O/Q)
  const vinMatch = html.match(/(?:VIN|Chassis|Vehicle Identification)[^A-HJ-NPR-Z0-9]*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) fields.vin = vinMatch[1].toUpperCase();

  return fields;
}

async function downloadFromStorage(storagePath) {
  const bucket = 'listing-snapshots';
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${storagePath}`;
  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function getSource(url) {
  if (url.includes('bringatrailer.com')) return 'bat';
  if (url.includes('mecum.com')) return 'mecum';
  if (url.includes('barrett-jackson.com')) return 'bj';
  if (url.includes('carsandbids.com')) return 'cab';
  return 'other';
}

async function run() {
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });
  await client.connect();
  console.log('Connected.\n');

  // Disable triggers
  await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER');
  console.log('Triggers disabled.\n');

  const stats = { processed: 0, updated: 0, errors: 0, fields: {} };
  let batchNum = 0;

  while (true) {
    // Get batch of snapshots joined to vehicles missing fields
    const batch = await client.query(`
      SELECT v.id AS vehicle_id, v.listing_url, lps.html_storage_path,
        v.sale_price, v.primary_image_url, v.description, v.transmission, v.mileage, v.vin
      FROM listing_page_snapshots lps
      JOIN vehicles v ON v.listing_url = lps.listing_url
      WHERE v.deleted_at IS NULL
        AND lps.html_storage_path IS NOT NULL
        AND (
          (v.sale_price IS NULL OR v.sale_price = 0)
          OR (v.primary_image_url IS NULL OR v.primary_image_url = '')
          OR (v.description IS NULL OR v.description = '')
          OR (v.transmission IS NULL OR v.transmission = '')
          OR (v.mileage IS NULL OR v.mileage = 0)
        )
      LIMIT ${BATCH}
    `);

    if (batch.rows.length === 0) {
      console.log('No more snapshots to process.');
      break;
    }

    batchNum++;
    let batchUpdates = 0;

    for (const row of batch.rows) {
      const html = await downloadFromStorage(row.html_storage_path);
      if (!html) { stats.errors++; continue; }

      stats.processed++;
      const source = getSource(row.listing_url);
      const extracted = extractFields(html, source);

      // Build SET clause only for fields that are currently NULL/empty
      const sets = [];
      const vals = [];
      let paramIdx = 1;

      if (extracted.sale_price && (!row.sale_price || row.sale_price === 0)) {
        sets.push(`sale_price = $${paramIdx++}`);
        vals.push(extracted.sale_price);
        stats.fields.sale_price = (stats.fields.sale_price || 0) + 1;
      }
      if (extracted.primary_image_url && (!row.primary_image_url || row.primary_image_url === '')) {
        sets.push(`primary_image_url = $${paramIdx++}`);
        vals.push(extracted.primary_image_url);
        stats.fields.primary_image_url = (stats.fields.primary_image_url || 0) + 1;
      }
      if (extracted.description && (!row.description || row.description === '')) {
        sets.push(`description = $${paramIdx++}`);
        vals.push(extracted.description);
        stats.fields.description = (stats.fields.description || 0) + 1;
      }
      if (extracted.transmission && (!row.transmission || row.transmission === '')) {
        sets.push(`transmission = $${paramIdx++}`);
        vals.push(extracted.transmission);
        stats.fields.transmission = (stats.fields.transmission || 0) + 1;
      }
      if (extracted.mileage && (!row.mileage || row.mileage === 0)) {
        sets.push(`mileage = $${paramIdx++}`);
        vals.push(extracted.mileage);
        stats.fields.mileage = (stats.fields.mileage || 0) + 1;
      }

      if (sets.length > 0) {
        vals.push(row.vehicle_id);
        await client.query(
          `UPDATE vehicles SET ${sets.join(', ')} WHERE id = $${paramIdx}`,
          vals
        );
        batchUpdates++;
        stats.updated++;
      }
    }

    console.log(`Batch ${batchNum}: processed ${batch.rows.length}, updated ${batchUpdates} (total: ${stats.updated}/${stats.processed})`);

    // Lock check every 5 batches
    if (batchNum % 5 === 0) {
      const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
      if (locks.rows[0].c > 2) {
        console.log(`  ⚠️  ${locks.rows[0].c} locks — pausing 5s`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Re-enable triggers
  await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER');
  console.log('\nTriggers re-enabled.');

  // Summary
  console.log('\n━━━ STORAGE EXTRACTION RESULTS ━━━');
  console.log(`Processed: ${stats.processed}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('Field updates:');
  for (const [k, v] of Object.entries(stats.fields)) {
    console.log(`  ${k}: ${v}`);
  }

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
