#!/usr/bin/env node
/**
 * Barrett-Jackson Storage Extraction
 * Downloads HTML from Supabase Storage and extracts vehicle fields.
 * BJ is a Next.js SPA — static HTML has description in RSC payload + title tag.
 * Structured specs (transmission, VIN, color) come from description text parsing.
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

function extractBjFields(html) {
  const fields = {};

  // Title: "1963 CHEVROLET CORVETTE ... - Vehicle | Barrett-Jackson ..."
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
  if (title.includes('Barrett-Jackson') && !title.includes('no longer available')) {
    const cleanTitle = title.split(' - Vehicle')[0].split(' | ')[0].trim()
      .replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
    if (cleanTitle && cleanTitle.length > 5) fields.title = cleanTitle;
  }

  // Combine all RSC payload text for description mining
  let rscText = '';
  const pushes = html.matchAll(/self\.__next_f\.push\(\[1,"([^"]*)"\]\)/g);
  for (const p of pushes) {
    rscText += p[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\u0026/g, '&')
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>');
  }

  // Description: look for long text blocks in RSC payload
  const descBlocks = rscText.match(/[A-Z][a-z].{100,2000}(?:\.|built|included|features)/g) || [];
  if (descBlocks.length > 0) {
    // Pick the longest block as the description
    const desc = descBlocks.sort((a, b) => b.length - a.length)[0];
    if (desc && desc.length > 50) fields.description = desc.substring(0, 2000);
  }

  // Full text for regex matching (description + all text)
  const fullText = rscText;

  // Transmission
  if (fullText.match(/automatic\s+(?:transmission|trans)/i) || fullText.match(/\d-speed\s+automatic/i)) {
    fields.transmission = 'Automatic';
  } else if (fullText.match(/manual\s+(?:transmission|trans)/i) || fullText.match(/\d-speed\s+manual/i) || fullText.match(/stick\s*shift/i)) {
    fields.transmission = 'Manual';
  }

  // Mileage
  const mileMatch = fullText.match(/([0-9][0-9,]+)\s*(?:actual\s+)?(?:miles|mi\b)/i);
  if (mileMatch) {
    const miles = parseInt(mileMatch[1].replace(/,/g, ''));
    if (miles > 0 && miles < 500000) fields.mileage = miles;
  }

  // VIN (17-char modern or shorter pre-1981)
  const vinMatch = fullText.match(/(?:VIN|chassis|serial)[^A-HJ-NPR-Z0-9]{0,30}([A-HJ-NPR-Z0-9]{11,17})/i);
  if (vinMatch) fields.vin = vinMatch[1].toUpperCase();

  // Exterior color from description
  const colorMatch = fullText.match(/(?:exterior|painted|finished)\s+(?:in\s+)?(?:a\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:paint|finish|color|exterior|over)/i);
  if (colorMatch) fields.color = colorMatch[1];

  // Price: "Sold for $XX,XXX" pattern in RSC or title
  const priceMatch = fullText.match(/(?:sold|hammer)\s*(?:price|for)?\s*[:\s]*\$([0-9,]+)/i)
    || fullText.match(/\$([0-9,]+)\s*(?:sold|hammer)/i);
  if (priceMatch) {
    const price = parseInt(priceMatch[1].replace(/,/g, ''));
    if (price > 100 && price < 100000000) fields.sale_price = price;
  }

  // Image: og:image meta tag
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
    || html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1];
  if (ogImage && ogImage.includes('http') && !ogImage.includes('no-car-image')) {
    fields.primary_image_url = ogImage;
  }

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
  client.on('error', () => {});
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
          v.vin, v.color, v.title
        FROM listing_page_snapshots lps
        JOIN vehicles v ON v.listing_url = lps.listing_url
        WHERE v.deleted_at IS NULL
          AND lps.html_storage_path IS NOT NULL
          AND lps.html_storage_path LIKE 'barrett-jackson/%'
          AND (
            (v.description IS NULL OR v.description = '')
            OR (v.transmission IS NULL OR v.transmission = '')
            OR (v.mileage IS NULL OR v.mileage = 0)
            OR (v.vin IS NULL OR v.vin = '')
            OR (v.sale_price IS NULL OR v.sale_price = 0)
            OR (v.primary_image_url IS NULL OR v.primary_image_url = '')
          )
        OFFSET ${offset} LIMIT ${BATCH}
      `);
      rows = result.rows;
    } catch (err) {
      console.log(`  Query error: ${err.message} — reconnecting...`);
      try { await reconnect(); } catch { break; }
      continue;
    }

    if (rows.length === 0) break;
    offset += rows.length;

    let batchUpdates = 0;
    for (const row of rows) {
      const html = await downloadHtml(row.html_storage_path);
      if (!html) { stats.errors++; continue; }

      stats.processed++;
      const extracted = extractBjFields(html);

      const sets = [];
      const vals = [];
      let i = 1;

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
      if (extracted.vin && !row.vin) {
        sets.push(`vin = $${i++}`); vals.push(extracted.vin);
        stats.fields.vin = (stats.fields.vin || 0) + 1;
      }
      if (extracted.color && !row.color) {
        sets.push(`color = $${i++}`); vals.push(extracted.color);
        stats.fields.color = (stats.fields.color || 0) + 1;
      }
      if (extracted.sale_price && (!row.sale_price || row.sale_price === 0)) {
        sets.push(`sale_price = $${i++}`); vals.push(extracted.sale_price);
        stats.fields.sale_price = (stats.fields.sale_price || 0) + 1;
      }
      if (extracted.primary_image_url && !row.primary_image_url) {
        sets.push(`primary_image_url = $${i++}`); vals.push(extracted.primary_image_url);
        stats.fields.image = (stats.fields.image || 0) + 1;
      }

      if (sets.length > 0) {
        vals.push(row.id);
        try {
          await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $${i}`, vals);
          batchUpdates++;
          stats.updated++;
        } catch (err) {
          stats.errors++;
          if (err.message?.includes('Connection terminated') || err.code === '57P01') {
            try { await reconnect(); } catch {}
          }
        }
      } else {
        stats.skipped++;
      }
    }

    const batchNum = Math.ceil(offset / BATCH);
    console.log(`Batch ${batchNum}: ${rows.length} processed, ${batchUpdates} updated (total: ${stats.updated}/${stats.processed})`);

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

  console.log('\n━━━ BJ STORAGE EXTRACTION RESULTS ━━━');
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
