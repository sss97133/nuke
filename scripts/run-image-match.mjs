#!/usr/bin/env node
// Run check-image-vehicle-match in batches
// Usage: node scripts/run-image-match.mjs [vehicle_id | --source jamesedition] [batch_size] [max_batches] [--dry-run]
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sourceIdx = args.indexOf('--source');
const sourceFilter = sourceIdx >= 0 ? args[sourceIdx + 1] : null;
const positional = args.filter(a => !a.startsWith('--') && (sourceIdx < 0 || args.indexOf(a) !== sourceIdx + 1));
const vehicleId = sourceFilter ? null : (positional[0] || null);
const batchSize = parseInt(positional[sourceFilter ? 0 : 1] || '5');
const maxBatches = parseInt(positional[sourceFilter ? 1 : 2] || '10');

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing env vars'); process.exit(1); }

let totalProcessed = 0;
let totalConfirmed = 0;
let totalMismatch = 0;
let totalAmbiguous = 0;
let totalUnrelated = 0;
let totalErrors = 0;

for (let batch = 1; batch <= maxBatches; batch++) {
  console.log(`\n--- Batch ${batch} ---`);

  let data;
  let retries = 3;
  while (retries > 0) {
    try {
      const resp = await fetch(`${url}/functions/v1/check-image-vehicle-match`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({
          ...(vehicleId ? { vehicle_id: vehicleId } : {}),
          ...(sourceFilter ? { source_filter: sourceFilter } : {}),
          batch_size: batchSize,
          dry_run: dryRun,
        }),
      });
      const text = await resp.text();
      data = JSON.parse(text);
      break;
    } catch (err) {
      retries--;
      if (retries <= 0) { console.error(`  Failed after retries: ${err.message}`); data = null; break; }
      console.log(`  Retry (${3-retries}/3): ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  if (!data) continue;

  if (data.message === 'No unchecked images found') {
    console.log('All images checked.');
    break;
  }

  const s = data.summary || {};
  totalProcessed += s.processed || 0;
  totalConfirmed += s.confirmed || 0;
  totalMismatch += s.mismatch || 0;
  totalAmbiguous += s.ambiguous || 0;
  totalUnrelated += s.unrelated || 0;
  totalErrors += s.errors || 0;

  console.log(`  processed:${s.processed} confirmed:${s.confirmed} mismatch:${s.mismatch} ambiguous:${s.ambiguous} unrelated:${s.unrelated} errors:${s.errors}`);

  for (const r of (data.results || [])) {
    if (r.status !== 'confirmed') {
      console.log(`  ** ${r.status.padEnd(10)} | ${(r.ai_detected_vehicle || '').padEnd(30)} | ${r.reason.slice(0, 80)}`);
    }
  }

  for (const e of (data.errors || [])) {
    console.log(`  !! ERROR ${e.image_id.slice(0, 8)} | ${e.error.slice(0, 80)}`);
  }
}

console.log(`\n=== TOTAL ===`);
console.log(`Processed: ${totalProcessed} | Confirmed: ${totalConfirmed} | Mismatch: ${totalMismatch} | Ambiguous: ${totalAmbiguous} | Unrelated: ${totalUnrelated} | Errors: ${totalErrors}`);
