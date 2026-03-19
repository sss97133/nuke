/**
 * Batch Enrich Facebook Saved Vehicles
 *
 * Matches facebook_ids from the saved page extraction to existing DB records,
 * then visits each FB Marketplace listing page to extract full details:
 * specs, description, location, and images.
 *
 * Prerequisites:
 *   - Export FB cookies from your browser (cookie file at data/fb-cookies.txt)
 *   - Run the fb-saved-extractor.js on facebook.com/saved first
 *   - Save the output to data/fb-saved-ids.json
 *
 * Usage:
 *   dotenvx run -- node scripts/enrich-fb-saved-batch.mjs
 *   dotenvx run -- node scripts/enrich-fb-saved-batch.mjs --dry-run
 *   dotenvx run -- node scripts/enrich-fb-saved-batch.mjs --limit 10
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const idx = process.argv.indexOf("--limit");
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : Infinity;
})();

// ─── Supabase ────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(supabaseUrl, supabaseKey);

// ─── Load facebook_id mapping ────────────────────────────────
const idsPath = resolve(__dirname, "../data/fb-saved-ids.json");
if (!existsSync(idsPath)) {
  // Try Downloads folder
  const altPath = resolve(process.env.HOME, "Downloads/fb-saved-ids.json");
  if (!existsSync(altPath)) {
    console.error("No fb-saved-ids.json found. Run the extractor on facebook.com/saved first.");
    process.exit(1);
  }
  // Copy to data/
  execSync(`cp "${altPath}" "${idsPath}"`);
}
const fbVehicles = JSON.parse(readFileSync(idsPath, "utf-8"));
console.log(`Loaded ${fbVehicles.length} facebook_ids from saved page\n`);

// ─── Cookie file for curl ────────────────────────────────────
const cookiePath = resolve(__dirname, "../data/fb-cookies.txt");
const hasCookies = existsSync(cookiePath);
if (!hasCookies) {
  console.warn("⚠ No data/fb-cookies.txt found. Will try without cookies (may fail for some pages).");
  console.warn("  Export cookies from your browser using a cookie export extension.\n");
}

// ─── Title matching ──────────────────────────────────────────
function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[·•—–|,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Parse listing HTML for vehicle data ─────────────────────
function parseListingHtml(html, facebookId) {
  const data = {
    facebook_id: facebookId,
    url: `https://www.facebook.com/marketplace/item/${facebookId}/`,
  };

  // Try relay store JSON first
  const titleMatch = html.match(/"marketplace_listing_title"\s*:\s*"([^"]+)"/);
  if (titleMatch) data.title = titleMatch[1].replace(/\\u[\da-f]{4}/gi, m =>
    String.fromCharCode(parseInt(m.slice(2), 16)));

  const priceMatch = html.match(/"listing_price"\s*:\s*\{[^}]*"amount"\s*:\s*"([\d.]+)"/);
  if (priceMatch) data.price = parseFloat(priceMatch[1]);

  const cityMatch = html.match(/"location_city"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  const stateMatch = html.match(/"location_state"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (cityMatch) data.location = cityMatch[1] + (stateMatch ? `, ${stateMatch[1]}` : "");

  // Mileage
  const mileageMatch = html.match(/Driven\s+([\d,]+)\s*miles/i) ||
    html.match(/"mileage"\s*:\s*\{[^}]*"value"\s*:\s*"?(\d+)/);
  if (mileageMatch) data.mileage = parseInt(mileageMatch[1].replace(/,/g, ""), 10);

  // Transmission
  const transMatch = html.match(/(Automatic|Manual|CVT)\s*transmission/i) ||
    html.match(/"transmission"\s*:\s*"([^"]+)"/);
  if (transMatch) data.transmission = transMatch[1];

  // Colors
  const extColorMatch = html.match(/Exterior color:\s*(\w+)/i) ||
    html.match(/"exterior_color"\s*:\s*"([^"]+)"/);
  if (extColorMatch) data.exterior_color = extColorMatch[1];

  const intColorMatch = html.match(/Interior color:\s*(\w+)/i) ||
    html.match(/"interior_color"\s*:\s*"([^"]+)"/);
  if (intColorMatch) data.interior_color = intColorMatch[1];

  // Fuel type
  const fuelMatch = html.match(/Fuel type:\s*(\w+)/i) ||
    html.match(/"fuel_type"\s*:\s*"([^"]+)"/);
  if (fuelMatch) data.fuel_type = fuelMatch[1];

  // Title status
  if (/clean title/i.test(html)) data.title_status = "clean";
  else if (/salvage/i.test(html)) data.title_status = "salvage";

  // Description
  const descMatch = html.match(/"redacted_description"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{10,})"/);
  if (descMatch) data.description = descMatch[1]
    .replace(/\\n/g, "\n").replace(/\\u[\da-f]{4}/gi, m =>
      String.fromCharCode(parseInt(m.slice(2), 16)));

  // Seller
  const sellerMatch = html.match(/"marketplace_listing_seller"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
  if (sellerMatch) data.seller_name = sellerMatch[1];

  // Sold status
  if (/"is_sold"\s*:\s*true/.test(html)) data.is_sold = true;

  // Image URLs from relay store
  const imageUrls = [];
  const imgRegex = /scontent[^"]*\.(?:jpg|jpeg|png|webp)/g;
  let imgMatch;
  const seenBases = new Set();
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const fullUrl = "https://" + imgMatch[0].replace(/\\\//g, "/");
    const base = fullUrl.split("?")[0];
    if (!seenBases.has(base) && !base.includes("emoji") && !base.includes("profile") && !base.includes("rsrc")) {
      seenBases.add(base);
      imageUrls.push(fullUrl);
    }
  }
  data.image_urls = imageUrls.slice(0, 20);

  return data;
}

// ─── Download and upload image ───────────────────────────────
async function downloadAndUploadImage(imageUrl, vehicleId, index) {
  const filename = `${vehicleId}/fb-saved-${String(index).padStart(2, "0")}.jpg`;
  const tmpPath = `/tmp/fb-enrich-${vehicleId}-${index}.jpg`;

  try {
    // Download
    const cookieFlag = hasCookies ? `-b "${cookiePath}"` : "";
    execSync(
      `curl -sL ${cookieFlag} -o "${tmpPath}" "${imageUrl}"`,
      { timeout: 15000 }
    );

    const stat = execSync(`stat -f%z "${tmpPath}"`).toString().trim();
    const size = parseInt(stat, 10);
    if (size < 1000) {
      execSync(`rm -f "${tmpPath}"`);
      return null;
    }

    // Upload to Supabase storage
    const uploadUrl = `${supabaseUrl}/storage/v1/object/vehicle-photos/${filename}`;
    const result = execSync(
      `curl -s -o /dev/null -w "%{http_code}" -X POST "${uploadUrl}" ` +
      `-H "Authorization: Bearer ${supabaseKey}" ` +
      `-H "Content-Type: image/jpeg" ` +
      `-H "x-upsert: true" ` +
      `--data-binary "@${tmpPath}"`,
      { timeout: 15000 }
    ).toString().trim();

    execSync(`rm -f "${tmpPath}"`);

    if (result === "200") {
      return `${supabaseUrl}/storage/v1/object/public/vehicle-photos/${filename}`;
    }
    return null;
  } catch (e) {
    execSync(`rm -f "${tmpPath}"`, { stdio: "ignore" }).toString?.();
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log(`=== FB Saved Batch Enrichment ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  // 1. Get all facebook-saved vehicles from DB
  const { data: dbVehicles, error } = await sb
    .from("vehicles")
    .select("id, year, make, model, asking_price, listing_title, mileage, primary_image_url")
    .eq("source", "facebook-saved")
    .order("asking_price", { ascending: false, nullsFirst: false });

  if (error) { console.error("DB query error:", error.message); process.exit(1); }
  console.log(`DB has ${dbVehicles.length} facebook-saved vehicles`);

  // 2. Match facebook_ids to DB records by normalized title + price
  const matches = [];
  const dbByKey = new Map();
  for (const v of dbVehicles) {
    const key = normalizeTitle(v.listing_title) + "|" + (v.asking_price || "");
    dbByKey.set(key, v);
  }

  for (const fbv of fbVehicles) {
    const key = normalizeTitle(fbv.title) + "|" + (fbv.price || "");
    const dbMatch = dbByKey.get(key);
    if (dbMatch) {
      matches.push({ ...fbv, vehicle_id: dbMatch.id, db: dbMatch });
    }
  }

  console.log(`Matched ${matches.length} of ${fbVehicles.length} to DB records`);

  // Filter to those needing enrichment (no images yet)
  const needsEnrichment = matches.filter(m => !m.db.primary_image_url);
  console.log(`${needsEnrichment.length} need enrichment (no primary image)\n`);

  const toProcess = needsEnrichment.slice(0, LIMIT);
  console.log(`Processing ${toProcess.length} vehicles...\n`);

  if (DRY_RUN) {
    for (const v of toProcess.slice(0, 10)) {
      console.log(`  Would enrich: ${v.title} (${v.facebook_id}) -> ${v.vehicle_id}`);
    }
    console.log(`\n  ... and ${Math.max(0, toProcess.length - 10)} more`);
    return;
  }

  // 3. Process each vehicle
  let enriched = 0, failed = 0, imagesUploaded = 0;
  const progressPath = resolve(__dirname, "../data/fb-enrich-progress.json");
  const processed = new Set();
  if (existsSync(progressPath)) {
    const prev = JSON.parse(readFileSync(progressPath, "utf-8"));
    prev.forEach(id => processed.add(id));
    console.log(`Resuming: ${processed.size} already processed\n`);
  }

  for (let i = 0; i < toProcess.length; i++) {
    const v = toProcess[i];
    if (processed.has(v.facebook_id)) continue;

    const pct = ((i / toProcess.length) * 100).toFixed(1);
    process.stdout.write(`[${pct}%] ${i + 1}/${toProcess.length} ${v.title}...`);

    try {
      // Fetch the listing page HTML
      const cookieFlag = hasCookies ? `-b "${cookiePath}"` : "";
      const html = execSync(
        `curl -sL ${cookieFlag} -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" ` +
        `"https://www.facebook.com/marketplace/item/${v.facebook_id}/"`,
        { timeout: 20000, maxBuffer: 5 * 1024 * 1024 }
      ).toString();

      if (html.length < 1000 || html.includes("login_form")) {
        process.stdout.write(" SKIP (login required)\n");
        failed++;
        continue;
      }

      // Parse the HTML
      const listing = parseListingHtml(html, v.facebook_id);

      // Update vehicle record with extracted specs
      const updates = {};
      if (listing.mileage && !v.db.mileage) updates.mileage = listing.mileage;
      if (listing.transmission) updates.transmission = listing.transmission;
      if (listing.exterior_color) updates.color = listing.exterior_color;
      if (listing.interior_color) updates.interior_color = listing.interior_color;
      if (listing.fuel_type) updates.fuel_type = listing.fuel_type;
      if (listing.location) updates.location = listing.location;
      if (listing.description) updates.description = listing.description;
      if (listing.seller_name) updates.seller_name = listing.seller_name;
      if (listing.title_status) updates.title_status = listing.title_status;
      updates.listing_url = listing.url;

      if (Object.keys(updates).length > 1) {
        await sb.from("vehicles").update(updates).eq("id", v.vehicle_id);
      }

      // Download and upload images
      let primaryUrl = null;
      const imageUrls = listing.image_urls || [];
      const maxImages = Math.min(imageUrls.length, 12);

      for (let j = 0; j < maxImages; j++) {
        const publicUrl = await downloadAndUploadImage(imageUrls[j], v.vehicle_id, j);
        if (publicUrl) {
          imagesUploaded++;
          if (j === 0) primaryUrl = publicUrl;

          await sb.from("vehicle_images").insert({
            vehicle_id: v.vehicle_id,
            image_url: publicUrl,
            is_primary: j === 0,
            source: "facebook-saved",
          });
        }
      }

      // Set primary image
      if (primaryUrl) {
        await sb.from("vehicles")
          .update({ primary_image_url: primaryUrl })
          .eq("id", v.vehicle_id);
      }

      // Insert timeline event
      await sb.from("vehicle_events").insert({
        vehicle_id: v.vehicle_id,
        source_platform: "facebook-saved",
        source_url: listing.url,
        source_listing_id: v.facebook_id,
        event_type: "listing",
        event_status: v.sold ? "sold" : "active",
        current_price: v.price || null,
        final_price: v.sold ? v.price : null,
        seller_identifier: listing.seller_name || v.seller || null,
        extraction_method: "fb-saved-batch-enrich",
        metadata: {
          title: v.title,
          location: listing.location || null,
          mileage: listing.mileage || null,
          image_count: imageUrls.length,
          images_uploaded: maxImages,
        },
      });

      processed.add(v.facebook_id);
      enriched++;
      process.stdout.write(` OK (${imageUrls.length} imgs, ${Object.keys(updates).length} fields)\n`);

      // Save progress every 10
      if (enriched % 10 === 0) {
        writeFileSync(progressPath, JSON.stringify([...processed]));
      }

      // Rate limit: 2s between requests to be gentle
      await new Promise(r => setTimeout(r, 2000));

    } catch (e) {
      process.stdout.write(` ERROR: ${e.message.slice(0, 60)}\n`);
      failed++;
    }
  }

  // Save final progress
  writeFileSync(progressPath, JSON.stringify([...processed]));

  console.log(`\n=== Done ===`);
  console.log(`Enriched: ${enriched}`);
  console.log(`Failed: ${failed}`);
  console.log(`Images uploaded: ${imagesUploaded}`);

  // Also insert timeline events for already-matched vehicles that don't have events yet
  console.log(`\nInserting timeline events for all matched vehicles...`);
  let eventsInserted = 0;
  for (const m of matches) {
    // Check if event already exists
    const { data: existing } = await sb
      .from("vehicle_events")
      .select("id")
      .eq("vehicle_id", m.vehicle_id)
      .eq("source_platform", "facebook-saved")
      .limit(1);

    if (existing && existing.length > 0) continue;

    await sb.from("vehicle_events").insert({
      vehicle_id: m.vehicle_id,
      source_platform: "facebook-saved",
      source_url: `https://www.facebook.com/marketplace/item/${m.facebook_id}/`,
      source_listing_id: m.facebook_id,
      event_type: "listing",
      event_status: m.sold ? "sold" : "active",
      current_price: m.price || null,
      final_price: m.sold ? m.price : null,
      extraction_method: "fb-saved-batch-enrich",
      metadata: { title: m.title },
    });
    eventsInserted++;
  }
  console.log(`Timeline events inserted: ${eventsInserted}`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
