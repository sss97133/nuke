#!/usr/bin/env node
/**
 * Persistent condition backfill loop.
 * Calls the edge function in small batches, waits between kicks.
 * Handles LLM rate limits gracefully — just keeps retrying.
 *
 * Usage: dotenvx run -- node scripts/condition-backfill-loop.mjs
 * Stop: Ctrl+C
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 5; // small batches — fits in 50s edge function budget even with slow LLMs
const PAUSE_ON_SUCCESS_MS = 5_000;  // 5s between successful batches
const PAUSE_ON_ERROR_MS = 30_000;   // 30s backoff on errors (rate limits)

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run with: dotenvx run -- node scripts/condition-backfill-loop.mjs');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let totalIngested = 0;
let totalProcessed = 0;
let consecutiveErrors = 0;
let iterations = 0;
const startTime = Date.now();

async function kick() {
  iterations++;
  const elapsed = Math.round((Date.now() - startTime) / 60000);

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/discover-description-data`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      // Don't self-chain — this loop handles pacing
      body: JSON.stringify({ mode: 'condition_backfill', batch_size: BATCH_SIZE, continue: false }),
      signal: AbortSignal.timeout(120_000),
    });

    const d = await resp.json();

    if (d.success) {
      const ingested = d.conditions_ingested || 0;
      totalProcessed += d.processed || 0;
      totalIngested += ingested;

      const rate = elapsed > 0 ? Math.round(totalIngested / elapsed) : totalIngested;

      if (ingested > 0) {
        consecutiveErrors = 0;
        console.log(
          `[${elapsed}m] #${iterations} +${ingested} cond (${d.processed} veh) | ` +
          `Total: ${totalIngested} obs ${totalProcessed} veh | ${rate}/min`
        );
        return PAUSE_ON_SUCCESS_MS;
      } else {
        consecutiveErrors++;
        console.log(
          `[${elapsed}m] #${iterations} 0 cond (${d.processed} veh) — LLM errors, backoff ${consecutiveErrors} | ` +
          `Total: ${totalIngested} obs`
        );
        // Exponential backoff: 30s, 60s, 120s, max 5min
        return Math.min(PAUSE_ON_ERROR_MS * Math.pow(2, consecutiveErrors - 1), 300_000);
      }
    } else {
      consecutiveErrors++;
      console.log(`[${elapsed}m] #${iterations} ERROR: ${d.error}`);
      return Math.min(PAUSE_ON_ERROR_MS * Math.pow(2, consecutiveErrors - 1), 300_000);
    }
  } catch (e) {
    consecutiveErrors++;
    console.error(`[${elapsed}m] #${iterations} FETCH: ${e.message}`);
    return Math.min(PAUSE_ON_ERROR_MS * Math.pow(2, consecutiveErrors - 1), 300_000);
  }
}

console.log('=== CONDITION BACKFILL LOOP ===');
console.log(`Batch: ${BATCH_SIZE} | LLM: Kimi → Grok → Gemini → Haiku`);
console.log('Ctrl+C to stop\n');

// Infinite loop with adaptive pacing
while (true) {
  const pauseMs = await kick();
  await sleep(pauseMs);
}
