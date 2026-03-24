#!/usr/bin/env node
/**
 * Valuation Burndown — Rapid batch processor for nuke_estimate backlog
 *
 * Fires parallel requests to compute-vehicle-valuation edge function.
 * Each request processes up to 50 vehicles.
 *
 * Usage:
 *   dotenvx run -- node scripts/valuation-burndown.mjs [--parallel 5] [--batch 50] [--max 5000] [--dry]
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Parse args
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : def;
}
const PARALLEL = getArg("parallel", 5);
const BATCH_SIZE = getArg("batch", 50);
const MAX_TOTAL = getArg("max", 50000);
const DRY_RUN = args.includes("--dry");

console.log(`Valuation Burndown — parallel=${PARALLEL}, batch=${BATCH_SIZE}, max=${MAX_TOTAL}${DRY_RUN ? " (DRY RUN)" : ""}`);

let totalComputed = 0;
let totalErrors = 0;
let totalCached = 0;
let round = 0;
const startTime = Date.now();

async function fireBatch() {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/compute-vehicle-valuation`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch_size: BATCH_SIZE }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { computed: 0, errors: 1, cached: 0, error_details: [{ error: `HTTP ${resp.status}: ${text.slice(0, 200)}` }] };
  }

  return resp.json();
}

async function runRound() {
  round++;
  const promises = Array.from({ length: PARALLEL }, () => fireBatch());
  const results = await Promise.all(promises);

  let roundComputed = 0;
  let roundErrors = 0;
  let roundCached = 0;

  for (const r of results) {
    roundComputed += r.computed || 0;
    roundErrors += r.errors || 0;
    roundCached += r.cached || 0;
  }

  totalComputed += roundComputed;
  totalErrors += roundErrors;
  totalCached += roundCached;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const rate = totalComputed > 0 ? (totalComputed / (elapsed / 3600)).toFixed(0) : "0";

  console.log(
    `[Round ${round}] +${roundComputed} computed, ${roundErrors} errors, ${roundCached} cached | ` +
    `Total: ${totalComputed} computed, ${totalErrors} errors | ` +
    `${elapsed}s elapsed, ${rate}/hr`
  );

  return roundComputed;
}

async function main() {
  if (DRY_RUN) {
    console.log("Dry run — would process vehicles via edge function");
    return;
  }

  while (totalComputed < MAX_TOTAL) {
    const computed = await runRound();

    // If no vehicles were computed, the backlog is empty
    if (computed === 0) {
      console.log("No more vehicles to process. Backlog empty!");
      break;
    }

    // Small delay between rounds to avoid overwhelming the function
    await new Promise(r => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone! ${totalComputed} computed, ${totalErrors} errors in ${elapsed}s`);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
