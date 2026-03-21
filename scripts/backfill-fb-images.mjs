/**
 * FB Image Backfill — Download expired CDN images and persist to Supabase Storage
 *
 * Problem: 6,816 FB Marketplace vehicles have expired fbcdn/facebook URLs as
 * primary_image_url and zero images in vehicle_images. These were scraped before
 * the image download code was added to the scraper.
 *
 * Strategy:
 *   1. Try downloading the CDN URL directly (many recent ones still work)
 *   2. If that fails, try re-fetching the listing via FB GraphQL single-item endpoint
 *   3. Upload to Supabase Storage, update primary_image_url, insert vehicle_images
 *
 * Usage:
 *   dotenvx run -- node scripts/backfill-fb-images.mjs [--batch 100] [--dry-run] [--skip-graphql]
 */

import { createClient } from "@supabase/supabase-js";
import { Resolver } from "dns";
import https from "https";

// ── Custom DNS (same as scraper) ──────────────────────────────────────────────
const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function customLookup(hostname, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  dnsResolver.resolve4(hostname, (err, addrs) => {
    if (err || !addrs || addrs.length === 0) {
      dnsResolver.resolve6(hostname, (err6, addrs6) => {
        if (err6) return cb(err || err6);
        if (opts && opts.all) {
          cb(null, addrs6.map(a => ({ address: a, family: 6 })));
        } else {
          cb(null, addrs6[0], 6);
        }
      });
      return;
    }
    if (opts && opts.all) {
      cb(null, addrs.map(a => ({ address: a, family: 4 })));
    } else {
      cb(null, addrs[0], 4);
    }
  });
}

function dnsFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(typeof url === "string" ? url : url.url || url.href || String(url));
    const flatHeaders = {};
    const h = options.headers;
    if (h) {
      if (typeof h.entries === "function") {
        for (const [k, v] of h.entries()) flatHeaders[k] = v;
      } else if (typeof h === "object") {
        Object.assign(flatHeaders, h);
      }
    }
    flatHeaders["Host"] = parsed.hostname;
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: flatHeaders,
      lookup: customLookup,
    };
    const req = https.request(reqOptions, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const headers = new Map(Object.entries(res.headers));
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: `${res.statusCode}`,
          headers: { get: (k) => headers.get(k.toLowerCase()) || null },
          text: () => Promise.resolve(body.toString()),
          json: () => Promise.resolve(JSON.parse(body.toString())),
          arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
        });
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: dnsFetch },
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_GRAPHQL = args.includes("--skip-graphql");
const batchIdx = args.indexOf("--batch");
const BATCH_SIZE = batchIdx >= 0 ? parseInt(args[batchIdx + 1]) : 100;
const concIdx = args.indexOf("--concurrency");
const CONCURRENCY = concIdx >= 0 ? parseInt(args[concIdx + 1]) : 5;
const maxIdx = args.indexOf("--max");
const MAX_VEHICLES = maxIdx >= 0 ? parseInt(args[maxIdx + 1]) : Infinity;

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ── Image Download + Upload ───────────────────────────────────────────────────
async function downloadAndStore(sourceUrl, vehicleId, index = 0) {
  try {
    const resp = await fetch(sourceUrl, {
      headers: { "User-Agent": CHROME_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const buffer = Buffer.from(await resp.arrayBuffer());

    if (buffer.length < 5000) return null; // Skip tiny/placeholder images

    const storagePath = `${vehicleId}/fb-marketplace/${Date.now()}-${index}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("vehicle-photos")
      .upload(storagePath, buffer, { contentType, upsert: false });

    if (uploadErr && !uploadErr.message?.includes("already exists")) return null;

    const { data: pubData } = supabase.storage
      .from("vehicle-photos")
      .getPublicUrl(storagePath);

    return pubData?.publicUrl || null;
  } catch {
    return null;
  }
}

// ── GraphQL Single-Item Fetch ─────────────────────────────────────────────────
const DOC_ID = "33269364996041474";

async function fetchListingImages(facebookId) {
  // Try fetching the listing page HTML and extracting image URLs from meta tags
  try {
    const url = `https://www.facebook.com/marketplace/item/${facebookId}/`;
    // Use dnsFetch for residential IP routing
    const resp = await dnsFetch(url, {
      headers: {
        "User-Agent": CHROME_UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!resp.ok) return [];

    const html = await resp.text();

    // Extract og:image meta tags (FB always includes these)
    const ogImages = [];
    const ogPattern = /property="og:image"\s+content="([^"]+)"/g;
    let match;
    while ((match = ogPattern.exec(html)) !== null) {
      const decoded = match[1].replace(/&amp;/g, "&");
      if (decoded.includes("fbcdn") || decoded.includes("facebook")) {
        ogImages.push(decoded);
      }
    }

    // Also look for image URLs in JSON-LD or structured data
    const imgPattern = /scontent[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*/gi;
    const allMatches = html.match(imgPattern) || [];
    for (const m of allMatches) {
      const cleaned = m.replace(/\\u0025/g, "%").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      if (!ogImages.includes(cleaned) && cleaned.length > 50) {
        ogImages.push(cleaned);
      }
    }

    // Deduplicate by base path (before query params)
    const seen = new Set();
    return ogImages.filter(url => {
      const base = url.split("?")[0];
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    }).slice(0, 10); // Cap at 10 images
  } catch {
    return [];
  }
}

// ── Extract FB ID from URL ────────────────────────────────────────────────────
function extractFbId(url) {
  if (!url) return null;
  const match = url.match(/marketplace\/item\/(\d+)/);
  return match ? match[1] : null;
}

// ── Process a single vehicle ──────────────────────────────────────────────────
async function processVehicle(vehicle, marketplaceListing) {
  const { id: vehicleId, primary_image_url: cdnUrl, listing_url } = vehicle;
  const stats = { vehicleId, cdnDownloaded: false, graphqlFetched: false, imagesStored: 0 };

  // Strategy 1: Try downloading CDN URL directly
  const stored = await downloadAndStore(cdnUrl, vehicleId, 0);
  if (stored) {
    stats.cdnDownloaded = true;
    stats.imagesStored = 1;

    if (!DRY_RUN) {
      // Update primary_image_url
      await supabase.from("vehicles").update({ primary_image_url: stored }).eq("id", vehicleId);

      // Insert into vehicle_images
      await supabase.from("vehicle_images").insert({
        vehicle_id: vehicleId,
        image_url: stored,
        source_url: cdnUrl,
        source: "facebook_marketplace",
        display_order: 0,
        position: 0,
      });
    }
    return stats;
  }

  // Strategy 2: Try re-fetching via FB page HTML
  if (SKIP_GRAPHQL) return stats;

  const fbId = marketplaceListing?.facebook_id || extractFbId(listing_url);
  if (!fbId) {
    if (DRY_RUN) console.log(`    [SKIP] No facebook_id for ${vehicleId}`);
    return stats;
  }

  const freshUrls = await fetchListingImages(fbId);
  if (freshUrls.length === 0) {
    if (DRY_RUN) console.log(`    [SKIP] GraphQL returned 0 images for fb:${fbId}`);
    return stats;
  }
  if (DRY_RUN) console.log(`    [GRAPHQL] Got ${freshUrls.length} images for fb:${fbId}`);

  stats.graphqlFetched = true;

  // Download and store each image
  let primaryStored = null;
  const imgRows = [];

  for (let i = 0; i < freshUrls.length; i++) {
    const storedUrl = await downloadAndStore(freshUrls[i], vehicleId, i);
    if (!storedUrl) continue;

    if (i === 0) primaryStored = storedUrl;
    imgRows.push({
      vehicle_id: vehicleId,
      image_url: storedUrl,
      source_url: freshUrls[i],
      source: "facebook_marketplace",
      display_order: i,
      position: i,
    });
  }

  stats.imagesStored = imgRows.length;

  if (!DRY_RUN && imgRows.length > 0) {
    // Update primary_image_url
    if (primaryStored) {
      await supabase.from("vehicles").update({ primary_image_url: primaryStored }).eq("id", vehicleId);
    }
    // Batch insert vehicle_images
    await supabase.from("vehicle_images").insert(imgRows);
  }

  return stats;
}

// ── Parallel batch processor ──────────────────────────────────────────────────
async function processBatch(vehicles, marketplaceMap) {
  const results = [];
  for (let i = 0; i < vehicles.length; i += CONCURRENCY) {
    const chunk = vehicles.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(v => processVehicle(v, marketplaceMap.get(v.id)))
    );
    results.push(...chunkResults);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔧 FB Image Backfill`);
  console.log(`  Batch size: ${BATCH_SIZE}, Concurrency: ${CONCURRENCY}`);
  console.log(`  Dry run: ${DRY_RUN}, Skip GraphQL: ${SKIP_GRAPHQL}\n`);

  // Count total to process — filter by CDN URL pattern
  const { count: totalCount } = await supabase
    .from("vehicles")
    .select("id", { count: "exact", head: true })
    .like("primary_image_url", "%fbcdn%");

  console.log(`  Total vehicles with CDN URLs: ${totalCount}\n`);

  let processed = 0;
  let totalCdn = 0;
  let totalGraphql = 0;
  let totalImages = 0;
  let totalFailed = 0;

  // Use cursor-based pagination (by id) since successfully processed vehicles
  // get their primary_image_url changed and drop out of the result set.
  let lastId = "00000000-0000-0000-0000-000000000000";

  while (true) {
    // Fetch batch — filter by CDN URL pattern (the defining characteristic)
    // Using .like for fbcdn covers 99%+ of cases
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("id, primary_image_url, listing_url")
      .like("primary_image_url", "%fbcdn%")
      .gt("id", lastId)
      .order("id")
      .limit(BATCH_SIZE);

    if (error) {
      console.error(`Query error: ${error.message}`);
      break;
    }
    if (!vehicles || vehicles.length === 0) break;

    // Fetch marketplace_listings for this batch (for facebook_id fallback)
    const vehicleIds = vehicles.map(v => v.id);
    const { data: listings } = await supabase
      .from("marketplace_listings")
      .select("vehicle_id, facebook_id")
      .in("vehicle_id", vehicleIds);

    const marketplaceMap = new Map((listings || []).map(l => [l.vehicle_id, l]));

    // Process batch
    const results = await processBatch(vehicles, marketplaceMap);

    for (const r of results) {
      processed++;
      if (r.cdnDownloaded) totalCdn++;
      else if (r.graphqlFetched && r.imagesStored > 0) totalGraphql++;
      else totalFailed++;
      totalImages += r.imagesStored;
    }

    const pct = totalCount ? Math.round((processed / totalCount) * 100) : 0;
    console.log(`  [${pct}%] Processed ${processed}/${totalCount} — CDN: ${totalCdn}, GraphQL: ${totalGraphql}, Failed: ${totalFailed}, Images: ${totalImages}`);

    // Check if we got a full batch or hit max — if not, we're done
    if (vehicles.length < BATCH_SIZE) break;
    if (processed >= MAX_VEHICLES) {
      console.log(`  Hit --max ${MAX_VEHICLES}, stopping.`);
      break;
    }

    // Cursor-based: advance past the last vehicle we processed
    lastId = vehicles[vehicles.length - 1].id;

    // Rate limit: small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n✅ Backfill complete`);
  console.log(`  Processed: ${processed}`);
  console.log(`  CDN direct: ${totalCdn}`);
  console.log(`  GraphQL re-fetch: ${totalGraphql}`);
  console.log(`  Failed: ${totalFailed}`);
  console.log(`  Images stored: ${totalImages}`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
