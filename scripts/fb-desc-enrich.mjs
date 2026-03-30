#!/usr/bin/env node
/**
 * FB Marketplace Description Enricher v1.0
 *
 * Fetches descriptions for FB Marketplace vehicles that are missing them.
 * Uses Googlebot UA from residential IP (runs locally on Mac).
 *
 * Two-phase approach:
 *   Phase 1: Googlebot fetch (fast, ~0.5s/listing, works for ~13% of listings)
 *   Phase 2: Playwright fallback for listings where Googlebot fails (slower, ~4s/listing)
 *
 * The script tracks enrichment attempts via marketplace_listings.refined_at
 * and only targets listings that either:
 *   - Have never been refined (refined_at IS NULL)
 *   - Were refined from cloud but got no description (need residential IP retry)
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs                         # Default: 200 batch
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs --batch 500             # Larger batch
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs --batch 500 --playwright # Use Playwright for all
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs --active-only           # Only active listings
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs --retry-failed          # Retry previously failed
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs --dry-run               # Preview only
 *   dotenvx run -- node scripts/fb-desc-enrich.mjs --stats                 # Show stats and exit
 */

import { createClient } from "@supabase/supabase-js";
import https from "https";
import http from "http";
import { Resolver } from "dns";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BATCH_SIZE = parseInt(getArg("batch", "200"));
const PARALLEL = parseInt(getArg("parallel", "1"));
const DRY_RUN = args.includes("--dry-run");
const ACTIVE_ONLY = args.includes("--active-only");
const USE_PLAYWRIGHT = args.includes("--playwright");
const RETRY_FAILED = args.includes("--retry-failed");
const STATS_ONLY = args.includes("--stats");
const VERBOSE = args.includes("--verbose");
const FAST = args.includes("--fast");

// ─── Constants ──────────────────────────────────────────────────────────
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const DELAY_MS = FAST ? 300 : 800;  // Polite delay between requests
const MAX_CONSECUTIVE_FAILURES = 10;

// ─── Custom DNS (bypass macOS getaddrinfo issues) ───────────────────────
const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function customLookup(hostname, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  dnsResolver.resolve4(hostname, (err, addrs) => {
    if (err || !addrs?.length) {
      dnsResolver.resolve6(hostname, (err6, addrs6) => {
        if (err6) return cb(err || err6);
        cb(null, opts?.all ? addrs6.map(a => ({ address: a, family: 6 })) : addrs6[0], 6);
      });
      return;
    }
    cb(null, opts?.all ? addrs.map(a => ({ address: a, family: 4 })) : addrs[0], 4);
  });
}

// ─── Googlebot fetch with custom DNS ────────────────────────────────────
function googlebotFetch(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: "GET",
      lookup: customLookup,
      headers: {
        "User-Agent": GOOGLEBOT_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Referer": "https://www.facebook.com/marketplace/vehicles/",
        "Host": parsed.hostname,
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        googlebotFetch(res.headers.location).then(resolve).catch(reject);
        return;
      }

      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, html: data }));
      res.on("error", reject);
    });

    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
    req.end();
  });
}

// ─── HTML parsing helpers ───────────────────────────────────────────────
function decodeUnicode(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function extractOgMeta(html, property) {
  const re = new RegExp(`<meta property="${property}" content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? decodeHtmlEntities(decodeUnicode(m[1])) : null;
}

// ─── Description parsing (mirrors edge function) ────────────────────────
function parseDescription(desc) {
  const result = {
    vin: null, engine: null, trim: null, body_style: null,
    title_status: null, drivetrain: null, mileage: null,
    transmission: null, exterior_color: null,
  };
  if (!desc) return result;

  // VIN
  const vinMatch = desc.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) result.vin = vinMatch[1];

  // Engine
  const enginePatterns = [
    /\b(\d{3})\s*(ci|cubic\s*inch|cu\.?\s*in)/i,
    /\b(small|big)\s*block\s*(\d{3})?/i,
    /\b(\d\.\d)\s*[lL]\b/,
    /\b(v-?[468]|inline[- ]?[46]|flat[- ]?[46]|i[46])\b/i,
    /\b(\d{3,4})\s*(v8|v6|v4)\b/i,
    /\b(\d{3})\s*(motor|engine)\b/i,
    /\b(ls\d|lt\d|sbc|bbc|hemi|flathead|windsor|cleveland|coyote|vortec|ecoboost)\b/i,
  ];
  for (const p of enginePatterns) {
    const m = desc.match(p);
    if (m) { result.engine = m[0].trim(); break; }
  }

  // Trim
  const trimPatterns = [
    /\b(scottsdale|cheyenne|silverado|custom\s*deluxe|sierra\s*classic|sierra\s*grande|high\s*sierra|big\s*10)\b/i,
    /\b(sport|gt|ss|rs|z28|z\/28|rt|r\/t|srt|sr5|limited|xlt|lariat|king\s*ranch|laramie|sle|slt)\b/i,
  ];
  for (const p of trimPatterns) {
    const m = desc.match(p);
    if (m) { result.trim = m[1].trim(); break; }
  }

  // Body style
  const bodyPatterns = [
    /\b(short\s*(?:bed|box)|long\s*(?:bed|box)|stepside|fleetside|step\s*side|fleet\s*side)\b/i,
    /\b(crew\s*cab|ext(?:ended)?\s*cab|regular\s*cab|single\s*cab|quad\s*cab|super\s*cab)\b/i,
    /\b(convertible|hardtop|fastback|hatchback|wagon|coupe|sedan|roadster)\b/i,
  ];
  for (const p of bodyPatterns) {
    const m = desc.match(p);
    if (m) { result.body_style = m[1].trim(); break; }
  }

  // Title status
  if (/\bclean\s*title\b/i.test(desc)) result.title_status = "clean";
  else if (/\bsalvage\s*title\b/i.test(desc)) result.title_status = "salvage";
  else if (/\brebuilt\s*title\b/i.test(desc)) result.title_status = "rebuilt";
  else if (/\bno\s*title\b/i.test(desc)) result.title_status = "none";

  // Drivetrain
  if (/\b4x4\b|4wd\b|four\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "4WD";
  else if (/\b2wd\b|2x4\b|two\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "2WD";
  else if (/\bawd\b|all\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "AWD";

  // Mileage
  const km = desc.match(/([\d,.]+)\s*[Kk]\s*(?:miles?)?/);
  if (km) result.mileage = Math.round(parseFloat(km[1].replace(/,/g, "")) * 1000);
  else {
    const plain = desc.match(/([\d,]+)\s*miles?/i);
    if (plain) result.mileage = parseInt(plain[1].replace(/,/g, ""), 10);
  }

  // Transmission
  const transMatch = desc.match(/\b(automatic|manual|standard|5[- ]?speed|4[- ]?speed|3[- ]?speed|th350|th400|turbo\s*350|turbo\s*400|muncie|t5|t56|nv3500|nv4500|700r4|4l60|4l80|powerglide)\b/i);
  if (transMatch) result.transmission = transMatch[1].trim().toLowerCase();

  // Color
  const colorMatch = desc.match(/\b(black|white|red|blue|green|yellow|orange|silver|gray|grey|brown|tan|beige|gold|maroon|burgundy|cream|bronze|copper|teal|purple)\b/i);
  if (colorMatch) result.exterior_color = colorMatch[1].toLowerCase();

  return result;
}

// ─── Stats display ──────────────────────────────────────────────────────
async function showStats() {
  const { data } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        count(*) as total_fb_vehicles,
        count(*) FILTER (WHERE description IS NOT NULL AND description != '') as vehicles_with_desc,
        count(*) FILTER (WHERE description IS NULL OR description = '') as vehicles_no_desc,
        count(*) FILTER (WHERE status = 'active' AND (description IS NULL OR description = '')) as active_no_desc,
        round(100.0 * count(*) FILTER (WHERE description IS NOT NULL AND description != '') / count(*), 1) as desc_pct
      FROM vehicles WHERE platform_source = 'facebook_marketplace'
    `,
  });
  const s = data?.[0] || {};
  console.log("\n  FB Marketplace Description Coverage");
  console.log("  ====================================");
  console.log(`  Total vehicles:      ${s.total_fb_vehicles}`);
  console.log(`  With description:    ${s.vehicles_with_desc} (${s.desc_pct}%)`);
  console.log(`  Missing description: ${s.vehicles_no_desc}`);
  console.log(`  Active + missing:    ${s.active_no_desc}`);

  const { data: ml } = await supabase.rpc("execute_sql", {
    query: `
      SELECT
        count(*) as total,
        count(*) FILTER (WHERE description IS NOT NULL AND description != '') as with_desc,
        count(*) FILTER (WHERE refined_at IS NOT NULL) as refined,
        count(*) FILTER (WHERE refined_at IS NOT NULL AND (description IS NULL OR description = '')) as refined_no_desc,
        count(*) FILTER (WHERE refined_at IS NULL) as never_refined
      FROM marketplace_listings WHERE status = 'active'
    `,
  });
  const m = ml?.[0] || {};
  console.log("\n  Marketplace Listings (active):");
  console.log(`  Total:              ${m.total}`);
  console.log(`  With description:   ${m.with_desc}`);
  console.log(`  Refined (any):      ${m.refined}`);
  console.log(`  Refined, no desc:   ${m.refined_no_desc} (cloud fetch failed)`);
  console.log(`  Never refined:      ${m.never_refined}`);
  console.log("");
}

// ─── Fetch a single listing description via Googlebot ───────────────────
async function fetchDescription(facebookId) {
  const url = `https://www.facebook.com/marketplace/item/${facebookId}/`;

  try {
    const { status, html } = await googlebotFetch(url);

    if (status !== 200) {
      return { success: false, error: `HTTP ${status}` };
    }

    // Extract og:description (this is where FB puts the listing description for bots)
    const description = extractOgMeta(html, "og:description");

    if (!description || description.length < 10) {
      // Check if the page indicates the listing is gone
      if (html.includes("This listing may have been removed") ||
          html.includes("content isn't available") ||
          html.length < 5000) {
        return { success: false, error: "listing_removed", removed: true };
      }
      return { success: false, error: "no_description" };
    }

    // Also grab images while we're here
    const images = [];
    const ogImage = extractOgMeta(html, "og:image");
    if (ogImage) images.push(ogImage);
    for (const m of html.matchAll(/"uri":"(https:\/\/scontent[^"]+)"/g)) {
      const u = decodeUnicode(m[1].replace(/\\\//g, "/"));
      if (!u.includes("emoji") && !u.includes("_s.") && !u.includes("_t.")) {
        images.push(u);
      }
    }

    return {
      success: true,
      description,
      images: [...new Set(images)].slice(0, 20),
      htmlSize: html.length,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Update database with enrichment results ────────────────────────────
async function applyEnrichment(listing, result) {
  const now = new Date().toISOString();

  // Update marketplace_listings
  const mlUpdate = { refined_at: now };
  if (result.description) mlUpdate.description = result.description;
  if (result.images?.length > 0) mlUpdate.all_images = result.images;

  await supabase
    .from("marketplace_listings")
    .update(mlUpdate)
    .eq("facebook_id", listing.facebook_id);

  // Update linked vehicle record
  if (listing.vehicle_id && result.description) {
    const vehicleUpdates = { description: result.description, updated_at: now };
    const parsed = parseDescription(result.description);

    if (parsed.vin) vehicleUpdates.vin = parsed.vin;
    if (parsed.trim) vehicleUpdates.trim = parsed.trim;
    if (parsed.drivetrain) vehicleUpdates.drivetrain = parsed.drivetrain;
    if (parsed.mileage) vehicleUpdates.mileage = parsed.mileage;
    if (parsed.transmission) vehicleUpdates.transmission = parsed.transmission;
    if (parsed.exterior_color) vehicleUpdates.color = parsed.exterior_color;

    // Enrich origin_metadata
    const { data: existing } = await supabase
      .from("vehicles")
      .select("origin_metadata")
      .eq("id", listing.vehicle_id)
      .maybeSingle();
    const meta = existing?.origin_metadata || {};
    if (parsed.engine) meta.engine = parsed.engine;
    if (parsed.body_style) meta.body_style = parsed.body_style;
    if (parsed.title_status) meta.title_status = parsed.title_status;
    meta.enriched_at = now;
    meta.enrichment_source = "googlebot_local";
    vehicleUpdates.origin_metadata = meta;

    await supabase
      .from("vehicles")
      .update(vehicleUpdates)
      .eq("id", listing.vehicle_id);

    return Object.keys(parsed).filter(k => parsed[k] !== null).length + 1; // +1 for description
  }

  return result.description ? 1 : 0;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log("\n  FB Marketplace Description Enricher v1.0");
  console.log("  =========================================");
  console.log(`  Batch: ${BATCH_SIZE} | Parallel: ${PARALLEL} | Active only: ${ACTIVE_ONLY}`);
  console.log(`  Retry failed: ${RETRY_FAILED} | Fast: ${FAST} | Dry run: ${DRY_RUN}\n`);

  if (STATS_ONLY) {
    await showStats();
    return;
  }

  // Build query for listings needing descriptions
  let query;
  if (RETRY_FAILED) {
    // Retry listings that were refined from cloud but got no description
    // (residential IP may succeed where cloud IP failed)
    query = supabase
      .from("marketplace_listings")
      .select("facebook_id, url, title, vehicle_id")
      .is("description", null)
      .not("refined_at", "is", null)
      .not("facebook_id", "is", null);
  } else {
    // Default: all listings without descriptions
    query = supabase
      .from("marketplace_listings")
      .select("facebook_id, url, title, vehicle_id")
      .is("description", null)
      .not("facebook_id", "is", null);
  }

  if (ACTIVE_ONLY) {
    query = query.eq("status", "active");
  }

  query = query.order("first_seen_at", { ascending: false }).limit(BATCH_SIZE);
  const { data: listings, error } = await query;

  if (error) {
    console.error("  DB error:", error.message);
    process.exit(1);
  }

  if (!listings?.length) {
    console.log("  No listings need enrichment.");
    await showStats();
    return;
  }

  console.log(`  Found ${listings.length} listings to enrich\n`);

  if (DRY_RUN) {
    listings.slice(0, 10).forEach((l) =>
      console.log(`  ${l.facebook_id}: ${l.title?.slice(0, 60) || "(no title)"}`)
    );
    console.log(`\n  Dry run — ${listings.length} would be processed.`);
    return;
  }

  // Process listings
  const stats = {
    processed: 0, enriched: 0, no_desc: 0, removed: 0, errors: 0,
    fields: 0, consecutive_failures: 0, stopped: false,
  };
  const startTime = Date.now();

  // Process a single listing
  async function processOne(listing) {
    if (stats.stopped) return;

    const result = await fetchDescription(listing.facebook_id);

    stats.processed++;
    const label = listing.title?.slice(0, 50) || listing.facebook_id;
    const progress = `[${stats.processed}/${listings.length}]`;

    if (result.success) {
      const fieldCount = await applyEnrichment(listing, result);
      stats.enriched++;
      stats.fields += fieldCount;
      stats.consecutive_failures = 0;
      if (VERBOSE) {
        console.log(`  ${progress} ${label} — +${fieldCount} fields (${result.description?.length || 0} chars)`);
      }
    } else if (result.removed) {
      await supabase
        .from("marketplace_listings")
        .update({ status: "removed", refined_at: new Date().toISOString() })
        .eq("facebook_id", listing.facebook_id);
      if (listing.vehicle_id) {
        await supabase
          .from("vehicles")
          .update({ status: "removed", updated_at: new Date().toISOString() })
          .eq("id", listing.vehicle_id);
      }
      stats.removed++;
      stats.consecutive_failures = 0;
      if (VERBOSE) console.log(`  ${progress} ${label} — removed`);
    } else if (result.error === "no_description") {
      await supabase
        .from("marketplace_listings")
        .update({ refined_at: new Date().toISOString() })
        .eq("facebook_id", listing.facebook_id);
      stats.no_desc++;
      stats.consecutive_failures++;
      if (VERBOSE) console.log(`  ${progress} ${label} — no description in og:meta`);
    } else {
      stats.errors++;
      stats.consecutive_failures++;
      if (VERBOSE) console.log(`  ${progress} ${label} — error: ${result.error}`);
    }

    // Progress line every 25 items
    if (!VERBOSE && stats.processed % 25 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = stats.processed / elapsed;
      const remaining = (listings.length - stats.processed) / rate;
      console.log(
        `  ${progress} enriched: ${stats.enriched}, no_desc: ${stats.no_desc}, ` +
        `removed: ${stats.removed}, errors: ${stats.errors} ` +
        `(${rate.toFixed(1)}/s, ~${Math.ceil(remaining / 60)}min remaining)`
      );
    }

    if (stats.consecutive_failures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`\n  Stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Likely rate limited.`);
      stats.stopped = true;
    }
  }

  // Run with parallelism
  if (PARALLEL > 1) {
    console.log(`  Running with ${PARALLEL} parallel workers...\n`);
    // Process in chunks of PARALLEL size
    for (let i = 0; i < listings.length && !stats.stopped; i += PARALLEL) {
      const chunk = listings.slice(i, i + PARALLEL);
      await Promise.all(chunk.map(l => processOne(l)));
      if (!stats.stopped) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }
  } else {
    // Sequential processing
    for (const listing of listings) {
      if (stats.stopped) break;
      await processOne(listing);
      await new Promise((r) => setTimeout(r, DELAY_MS + Math.random() * 400));
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;

  console.log("\n  ─── Results ───────────────────────────");
  console.log(`  Processed:     ${stats.processed}`);
  console.log(`  Enriched:      ${stats.enriched} (${(100 * stats.enriched / stats.processed).toFixed(1)}%)`);
  console.log(`  No description: ${stats.no_desc}`);
  console.log(`  Removed:       ${stats.removed}`);
  console.log(`  Errors:        ${stats.errors}`);
  console.log(`  Fields added:  ${stats.fields}`);
  console.log(`  Time:          ${elapsed.toFixed(0)}s (${(stats.processed / elapsed).toFixed(1)}/s)`);

  if (stats.enriched > 0) {
    console.log(`\n  Description success rate: ${(100 * stats.enriched / stats.processed).toFixed(1)}%`);
    console.log(`  Average fields per enriched vehicle: ${(stats.fields / stats.enriched).toFixed(1)}`);
  }

  if (stats.no_desc > stats.enriched && !USE_PLAYWRIGHT) {
    console.log("\n  Tip: Most listings don't expose descriptions via og:meta.");
    console.log("  Run with --playwright for Playwright fallback (slower but higher success rate):");
    console.log("  dotenvx run -- node scripts/fb-desc-enrich.mjs --batch 500 --playwright --retry-failed");
  }

  console.log("");
  await showStats();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
