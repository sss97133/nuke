#!/usr/bin/env node
/**
 * enrich-marketplace-listings.mjs
 *
 * Enriches existing vehicle records from ClassicCars.com and Classic Driver
 * by fetching their listing pages and extracting structured data.
 *
 * ClassicCars.com: JSON-LD schema.org @type:car — VIN, price, mileage, color, description
 * Classic Driver:  Drupal HTML spec fields — mileage, color, gearbox, drivetrain, performance, description
 *
 * Both use direct HTTP fetch with browser UA (no Firecrawl needed, no AI needed).
 * Archives fetched HTML to listing_page_snapshots for future re-extraction.
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-marketplace-listings.mjs --source classiccars --max 20 --dry-run
 *   dotenvx run -- node scripts/enrich-marketplace-listings.mjs --source classic-driver --max 20 --dry-run
 *   dotenvx run -- node scripts/enrich-marketplace-listings.mjs --source classiccars --concurrency 10 --max 1000
 *   dotenvx run -- node scripts/enrich-marketplace-listings.mjs --source all --concurrency 15
 *
 * Options:
 *   --source X:       classiccars | classic-driver | all (default: all)
 *   --dry-run:        Parse and log but don't write to DB
 *   --concurrency N:  Parallel fetches (default 10)
 *   --batch N:        DB batch size (default 100)
 *   --max N:          Max items to process (default unlimited)
 *   --skip-archive:   Don't archive to listing_page_snapshots (faster for testing)
 *   --force:          Re-fetch even if description already exists
 */

import pg from 'pg';
const { Client } = pg;

// ─── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? (typeof def === 'number' ? parseInt(args[idx + 1]) : args[idx + 1]) : def;
}
const SOURCE_FILTER = getArg('--source', 'all');
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = getArg('--concurrency', 10);
const BATCH_SIZE = getArg('--batch', 100);
const MAX_TOTAL = getArg('--max', 999999999);
const SKIP_ARCHIVE = args.includes('--skip-archive');
const FORCE = args.includes('--force');
const VERSION = 'enrich-marketplace:1.0.0';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── ClassicCars.com JSON-LD parser ──────────────────────────────────────────
function parseClassicCarsHtml(html) {
  const result = {};

  // Extract JSON-LD blocks
  const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      // Clean control chars before parsing
      const cleaned = match[1].replace(/[\x00-\x1f\x7f]/g, ' ');
      const items = [].concat(JSON.parse(cleaned));
      for (const item of items) {
        if (['car', 'Car', 'Vehicle', 'Product'].includes(item['@type'])) {
          // VIN
          if (item.vehicleIdentificationNumber && item.vehicleIdentificationNumber.length >= 5) {
            result.vin = item.vehicleIdentificationNumber.toUpperCase().trim();
          }

          // Mileage
          if (item.mileageFromOdometer) {
            const mi = parseInt(String(item.mileageFromOdometer.value || item.mileageFromOdometer).replace(/\D/g, ''));
            if (mi > 0 && mi < 999999) result.mileage = mi;
          }

          // Color
          if (item.color && item.color.trim()) {
            result.color = item.color.trim();
          }

          // Interior color
          if (item.vehicleInteriorColor && item.vehicleInteriorColor.trim()) {
            result.interior_color = item.vehicleInteriorColor.trim();
          }

          // Body type
          if (item.bodyType && item.bodyType.trim()) {
            result.body_style = item.bodyType.trim();
          }

          // Description (strip HTML entities)
          if (item.description) {
            let desc = item.description
              .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (desc.length > 20) result.description = desc.slice(0, 4000);
          }

          // Price
          if (item.offers) {
            const o = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (o.price) {
              const p = parseFloat(String(o.price).replace(/[^0-9.]/g, ''));
              if (p > 0 && p < 50000000) {
                result.asking_price = Math.round(p);
              }
            }
          }

          // Product ID
          if (item.productID) result.cc_listing_id = item.productID;
        }
      }
    } catch (e) {
      // JSON parse failed — try the next block
    }
  }

  // og:image fallback for primary image
  if (!result.primary_image_url) {
    const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
               html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (og?.[1]?.startsWith('http') && !og[1].includes('logo')) {
      result.primary_image_url = og[1].replace(/&amp;/g, '&');
    }
  }

  // Extract listing images from HTML
  const imagePattern = /https?:\/\/photos\.classiccars\.com\/cc-temp\/listing\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
  const images = new Set();
  let imgMatch;
  while ((imgMatch = imagePattern.exec(html)) !== null) {
    // Prefer -std size over -thumb or -thumbnailcarousel
    let url = imgMatch[0];
    if (!url.includes('-std')) {
      url = url.replace(/-thumb\./, '-std.').replace(/-thumbnailcarousel\./, '-std.');
    }
    images.add(url);
  }
  if (images.size > 0) result.image_urls = [...images];

  return result;
}

// ─── Classic Driver HTML parser ──────────────────────────────────────────────
function parseClassicDriverHtml(html) {
  const result = {};

  // Extract spec fields from Drupal field structure
  // Pattern: <div class="field-label...">Label</div> ... <div class="field-items"><div ...>Value</div>
  const specPattern = /<div class="field-label[^"]*">\s*([^<]+)<\/div>\s*<div class="field-items[^"]*">\s*<div[^>]*>\s*([^<]*)/g;
  let match;
  while ((match = specPattern.exec(html)) !== null) {
    const label = match[1].replace(/&nbsp;/g, '').trim().toLowerCase();
    const value = match[2].replace(/&nbsp;/g, ' ').trim();
    if (!value || value.length === 0) continue;

    if (label.includes('mileage')) {
      // "32 500 km / 20 195 mi" or "100 km" or "55 000 mi"
      const miMatch = value.match(/([\d\s]+)\s*mi/i);
      const kmMatch = value.match(/([\d\s]+)\s*km/i);
      if (miMatch) {
        const mi = parseInt(miMatch[1].replace(/\s/g, ''));
        if (mi > 0 && mi < 999999) result.mileage = mi;
      } else if (kmMatch) {
        const km = parseInt(kmMatch[1].replace(/\s/g, ''));
        if (km > 0 && km < 999999) result.mileage = Math.round(km * 0.621371);
      }
    } else if (label.includes('exterior') && label.includes('colour')) {
      result.color = value;
    } else if (label.includes('interior') && label.includes('colour')) {
      result.interior_color = value;
    } else if (label.includes('gearbox') || label.includes('transmission')) {
      result.transmission = value;
    } else if (label.includes('car type') || label.includes('body')) {
      result.body_style = value;
    } else if (label.includes('performance')) {
      // "570 BHP / 578 PS / 426 kW"
      result.horsepower_raw = value;
      const bhp = value.match(/(\d+)\s*BHP/i);
      const hp = value.match(/(\d+)\s*HP/i);
      if (bhp) result.horsepower = parseInt(bhp[1]);
      else if (hp) result.horsepower = parseInt(hp[1]);
    } else if (label.includes('drivetrain') || label.includes('drive')) {
      result.drivetrain = value;
    } else if (label.includes('fuel type')) {
      result.fuel_type = value;
    } else if (label.includes('registration')) {
      if (value.length >= 5 && value.length <= 20) result.registration_number = value;
    } else if (label.includes('number of doors')) {
      result.doors = parseInt(value);
    } else if (label.includes('number of seats')) {
      result.seats = parseInt(value);
    } else if (label.includes('condition')) {
      result.condition = value;
    } else if (label.includes('chassis') && label.includes('number')) {
      // Chassis number = VIN or partial VIN
      if (value.length >= 5 && value.length <= 20) {
        result.vin = value.toUpperCase().trim();
      }
    } else if (label.includes('lot number')) {
      result.lot_number = value;
    }
  }

  // Extract description from field-name-body
  const descMatch = html.match(/field-name-body[\s\S]*?<div class="field-items[^"]*">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  if (descMatch) {
    const desc = descMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (desc.length > 20) result.description = desc.slice(0, 4000);
  }

  // Fallback: meta description (often has useful seller text)
  if (!result.description) {
    const metaDesc = html.match(/name="description"[^>]+content="([^"]+)"/i);
    if (metaDesc && metaDesc[1].length > 30) {
      result.description = metaDesc[1]
        .replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        .trim().slice(0, 4000);
    }
  }

  // Extract price from Drupal settings (most reliable)
  // Format: "price": "170860.93" or "price":170860
  const drupalPrice = html.match(/"price"\s*:\s*"?([\d]+(?:\.\d+)?)"?/);
  if (drupalPrice) {
    const p = Math.round(parseFloat(drupalPrice[1]));
    // Must be a reasonable vehicle price (>500 and <50M)
    if (p >= 500 && p < 50000000) result.asking_price = p;
  }

  // Fallback: look for formatted USD price in the page content
  if (!result.asking_price) {
    // Match "USD 313 167" or "USD 313,167" or similar
    const usdPrice = html.match(/USD\s*([\d\s,]+)/);
    if (usdPrice) {
      const p = parseInt(usdPrice[1].replace(/[\s,]/g, ''));
      if (p >= 500 && p < 50000000) result.asking_price = p;
    }
  }

  // og:image
  const ogImage = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (ogImage?.[1]?.startsWith('http')) {
    result.primary_image_url = ogImage[1].replace(/&amp;/g, '&');
  }

  // Detect expired listings
  if (html.includes('This listing is no longer available') || html.includes('listing-expired')) {
    result._expired = true;
  }

  // Extract listing images from Classic Driver
  const cdImagePattern = /https?:\/\/www\.classicdriver\.com\/sites\/default\/files\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
  const images = new Set();
  let imgMatch;
  while ((imgMatch = cdImagePattern.exec(html)) !== null) {
    const url = imgMatch[0];
    if (!url.includes('logo') && !url.includes('favicon') && !url.includes('icon') && !url.includes('avatar') && !url.includes('flag')) {
      images.add(url);
    }
  }
  if (images.size > 0) result.image_urls = [...images];

  return result;
}

// ─── HTTP fetch ──────────────────────────────────────────────────────────────
async function fetchPage(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 20000);
  try {
    // Use manual redirect to detect expired/removed listings (302 -> search page)
    const r = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(tid);

    // Classic Driver returns 302 for removed listings -> search page
    if (r.status === 301 || r.status === 302) {
      const location = r.headers.get('location') || '';
      // If redirect goes to a search/browse page (not the same listing), listing is gone
      if (!location.includes(url.split('/').pop())) {
        return { html: null, status: r.status, redirected: true };
      }
      // If redirect is just www/non-www or trailing slash, follow it
      const r2 = await fetch(location, { headers: BROWSER_HEADERS, signal: ctrl.signal, redirect: 'follow' });
      if (!r2.ok) return { html: null, status: r2.status };
      const html = await r2.text();
      if (html.length < 500) return { html: null, status: 204 };
      return { html, status: r2.status };
    }

    if (!r.ok) return { html: null, status: r.status };
    const html = await r.text();
    if (html.length < 500) return { html: null, status: 204 };
    return { html, status: r.status };
  } catch (e) {
    clearTimeout(tid);
    return { html: null, status: 0, error: e.message };
  }
}

// ─── Archive to listing_page_snapshots ───────────────────────────────────────
async function archiveSnapshot(client, url, html, platform) {
  try {
    const contentLength = html.length;
    // Use crypto for SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(html);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    await client.query(
      `INSERT INTO listing_page_snapshots (listing_url, platform, html, html_sha256, content_length, success, http_status, fetch_method, fetched_at)
       VALUES ($1, $2, $3, $4, $5, true, 200, 'direct', NOW())
       ON CONFLICT (platform, listing_url, html_sha256) WHERE html_sha256 IS NOT NULL
       DO UPDATE SET fetched_at = NOW()`,
      [url, platform, html, sha256, contentLength]
    );
    return true;
  } catch (e) {
    // Snapshot may be too large for inline storage — log and skip
    if (e.message?.includes('too large') || e.message?.includes('statement_timeout')) {
      console.warn(`    Archive skipped (too large): ${url.slice(0, 80)}`);
    }
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  let totalProcessed = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;
  let totalExpired = 0, totalArchived = 0;

  console.log(`\n=== ENRICH MARKETPLACE LISTINGS ===`);
  console.log(`Source: ${SOURCE_FILTER} | Batch: ${BATCH_SIZE} | Concurrency: ${CONCURRENCY} | Max: ${MAX_TOTAL} | DryRun: ${DRY_RUN}`);
  console.log(`Archive: ${!SKIP_ARCHIVE} | Force: ${FORCE}`);
  console.log('');

  // Connect
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
    database: 'postgres', ssl: { rejectUnauthorized: false },
    statement_timeout: 120000,
  });
  client.on('error', (e) => { console.error('DB background error:', e.message); });
  await client.connect();
  console.log('Connected to DB.');

  const sources = SOURCE_FILTER === 'all'
    ? ['classiccars', 'classic-driver']
    : [SOURCE_FILTER];

  // URL domain filters to ensure we fetch the right sites
  const urlDomainFilters = {
    'classiccars': "v.listing_url LIKE '%classiccars.com/listings/%'",
    'classic-driver': "v.listing_url LIKE '%classicdriver.com/en/car/%'",
  };

  for (const source of sources) {
    if (totalProcessed >= MAX_TOTAL) break;

    const snapshotPlatform = source; // for listing_page_snapshots.platform
    const urlFilter = urlDomainFilters[source];
    if (!urlFilter) {
      console.log(`  ${source}: no URL filter defined, skipping`);
      continue;
    }

    // Count vehicles needing enrichment
    const descCondition = FORCE ? 'TRUE' : 'v.description IS NULL';
    const { rows: countRows } = await client.query(
      `SELECT count(*) as cnt FROM vehicles v
       WHERE ${urlFilter}
       AND v.deleted_at IS NULL
       AND (${descCondition})`
    );
    const pendingCount = parseInt(countRows[0].cnt);
    if (pendingCount === 0) {
      console.log(`  ${source}: 0 vehicles needing enrichment, skipping`);
      continue;
    }
    console.log(`\n  ${source}: ${pendingCount.toLocaleString()} vehicles to enrich`);

    let sourceProcessed = 0, sourceUpdated = 0, sourceErrors = 0, sourceExpired = 0;
    let consecutiveRateLimits = 0;
    let round = 0;

    while (sourceProcessed < pendingCount && totalProcessed < MAX_TOTAL) {
      round++;
      const remaining = Math.min(BATCH_SIZE, MAX_TOTAL - totalProcessed);

      // Fetch batch of vehicles needing enrichment
      const { rows: batch } = await client.query(
        `SELECT v.id, v.listing_url, v.year, v.make, v.model, v.vin, v.description,
                v.sale_price, v.mileage, v.color, v.interior_color, v.transmission,
                v.horsepower, v.body_style, v.drivetrain, v.primary_image_url
         FROM vehicles v
         WHERE ${urlFilter}
         AND v.deleted_at IS NULL
         AND (${descCondition})
         AND v.extractor_version IS DISTINCT FROM $1
         ORDER BY v.created_at ASC
         LIMIT $2`,
        [VERSION, remaining]
      );

      if (batch.length === 0) break;

      // Fetch pages concurrently
      const queue = [...batch];
      const results = [];

      while (queue.length > 0) {
        const wave = queue.splice(0, CONCURRENCY);

        const waveResults = await Promise.allSettled(
          wave.map(async (vehicle) => {
            const { html, status, error, redirected } = await fetchPage(vehicle.listing_url);
            if (!html) {
              if (status === 429 || status === 403) return { vehicle, rateLimited: true, status };
              if (status === 404 || status === 410 || redirected) return { vehicle, gone: true, status };
              return { vehicle, error: error || `HTTP ${status}`, status };
            }

            // Parse based on source
            let parsed;
            if (source === 'classiccars') {
              parsed = parseClassicCarsHtml(html);
            } else if (source === 'classic-driver') {
              parsed = parseClassicDriverHtml(html);
            }

            return { vehicle, parsed, html, status };
          })
        );

        let waveRL = 0;
        for (const r of waveResults) {
          if (r.status === 'fulfilled') {
            results.push(r.value);
            if (r.value.rateLimited) waveRL++;
          } else {
            results.push({ vehicle: wave[0], error: 'promise_rejected' });
          }
        }

        if (waveRL > 0) {
          consecutiveRateLimits += waveRL;
          if (consecutiveRateLimits >= 5) {
            console.log(`    Rate limited ${consecutiveRateLimits}x -- backing off 30s`);
            await sleep(30000);
            consecutiveRateLimits = 0;
          } else {
            await sleep(5000);
          }
        } else {
          consecutiveRateLimits = 0;
          if (queue.length > 0) await sleep(300); // Polite delay between waves
        }
      }

      // Process results
      let batchUpdated = 0, batchErrors = 0, batchExpired = 0;

      for (const r of results) {
        if (r.rateLimited) continue; // Retry next round

        if (r.gone) {
          // Mark as expired/gone
          if (!DRY_RUN) {
            try {
              await client.query(
                `UPDATE vehicles SET extractor_version = $1, updated_at = NOW()
                 WHERE id = $2`,
                [VERSION + ':gone', r.vehicle.id]
              );
            } catch {}
          }
          batchExpired++;
          continue;
        }

        if (r.error) {
          batchErrors++;
          if (batchErrors <= 3) console.warn(`    Error: ${r.error} for ${r.vehicle.listing_url?.slice(0, 60)}`);
          // Mark as attempted to avoid re-processing
          if (!DRY_RUN) {
            try {
              await client.query(
                `UPDATE vehicles SET extractor_version = $1, updated_at = NOW()
                 WHERE id = $2`,
                [VERSION + ':error', r.vehicle.id]
              );
            } catch {}
          }
          continue;
        }

        const parsed = r.parsed;
        if (!parsed) {
          batchErrors++;
          continue;
        }

        // Check if listing is expired (Classic Driver)
        if (parsed._expired) {
          batchExpired++;
          if (!DRY_RUN) {
            try {
              await client.query(
                `UPDATE vehicles SET extractor_version = $1, updated_at = NOW()
                 WHERE id = $2`,
                [VERSION + ':expired', r.vehicle.id]
              );
            } catch {}
          }
          // Even for expired listings, try to extract whatever data is available
          // (CD still shows specs on expired listings)
        }

        // Build UPDATE SET clause — only fill empty fields (COALESCE pattern)
        const updates = [];
        const values = [];
        let paramIdx = 1;

        function addUpdate(col, newVal, existingVal) {
          if (newVal !== undefined && newVal !== null && newVal !== '' &&
              (existingVal === null || existingVal === undefined || existingVal === '')) {
            updates.push(`${col} = $${paramIdx}`);
            values.push(newVal);
            paramIdx++;
          }
        }

        const v = r.vehicle;
        addUpdate('description', parsed.description, v.description);
        addUpdate('mileage', parsed.mileage, v.mileage);
        addUpdate('color', parsed.color, v.color);
        addUpdate('interior_color', parsed.interior_color, v.interior_color);
        addUpdate('transmission', parsed.transmission, v.transmission);
        addUpdate('body_style', parsed.body_style, v.body_style);
        addUpdate('drivetrain', parsed.drivetrain, v.drivetrain);
        addUpdate('primary_image_url', parsed.primary_image_url, v.primary_image_url);

        // VIN: only update if parsed VIN is longer than existing
        if (parsed.vin && (!v.vin || parsed.vin.length > v.vin.length)) {
          updates.push(`vin = $${paramIdx}`);
          values.push(parsed.vin);
          paramIdx++;
        }

        // Price: set as asking_price (marketplace, not auction sold price)
        if (parsed.asking_price && !v.sale_price) {
          updates.push(`sale_price = $${paramIdx}`);
          values.push(parsed.asking_price);
          paramIdx++;
        }

        // Horsepower
        if (parsed.horsepower && !v.horsepower) {
          updates.push(`horsepower = $${paramIdx}`);
          values.push(parsed.horsepower);
          paramIdx++;
        }

        // Always mark as processed
        updates.push(`extractor_version = $${paramIdx}`);
        values.push(VERSION);
        paramIdx++;

        updates.push(`updated_at = NOW()`);

        if (DRY_RUN) {
          const fieldsFound = Object.keys(parsed).filter(k => !k.startsWith('_') && k !== 'image_urls' && parsed[k]);
          console.log(`    [DRY] ${v.year} ${v.make} ${v.model} | fields: ${fieldsFound.join(', ') || 'none'}${parsed._expired ? ' [EXPIRED]' : ''}`);
          batchUpdated++;
        } else {
          // Execute update
          values.push(r.vehicle.id);
          try {
            await client.query(
              `UPDATE vehicles SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
              values
            );
            batchUpdated++;
          } catch (e) {
            // VIN conflict — retry without VIN
            if (e.message?.includes('vin') && e.message?.includes('unique')) {
              try {
                const vinlessUpdates = updates.filter(u => !u.startsWith('vin '));
                const vinlessValues = [];
                let pi2 = 1;
                // Rebuild without VIN
                const rebuiltUpdates = [];
                for (const u of vinlessUpdates) {
                  rebuiltUpdates.push(u.replace(/\$\d+/, `$${pi2}`));
                  pi2++;
                }
                // Re-extract non-VIN values (extractor_version is always last before id)
                const nonVinParsed = { ...parsed };
                delete nonVinParsed.vin;
                const rebuildValues = values.filter((_, idx) => {
                  const updateStr = updates[idx];
                  return updateStr && !updateStr.startsWith('vin ');
                });
                // Simpler approach: just remove vin from the SET and rerun
                const safeUpdates = updates.filter(u => !u.startsWith('vin '));
                if (safeUpdates.length > 0) {
                  // Rebuild with fresh parameter indices
                  const freshUpdates = [];
                  const freshValues = [];
                  let fi = 1;
                  for (let ui = 0; ui < updates.length; ui++) {
                    if (updates[ui].startsWith('vin ')) continue;
                    if (updates[ui] === 'updated_at = NOW()') {
                      freshUpdates.push('updated_at = NOW()');
                      continue;
                    }
                    freshUpdates.push(updates[ui].replace(/\$\d+/, `$${fi}`));
                    freshValues.push(values[ui]);
                    fi++;
                  }
                  freshValues.push(r.vehicle.id);
                  await client.query(
                    `UPDATE vehicles SET ${freshUpdates.join(', ')} WHERE id = $${fi}`,
                    freshValues
                  );
                  batchUpdated++;
                }
              } catch (e2) {
                batchErrors++;
                if (batchErrors <= 3) console.error(`    Retry without VIN failed: ${e2.message?.slice(0, 120)}`);
              }
            } else {
              batchErrors++;
              if (batchErrors <= 3) console.error(`    Update error: ${e.message?.slice(0, 120)}`);
            }
          }
        }

        // Archive HTML
        if (!SKIP_ARCHIVE && !DRY_RUN && r.html) {
          const archived = await archiveSnapshot(client, r.vehicle.listing_url, r.html, snapshotPlatform);
          if (archived) totalArchived++;
        }
      }

      sourceProcessed += batch.length;
      totalProcessed += batch.length;
      sourceUpdated += batchUpdated;
      sourceErrors += batchErrors;
      sourceExpired += batchExpired;
      totalUpdated += batchUpdated;
      totalErrors += batchErrors;
      totalExpired += batchExpired;
      totalSkipped += results.filter(r => r.rateLimited).length;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = totalProcessed > 0 ? (totalProcessed / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

      console.log(
        `    R${round}: ${batch.length} fetched | +${batchUpdated} enriched | +${batchExpired} expired | +${batchErrors} err | ` +
        `${sourceProcessed.toLocaleString()}/${pendingCount.toLocaleString()} | ${rate}/hr | ${elapsed}s`
      );

      // Back-pressure: if too many rate limits or errors, slow down
      if (batchErrors > batch.length * 0.5) {
        console.log(`    High error rate -- backing off 10s`);
        await sleep(10000);
      }
    }

    console.log(`\n  ${source} done: ${sourceProcessed} processed, ${sourceUpdated} enriched, ${sourceExpired} expired, ${sourceErrors} errors`);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = totalProcessed > 0 ? (totalProcessed / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;

  console.log(`\n=== ENRICHMENT COMPLETE ===`);
  console.log(`Processed: ${totalProcessed.toLocaleString()}`);
  console.log(`Enriched:  ${totalUpdated.toLocaleString()} (fields filled)`);
  console.log(`Expired:   ${totalExpired.toLocaleString()} (listing gone)`);
  console.log(`Errors:    ${totalErrors.toLocaleString()}`);
  console.log(`Archived:  ${totalArchived.toLocaleString()} (to listing_page_snapshots)`);
  console.log(`Rate:      ${rate}/hr`);
  console.log(`Duration:  ${elapsed}s`);

  await client.end();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
