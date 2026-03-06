/**
 * FB Marketplace Enricher v1.0
 *
 * Fetches individual FB Marketplace listing pages using Playwright (headless Chrome)
 * from a residential IP, extracts descriptions and additional detail, then updates
 * both marketplace_listings and the linked vehicles record.
 *
 * Why this exists:
 *   FB's GraphQL search endpoint stopped returning redacted_description in late Feb 2026.
 *   Individual listing pages require a real browser (curl/bingbot get blocked).
 *   This script runs locally on the Mac where residential IP passes FB's checks.
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-marketplace-enricher.mjs [--batch 50] [--dry-run]
 *   dotenvx run -- node scripts/fb-marketplace-enricher.mjs --facebook-id 1812163006155551
 */

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const BATCH_SIZE = args.includes("--batch")
  ? parseInt(args[args.indexOf("--batch") + 1] || "50")
  : 50;
const DRY_RUN = args.includes("--dry-run");
const SINGLE_ID = args.includes("--facebook-id")
  ? args[args.indexOf("--facebook-id") + 1]
  : null;

// ─── Description parser (mirrors edge function logic) ────────────────────

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
    /\b(\d{3})\s*(motor|engine)\b/i,  // "400 motor", "350 engine"
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
  const kmMatch = desc.match(/([\d,.]+)\s*[Kk]\s*(?:miles?)?/);
  if (kmMatch) result.mileage = Math.round(parseFloat(kmMatch[1].replace(/,/g, "")) * 1000);
  else {
    const plainMatch = desc.match(/([\d,]+)\s*miles?/i);
    if (plainMatch) result.mileage = parseInt(plainMatch[1].replace(/,/g, ""), 10);
  }

  // Transmission
  const transMatch = desc.match(/\b(automatic|manual|standard|5[- ]?speed|4[- ]?speed|3[- ]?speed|th350|th400|turbo\s*350|turbo\s*400|muncie|t5|t56|nv3500|nv4500|700r4|4l60|4l80|powerglide)\b/i);
  if (transMatch) result.transmission = transMatch[1].trim().toLowerCase();

  // Color
  const colorMatch = desc.match(/\b(black|white|red|blue|green|yellow|orange|silver|gray|grey|brown|tan|beige|gold|maroon|burgundy|cream|bronze|copper|teal|purple)\b/i);
  if (colorMatch) result.exterior_color = colorMatch[1].toLowerCase();

  return result;
}

// ─── Extract listing data from Playwright page ───────────────────────────

async function extractFromPage(page, url) {
  const result = { description: null, images: [], seller: null, attributes: {} };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    // Wait for content to render
    await page.waitForTimeout(2000);

    // Try og:description meta tag first
    result.description = await page.evaluate(() => {
      const meta = document.querySelector('meta[property="og:description"]');
      return meta?.content || null;
    });

    // If no og:description, try to find it in page JSON data
    if (!result.description) {
      result.description = await page.evaluate(() => {
        // FB embeds listing data in script tags as JSON
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          try {
            const data = JSON.parse(s.textContent);
            if (data.description) return data.description;
          } catch {}
        }

        // Also try __comet_graphql payloads
        const allScripts = document.querySelectorAll("script");
        for (const s of allScripts) {
          const text = s.textContent || "";
          // Look for redacted_description in inline JSON
          const match = text.match(/"redacted_description":\s*\{\s*"text":\s*"((?:[^"\\]|\\.)*)"/);
          if (match) {
            return match[1]
              .replace(/\\n/g, "\n")
              .replace(/\\t/g, "\t")
              .replace(/\\\//g, "/")
              .replace(/\\u[\dA-Fa-f]{4}/g, (m) => String.fromCharCode(parseInt(m.slice(2), 16)));
          }
        }

        // Try the visible description element
        const descEl = document.querySelector('[data-testid="marketplace_listing_description"]');
        if (descEl) return descEl.textContent;

        return null;
      });
    }

    // Extract additional images
    result.images = await page.evaluate(() => {
      const imgs = new Set();
      document.querySelectorAll("img").forEach((img) => {
        const src = img.src || img.dataset?.src || "";
        if (src.includes("scontent") && !src.includes("emoji") && !src.includes("_s.")) {
          imgs.add(src);
        }
      });
      return [...imgs].slice(0, 20);
    });

    // Extract structured attributes (mileage, transmission, etc. from FB's own fields)
    result.attributes = await page.evaluate(() => {
      const attrs = {};
      // FB shows vehicle attributes in a structured list
      const items = document.querySelectorAll('[role="list"] [role="listitem"]');
      items.forEach((item) => {
        const text = item.textContent?.trim() || "";
        if (/miles/i.test(text)) attrs.mileage_text = text;
        if (/transmission/i.test(text)) attrs.transmission = text;
        if (/drivetrain/i.test(text)) attrs.drivetrain = text;
        if (/fuel/i.test(text)) attrs.fuel_type = text;
        if (/exterior/i.test(text)) attrs.exterior_color = text;
        if (/interior/i.test(text)) attrs.interior_color = text;
        if (/title/i.test(text)) attrs.title_status = text;
      });
      return attrs;
    });

  } catch (err) {
    console.error(`  Error extracting ${url}: ${err.message}`);
  }

  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nFB Marketplace Enricher v1.0`);
  console.log(`Batch: ${BATCH_SIZE} | Dry run: ${DRY_RUN}\n`);

  // Get listings that need descriptions
  let query = supabase
    .from("marketplace_listings")
    .select("facebook_id, url, vehicle_id, title")
    .is("description", null)
    .eq("status", "active")
    .not("vehicle_id", "is", null)
    .order("scraped_at", { ascending: false });

  if (SINGLE_ID) {
    query = supabase
      .from("marketplace_listings")
      .select("facebook_id, url, vehicle_id, title")
      .eq("facebook_id", SINGLE_ID);
  }

  const { data: listings, error } = await query.limit(BATCH_SIZE);

  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  if (!listings?.length) {
    console.log("No listings need enrichment.");
    process.exit(0);
  }

  console.log(`Found ${listings.length} listings to enrich\n`);

  if (DRY_RUN) {
    listings.slice(0, 5).forEach((l) => console.log(`  ${l.facebook_id}: ${l.title}`));
    console.log("\nDry run — no changes made.");
    process.exit(0);
  }

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });

  const stats = { processed: 0, enriched: 0, failed: 0, fields: 0 };

  for (const listing of listings) {
    stats.processed++;
    const url = listing.url.endsWith("/") ? listing.url : listing.url + "/";

    process.stdout.write(`  [${stats.processed}/${listings.length}] ${listing.title?.slice(0, 50) || listing.facebook_id}...`);

    const page = await context.newPage();
    try {
      const extracted = await extractFromPage(page, url);

      if (!extracted.description && extracted.images.length === 0) {
        console.log(" no data");
        stats.failed++;
        continue;
      }

      // Update marketplace_listing
      const listingUpdates = { refined_at: new Date().toISOString() };
      if (extracted.description) listingUpdates.description = extracted.description;
      if (extracted.images.length > 0) listingUpdates.all_images = extracted.images;

      await supabase
        .from("marketplace_listings")
        .update(listingUpdates)
        .eq("facebook_id", listing.facebook_id);

      // Parse description and update vehicle
      if (listing.vehicle_id && extracted.description) {
        const parsed = parseDescription(extracted.description);
        const vehicleUpdates = {};
        let fieldCount = 0;

        if (parsed.vin) { vehicleUpdates.vin = parsed.vin; fieldCount++; }
        if (parsed.trim) { vehicleUpdates.trim = parsed.trim; fieldCount++; }
        if (parsed.drivetrain) { vehicleUpdates.drivetrain = parsed.drivetrain; fieldCount++; }
        if (parsed.mileage) { vehicleUpdates.mileage = parsed.mileage; fieldCount++; }
        if (parsed.transmission) { vehicleUpdates.transmission = parsed.transmission; fieldCount++; }
        if (parsed.exterior_color) { vehicleUpdates.color = parsed.exterior_color; fieldCount++; }
        vehicleUpdates.description = extracted.description;
        fieldCount++;

        // Engine, body_style, title_status → origin_metadata
        const { data: existing } = await supabase
          .from("vehicles")
          .select("origin_metadata")
          .eq("id", listing.vehicle_id)
          .maybeSingle();
        const meta = (existing?.origin_metadata) || {};
        if (parsed.engine) { meta.engine = parsed.engine; fieldCount++; }
        if (parsed.body_style) { meta.body_style = parsed.body_style; fieldCount++; }
        if (parsed.title_status) { meta.title_status = parsed.title_status; fieldCount++; }
        meta.enriched_at = new Date().toISOString();
        meta.enrichment_source = "playwright";
        vehicleUpdates.origin_metadata = meta;

        await supabase
          .from("vehicles")
          .update(vehicleUpdates)
          .eq("id", listing.vehicle_id);

        stats.fields += fieldCount;
        console.log(` ${fieldCount} fields`);
      } else {
        console.log(` images only (${extracted.images.length})`);
      }

      stats.enriched++;
    } catch (err) {
      console.log(` error: ${err.message}`);
      stats.failed++;
    } finally {
      await page.close();
    }

    // Polite delay — don't hammer FB
    const delay = 3000 + Math.random() * 2000;
    await new Promise((r) => setTimeout(r, delay));
  }

  await browser.close();

  console.log(`\n─── Results ───`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Enriched:  ${stats.enriched}`);
  console.log(`  Failed:    ${stats.failed}`);
  console.log(`  Fields:    ${stats.fields}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
