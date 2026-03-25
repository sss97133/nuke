#!/usr/bin/env node
/**
 * Backfill shallow BaT vehicles — vehicles with listing_url but no description.
 *
 * Strategy:
 * 1. For vehicles WITH snapshots: use batch-extract-snapshots (already handled by cron)
 * 2. For vehicles WITHOUT snapshots: use extract-bat-core to fetch + extract
 *
 * Usage:
 *   dotenvx run -- node scripts/backfill-shallow-bat.mjs [--batch-size 10] [--max-batches 50] [--dry-run]
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const args = process.argv.slice(2);
const batchSize = parseInt(args.find((_, i, a) => a[i - 1] === "--batch-size") || "10");
const maxBatches = parseInt(args.find((_, i, a) => a[i - 1] === "--max-batches") || "50");
const dryRun = args.includes("--dry-run");
const delayMs = parseInt(args.find((_, i, a) => a[i - 1] === "--delay") || "3000");

async function supabaseQuery(query, params = {}) {
  // Use PostgREST for queries
  const url = `${SUPABASE_URL}/rest/v1/rpc/`;
  // For simple queries, use the direct table endpoint
  return null; // We'll use psql or edge functions instead
}

async function callEdgeFunction(fn, body) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  return resp.json();
}

async function getShallowVehicles(offset, limit) {
  // Get shallow BaT vehicles with no description via PostgREST
  // Note: PostgREST can't filter by length(), so we filter description.is.null
  // This misses very short descriptions, but those are rare
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?source=eq.bat&deleted_at=is.null&description=is.null&listing_url=not.is.null&select=id,listing_url,bat_auction_url,year,make,model&order=id&offset=${offset}&limit=${limit}`,
    {
      headers: {
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
    }
  );
  return resp.json();
}

async function main() {
  console.log(`=== Backfill Shallow BaT Vehicles ===`);
  console.log(`Batch size: ${batchSize}, Max batches: ${maxBatches}, Delay: ${delayMs}ms, Dry run: ${dryRun}`);
  console.log();

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const vehicles = await getShallowVehicles(batch * batchSize, batchSize);

    if (!Array.isArray(vehicles) || vehicles.length === 0) {
      console.log(`\nNo more vehicles to process at offset ${batch * batchSize}`);
      break;
    }

    console.log(`\n--- Batch ${batch + 1}/${maxBatches}: ${vehicles.length} vehicles ---`);

    for (const v of vehicles) {
      const url = v.listing_url || v.bat_auction_url;
      if (!url) {
        totalSkipped++;
        continue;
      }

      // Clean URL (remove double slashes at end)
      const cleanUrl = url.replace(/\/+$/, "");
      const label = `${v.year || "?"} ${v.make || "?"} ${v.model || "?"}`;

      if (dryRun) {
        console.log(`  [DRY] Would extract: ${label} — ${cleanUrl}`);
        totalProcessed++;
        continue;
      }

      try {
        console.log(`  Extracting: ${label} — ${cleanUrl}`);
        const result = await callEdgeFunction("extract-bat-core", {
          url: cleanUrl,
          vehicle_id: v.id,
        });

        if (result.success) {
          totalSuccess++;
          console.log(`    OK: ${result.vehicles_updated || 0} updated, ${result.extraction_method || "?"}`);
        } else {
          totalErrors++;
          console.log(`    FAIL: ${result.error || result.message || JSON.stringify(result)}`);
        }
      } catch (e) {
        totalErrors++;
        console.log(`    ERROR: ${e.message}`);
      }

      totalProcessed++;

      // Delay between requests
      if (delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    console.log(`\nBatch ${batch + 1} complete. Running total: ${totalSuccess} success, ${totalErrors} errors, ${totalSkipped} skipped`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Success: ${totalSuccess}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Skipped: ${totalSkipped}`);
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
