#!/usr/bin/env node
/**
 * Cars & Bids Storage Extraction
 * C&B has structured dt/dd pairs in server-rendered HTML.
 * Fields: Mileage, VIN, Transmission, Body Style, Drivetrain, Title Status, Location, etc.
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

function extractCabFields(html) {
  const fields = {};

  // Parse dt/dd pairs: <dt>Label</dt><dd class="wrappable">Value</dd>
  const dtDdPairs = html.matchAll(/<dt>([^<]+)<\/dt>\s*<dd[^>]*>([^<]+)<\/dd>/gi);
  const specs = {};
  for (const match of dtDdPairs) {
    specs[match[1].trim()] = match[2].trim();
  }

  // VIN
  if (specs['VIN'] && specs['VIN'].length >= 5) {
    fields.vin = specs['VIN'].toUpperCase();
  }

  // Mileage
  if (specs['Mileage']) {
    const miles = parseInt(specs['Mileage'].replace(/[,\s]/g, ''));
    if (miles > 0 && miles < 500000) fields.mileage = miles;
  }

  // Transmission
  if (specs['Transmission']) {
    const trans = specs['Transmission'].toLowerCase();
    if (trans.includes('automatic') || trans.includes('auto') || trans.includes('dct') || trans.includes('cvt') || trans.includes('dsg')) {
      fields.transmission = 'Automatic';
    } else if (trans.includes('manual') || trans.includes('speed')) {
      fields.transmission = 'Manual';
    } else {
      fields.transmission = specs['Transmission'];
    }
  }

  // Body Style
  if (specs['Body Style']) {
    fields.body_style = specs['Body Style'];
  }

  // Exterior color
  if (specs['Exterior Color']) {
    fields.color = specs['Exterior Color'];
  }

  // Interior color
  if (specs['Interior Color']) {
    fields.interior_color = specs['Interior Color'];
  }

  // Location
  if (specs['Location']) {
    fields.location = specs['Location'];
  }

  // Engine
  if (specs['Engine']) {
    fields.engine_size = specs['Engine'];
  }

  // Drivetrain
  if (specs['Drivetrain']) {
    fields.drivetrain = specs['Drivetrain'];
  }

  // Price: look for sold price
  const priceMatch = html.match(/(?:sold|winning bid|hammer)[^$]*\$([0-9,]+)/i)
    || html.match(/class="[^"]*bid-value[^"]*"[^>]*>\$([0-9,]+)/i)
    || html.match(/data-bid="(\d+)"/i);
  if (priceMatch) {
    const price = parseInt(priceMatch[1].replace(/,/g, ''));
    if (price > 100 && price < 100000000) fields.sale_price = price;
  }

  // Image: og:image
  const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1]
    || html.match(/content="([^"]+)"\s+property="og:image"/i)?.[1];
  if (ogImage && ogImage.includes('http')) fields.primary_image_url = ogImage;

  // Description: og:description or meta description
  const ogDesc = html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1]
    || html.match(/name="description"\s+content="([^"]+)"/i)?.[1];
  if (ogDesc && ogDesc.length > 30) {
    fields.description = ogDesc.substring(0, 2000);
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
          v.vin, v.color, v.interior_color, v.engine_size, v.body_style, v.location
        FROM listing_page_snapshots lps
        JOIN vehicles v ON v.listing_url = lps.listing_url
        WHERE v.deleted_at IS NULL
          AND lps.html_storage_path IS NOT NULL
          AND lps.html_storage_path LIKE 'carsandbids/%'
          AND (
            (v.transmission IS NULL OR v.transmission = '')
            OR (v.mileage IS NULL OR v.mileage = 0)
            OR (v.vin IS NULL OR v.vin = '')
            OR (v.description IS NULL OR v.description = '')
            OR (v.color IS NULL OR v.color = '')
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
      const extracted = extractCabFields(html);

      const sets = [];
      const vals = [];
      let i = 1;

      for (const [field, dbCol] of [
        ['vin', 'vin'], ['sale_price', 'sale_price'], ['transmission', 'transmission'],
        ['mileage', 'mileage'], ['color', 'color'], ['interior_color', 'interior_color'],
        ['engine_size', 'engine_size'], ['primary_image_url', 'primary_image_url'],
        ['description', 'description'], ['body_style', 'body_style'], ['location', 'location'],
      ]) {
        if (extracted[field] && (!row[dbCol] || (typeof row[dbCol] === 'number' && row[dbCol] === 0))) {
          sets.push(`${dbCol} = $${i++}`); vals.push(extracted[field]);
          stats.fields[field] = (stats.fields[field] || 0) + 1;
        }
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
      try {
        const locks = await client.query("SELECT count(*)::int AS c FROM pg_stat_activity WHERE wait_event_type='Lock'");
        if (locks.rows[0].c > 2) {
          console.log(`  ⚠️  ${locks.rows[0].c} locks — pausing 5s`);
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch {}
    }
  }

  try { await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER'); } catch {
    try { await reconnect(); await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER'); } catch {}
  }
  console.log('\nTriggers re-enabled.');

  console.log('\n━━━ C&B STORAGE EXTRACTION RESULTS ━━━');
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
