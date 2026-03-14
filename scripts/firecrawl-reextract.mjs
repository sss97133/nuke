#!/usr/bin/env node
/**
 * Firecrawl Re-extraction for SPA sites (Mecum, Barrett-Jackson, Bonhams)
 *
 * Uses Firecrawl to render JavaScript and get the real page content,
 * then extracts vehicle fields from the rendered markdown/HTML.
 *
 * Usage: dotenvx run -- node scripts/firecrawl-reextract.mjs [--source mecum|bj|bonhams] [--limit 100]
 */
import pg from 'pg';
const { Client } = pg;

const args = process.argv.slice(2);
const source = args.find(a => a.startsWith('--source='))?.split('=')[1] || 'mecum';
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '200');
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SOURCE_URLS = {
  mecum: '%mecum.com%',
  bj: '%barrett-jackson.com%',
  bonhams: '%bonhams.com%',
  rmsothebys: '%rmsothebys.com%',
};

async function scrapeWithFirecrawl(url) {
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'html'],
        waitFor: 3000,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { error: `${res.status}: ${err.substring(0, 100)}` };
    }
    const data = await res.json();
    return data.data || data;
  } catch (err) {
    return { error: err.message };
  }
}

function extractFromContent(markdown, html, source) {
  const fields = {};
  const text = markdown || '';

  // === Barrett-Jackson specific extraction ===
  if (source === 'bj') {
    return extractBjFields(text, html);
  }

  // Price patterns (generic)
  const pricePatterns = [
    /(?:sold|hammer|sale)\s*(?:price)?\s*[:\s]*\$([0-9,]+)/i,
    /\$([0-9,]+)\s*(?:sold|hammer|final)/i,
    /(?:winning bid|high bid|sold for)\s*[:\s]*\$([0-9,]+)/i,
  ];
  for (const pat of pricePatterns) {
    const match = text.match(pat) || html?.match(pat);
    if (match) {
      const price = parseInt(match[1].replace(/,/g, ''));
      if (price > 100 && price < 100000000) { fields.sale_price = price; break; }
    }
  }

  // Image from HTML og:image or markdown image
  if (html) {
    const imgMatch = html.match(/property="og:image"\s+content="([^"]+)"/i)
      || html.match(/content="([^"]+)"\s+property="og:image"/i);
    if (imgMatch) fields.primary_image_url = imgMatch[1];
  }
  if (!fields.primary_image_url) {
    const mdImages = text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g);
    for (const m of mdImages) {
      const alt = m[1], url = m[2];
      if (url.includes('cookieyes') || url.includes('favicon') || url.includes('logo')
          || url.includes('revisit') || url.includes('close.svg')
          || alt.match(/^(sold|bid|Revisit|Opt|Menu|video)/i)) continue;
      if (url.match(/\.(jpg|jpeg|png|webp)/i) && url.includes('http')) {
        fields.primary_image_url = url.split('?')[0];
        break;
      }
    }
  }

  // Description
  const lines = text.split('\n').filter(l => l.trim().length > 30);
  if (lines.length > 0) {
    const descLines = lines.filter(l =>
      !l.startsWith('#') && !l.startsWith('[') && !l.startsWith('|')
      && !l.match(/^(Home|Menu|Search|Login|Sign|Filter|Sort|View)/i)
      && l.length > 50
    );
    if (descLines.length > 0) {
      fields.description = descLines.slice(0, 3).join(' ').substring(0, 2000);
    }
  }

  // Transmission
  if (text.match(/automatic|auto\s*trans|tiptronic|powerglide/i)) {
    fields.transmission = 'Automatic';
  } else if (text.match(/manual|stick.?shift|[3-6]-speed\s*manual/i)) {
    fields.transmission = 'Manual';
  }

  // Mileage
  const mileMatch = text.match(/([0-9][0-9,]+)\s*(?:actual\s+)?miles/i);
  if (mileMatch) {
    const miles = parseInt(mileMatch[1].replace(/,/g, ''));
    if (miles > 0 && miles < 500000) fields.mileage = miles;
  }

  // VIN
  const vinMatch = text.match(/(?:VIN|Chassis|Serial)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) fields.vin = vinMatch[1].toUpperCase();

  return fields;
}

function extractBjFields(text, html) {
  const fields = {};

  // BJ format: "ValueLabel" on separate lines in ## Details section
  // e.g. "N/ATransmission", "REDExterior Color", "HBJ8L37779Vin"

  // Transmission: look for "XXXTransmission" pattern
  const transMatch = text.match(/(.+?)Transmission/);
  if (transMatch) {
    const val = transMatch[1].trim();
    if (val && val !== 'N/A' && val !== '0') {
      if (val.match(/automatic|auto|tiptronic/i)) fields.transmission = 'Automatic';
      else if (val.match(/manual|stick|speed/i)) fields.transmission = 'Manual';
      else fields.transmission = val;
    }
  }
  // Fallback: check description text
  if (!fields.transmission) {
    if (text.match(/automatic|auto\s*trans|tiptronic|powerglide/i)) {
      fields.transmission = 'Automatic';
    } else if (text.match(/manual|stick.?shift|[3-6]-speed\s*manual/i)) {
      fields.transmission = 'Manual';
    }
  }

  // VIN: "XXXVin" pattern in details section
  const vinDetailMatch = text.match(/([A-HJ-NPR-Z0-9]{5,17})Vin/i);
  if (vinDetailMatch) {
    const vin = vinDetailMatch[1].toUpperCase();
    if (vin.length >= 5) fields.vin = vin; // BJ has pre-17-digit VINs
  }
  // Fallback generic VIN
  if (!fields.vin) {
    const vinGeneric = text.match(/(?:VIN|Chassis|Serial)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{5,17})/i);
    if (vinGeneric) fields.vin = vinGeneric[1].toUpperCase();
  }

  // Exterior Color: "XXXExterior Color"
  const colorMatch = text.match(/(.+?)Exterior Color/);
  if (colorMatch) {
    const val = colorMatch[1].trim();
    if (val && val !== 'N/A' && val !== '0') fields.color = val;
  }

  // Interior Color: "XXXInterior Color"
  const intColorMatch = text.match(/(.+?)Interior Color/);
  if (intColorMatch) {
    const val = intColorMatch[1].trim();
    if (val && val !== 'N/A' && val !== '0') fields.interior_color = val;
  }

  // Engine Size: "XXXEngine Size"
  const engineMatch = text.match(/(.+?)Engine Size/);
  if (engineMatch) {
    const val = engineMatch[1].trim();
    if (val && val !== 'N/A' && val !== '0') fields.engine_size = val;
  }

  // Mileage: "XXXMileage" or "XXXOdometer" or from description
  const mileMatch = text.match(/([0-9][0-9,]+)\s*(?:actual\s+)?(?:miles|mi\b|odometer|mileage)/i);
  if (mileMatch) {
    const miles = parseInt(mileMatch[1].replace(/,/g, ''));
    if (miles > 0 && miles < 500000) fields.mileage = miles;
  }

  // Price: "Sold for $XX,XXX" or from status
  const priceMatch = text.match(/\$([0-9,]+(?:\.[0-9]{2})?)/);
  if (priceMatch) {
    const price = parseInt(priceMatch[1].replace(/[,.]/g, ''));
    if (price > 100 && price < 100000000) fields.sale_price = price;
  }

  // Image: skip no-car-image placeholders
  const mdImages = text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g);
  for (const m of mdImages) {
    const url = m[2];
    if (url.includes('no-car-image') || url.includes('cookieyes') || url.includes('favicon') || url.includes('logo')) continue;
    if (url.includes('http') && !url.includes('close.svg')) {
      fields.primary_image_url = url.split('?')[0];
      break;
    }
  }

  // Description: look for text after "### Description"
  const descSection = text.split(/###?\s*Description/i)[1];
  if (descSection) {
    const descLines = descSection.split('\n')
      .filter(l => l.trim().length > 30 && !l.startsWith('#') && !l.startsWith('['))
      .slice(0, 5);
    if (descLines.length > 0) {
      fields.description = descLines.join(' ').substring(0, 2000);
    }
  }

  return fields;
}

async function run() {
  if (!FIRECRAWL_KEY) {
    console.error('FIRECRAWL_API_KEY not set');
    process.exit(1);
  }

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
  console.log(`Connected. Source: ${source}, Limit: ${limit}\n`);

  const urlPattern = SOURCE_URLS[source];
  if (!urlPattern) { console.error('Unknown source:', source); process.exit(1); }

  // Get vehicles missing ANY key field (not just price/image/desc)
  const { rows } = await client.query(`
    SELECT id, listing_url, sale_price, primary_image_url, description, transmission, mileage, vin,
           color, interior_color, engine_size
    FROM vehicles
    WHERE deleted_at IS NULL
      AND listing_url LIKE $1
      AND listing_url IS NOT NULL
      AND (
        (sale_price IS NULL OR sale_price = 0)
        OR (primary_image_url IS NULL OR primary_image_url = '')
        OR (description IS NULL OR description = '')
        OR (transmission IS NULL OR transmission = '')
        OR (mileage IS NULL OR mileage = 0)
        OR (vin IS NULL OR vin = '')
      )
    LIMIT $2
  `, [urlPattern, limit]);

  console.log(`Found ${rows.length} vehicles to process.\n`);

  try { await client.query('ALTER TABLE vehicles DISABLE TRIGGER USER'); } catch {}

  const stats = { processed: 0, updated: 0, errors: 0, fields: {} };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    stats.processed++;

    // Rate limit: 1 request per second to respect Firecrawl limits
    if (i > 0) await new Promise(r => setTimeout(r, 1000));

    const result = await scrapeWithFirecrawl(row.listing_url);
    if (result.error) {
      stats.errors++;
      if (i % 10 === 0) console.log(`  [${i}/${rows.length}] Error: ${result.error}`);
      continue;
    }

    const extracted = extractFromContent(result.markdown, result.html, source);

    const sets = [];
    const vals = [];
    let idx = 1;

    if (extracted.sale_price && (!row.sale_price || row.sale_price === 0)) {
      sets.push(`sale_price = $${idx++}`); vals.push(extracted.sale_price);
      stats.fields.sale_price = (stats.fields.sale_price || 0) + 1;
    }
    if (extracted.primary_image_url && !row.primary_image_url) {
      sets.push(`primary_image_url = $${idx++}`); vals.push(extracted.primary_image_url);
      stats.fields.image = (stats.fields.image || 0) + 1;
    }
    if (extracted.description && !row.description) {
      sets.push(`description = $${idx++}`); vals.push(extracted.description);
      stats.fields.description = (stats.fields.description || 0) + 1;
    }
    if (extracted.transmission && !row.transmission) {
      sets.push(`transmission = $${idx++}`); vals.push(extracted.transmission);
      stats.fields.transmission = (stats.fields.transmission || 0) + 1;
    }
    if (extracted.mileage && (!row.mileage || row.mileage === 0)) {
      sets.push(`mileage = $${idx++}`); vals.push(extracted.mileage);
      stats.fields.mileage = (stats.fields.mileage || 0) + 1;
    }
    if (extracted.vin && !row.vin) {
      sets.push(`vin = $${idx++}`); vals.push(extracted.vin);
      stats.fields.vin = (stats.fields.vin || 0) + 1;
    }
    if (extracted.color && !row.color) {
      sets.push(`color = $${idx++}`); vals.push(extracted.color);
      stats.fields.color = (stats.fields.color || 0) + 1;
    }
    if (extracted.interior_color && !row.interior_color) {
      sets.push(`interior_color = $${idx++}`); vals.push(extracted.interior_color);
      stats.fields.interior_color = (stats.fields.interior_color || 0) + 1;
    }
    if (extracted.engine_size && !row.engine_size) {
      sets.push(`engine_size = $${idx++}`); vals.push(extracted.engine_size);
      stats.fields.engine_size = (stats.fields.engine_size || 0) + 1;
    }

    if (sets.length > 0) {
      vals.push(row.id);
      try {
        await client.query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
        stats.updated++;
      } catch (err) {
        stats.errors++;
        if (err.code === 'EADDRNOTAVAIL' || err.code === '57P01' || err.message?.includes('Connection terminated')) {
          try { await reconnect(); } catch { console.log('  Reconnect failed, continuing...'); }
        }
      }
    }

    if ((i + 1) % 10 === 0) {
      console.log(`  [${i + 1}/${rows.length}] Updated: ${stats.updated}, Errors: ${stats.errors}`);
    }
  }

  try { await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER'); } catch {
    // If connection died, reconnect just to re-enable triggers
    try { await reconnect(); await client.query('ALTER TABLE vehicles ENABLE TRIGGER USER'); } catch {}
  }

  console.log('\n━━━ FIRECRAWL EXTRACTION RESULTS ━━━');
  console.log(`Source: ${source}`);
  console.log(`Processed: ${stats.processed}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Errors: ${stats.errors}`);
  for (const [k, v] of Object.entries(stats.fields)) {
    console.log(`  ${k}: ${v}`);
  }

  await client.end();
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
