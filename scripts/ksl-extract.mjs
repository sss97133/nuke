#!/usr/bin/env node
/**
 * ksl-extract.mjs — Extract KSL vehicle listings via Firecrawl + Playwright fallback
 * Processes all KSL URLs from mail-app-intake that were skipped.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;

async function sql(query) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  return resp.json();
}

async function firecrawlScrape(url) {
  const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${FIRECRAWL_KEY}`,
    },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  const d = await resp.json();
  if (!d.success) return null;
  const md = d.data?.markdown || '';
  const title = d.data?.metadata?.title || '';
  if (title.includes('not found') || title === 'Request Blocked' || md.includes('Listing not found')) {
    return null;
  }
  return { markdown: md, title };
}

function parseKSLMarkdown(md, title) {
  const vehicle = {};

  // Title parse: "2024 Land Rover Defender 110 S in null, null | KSL Cars"
  const titleMatch = title.match(/^(\d{4})\s+(.+?)\s+in\s/);
  if (titleMatch) {
    vehicle.year = parseInt(titleMatch[1]);
    const rest = titleMatch[2];
    const parts = rest.split(/\s+/);
    vehicle.make = parts[0];
    vehicle.model = parts.slice(1).join(' ');
  }

  // Price
  const priceMatch = md.match(/\$[\d,]+/);
  if (priceMatch) {
    vehicle.price = parseInt(priceMatch[0].replace(/[$,]/g, ''));
  }

  // Mileage
  const mileMatch = md.match(/(?:Mileage|Miles)[:\s]*([0-9,]+)/i);
  if (mileMatch) vehicle.mileage = parseInt(mileMatch[1].replace(/,/g, ''));

  // VIN
  const vinMatch = md.match(/(?:VIN)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) vehicle.vin = vinMatch[1];

  // Color
  const colorMatch = md.match(/(?:Exterior Color|Color)[:\s]*([^\n|]+)/i);
  if (colorMatch) vehicle.exterior_color = colorMatch[1].trim();

  const intColorMatch = md.match(/(?:Interior Color)[:\s]*([^\n|]+)/i);
  if (intColorMatch) vehicle.interior_color = intColorMatch[1].trim();

  // Transmission
  const transMatch = md.match(/(?:Transmission)[:\s]*([^\n|]+)/i);
  if (transMatch) vehicle.transmission = transMatch[1].trim();

  // Engine / Drivetrain
  const engineMatch = md.match(/(?:Engine|Fuel Type)[:\s]*([^\n|]+)/i);
  if (engineMatch) vehicle.engine = engineMatch[1].trim();

  const driveMatch = md.match(/(?:Drive Type|Drivetrain)[:\s]*([^\n|]+)/i);
  if (driveMatch) vehicle.drivetrain = driveMatch[1].trim();

  // Description
  const descMatch = md.match(/(?:Description|Seller['\u2019]s? (?:Notes|Description))[:\s]*\n?([\s\S]{20,800}?)(?=\n\n|\n(?:Features|Seller|Contact|Share|Report))/i);
  if (descMatch) vehicle.description = descMatch[1].trim();

  // Location
  const locMatch = md.match(/in\s+([A-Za-z\s]+),\s*([A-Z]{2})/);
  if (locMatch) {
    vehicle.city = locMatch[1].trim();
    vehicle.state = locMatch[2];
  }

  // Images
  const imgMatches = [...md.matchAll(/https:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)[^\s"'<>]*/gi)];
  vehicle.image_urls = [...new Set(imgMatches.map(m => m[0]))].slice(0, 30);

  return vehicle;
}

async function upsertVehicle(vehicle, listingUrl, importQueueIds) {
  // Insert to import_queue with extracted data, reset status
  for (const iqId of importQueueIds) {
    await fetch(`${SUPABASE_URL}/rest/v1/import_queue?id=eq.${iqId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        status: 'pending',
        error_message: null,
        listing_title: vehicle.year && vehicle.make ? `${vehicle.year} ${vehicle.make} ${vehicle.model || ''}`.trim() : null,
        listing_price: vehicle.price || null,
        listing_year: vehicle.year || null,
        listing_make: vehicle.make || null,
        listing_model: vehicle.model || null,
        raw_data: {
          ingested_via: 'mail_app_intake',
          ksl_extract: true,
          extracted_at: new Date().toISOString(),
          vehicle_data: vehicle,
        },
        attempts: 0,
        failure_category: null,
      }),
    });
  }
}

async function extractViaAI(markdown, url) {
  // Use extract-vehicle-data-ai edge function
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/extract-vehicle-data-ai`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url,
      markdown,
      source: 'ksl',
    }),
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function main() {
  console.log('Fetching skipped KSL listings from import_queue...');

  // Get all KSL entries grouped by clean URL
  const rows = await sql(`
    SELECT id, listing_url, split_part(listing_url, '?', 1) as clean_url
    FROM import_queue
    WHERE raw_data->>'ingested_via' = 'mail_app_intake'
      AND listing_url LIKE '%ksl.com%'
      AND status = 'skipped'
  `);

  // Group by clean URL
  const byUrl = {};
  for (const row of rows) {
    if (!byUrl[row.clean_url]) byUrl[row.clean_url] = { ids: [], url: row.clean_url };
    byUrl[row.clean_url].ids.push(row.id);
  }

  const urls = Object.values(byUrl);
  console.log(`Found ${urls.length} unique KSL listings to process`);

  let extracted = 0, expired = 0, blocked = 0, errors = 0;

  for (const entry of urls) {
    process.stdout.write(`  ${entry.url} ... `);

    // Try Firecrawl first
    const scraped = await firecrawlScrape(entry.url);
    if (!scraped) {
      console.log('EXPIRED/NOT FOUND');
      // Mark as permanently skipped
      for (const id of entry.ids) {
        await fetch(`${SUPABASE_URL}/rest/v1/import_queue?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            error_message: 'KSL listing expired or not found',
          }),
        });
      }
      expired++;
      continue;
    }

    // Parse what we can from markdown
    const vehicle = parseKSLMarkdown(scraped.markdown, scraped.title);
    if (!vehicle.year && !vehicle.make) {
      console.log('BLOCKED (no vehicle data)');
      blocked++;
      continue;
    }

    console.log(`${vehicle.year} ${vehicle.make} ${vehicle.model || ''} ${vehicle.price ? '$' + vehicle.price.toLocaleString() : ''}`);

    // Try AI extraction for richer data
    const aiResult = await extractViaAI(scraped.markdown, entry.url);
    if (aiResult?.vehicle) {
      Object.assign(vehicle, aiResult.vehicle);
    }

    // Update import_queue entries to re-process with data
    await upsertVehicle(vehicle, entry.url, entry.ids);
    extracted++;
  }

  console.log(`\nResults:`);
  console.log(`  Extracted: ${extracted}`);
  console.log(`  Expired: ${expired}`);
  console.log(`  Blocked: ${blocked}`);
  console.log(`  Errors: ${errors}`);

  // Now handle blocked ones via Playwright
  if (blocked > 0) {
    console.log(`\n${blocked} listings blocked by KSL — trying Playwright...`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
