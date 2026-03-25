#!/usr/bin/env node
/**
 * Backfill Condition Observations
 *
 * Orchestrates condition extraction across three data sources in parallel:
 * 1. Descriptions → condition observations (via discover-description-data)
 * 2. Comments → condition observations (via batch-comment-discovery)
 * 3. Photos → condition observations (via score-vehicle-condition)
 *
 * Each source self-chains (descriptions/comments) or runs in small batches (vision).
 * All write to vehicle_observations with kind='condition' via ingest-observation.
 * Content-hash dedup prevents duplicates on re-runs.
 *
 * Usage:
 *   dotenvx run -- node scripts/backfill-condition-observations.mjs
 *   dotenvx run -- node scripts/backfill-condition-observations.mjs --descriptions-only
 *   dotenvx run -- node scripts/backfill-condition-observations.mjs --comments-only
 *   dotenvx run -- node scripts/backfill-condition-observations.mjs --vision-only
 *   dotenvx run -- node scripts/backfill-condition-observations.mjs --vehicle-id UUID
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: dotenvx run -- node scripts/backfill-condition-observations.mjs');
  process.exit(1);
}

async function callFunction(name, body) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${name} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// Parse CLI flags
const args = process.argv.slice(2);
const descOnly = args.includes('--descriptions-only');
const commentsOnly = args.includes('--comments-only');
const visionOnly = args.includes('--vision-only');
const vehicleIdIdx = args.indexOf('--vehicle-id');
const vehicleId = vehicleIdIdx >= 0 ? args[vehicleIdIdx + 1] : null;
const all = !descOnly && !commentsOnly && !visionOnly;

console.log('=== CONDITION OBSERVATION BACKFILL ===');
console.log(`Mode: ${all ? 'ALL sources' : [descOnly && 'descriptions', commentsOnly && 'comments', visionOnly && 'vision'].filter(Boolean).join(', ')}`);
if (vehicleId) console.log(`Vehicle: ${vehicleId}`);
console.log('');

const promises = [];

// Gap 1: Descriptions → condition observations
if (all || descOnly) {
  console.log('[descriptions] Starting description → condition extraction...');
  const body = vehicleId
    ? { vehicle_id: vehicleId }
    : { mode: 'condition_backfill', batch_size: 20, continue: true };
  promises.push(
    callFunction('discover-description-data', body)
      .then(r => {
        console.log(`[descriptions] First batch: ${r.discovered || 0} discovered, ${r.condition_observations_created || 0} condition obs, ${r.remaining || '?'} remaining`);
        if (r.continued) console.log('[descriptions] Self-chaining enabled — will continue autonomously');
        return { source: 'descriptions', ...r };
      })
      .catch(e => {
        console.error(`[descriptions] Error: ${e.message}`);
        return { source: 'descriptions', error: e.message };
      })
  );
}

// Gap 2: Comments → condition observations
if (all || commentsOnly) {
  console.log('[comments] Starting comment → condition extraction...');
  const body = vehicleId
    ? { mode: 'extract_claims', vehicle_id: vehicleId, batch_size: 1 }
    : { mode: 'extract_claims', batch_size: 10, continue: true };
  promises.push(
    callFunction('batch-comment-discovery', body)
      .then(r => {
        console.log(`[comments] First batch: ${r.vehicles || 0} vehicles, ${r.claims_total || 0} claims, ${r.comments_processed || 0} comments`);
        if (r.continued) console.log('[comments] Self-chaining enabled — will continue autonomously');
        return { source: 'comments', ...r };
      })
      .catch(e => {
        console.error(`[comments] Error: ${e.message}`);
        return { source: 'comments', error: e.message };
      })
  );
}

// Gap 3: Photos → condition observations
if (all || visionOnly) {
  console.log('[vision] Starting photo → condition scoring...');
  const body = vehicleId
    ? { vehicle_id: vehicleId }
    : { batch_size: 3 };
  promises.push(
    callFunction('score-vehicle-condition', body)
      .then(r => {
        if (vehicleId) {
          console.log(`[vision] Score: ${r.overall_score || 0}/100, concerns: ${(r.concerns || []).length}, images: ${r.images_scored || 0}`);
        } else {
          console.log(`[vision] Batch: ${r.vehicles_processed || 0} vehicles scored`);
        }
        return { source: 'vision', ...r };
      })
      .catch(e => {
        console.error(`[vision] Error: ${e.message}`);
        return { source: 'vision', error: e.message };
      })
  );
}

const results = await Promise.allSettled(promises);

console.log('\n=== BACKFILL KICK RESULTS ===');
for (const r of results) {
  if (r.status === 'fulfilled') {
    const v = r.value;
    if (v.error) {
      console.log(`  ${v.source}: FAILED — ${v.error}`);
    } else {
      console.log(`  ${v.source}: OK`);
    }
  } else {
    console.log(`  FAILED: ${r.reason}`);
  }
}

console.log('\nSelf-chaining functions will continue autonomously.');
console.log('Monitor progress: SELECT kind, count(*) FROM vehicle_observations WHERE kind = \'condition\' GROUP BY kind;');
