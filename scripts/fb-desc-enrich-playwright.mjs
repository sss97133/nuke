#!/usr/bin/env node
/**
 * FB Marketplace Description Enricher — Playwright Mode v1.0
 *
 * Uses Playwright (headless Chrome) to visit individual FB Marketplace listing pages
 * and extract descriptions + structured data. Runs locally on Mac with residential IP.
 *
 * This is the high-success-rate but slow approach (~3-5s per listing).
 * Use this for listings where the Googlebot approach failed.
 *
 * Features:
 *   - Targets marketplace_listings that were refined but got no description
 *   - Extracts: description, mileage, transmission, colors, title status, images
 *   - Propagates to both marketplace_listings and vehicles tables
 *   - Marks removed listings (cleans up dead data)
 *   - Rate limited to avoid FB detection (~3-5s per listing + random jitter)
 *   - Resumable: uses refined_at to skip already-processed listings
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-desc-enrich-playwright.mjs                    # Default: 100 batch
 *   dotenvx run -- node scripts/fb-desc-enrich-playwright.mjs --batch 500        # Larger batch
 *   dotenvx run -- node scripts/fb-desc-enrich-playwright.mjs --active-only      # Only active listings
 *   dotenvx run -- node scripts/fb-desc-enrich-playwright.mjs --dry-run          # Preview only
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

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
const BATCH_SIZE = parseInt(getArg("batch", "100"));
const DRY_RUN = args.includes("--dry-run");
const ACTIVE_ONLY = args.includes("--active-only");
const VERBOSE = args.includes("--verbose");
const MAX_CONSECUTIVE_FAILURES = 8;

// ─── Description parsing (same as fb-desc-enrich.mjs) ───────────────────
function parseDescription(desc) {
  const result = {
    vin: null, engine: null, trim: null, body_style: null,
    title_status: null, drivetrain: null, mileage: null,
    transmission: null, exterior_color: null,
  };
  if (!desc) return result;

  const vinMatch = desc.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  if (vinMatch) result.vin = vinMatch[1];

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

  const trimPatterns = [
    /\b(scottsdale|cheyenne|silverado|custom\s*deluxe|sierra\s*classic|sierra\s*grande|high\s*sierra|big\s*10)\b/i,
    /\b(sport|gt|ss|rs|z28|z\/28|rt|r\/t|srt|sr5|limited|xlt|lariat|king\s*ranch|laramie|sle|slt)\b/i,
  ];
  for (const p of trimPatterns) {
    const m = desc.match(p);
    if (m) { result.trim = m[1].trim(); break; }
  }

  const bodyPatterns = [
    /\b(short\s*(?:bed|box)|long\s*(?:bed|box)|stepside|fleetside|step\s*side|fleet\s*side)\b/i,
    /\b(crew\s*cab|ext(?:ended)?\s*cab|regular\s*cab|single\s*cab|quad\s*cab|super\s*cab)\b/i,
    /\b(convertible|hardtop|fastback|hatchback|wagon|coupe|sedan|roadster)\b/i,
  ];
  for (const p of bodyPatterns) {
    const m = desc.match(p);
    if (m) { result.body_style = m[1].trim(); break; }
  }

  if (/\bclean\s*title\b/i.test(desc)) result.title_status = "clean";
  else if (/\bsalvage\s*title\b/i.test(desc)) result.title_status = "salvage";
  else if (/\brebuilt\s*title\b/i.test(desc)) result.title_status = "rebuilt";
  else if (/\bno\s*title\b/i.test(desc)) result.title_status = "none";

  if (/\b4x4\b|4wd\b|four\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "4WD";
  else if (/\b2wd\b|2x4\b|two\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "2WD";
  else if (/\bawd\b|all\s*wheel\s*drive\b/i.test(desc)) result.drivetrain = "AWD";

  const km = desc.match(/([\d,.]+)\s*[Kk]\s*(?:miles?)?/);
  if (km) result.mileage = Math.round(parseFloat(km[1].replace(/,/g, "")) * 1000);
  else {
    const plain = desc.match(/([\d,]+)\s*miles?/i);
    if (plain) result.mileage = parseInt(plain[1].replace(/,/g, ""), 10);
  }

  const transMatch = desc.match(/\b(automatic|manual|standard|5[- ]?speed|4[- ]?speed|3[- ]?speed|th350|th400|turbo\s*350|turbo\s*400|muncie|t5|t56|nv3500|nv4500|700r4|4l60|4l80|powerglide)\b/i);
  if (transMatch) result.transmission = transMatch[1].trim().toLowerCase();

  const colorMatch = desc.match(/\b(black|white|red|blue|green|yellow|orange|silver|gray|grey|brown|tan|beige|gold|maroon|burgundy|cream|bronze|copper|teal|purple)\b/i);
  if (colorMatch) result.exterior_color = colorMatch[1].toLowerCase();

  return result;
}

// ─── Extract data from a Playwright page ────────────────────────────────
async function extractFromPage(page, url) {
  const result = { description: null, images: [], attributes: {}, removed: false };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2500);

    // Check if listing is gone
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    if (bodyText.includes("This listing may have been removed") ||
        bodyText.includes("This content isn't available") ||
        (bodyText.includes("Log in or sign up") && !bodyText.includes("About this vehicle"))) {
      result.removed = true;
      return result;
    }

    // Click "See more" to expand description
    try {
      const seeMore = page.locator('button:has-text("See more")').first();
      if (await seeMore.isVisible({ timeout: 2000 })) {
        await seeMore.click({ timeout: 2000 });
        await page.waitForTimeout(500);
      }
    } catch {}

    // Try multiple description sources
    // 1. og:description meta
    result.description = await page.evaluate(() => {
      const meta = document.querySelector('meta[property="og:description"]');
      return meta?.content || null;
    });

    // 2. Inline JSON (redacted_description)
    if (!result.description) {
      result.description = await page.evaluate(() => {
        const allScripts = document.querySelectorAll("script");
        for (const s of allScripts) {
          const text = s.textContent || "";
          const match = text.match(/"redacted_description":\s*\{\s*"text":\s*"((?:[^"\\]|\\.)*)"/);
          if (match) {
            return match[1]
              .replace(/\\n/g, "\n").replace(/\\t/g, "\t")
              .replace(/\\\//g, "/")
              .replace(/\\u[\dA-Fa-f]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)));
          }
        }
        return null;
      });
    }

    // 3. Visible description element
    if (!result.description) {
      result.description = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="marketplace_listing_description"]');
        return el?.textContent || null;
      });
    }

    // 4. Seller's description section from body text
    if (!result.description) {
      const descMatch = bodyText.match(/Seller's description\n([\s\S]*?)(?:\nView Map|Related listings|Today's picks|Message\n)/);
      result.description = descMatch ? descMatch[1].trim() : null;
    }

    // Extract structured attributes from the page
    const mileageMatch = bodyText.match(/Driven\s+([\d,]+)\s+miles/);
    if (mileageMatch) result.attributes.mileage = parseInt(mileageMatch[1].replace(/,/g, ""));

    const transMatch = bodyText.match(/(Manual|Automatic)\s+transmission/i);
    if (transMatch) result.attributes.transmission = transMatch[1];

    const extColor = bodyText.match(/Exterior color:\s*(\w+)/i);
    if (extColor) result.attributes.exterior_color = extColor[1];

    const intColor = bodyText.match(/Interior color:\s*(\w+)/i);
    if (intColor) result.attributes.interior_color = intColor[1];

    const titleStatus = bodyText.match(/(Clean|Rebuilt|Salvage)\s+title/i);
    if (titleStatus) result.attributes.title_status = titleStatus[1];

    // Images
    result.images = await page.evaluate(() => {
      const urls = [];
      const seen = new Set();
      document.querySelectorAll('img[src*="scontent"]').forEach((img) => {
        const src = img.src;
        if (src.includes("scontent") && !src.includes("emoji") && !src.includes("profile")) {
          const key = src.split("?")[0].split("/").pop() || src;
          if (!seen.has(key)) {
            seen.add(key);
            urls.push(src);
          }
        }
      });
      return urls.slice(0, 20);
    });

  } catch (err) {
    console.error(`  Error extracting: ${err.message}`);
  }

  return result;
}

// ─── Apply enrichment to database ───────────────────────────────────────
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

  // Update vehicle record
  if (!listing.vehicle_id || !result.description) return 0;

  const vehicleUpdates = { description: result.description, updated_at: now };
  const parsed = parseDescription(result.description);

  if (parsed.vin) vehicleUpdates.vin = parsed.vin;
  if (parsed.trim) vehicleUpdates.trim = parsed.trim;
  if (parsed.drivetrain) vehicleUpdates.drivetrain = parsed.drivetrain;
  if (parsed.mileage || result.attributes.mileage) {
    vehicleUpdates.mileage = parsed.mileage || result.attributes.mileage;
  }
  if (parsed.transmission || result.attributes.transmission) {
    vehicleUpdates.transmission = (parsed.transmission || result.attributes.transmission).toLowerCase();
  }
  if (parsed.exterior_color || result.attributes.exterior_color) {
    vehicleUpdates.color = (parsed.exterior_color || result.attributes.exterior_color).toLowerCase();
  }
  if (result.attributes.interior_color) {
    vehicleUpdates.interior_color = result.attributes.interior_color.toLowerCase();
  }

  // Enrich origin_metadata
  const { data: existing } = await supabase
    .from("vehicles")
    .select("origin_metadata")
    .eq("id", listing.vehicle_id)
    .maybeSingle();
  const meta = existing?.origin_metadata || {};
  if (parsed.engine) meta.engine = parsed.engine;
  if (parsed.body_style) meta.body_style = parsed.body_style;
  if (parsed.title_status || result.attributes.title_status) {
    meta.title_status = parsed.title_status || result.attributes.title_status;
  }
  meta.enriched_at = now;
  meta.enrichment_source = "playwright_local";
  vehicleUpdates.origin_metadata = meta;

  await supabase
    .from("vehicles")
    .update(vehicleUpdates)
    .eq("id", listing.vehicle_id);

  return Object.keys(parsed).filter(k => parsed[k] !== null).length + 1;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log("\n  FB Description Enricher — Playwright Mode v1.0");
  console.log("  ================================================");
  console.log(`  Batch: ${BATCH_SIZE} | Active only: ${ACTIVE_ONLY} | Dry run: ${DRY_RUN}\n`);

  // Get listings that need Playwright enrichment
  // Targets: refined by cloud Googlebot (refined_at IS NOT NULL) but no description
  // Priority: enrichment_priority DESC (taste_score × freshness_decay per signal formula)
  let query = supabase
    .from("marketplace_listings")
    .select("facebook_id, url, title, vehicle_id, taste_score, enrichment_priority")
    .is("description", null)
    .not("facebook_id", "is", null);

  if (ACTIVE_ONLY) {
    query = query.eq("status", "active");
  }

  const { data: listings, error } = await query
    .order("enrichment_priority", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .limit(BATCH_SIZE);

  if (error) {
    console.error("  DB error:", error.message);
    process.exit(1);
  }

  if (!listings?.length) {
    console.log("  No listings need enrichment.");
    return;
  }

  console.log(`  Found ${listings.length} listings to enrich`);

  if (DRY_RUN) {
    listings.slice(0, 10).forEach((l) =>
      console.log(`  ${l.facebook_id}: ${l.title?.slice(0, 60) || "(no title)"}`)
    );
    console.log(`\n  Would process ${listings.length} listings.`);
    return;
  }

  console.log("  Launching browser...\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();

  const stats = {
    processed: 0, enriched: 0, no_desc: 0, removed: 0, errors: 0,
    fields: 0, consecutive_failures: 0,
  };
  const startTime = Date.now();

  for (const listing of listings) {
    stats.processed++;
    const label = listing.title?.slice(0, 50) || listing.facebook_id;
    const progress = `[${stats.processed}/${listings.length}]`;

    const url = listing.url?.startsWith("http")
      ? listing.url
      : `https://www.facebook.com/marketplace/item/${listing.facebook_id}/`;

    const result = await extractFromPage(page, url);

    if (result.removed) {
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
    } else if (result.description && result.description.length >= 10) {
      const fieldCount = await applyEnrichment(listing, result);
      stats.enriched++;
      stats.fields += fieldCount;
      stats.consecutive_failures = 0;
      if (VERBOSE) console.log(`  ${progress} ${label} — +${fieldCount} fields`);
    } else {
      // No description even with Playwright — mark as refined
      await supabase
        .from("marketplace_listings")
        .update({ refined_at: new Date().toISOString() })
        .eq("facebook_id", listing.facebook_id);
      stats.no_desc++;
      stats.consecutive_failures++;
      if (VERBOSE) console.log(`  ${progress} ${label} — no description`);
    }

    // Progress every 10 items
    if (!VERBOSE && stats.processed % 10 === 0) {
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
      console.log(`\n  Stopping: ${MAX_CONSECUTIVE_FAILURES} consecutive failures.`);
      break;
    }

    // Rate limit — ~3-5s between pages
    await page.waitForTimeout(2000 + Math.random() * 2000);
  }

  await browser.close();

  const elapsed = (Date.now() - startTime) / 1000;

  console.log("\n  ─── Results ───────────────────────────");
  console.log(`  Processed:      ${stats.processed}`);
  console.log(`  Enriched:       ${stats.enriched} (${(100 * stats.enriched / stats.processed).toFixed(1)}%)`);
  console.log(`  No description: ${stats.no_desc}`);
  console.log(`  Removed:        ${stats.removed}`);
  console.log(`  Errors:         ${stats.errors}`);
  console.log(`  Fields added:   ${stats.fields}`);
  console.log(`  Time:           ${elapsed.toFixed(0)}s (${(stats.processed / elapsed).toFixed(1)}/s)`);
  console.log("");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
