#!/usr/bin/env node
/**
 * K5 Blazer Vision Analysis — Batch Runner
 *
 * Calls analyze-vehicle-image-haiku on K5 photos in small batches.
 * Uses single-image mode with rate limiting to avoid compute exhaustion.
 *
 * Usage:
 *   dotenvx run -- node scripts/vision-k5-batch.mjs                    # analyze 20 images
 *   dotenvx run -- node scripts/vision-k5-batch.mjs --batch-size 50    # analyze 50
 *   dotenvx run -- node scripts/vision-k5-batch.mjs --all              # analyze all pending
 */

const VEHICLE_ID = "e04bf9c5-b488-433b-be9a-3d307861d90b";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const bsIdx = args.indexOf("--batch-size");
const BATCH_SIZE = ALL ? 9999 : (bsIdx >= 0 ? parseInt(args[bsIdx + 1]) : 20);
const DELAY_MS = 2000; // 2 sec between images to stay under rate limits

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("=".repeat(70));
  console.log("K5 Blazer Vision Analysis — Haiku Batch");
  console.log(`Batch size: ${ALL ? "ALL" : BATCH_SIZE}`);
  console.log("=".repeat(70));

  // Get pending images with accessible URLs
  const headers = { Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", apikey: SUPABASE_KEY };

  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicle_images?vehicle_id=eq.${VEHICLE_ID}&ai_processing_status=eq.pending&select=id,image_url,storage_path&limit=${BATCH_SIZE}&order=created_at`,
    { headers }
  );
  const images = await listRes.json();
  console.log(`\nPending images: ${images.length}`);

  if (images.length === 0) {
    console.log("Nothing to process.");
    return;
  }

  let ok = 0, fail = 0, skipped = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const url = img.image_url || (img.storage_path ? `${SUPABASE_URL}/storage/v1/object/public/vehicle-photos/${img.storage_path}` : null);

    if (!url) {
      skipped++;
      continue;
    }

    process.stdout.write(`  [${i + 1}/${images.length}] ${img.id.slice(0, 8)}... `);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-vehicle-image-haiku`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: "single",
          image_url: url,
          image_id: img.id,
          vehicle_id: VEHICLE_ID,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const zone = data.zone || data.classification?.zone || "unknown";
        console.log(`OK (${zone})`);
        ok++;
      } else {
        const text = await res.text();
        console.log(`FAIL ${res.status}: ${text.slice(0, 100)}`);
        fail++;
        if (res.status === 429 || text.includes("WORKER_LIMIT")) {
          console.log("  Rate limited — backing off 10s...");
          await sleep(10000);
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      fail++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`Done: ${ok} analyzed, ${fail} failed, ${skipped} skipped (no URL)`);
  console.log("=".repeat(70));
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
