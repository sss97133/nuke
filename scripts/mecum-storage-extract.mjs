#!/usr/bin/env node
/**
 * Mecum Storage Extraction
 * Downloads HTML from Supabase Storage and extracts structured vehicle data
 * from __NEXT_DATA__ JSON embedded in the page.
 *
 * Mecum has rich structured data: vinSerial, hammerPrice, color, interior,
 * transmission, odometer, lotSeries (engine), featuredImage, etc.
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

function extractMecumFields(html) {
  const fields = {};

  // Parse __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (!nextDataMatch) return fields;

  let data;
  try { data = JSON.parse(nextDataMatch[1]); } catch { return fields; }

  const post = data?.props?.pageProps?.post;
  if (!post) return fields;

  // VIN
  if (post.vinSerial && post.vinSerial.length >= 5) {
    fields.vin = post.vinSerial.toUpperCase();
  }

  // Price
  if (post.hammerPrice && post.hammerPrice !== '' && post.hammerPrice !== '0') {
    const price = parseInt(String(post.hammerPrice).replace(/[,$]/g, ''));
    if (price > 0 && price < 100000000) fields.sale_price = price;
  }

  // Exterior color
  if (post.color && post.color !== '' && post.color !== 'N/A') {
    fields.color = post.color;
  }

  // Interior color
  if (post.interior && post.interior !== '' && post.interior !== 'N/A') {
    fields.interior_color = post.interior;
  }

  // Transmission
  if (post.transmission && post.transmission !== '' && post.transmission !== 'N/A') {
    const trans = post.transmission.toLowerCase();
    if (trans.includes('auto')) fields.transmission = 'Automatic';
    else if (trans.includes('manual') || trans.includes('speed')) fields.transmission = 'Manual';
    else fields.transmission = post.transmission;
  }

  // Odometer / Mileage
  if (post.odometer && post.odometer !== '' && post.odometer !== '0') {
    const miles = parseInt(String(post.odometer).replace(/[,\s]/g, ''));
    if (miles > 0 && miles < 500000) {
      fields.mileage = miles;
    }
  }

  // Engine (lotSeries often has engine info like "350 CI")
  if (post.lotSeries && post.lotSeries !== '') {
    fields.engine_size = post.lotSeries;
  }

  // Featured image
  const featuredImg = post.featuredImage?.node?.sourceUrl
    || post.featuredImage?.node?.mediaItemUrl;
  if (featuredImg && featuredImg.includes('http')) {
    fields.primary_image_url = featuredImg;
  }

  // Description from blocks or excerpt
  if (post.excerpt && post.excerpt.length > 20) {
    fields.description = post.excerpt.replace(/<[^>]+>/g, '').substring(0, 2000);
  }
  if (!fields.description) {
    // Try to get description from blocks
    const blocks = post.blocks || post.revisions?.nodes?.[0]?.blocks;
    if (blocks && Array.isArray(blocks)) {
      const textBlocks = blocks
        .filter(b => b.originalContent && b.originalContent.length > 30)
        .map(b => b.originalContent.replace(/<[^>]+>/g, '').trim());
      if (textBlocks.length > 0) {
        fields.description = textBlocks.join(' ').substring(0, 2000);
      }
    }
  }

  // Also check description text for transmission/mileage if structured fields are empty
  const descText = fields.description || post.excerpt || '';
  if (!fields.transmission && descText) {
    if (descText.match(/automatic|auto\s*trans|tiptronic|powerglide/i)) {
      fields.transmission = 'Automatic';
    } else if (descText.match(/manual|stick.?shift|[3-6]-speed\s*manual/i)) {
      fields.transmission = 'Manual';
    }
  }
  if (!fields.mileage && descText) {
    const mileMatch = descText.match(/([0-9][0-9,]+)\s*(?:actual\s+)?(?:miles|mi\b)/i);
    if (mileMatch) {
      const miles = parseInt(mileMatch[1].replace(/,/g, ''));
      if (miles > 0 && miles < 500000) fields.mileage = miles;
    }
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
          v.vin, v.color, v.interior_color, v.engine_size
        FROM listing_page_snapshots lps
        JOIN vehicles v ON v.listing_url = lps.listing_url
        WHERE v.deleted_at IS NULL
          AND lps.html_storage_path IS NOT NULL
          AND lps.html_storage_path LIKE 'mecum/%'
          AND (
            (v.transmission IS NULL OR v.transmission = '')
            OR (v.mileage IS NULL OR v.mileage = 0)
            OR (v.vin IS NULL OR v.vin = '')
            OR (v.color IS NULL OR v.color = '')
            OR (v.interior_color IS NULL OR v.interior_color = '')
            OR (v.description IS NULL OR v.description = '')
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
      const extracted = extractMecumFields(html);

      const sets = [];
      const vals = [];
      let i = 1;

      if (extracted.vin && !row.vin) {
        sets.push(`vin = $${i++}`); vals.push(extracted.vin);
        stats.fields.vin = (stats.fields.vin || 0) + 1;
      }
      if (extracted.sale_price && (!row.sale_price || row.sale_price === 0)) {
        sets.push(`sale_price = $${i++}`); vals.push(extracted.sale_price);
        stats.fields.sale_price = (stats.fields.sale_price || 0) + 1;
      }
      if (extracted.transmission && !row.transmission) {
        sets.push(`transmission = $${i++}`); vals.push(extracted.transmission);
        stats.fields.transmission = (stats.fields.transmission || 0) + 1;
      }
      if (extracted.mileage && (!row.mileage || row.mileage === 0)) {
        sets.push(`mileage = $${i++}`); vals.push(extracted.mileage);
        stats.fields.mileage = (stats.fields.mileage || 0) + 1;
      }
      if (extracted.color && !row.color) {
        sets.push(`color = $${i++}`); vals.push(extracted.color);
        stats.fields.color = (stats.fields.color || 0) + 1;
      }
      if (extracted.interior_color && !row.interior_color) {
        sets.push(`interior_color = $${i++}`); vals.push(extracted.interior_color);
        stats.fields.interior_color = (stats.fields.interior_color || 0) + 1;
      }
      if (extracted.engine_size && !row.engine_size) {
        sets.push(`engine_size = $${i++}`); vals.push(extracted.engine_size);
        stats.fields.engine_size = (stats.fields.engine_size || 0) + 1;
      }
      if (extracted.primary_image_url && !row.primary_image_url) {
        sets.push(`primary_image_url = $${i++}`); vals.push(extracted.primary_image_url);
        stats.fields.image = (stats.fields.image || 0) + 1;
      }
      if (extracted.description && !row.description) {
        sets.push(`description = $${i++}`); vals.push(extracted.description);
        stats.fields.description = (stats.fields.description || 0) + 1;
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

  console.log('\n━━━ MECUM STORAGE EXTRACTION RESULTS ━━━');
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
