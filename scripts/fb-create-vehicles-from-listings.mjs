#!/usr/bin/env node
/**
 * Creates vehicle records from marketplace_listings that have no vehicle_id.
 * Only processes listings with parsed_year + parsed_make (enough to identify a vehicle).
 *
 * Steps:
 *   1. Query orphaned listings with year+make
 *   2. Check for existing vehicle by FB URL (dedup)
 *   3. Create vehicle record
 *   4. Link marketplace_listing → vehicle via vehicle_id
 *   5. Download FB CDN images to Supabase storage (they expire)
 *
 * Usage:
 *   dotenvx run -- node scripts/fb-create-vehicles-from-listings.mjs [--dry-run] [--limit 50] [--skip-images]
 *   dotenvx run -- node scripts/fb-create-vehicles-from-listings.mjs --images-only [--limit 200]
 */

import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_IMAGES = process.argv.includes("--skip-images");
const IMAGES_ONLY = process.argv.includes("--images-only");
const LIMIT = parseInt(process.argv.find((a, i, arr) => arr[i - 1] === "--limit") || "500");

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Body style derivation (same as local scraper) ─────────────────────────
function deriveBodyStyle(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const patterns = [
    [/\b(pickup|pick-up|short\s*bed|long\s*bed|crew\s*cab|reg(ular)?\s*cab|ext(ended)?\s*cab|step\s*side|fleet\s*side|dually|single\s*cab)\b/, "Pickup"],
    [/\b(suv|sport\s*utility|4\s*runner|tahoe|yukon|suburban|bronco|blazer|scout|jimmy|wagoneer|land\s*cruiser|cherokee|4wd.*wagon)\b/, "SUV"],
    [/\b(sedan|saloon|4[- ]?door|four[- ]?door)\b/, "Sedan"],
    [/\bcoup[eé]\b|\b(coupe|2[- ]?door\s*hard\s*top)\b/, "Coupe"],
    [/\b(convertible|roadster|cabriolet|spider|spyder|drop\s*top|soft\s*top)\b/, "Convertible"],
    [/\b(wagon|estate|shooting\s*brake|squareback|sportwagen|avant|touring|safari|nomad)\b/, "Wagon"],
    [/\b(van|minivan|bus|kombi|transporter|vanagon|westfalia|econoline|e-?150|e-?250|e-?350|sprinter|sportsmobile)\b/, "Van"],
    [/\b(hatchback|hot\s*hatch|3[- ]?door|liftback)\b/, "Hatchback"],
  ];
  for (const [re, style] of patterns) {
    if (re.test(t)) return style;
  }
  return null;
}

// ─── Clean model string (remove unicode dots, trim) ────────────────────────
function cleanModel(model) {
  if (!model) return null;
  return model
    .replace(/[\u00b7·]/g, "")   // actual unicode middle dots
    .replace(/\\u00b7/g, "")     // literal escape sequences
    .replace(/[,]/g, "")         // commas
    .replace(/\s+/g, " ")        // collapse whitespace
    .trim() || null;
}

// ─── Download image to Supabase storage ────────────────────────────────────
async function downloadAndStoreImage(url, vehicleId, index) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length < 1000) return null; // Too small = error page

    const ext = url.includes(".png") ? "png" : "jpg";
    const path = `vehicles/${vehicleId}/${index}.${ext}`;

    const { error } = await supabase.storage
      .from("vehicle-images")
      .upload(path, buffer, {
        contentType: ext === "png" ? "image/png" : "image/jpeg",
        upsert: true,
      });

    if (error) return null;

    const { data: pub } = supabase.storage
      .from("vehicle-images")
      .getPublicUrl(path);

    return pub?.publicUrl || null;
  } catch {
    return null;
  }
}

// ─── Images-only mode ──────────────────────────────────────────────────────
async function imagesOnly() {
  console.log(`\nFB Image Downloader (limit: ${LIMIT})\n`);

  // Find vehicles linked to marketplace_listings with images but no vehicle_images
  const { data: rows, error } = await supabase.rpc("exec_sql", { query: `
    SELECT v.id as vehicle_id, ml.all_images, ml.title
    FROM vehicles v
    JOIN marketplace_listings ml ON ml.vehicle_id = v.id
    LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
    WHERE v.source = 'facebook_marketplace'
      AND ml.all_images IS NOT NULL
      AND array_length(ml.all_images, 1) > 0
      AND vi.id IS NULL
    ORDER BY v.created_at DESC
    LIMIT ${LIMIT}
  `});

  // Fallback: query without RPC
  if (error || !rows) {
    console.log("Using direct query fallback...");
    return imagesOnlyDirect();
  }

  console.log(`Found ${rows.length} vehicles needing images\n`);
  let stored = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { vehicle_id, all_images, title } = rows[i];
    const images = all_images.slice(0, 20);
    let primaryUrl = null;
    const imgRows = [];

    for (let idx = 0; idx < images.length; idx++) {
      const storedUrl = await downloadAndStoreImage(images[idx], vehicle_id, idx);
      if (!storedUrl) { failed++; continue; }
      if (idx === 0) primaryUrl = storedUrl;
      imgRows.push({
        vehicle_id,
        image_url: storedUrl,
        source_url: images[idx],
        source: "facebook_marketplace",
        display_order: idx,
        position: idx,
      });
    }

    if (imgRows.length > 0) {
      await supabase.from("vehicle_images").insert(imgRows);
      stored += imgRows.length;
      if (primaryUrl) {
        await supabase.from("vehicles").update({ primary_image_url: primaryUrl }).eq("id", vehicle_id);
      }
    }

    const label = (title || "").substring(0, 40);
    console.log(`  [${i + 1}/${rows.length}] ${imgRows.length}/${images.length} stored  ${label}`);
  }

  console.log(`\n────────────────────────────────\nImages stored: ${stored}\nFailed: ${failed}\n`);
}

async function imagesOnlyDirect() {
  // Direct approach: get FB vehicles created recently with no images
  const { data: vehicles, error: vErr } = await supabase
    .from("vehicles")
    .select("id")
    .eq("source", "facebook_marketplace")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (vErr || !vehicles?.length) { console.log("No vehicles found."); return; }

  let stored = 0, processed = 0;
  for (const v of vehicles) {
    // Check if vehicle already has images
    const { data: existingImgs } = await supabase
      .from("vehicle_images")
      .select("id")
      .eq("vehicle_id", v.id)
      .limit(1);
    if (existingImgs?.length) continue;

    // Get linked marketplace listing
    const { data: ml } = await supabase
      .from("marketplace_listings")
      .select("all_images, title")
      .eq("vehicle_id", v.id)
      .limit(1)
      .maybeSingle();
    if (!ml?.all_images?.length) continue;

    const images = ml.all_images.slice(0, 20);
    let primaryUrl = null;
    const imgRows = [];

    for (let idx = 0; idx < images.length; idx++) {
      const storedUrl = await downloadAndStoreImage(images[idx], v.id, idx);
      if (!storedUrl) continue;
      if (idx === 0) primaryUrl = storedUrl;
      imgRows.push({
        vehicle_id: v.id,
        image_url: storedUrl,
        source_url: images[idx],
        source: "facebook_marketplace",
        display_order: idx,
        position: idx,
      });
    }

    if (imgRows.length > 0) {
      await supabase.from("vehicle_images").insert(imgRows);
      stored += imgRows.length;
      if (primaryUrl) {
        await supabase.from("vehicles").update({ primary_image_url: primaryUrl }).eq("id", v.id);
      }
    }

    processed++;
    const label = (ml.title || "").substring(0, 40);
    console.log(`  [${processed}] ${imgRows.length}/${images.length} stored  ${label}`);
  }

  console.log(`\n────────────────────────────────\nImages stored: ${stored}\nVehicles processed: ${processed}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (IMAGES_ONLY) return imagesOnly();

  console.log(`\nFB Vehicle Creator (limit: ${LIMIT}, dry_run: ${DRY_RUN}, skip_images: ${SKIP_IMAGES})\n`);

  // Get orphaned listings with enough data to create a vehicle
  const { data: listings, error } = await supabase
    .from("marketplace_listings")
    .select("id, facebook_id, title, parsed_year, parsed_make, parsed_model, price, location, description, all_images, image_url, status, user_saved")
    .is("vehicle_id", null)
    .not("parsed_year", "is", null)
    .not("parsed_make", "is", null)
    .order("user_saved", { ascending: false })  // User saved first
    .order("first_seen_at", { ascending: false })
    .limit(LIMIT);

  if (error) { console.error("DB error:", error.message); process.exit(1); }
  if (!listings?.length) { console.log("No orphaned listings with year+make."); return; }

  console.log(`Found ${listings.length} orphaned listings with year+make\n`);

  let created = 0, linked = 0, skipped = 0, errors = 0, imagesStored = 0;

  for (const listing of listings) {
    const fbUrl = `https://www.facebook.com/marketplace/item/${listing.facebook_id}`;
    const model = cleanModel(listing.parsed_model);
    const fullTitle = listing.title || "";

    // Check if vehicle already exists by FB URL
    const { data: existing } = await supabase
      .from("vehicles")
      .select("id")
      .eq("listing_url", fbUrl)
      .limit(1)
      .maybeSingle();

    let vehicleId;

    if (existing) {
      vehicleId = existing.id;
      skipped++;
    } else {
      // Parse location into city/state
      let city = null, state = null;
      if (listing.location) {
        const parts = listing.location.split(",").map(s => s.trim());
        if (parts.length >= 2) {
          city = parts[0];
          state = parts[1];
        } else {
          city = parts[0];
        }
      }

      // Derive body style from full title
      const bodyStyle = deriveBodyStyle(fullTitle) || deriveBodyStyle(`${model || ""} ${listing.parsed_make}`);

      // Map FB status to vehicle status
      let vehicleStatus = "active";
      if (listing.status === "sold") vehicleStatus = "sold";
      else if (listing.status === "removed") vehicleStatus = "inactive";
      else if (listing.status === "pending") vehicleStatus = "pending";

      const insertData = {
        year: listing.parsed_year,
        make: listing.parsed_make,
        model: model,
        listing_url: fbUrl,
        asking_price: listing.price ? Math.round(listing.price) : null,
        description: listing.description || null,
        listing_location: listing.location || null,
        city: city,
        state: state,
        status: vehicleStatus,
        source: "facebook_marketplace",
        auction_source: "facebook_marketplace",
        discovery_source: "facebook_marketplace",
      };
      if (bodyStyle) insertData.body_style = bodyStyle;

      if (DRY_RUN) {
        console.log(`  [DRY] Would create: ${listing.parsed_year} ${listing.parsed_make} ${model || "?"} — $${listing.price || "?"} — ${listing.location || "?"}`);
        created++;
        continue;
      }

      const { data: newVeh, error: vehErr } = await supabase
        .from("vehicles")
        .insert(insertData)
        .select("id")
        .single();

      if (vehErr) {
        console.error(`  ERROR creating vehicle for ${listing.facebook_id}: ${vehErr.message}`);
        errors++;
        continue;
      }

      vehicleId = newVeh.id;
      created++;
    }

    // Link marketplace_listing to vehicle
    if (!DRY_RUN && vehicleId) {
      const { error: linkErr } = await supabase
        .from("marketplace_listings")
        .update({ vehicle_id: vehicleId })
        .eq("id", listing.id);

      if (linkErr) {
        console.error(`  ERROR linking listing ${listing.facebook_id}: ${linkErr.message}`);
      } else {
        linked++;
      }
    }

    // Download images to permanent storage
    if (!DRY_RUN && !SKIP_IMAGES && vehicleId && listing.all_images?.length) {
      const images = listing.all_images.slice(0, 20); // Cap at 20

      // Check existing images
      const { data: existingImgs } = await supabase
        .from("vehicle_images")
        .select("source_url, image_url")
        .eq("vehicle_id", vehicleId);

      const existingUrls = new Set((existingImgs || []).map(i => i.source_url || i.image_url));
      const newImages = images.filter(url => !existingUrls.has(url));

      if (newImages.length > 0) {
        let primaryUrl = null;
        const imgRows = [];

        for (let idx = 0; idx < newImages.length; idx++) {
          const storedUrl = await downloadAndStoreImage(newImages[idx], vehicleId, idx);
          if (!storedUrl) continue;
          if (idx === 0) primaryUrl = storedUrl;
          imgRows.push({
            vehicle_id: vehicleId,
            image_url: storedUrl,
            source_url: newImages[idx],
            source: "facebook_marketplace",
            display_order: idx,
            position: idx,
          });
        }

        if (imgRows.length > 0) {
          await supabase.from("vehicle_images").insert(imgRows);
          imagesStored += imgRows.length;

          // Set primary image on vehicle
          if (primaryUrl) {
            await supabase.from("vehicles").update({ primary_image_url: primaryUrl }).eq("id", vehicleId);
          }
        }
      }
    }

    const label = `${listing.parsed_year} ${listing.parsed_make} ${model || "?"}`.substring(0, 40);
    const priceStr = listing.price ? `$${listing.price.toLocaleString()}` : "$?";
    const imgCount = listing.all_images?.length || 0;
    const icon = existing ? "↗ linked" : "✓ created";
    console.log(`  ${icon}  ${label}  ${priceStr}  ${listing.location || ""}  [${imgCount} imgs]`);
  }

  console.log(`
────────────────────────────────
Created:  ${created}
Linked:   ${linked}
Skipped:  ${skipped} (already existed)
Images:   ${imagesStored}
Errors:   ${errors}
`);
}

main().catch(e => { console.error(e); process.exit(1); });
