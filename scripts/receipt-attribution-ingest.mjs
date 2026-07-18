#!/usr/bin/env node
/**
 * receipt-attribution-ingest.mjs — write attribution verdicts back to receipts table.
 *
 * Reads JSONL from --sink. Each line: {receipt_id, scope_type, vehicle_id,
 * vehicle_label, confidence, reasoning, signals_used}.
 *
 * Writes:
 *   - receipts.vehicle_id (only if currently NULL — never overwrite)
 *   - receipts.scope_type, receipts.scope_id (when vehicle scope, scope_id=vehicle_id)
 *   - receipts.confidence_score (the attribution confidence)
 *   - receipts.learned_insights (jsonb adds attribution_signals + reasoning)
 *
 * Idempotent. Skips rows with confidence < MIN_CONFIDENCE (default 0.6).
 *
 * Usage: node scripts/receipt-attribution-ingest.mjs --sink /tmp/receipt-attr/run-XXX/sink.jsonl
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i+1] : d; };
const SINK = arg('--sink');
const MIN_CONF = parseFloat(arg('--min-confidence', '0.6'));
if (!SINK || !existsSync(SINK)) { console.error('--sink <path> required'); process.exit(1); }

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const lines = readFileSync(SINK, 'utf8').split('\n').filter(Boolean);
const VALID_SCOPES = new Set(['vehicle','personal','household','nuke','viva','unknown']);

let written = 0, skipped_lowconf = 0, skipped_existing = 0, failed = 0, parse_failed = 0;
const tally = { vehicle: 0, personal: 0, household: 0, nuke: 0, viva: 0, unknown: 0 };
const vehicle_hits = {};

for (const line of lines) {
  let v;
  try { v = JSON.parse(line); } catch { parse_failed++; continue; }
  if (!v.receipt_id || !VALID_SCOPES.has(v.scope_type)) { failed++; continue; }
  if ((v.confidence ?? 0) < MIN_CONF) { skipped_lowconf++; continue; }

  // Don't overwrite already-attributed
  const { data: existing } = await sb.from('receipts').select('vehicle_id, scope_type, learned_insights').eq('id', v.receipt_id).maybeSingle();
  if (!existing) { failed++; continue; }
  if (existing.vehicle_id && v.scope_type === 'vehicle') { skipped_existing++; continue; }

  // Build update
  const update = {
    confidence_score: v.confidence,
    learned_insights: {
      ...(existing.learned_insights || {}),
      attribution_v1: {
        scope_type: v.scope_type,
        vehicle_id: v.vehicle_id ?? null,
        vehicle_label: v.vehicle_label ?? null,
        confidence: v.confidence,
        reasoning: v.reasoning,
        signals_used: v.signals_used ?? [],
        ingested_at: new Date().toISOString(),
      },
    },
  };
  if (!existing.scope_type) update.scope_type = v.scope_type;
  if (v.scope_type === 'vehicle' && v.vehicle_id && !existing.vehicle_id) {
    update.vehicle_id = v.vehicle_id;
    update.scope_id = v.vehicle_id;
  } else if (v.scope_type !== 'vehicle' && !existing.scope_type) {
    update.scope_id = v.scope_type; // for non-vehicle scope, scope_id mirrors scope_type label
  }

  const { error } = await sb.from('receipts').update(update).eq('id', v.receipt_id);
  if (error) { console.error(`${v.receipt_id}: ${error.message}`); failed++; continue; }
  written++;
  tally[v.scope_type] = (tally[v.scope_type] || 0) + 1;
  if (v.vehicle_label) vehicle_hits[v.vehicle_label] = (vehicle_hits[v.vehicle_label] || 0) + 1;
}

console.log(`receipt-attribution-ingest from ${SINK}:`);
console.log(`  written:           ${written}`);
console.log(`  skipped_lowconf:   ${skipped_lowconf}`);
console.log(`  skipped_existing:  ${skipped_existing}`);
console.log(`  parse_failed:      ${parse_failed}`);
console.log(`  failed:            ${failed}`);
console.log(`\nScope tally:`);
for (const [k, n] of Object.entries(tally)) if (n > 0) console.log(`  ${k}: ${n}`);
console.log(`\nTop vehicle attributions:`);
const sorted = Object.entries(vehicle_hits).sort((a,b)=>b[1]-a[1]).slice(0, 10);
for (const [label, n] of sorted) console.log(`  ${n}  ${label}`);
