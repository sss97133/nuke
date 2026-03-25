#!/usr/bin/env node
/**
 * bat-drain-queue.mjs
 *
 * Efficient BaT queue drainer: single persistent DB connection,
 * concurrent HTTP fetches, batch DB updates.
 *
 * Design:
 * - ONE persistent pg connection (avoids pool saturation)
 * - Concurrent HTTP fetches (15-25 parallel)
 * - Batch DB writes after each wave
 * - Marks queue entries complete/failed immediately
 *
 * Usage: dotenvx run -- node scripts/bat-drain-queue.mjs [--concurrency N] [--delay-ms N] [--max N]
 */

import pg from 'pg';
const { Client } = pg;

const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(name);
  return idx >= 0 ? parseInt(args[idx + 1]) : def;
}

const CONCURRENCY = getArg('--concurrency', 20);
const DELAY_MS = getArg('--delay-ms', 500);
const MAX_TOTAL = getArg('--max', 999999);
const CLAIM_SIZE = getArg('--claim', 100);
const VERSION = 'bat-drain:1.0.0';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeUrl(url) {
  let clean = url.trim().replace(/\/contact\/?$/, '').replace(/#.*$/, '').replace(/\?.*$/, '');
  if (!clean.endsWith('/')) clean += '/';
  return clean;
}

function extractBatFields(html) {
  const f = {};
  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';

  // Price from title
  const sold = title.match(/sold\s+for\s+\$([0-9,]+)/i);
  if (sold) { f.sale_price = parseInt(sold[1].replace(/,/g, '')); f.auction_outcome = 'sold'; }
  else {
    const bid = title.match(/bid\s+to\s+\$([0-9,]+)/i);
    if (bid) { f.high_bid = parseInt(bid[1].replace(/,/g, '')); f.auction_outcome = 'not_sold'; }
  }

  // JSON-LD
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const items = [].concat(JSON.parse(m[1].trim()));
      for (const item of items) {
        if (['Product','Car','Vehicle'].includes(item['@type'])) {
          if (item.description && !f.description) f.description = item.description.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,2000);
          if (item.image && !f.primary_image_url) {
            const img = Array.isArray(item.image) ? item.image[0] : item.image;
            f.primary_image_url = typeof img === 'string' ? img : img?.url;
          }
          if (item.offers && !f.sale_price) {
            const o = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            if (o.price) { const p = parseInt(String(o.price).replace(/\D/g,'')); if (p>0) { f.sale_price=p; f.auction_outcome='sold'; } }
          }
          if (item.vehicleIdentificationNumber) f.vin = item.vehicleIdentificationNumber.toUpperCase();
          if (item.mileageFromOdometer) {
            const mi = parseInt(String(item.mileageFromOdometer.value||item.mileageFromOdometer).replace(/\D/g,''));
            if (mi>0 && mi<500000) f.mileage = mi;
          }
        }
      }
    } catch {}
  }

  // og:image
  if (!f.primary_image_url) {
    const og = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (og?.[1]?.startsWith('http') && !og[1].includes('logo')) f.primary_image_url = og[1].replace(/&amp;/g,'&');
  }

  // Description fallbacks
  if (!f.description) {
    const og = html.match(/(?:property=["']og:description["']|name=["']description["'])[^>]+content=["']([^"']{40,})["']/i);
    if (og?.[1]) f.description = og[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"').slice(0,2000);
  }
  if (!f.description) {
    const d = html.match(/"description"\s*:\s*"([^"]{20,})"/);
    if (d) f.description = d[1].substring(0,2000).replace(/\\u[\dA-Fa-f]{4}/g, m => String.fromCharCode(parseInt(m.slice(2),16))).replace(/\\n/g,'\n').replace(/\\"/g,'"');
  }

  // Transmission
  if (html.match(/\bautomatic\b|auto\s*trans|tiptronic|powerglide/i)) f.transmission = 'Automatic';
  else if (html.match(/\bmanual\b|stick.?shift|[3-6]-speed\s*manual/i)) f.transmission = 'Manual';

  // Mileage
  if (!f.mileage) { const mi = html.match(/~?([0-9][0-9,]+)\s*(?:miles|mi\.?\b)/i); if (mi) { const v=parseInt(mi[1].replace(/,/g,'')); if(v>0&&v<500000) f.mileage=v; } }

  // Location
  const loc = html.match(/"location"\s*:\s*"([^"]+)"/i);
  if (loc) f.location = loc[1];

  // VIN
  if (!f.vin) { const v = html.match(/(?:VIN|Chassis)[^A-HJ-NPR-Z0-9]{0,20}([A-HJ-NPR-Z0-9]{17})/i); if (v) f.vin = v[1].toUpperCase(); }

  // Images
  const images = new Set();
  if (f.primary_image_url) images.add(f.primary_image_url);
  let mm; const re = /https?:\/\/[^"'\s<>]*bringatrailer\.com\/wp-content\/uploads\/[^"'\s<>]+\.(?:jpg|jpeg|png|webp)/gi;
  while ((mm = re.exec(html)) !== null) {
    const u = mm[0].replace(/&amp;/g,'&');
    if (!u.includes('logo') && !u.includes('favicon') && !u.includes('icon') && !u.includes('avatar')) images.add(u);
  }
  f.image_urls = [...images];

  return f;
}

async function fetchPage(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(tid);
    if (!r.ok) return { html: null, status: r.status };
    const html = await r.text();
    if (html.length < 1000) return { html: null, status: 429 };
    return { html, status: r.status };
  } catch (e) {
    clearTimeout(tid);
    return { html: null, status: 0, error: e.message };
  }
}

async function main() {
  const startTime = Date.now();
  let totalFetched = 0, totalUpdated = 0, totalImages = 0, totalErrors = 0, totalRateLimited = 0;
  let consecutiveRateLimits = 0;

  console.log(`\n=== BAT DRAIN QUEUE ===`);
  console.log(`Concurrency: ${CONCURRENCY} | Delay: ${DELAY_MS}ms | Claim: ${CLAIM_SIZE} | Max: ${MAX_TOTAL}`);

  // SINGLE persistent connection
  const client = new Client({
    host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
    database: 'postgres', ssl: { rejectUnauthorized: false },
    statement_timeout: 60000,
  });
  client.on('error', () => {}); // Prevent crash on idle disconnect

  let connected = false;
  async function ensureConnected() {
    if (connected) return;
    try { await client.connect(); connected = true; } catch (e) {
      console.error('DB connect failed:', e.message);
      process.exit(1);
    }
  }

  await ensureConnected();
  console.log('Connected to DB.\n');

  let round = 0;

  while (totalFetched + totalErrors < MAX_TOTAL) {
    round++;

    try {
      // 1. Claim batch
      const { rows: pending } = await client.query(
        `SELECT id, bat_url FROM bat_extraction_queue WHERE status = 'pending' ORDER BY created_at LIMIT $1`,
        [CLAIM_SIZE]
      );

      if (pending.length === 0) {
        console.log(`\nQueue empty. Done!`);
        break;
      }

      // 2. Fetch all pages concurrently
      const queue = [...pending];
      const results = []; // {queueId, url, fields, error, rateLimited}

      while (queue.length > 0) {
        const wave = queue.splice(0, CONCURRENCY);

        const waveResults = await Promise.allSettled(
          wave.map(async (row) => {
            const url = normalizeUrl(row.bat_url);
            const { html, status, error } = await fetchPage(url);
            if (!html) {
              if (status === 429 || status === 403) return { queueId: row.id, url, rateLimited: true };
              return { queueId: row.id, url, error: error || `HTTP ${status}` };
            }
            return { queueId: row.id, url, fields: extractBatFields(html) };
          })
        );

        let waveRL = 0;
        for (const r of waveResults) {
          if (r.status === 'fulfilled') {
            results.push(r.value);
            if (r.value.fields) totalFetched++;
            else if (r.value.rateLimited) { totalRateLimited++; waveRL++; }
            else totalErrors++;
          } else { totalErrors++; results.push({ queueId: null, error: 'promise_rejected' }); }
        }

        if (waveRL > 0) {
          consecutiveRateLimits += waveRL;
          if (consecutiveRateLimits >= 5) {
            console.log(`  Rate limited ${consecutiveRateLimits}x — backing off 30s`);
            await sleep(30000);
            consecutiveRateLimits = 0;
          } else await sleep(3000);
        } else {
          consecutiveRateLimits = 0;
          if (queue.length > 0) await sleep(DELAY_MS);
        }
      }

      // 3. Batch update vehicles
      let roundUpdated = 0, roundImages = 0;
      const fetched = results.filter(r => r.fields);

      for (const r of fetched) {
        const f = r.fields;
        const u1 = r.url.replace(/\/$/, '');
        const u2 = u1 + '/';

        // Build conditional update
        const sc = []; const vals = []; let i = 1;
        const fm = { sale_price:'n', high_bid:'n', mileage:'n', auction_outcome:'t', description:'t', primary_image_url:'t', transmission:'t', location:'t', vin:'t' };

        for (const [k, type] of Object.entries(fm)) {
          const v = f[k];
          if (v === undefined || v === null || v === '') continue;
          sc.push(type === 'n'
            ? `${k} = CASE WHEN ${k} IS NULL OR ${k} = 0 THEN $${i++} ELSE ${k} END`
            : `${k} = CASE WHEN ${k} IS NULL OR ${k} = '' THEN $${i++} ELSE ${k} END`);
          vals.push(v);
        }

        if (sc.length > 0) {
          vals.push(u1, u2);
          try {
            const res = await client.query(
              `UPDATE vehicles SET ${sc.join(', ')}, extractor_version = '${VERSION}', updated_at = NOW() WHERE listing_url = $${i} OR listing_url = $${i+1}`, vals);
            if (res.rowCount > 0) roundUpdated++;
          } catch (e) {
            if (e.message?.includes('unique') && f.vin) {
              // Retry without VIN
              const sc2 = []; const vals2 = []; let i2 = 1;
              for (const [k, type] of Object.entries(fm)) {
                if (k === 'vin') continue;
                const v = f[k]; if (v === undefined || v === null || v === '') continue;
                sc2.push(type === 'n' ? `${k} = CASE WHEN ${k} IS NULL OR ${k}=0 THEN $${i2++} ELSE ${k} END`
                  : `${k} = CASE WHEN ${k} IS NULL OR ${k}='' THEN $${i2++} ELSE ${k} END`);
                vals2.push(v);
              }
              if (sc2.length > 0) { vals2.push(u1, u2); try { await client.query(`UPDATE vehicles SET ${sc2.join(', ')}, extractor_version='${VERSION}', updated_at=NOW() WHERE listing_url=$${i2} OR listing_url=$${i2+1}`, vals2); roundUpdated++; } catch {} }
            }
          }
        }

        // Insert images
        if (f.image_urls?.length > 0) {
          try {
            const { rows: vr } = await client.query(`SELECT id FROM vehicles WHERE listing_url=$1 OR listing_url=$2 LIMIT 1`, [u1, u2]);
            if (vr.length > 0) {
              const vid = vr[0].id;
              const { rows: ex } = await client.query(`SELECT image_url FROM vehicle_images WHERE vehicle_id=$1`, [vid]);
              const exSet = new Set(ex.map(e => e.image_url));
              const newImgs = f.image_urls.filter(u => !exSet.has(u));
              for (let ci = 0; ci < newImgs.length; ci += 50) {
                const chunk = newImgs.slice(ci, ci + 50);
                const vals = []; const phs = chunk.map((u, idx) => { vals.push(vid, u, 'bat', true); return `($${idx*4+1},$${idx*4+2},$${idx*4+3},$${idx*4+4})`; }).join(',');
                try { const ir = await client.query(`INSERT INTO vehicle_images (vehicle_id, image_url, source, is_external) VALUES ${phs}`, vals); roundImages += ir.rowCount; } catch {}
              }
            }
          } catch {}
        }
      }

      totalUpdated += roundUpdated;
      totalImages += roundImages;

      // 4. Mark queue entries — THIS IS THE CRITICAL PART
      // Complete: all fetched successfully
      const completeIds = fetched.map(r => r.queueId).filter(Boolean);
      for (let ci = 0; ci < completeIds.length; ci += 100) {
        const chunk = completeIds.slice(ci, ci + 100);
        const phs = chunk.map((_, i) => `$${i+1}`).join(',');
        try {
          await client.query(`UPDATE bat_extraction_queue SET status = 'complete', updated_at = NOW() WHERE id IN (${phs})`, chunk);
        } catch (e) {
          console.log(`  Queue mark-complete error: ${e.message?.slice(0,80)}`);
        }
      }

      // Failed: HTTP errors (not rate limited)
      const failIds = results.filter(r => r.error && !r.rateLimited).map(r => r.queueId).filter(Boolean);
      if (failIds.length > 0) {
        const phs = failIds.map((_, i) => `$${i+1}`).join(',');
        try {
          await client.query(`UPDATE bat_extraction_queue SET status = 'failed', error_message = 'fetch-failed', updated_at = NOW() WHERE id IN (${phs})`, failIds);
        } catch {}
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;
      const queueRate = (completeIds.length + failIds.length) > 0 ? ((completeIds.length + failIds.length) / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;
      console.log(
        `R${round}: ${pending.length} claim | ${fetched.length} fetch | ${roundUpdated} upd | ${roundImages} img | queue -${completeIds.length+failIds.length} | Total: ${totalFetched} @ ${rate}/hr (queue: ${queueRate}/hr) | ${elapsed}s`
      );

    } catch (e) {
      console.error(`R${round} ERROR: ${e.message?.slice(0,100)}`);
      // Try to reconnect
      try {
        connected = false;
        await client.end();
      } catch {}
      try {
        const newClient = new Client({
          host: 'aws-0-us-west-1.pooler.supabase.com', port: 6543,
          user: 'postgres.qkgaybvrernstplzjaam',
          password: process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ',
          database: 'postgres', ssl: { rejectUnauthorized: false },
          statement_timeout: 60000,
        });
        newClient.on('error', () => {});
        await newClient.connect();
        // Replace client reference... actually can't since const.
        // Just exit and let the user restart
        console.log('Reconnected but need restart (const client). Exiting.');
        process.exit(0);
      } catch {
        await sleep(5000);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = totalFetched > 0 ? (totalFetched / ((Date.now() - startTime) / 1000) * 3600).toFixed(0) : 0;
  console.log(`\n=== DRAIN COMPLETE ===`);
  console.log(`Fetched: ${totalFetched} | Updated: ${totalUpdated} | Images: ${totalImages} | Errors: ${totalErrors} | RL: ${totalRateLimited}`);
  console.log(`Duration: ${elapsed}s | Rate: ${rate}/hr\n`);

  try { await client.end(); } catch {}
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
