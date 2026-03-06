#!/usr/bin/env node
/**
 * Mass extraction runner — fires batch-extract-snapshots in a loop
 * Usage: dotenvx run -- node scripts/mass-extract-snapshots.mjs [platform] [batches]
 *
 * Platforms (in priority order): barrett-jackson, mecum, carsandbids, bonhams, bat
 * Default: runs all platforms in priority order
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const platform = process.argv[2] || "all";
const maxBatches = parseInt(process.argv[3]) || 100;
const batchSize = parseInt(process.argv[4]) || 200;

const PLATFORMS = ["barrett-jackson", "mecum", "carsandbids", "bonhams", "bat"];

async function runBatch(platform, offset) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/batch-extract-snapshots`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      platform,
      batch_size: batchSize,
      mode: "sparse",
      offset,
    }),
  });
  return res.json();
}

async function runPlatform(plat) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PLATFORM: ${plat} — batch_size=${batchSize}, max_batches=${maxBatches}`);
  console.log("=".repeat(60));

  let offset = 0;
  let totalExtracted = 0;
  let totalFields = 0;
  let consecutiveEmpty = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const start = Date.now();
    try {
      const result = await runBatch(plat, offset);
      const elapsed = Date.now() - start;

      if (!result.success) {
        console.error(`  Batch ${batch}: ERROR — ${result.error}`);
        break;
      }

      const { extracted, skipped, no_snapshot, errors, fields_filled, vehicles_found } = result;
      totalExtracted += extracted;
      totalFields += fields_filled;

      console.log(
        `  Batch ${batch}: found=${vehicles_found} extracted=${extracted} skipped=${skipped} ` +
        `noSnap=${no_snapshot} err=${errors} fields=${fields_filled} ` +
        `[${elapsed}ms] cumul: ${totalExtracted} vehicles, ${totalFields} fields`
      );

      // Stop if no vehicles found or all empty
      if (vehicles_found === 0) {
        console.log(`  → No more vehicles to process for ${plat}`);
        break;
      }

      if (extracted === 0 && errors === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 5) {
          console.log(`  → 5 consecutive empty batches for ${plat}, advancing offset by 2000`);
          offset += 2000;
          consecutiveEmpty = 0;
          continue;
        }
      } else {
        consecutiveEmpty = 0;
      }

      offset = result.next_offset || offset + batchSize;

      // Small delay to avoid hammering
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error(`  Batch ${batch}: FETCH ERROR — ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n  DONE: ${plat} — ${totalExtracted} vehicles extracted, ${totalFields} fields filled`);
  return { platform: plat, extracted: totalExtracted, fields: totalFields };
}

async function main() {
  console.log(`Mass Extraction Runner — ${new Date().toISOString()}`);

  const platforms = platform === "all" ? PLATFORMS : [platform];
  const results = [];

  for (const p of platforms) {
    const r = await runPlatform(p);
    results.push(r);
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    console.log(`  ${r.platform}: ${r.extracted} vehicles, ${r.fields} fields`);
  }
  console.log("=".repeat(60));
}

main().catch(console.error);
