/**
 * Rescue FB CDN Primary Images
 *
 * Downloads expiring Facebook CDN primary_image_urls to Supabase storage.
 * FB CDN URLs (fbcdn.net/scontent) expire in 24-48h via `oe=` hex timestamp.
 * 2,314 active vehicles have these URLs, 2,132 with no backup.
 *
 * Usage:
 *   dotenvx run -- node scripts/rescue-fb-cdn-images.mjs [--dry-run] [--limit 100]
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1] || "0")
  : 0;
const BATCH_SIZE = 50;

const stats = { total: 0, rescued: 0, expired: 0, errors: 0, skipped: 0 };

async function downloadAndStore(sourceUrl, vehicleId) {
  try {
    const resp = await fetch(sourceUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : "jpg";
    const buffer = Buffer.from(await resp.arrayBuffer());

    if (buffer.length < 5000) return null;

    const storagePath = `${vehicleId}/fb-rescued/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("vehicle-photos")
      .upload(storagePath, buffer, { contentType, upsert: false });

    if (uploadErr) {
      if (!uploadErr.message?.includes("already exists")) return null;
    }

    const { data: pubData } = supabase.storage
      .from("vehicle-photos")
      .getPublicUrl(storagePath);

    return pubData?.publicUrl || null;
  } catch {
    return null;
  }
}

async function run() {
  console.log(
    `\n=== FB CDN Image Rescue ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`,
  );

  // Fetch affected vehicle IDs via RPC (LIKE on large table times out via REST)
  const { data: idRows, error: idErr } = await supabase.rpc("execute_sql_readonly", {
    query_text: `SELECT id, primary_image_url, year, make, model
     FROM vehicles
     WHERE status = 'active'
       AND (primary_image_url LIKE '%fbcdn.net%' OR primary_image_url LIKE '%scontent-%')
     ORDER BY id
     ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}`,
  });

  // Fallback: paginated fetch if RPC doesn't exist
  let vehicles;
  if (idErr) {
    console.log("RPC unavailable, using paginated fetch...");
    vehicles = [];
    let cursor = "00000000-0000-0000-0000-000000000000";
    const PAGE = 500;
    while (true) {
      const { data: page, error: pageErr } = await supabase
        .from("vehicles")
        .select("id, primary_image_url, year, make, model")
        .eq("status", "active")
        .gt("id", cursor)
        .order("id")
        .limit(PAGE);
      if (pageErr) { console.error("Page error:", pageErr.message); break; }
      if (!page || page.length === 0) break;
      for (const v of page) {
        if (v.primary_image_url?.includes("fbcdn.net") || v.primary_image_url?.includes("scontent-")) {
          vehicles.push(v);
        }
      }
      cursor = page[page.length - 1].id;
      if (page.length < PAGE) break;
      if (LIMIT > 0 && vehicles.length >= LIMIT) { vehicles = vehicles.slice(0, LIMIT); break; }
    }
  } else {
    vehicles = idRows || [];
  }

  stats.total = vehicles.length;
  console.log(`Found ${stats.total} vehicles with FB CDN primary images\n`);

  if (DRY_RUN) {
    for (const v of vehicles.slice(0, 10)) {
      console.log(`  ${v.year} ${v.make} ${v.model} (${v.id})`);
      console.log(`    ${v.primary_image_url?.substring(0, 80)}...`);
    }
    if (vehicles.length > 10)
      console.log(`  ... and ${vehicles.length - 10} more`);
    console.log("\nDry run complete. Use without --dry-run to execute.");
    return;
  }

  // Process in batches
  for (let i = 0; i < vehicles.length; i += BATCH_SIZE) {
    const batch = vehicles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (v) => {
        const storedUrl = await downloadAndStore(
          v.primary_image_url,
          v.id,
        );

        if (storedUrl) {
          // Update primary_image_url to stored version
          const { error: updateErr } = await supabase
            .from("vehicles")
            .update({ primary_image_url: storedUrl })
            .eq("id", v.id);

          if (updateErr) {
            console.error(`  ERR update ${v.id}: ${updateErr.message}`);
            stats.errors++;
            return;
          }

          // Insert vehicle_images row for the rescued image
          await supabase.from("vehicle_images").insert({
            vehicle_id: v.id,
            image_url: storedUrl,
            source: "fb_marketplace",
            source_url: v.primary_image_url,
            is_primary: true,
          });

          stats.rescued++;
        } else {
          // Image already expired or unreachable — null out the broken URL
          const { error: nullErr } = await supabase
            .from("vehicles")
            .update({ primary_image_url: null })
            .eq("id", v.id);

          if (nullErr) {
            console.error(`  ERR null ${v.id}: ${nullErr.message}`);
            stats.errors++;
            return;
          }
          stats.expired++;
        }
      }),
    );

    const batchErrors = results.filter((r) => r.status === "rejected").length;
    stats.errors += batchErrors;

    const progress = Math.min(i + BATCH_SIZE, vehicles.length);
    console.log(
      `[${progress}/${stats.total}] rescued=${stats.rescued} expired=${stats.expired} errors=${stats.errors}`,
    );

    // Brief pause between batches
    if (i + BATCH_SIZE < vehicles.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Total:   ${stats.total}`);
  console.log(`Rescued: ${stats.rescued}`);
  console.log(`Expired: ${stats.expired}`);
  console.log(`Errors:  ${stats.errors}`);
}

run().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
