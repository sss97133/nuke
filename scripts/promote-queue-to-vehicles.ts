#!/usr/bin/env npx tsx
/**
 * PROMOTE IMPORT QUEUE TO VEHICLES
 *
 * Takes pending import_queue records that already have year/make/model
 * (from sitemap ingestion) and creates vehicle entries directly.
 * Doesn't need to scrape individual pages - the metadata is sufficient.
 *
 * For Mecum/Barrett-Jackson/Gooding where we got data from sitemaps.
 *
 * Usage:
 *   npx tsx scripts/promote-queue-to-vehicles.ts                    # All pending with metadata
 *   npx tsx scripts/promote-queue-to-vehicles.ts --source mecum     # Only Mecum
 *   npx tsx scripts/promote-queue-to-vehicles.ts --batch 500        # Process 500 at a time
 *   npx tsx scripts/promote-queue-to-vehicles.ts --loop             # Keep processing
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const sourceFilter = args.includes("--source") ? args[args.indexOf("--source") + 1] : null;
const batchSize = args.includes("--batch") ? parseInt(args[args.indexOf("--batch") + 1]) : 200;
const loop = args.includes("--loop");

function detectPlatform(url: string): string {
  if (url.includes("mecum")) return "mecum";
  if (url.includes("barrett-jackson")) return "barrett-jackson";
  if (url.includes("gooding")) return "gooding";
  if (url.includes("craigslist")) return "craigslist";
  if (url.includes("ksl")) return "ksl";
  if (url.includes("ebay")) return "ebay";
  if (url.includes("bringatrailer")) return "bat";
  return "other";
}

async function processBatch(): Promise<number> {
  // Get pending records that have year/make/model data
  let query = supabase
    .from("import_queue")
    .select("id, listing_url, listing_title, listing_year, listing_make, listing_model, listing_price, thumbnail_url, raw_data")
    .eq("status", "pending")
    .not("listing_year", "is", null)
    .not("listing_make", "is", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (sourceFilter) {
    query = query.ilike("listing_url", `%${sourceFilter}%`);
  }

  const { data: items, error } = await query;

  if (error) {
    console.error("Query error:", error.message);
    return 0;
  }

  if (!items || items.length === 0) return 0;

  let created = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const platform = detectPlatform(item.listing_url);

      // Check if vehicle already exists by URL
      const { data: existing } = await supabase
        .from("vehicles")
        .select("id")
        .eq("listing_url", item.listing_url)
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Already exists, mark as complete
        await supabase
          .from("import_queue")
          .update({ status: "complete", vehicle_id: existing.id, processed_at: new Date().toISOString() })
          .eq("id", item.id);
        skipped++;
        continue;
      }

      // Create vehicle
      const { data: vehicle, error: insertError } = await supabase
        .from("vehicles")
        .insert({
          year: item.listing_year,
          make: item.listing_make,
          model: item.listing_model,
          listing_url: item.listing_url,
          sale_price: item.listing_price || null,
          source: platform,
          notes: `${item.listing_title || ""} | ${item.raw_data?.ingested_via || "feed_poll"}`,
        })
        .select("id")
        .single();

      if (insertError) {
        // Might be duplicate on some other constraint
        if (insertError.message.includes("duplicate")) {
          await supabase
            .from("import_queue")
            .update({ status: "complete", processed_at: new Date().toISOString() })
            .eq("id", item.id);
          skipped++;
        } else {
          await supabase
            .from("import_queue")
            .update({ status: "failed", error_message: insertError.message })
            .eq("id", item.id);
        }
        continue;
      }

      // Mark queue item as complete
      await supabase
        .from("import_queue")
        .update({
          status: "complete",
          vehicle_id: vehicle.id,
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      created++;
    } catch (e: any) {
      await supabase
        .from("import_queue")
        .update({ status: "failed", error_message: e.message })
        .eq("id", item.id);
    }
  }

  return created + skipped;
}

async function main() {
  console.log("🚀 Promote Import Queue → Vehicles");
  console.log(`   Source: ${sourceFilter || "all"} | Batch: ${batchSize} | Loop: ${loop}\n`);

  let totalProcessed = 0;
  let iteration = 0;

  do {
    iteration++;
    const startTime = Date.now();
    const processed = await processBatch();

    if (processed === 0) {
      if (loop) {
        console.log(`  [${iteration}] Nothing pending. Waiting 30s...`);
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      break;
    }

    totalProcessed += processed;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  [${iteration}] Processed ${processed} records (${elapsed}s) | Total: ${totalProcessed}`);

    // Brief pause between batches
    await new Promise((r) => setTimeout(r, 500));
  } while (loop || totalProcessed < 100000);

  console.log(`\n📊 Done: ${totalProcessed} records processed\n`);
}

main().catch(console.error);
