#!/usr/bin/env node
/**
 * Parallel extraction runner — fires N concurrent workers per platform
 * Uses queue mode for pre-computed vehicle-snapshot matching (much faster)
 *
 * Usage: dotenvx run -- node scripts/parallel-extract.mjs [platform] [workers] [batch-size]
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const platform = process.argv[2] || "all";
const numWorkers = parseInt(process.argv[3]) || 5;
const batchSize = parseInt(process.argv[4]) || 50;

const PLATFORMS = ["bat", "mecum", "carsandbids", "barrett-jackson", "bonhams"];

async function runBatch(platform) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/batch-extract-snapshots`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ platform, batch_size: batchSize, use_queue: true }),
  });
  return res.json();
}

async function worker(id, platform) {
  let totalExtracted = 0;
  let totalFields = 0;
  let batchCount = 0;
  let consecutiveErrors = 0;

  while (true) {
    try {
      const result = await runBatch(platform);
      batchCount++;

      if (!result.success) {
        console.error(`  [${platform}:W${id}] ERROR: ${result.error}`);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) break;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      consecutiveErrors = 0;

      // Queue empty — done
      if (result.queue_empty || result.vehicles_found === 0) {
        console.log(`  [${platform}:W${id}] Queue empty after ${batchCount} batches`);
        break;
      }

      const { extracted = 0, skipped = 0, no_snapshot = 0, fields_filled = 0 } = result;
      totalExtracted += extracted;
      totalFields += fields_filled;

      if (batchCount % 5 === 0 || extracted > 0) {
        console.log(
          `  [${platform}:W${id}] batch=${batchCount} ext=${extracted} skip=${skipped} noSnap=${no_snapshot} ` +
          `fields=${fields_filled} cumul: ${totalExtracted}v/${totalFields}f (${result.duration_ms}ms)`
        );
      }

      // Small delay to avoid overwhelming the DB
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error(`  [${platform}:W${id}] FETCH ERROR: ${e.message}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 5) break;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  return { id, platform, extracted: totalExtracted, fields: totalFields, batches: batchCount };
}

async function runPlatform(plat) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`PLATFORM: ${plat} — ${numWorkers} workers × batch_size=${batchSize} (queue mode)`);
  console.log("=".repeat(60));

  const promises = [];
  for (let i = 0; i < numWorkers; i++) {
    // Stagger worker starts slightly to avoid thundering herd
    await new Promise(r => setTimeout(r, i * 200));
    promises.push(worker(i, plat));
  }

  const results = await Promise.all(promises);
  const totalExt = results.reduce((s, r) => s + r.extracted, 0);
  const totalFields = results.reduce((s, r) => s + r.fields, 0);
  const totalBatches = results.reduce((s, r) => s + r.batches, 0);
  console.log(`\n  DONE: ${plat} — ${totalExt} vehicles extracted, ${totalFields} fields filled, ${totalBatches} batches`);
  return { platform: plat, extracted: totalExt, fields: totalFields };
}

async function main() {
  console.log(`Queue-Based Parallel Extraction — ${new Date().toISOString()}`);
  console.log(`Workers: ${numWorkers}, Batch size: ${batchSize}`);

  const platforms = platform === "all" ? PLATFORMS : [platform];
  const results = [];

  for (const p of platforms) {
    const r = await runPlatform(p);
    results.push(r);
  }

  console.log("\n" + "=".repeat(60));
  console.log("FINAL SUMMARY");
  console.log("=".repeat(60));
  let grandTotal = { v: 0, f: 0 };
  for (const r of results) {
    console.log(`  ${r.platform}: ${r.extracted} vehicles, ${r.fields} fields`);
    grandTotal.v += r.extracted;
    grandTotal.f += r.fields;
  }
  console.log(`  TOTAL: ${grandTotal.v} vehicles, ${grandTotal.f} fields`);
  console.log("=".repeat(60));
}

main().catch(console.error);
