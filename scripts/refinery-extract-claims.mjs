#!/usr/bin/env node
/**
 * Comment Refinery — Local claim extraction via Ollama ($0 cost)
 *
 * Reads from comment_claims_progress (triaged comments above threshold),
 * sends to local Ollama for claim extraction, writes results to field_evidence.
 *
 * Usage:
 *   dotenvx run -- node scripts/refinery-extract-claims.mjs --vehicle <id>
 *   dotenvx run -- node scripts/refinery-extract-claims.mjs --batch 50
 *   dotenvx run -- node scripts/refinery-extract-claims.mjs --all --max-vehicles 500
 *
 * Options:
 *   --vehicle <id>     Process specific vehicle
 *   --batch <n>        Process n vehicles (default: 10)
 *   --all              Process all pending vehicles (use with --max-vehicles)
 *   --max-vehicles <n> Cap total vehicles (default: 100)
 *   --model <name>     Ollama model (default: qwen3:30b-a3b)
 *   --dry-run          Parse and show claims without writing to DB
 *   --min-density <n>  Minimum claim density score (default: 0.3)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(name);

const vehicleId = getArg('--vehicle');
const batchSize = parseInt(getArg('--batch') || '10', 10);
const maxVehicles = parseInt(getArg('--max-vehicles') || '100', 10);
const ollamaModel = getArg('--model') || 'qwen3:30b-a3b';
const dryRun = hasFlag('--dry-run');
const minDensity = parseFloat(getArg('--min-density') || '0.3');
const processAll = hasFlag('--all');
const commentsPerCall = parseInt(getArg('--comments-per-call') || '10', 10);

// ── Prompt builder (mirrors _shared/commentRefinery.ts) ─────────────────

function buildPrompt(vehicle, comments, existingFieldNames) {
  const desc = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Unknown';
  const vinLine = vehicle.vin ? `VIN: ${vehicle.vin}` : 'VIN: unknown';
  const priceLine = vehicle.sale_price ? `SALE PRICE: $${Number(vehicle.sale_price).toLocaleString()}` : '';
  const existingLine = existingFieldNames.length > 0
    ? `FIELDS ALREADY KNOWN: ${existingFieldNames.slice(0, 20).join(', ')}`
    : 'FIELDS ALREADY KNOWN: none';

  const blocks = comments.map((c, i) => {
    const prefix = c.is_seller ? '[SELLER] ' : '';
    const user = c.author_username || 'anon';
    const bid = c.bid_amount ? ` [BID: $${Number(c.bid_amount).toLocaleString()}]` : '';
    const date = c.posted_at ? ` (${c.posted_at.substring(0, 10)})` : '';
    return `[${i + 1}] ${prefix}@${user}${bid}${date}:\n${c.comment_text}`;
  }).join('\n\n');

  return `Extract factual claims about a SPECIFIC vehicle from auction comments.

THE VEHICLE BEING SOLD: ${desc}
${vinLine}
${priceLine}

CRITICAL: Only extract claims about THIS EXACT vehicle (the ${desc}). Commenters often mention OTHER cars they own, compare to, or reference. Those are NOT claims about this vehicle. If a commenter says "I had a 1993 Acura Legend" on a Ferrari listing — that is NOT a claim about the Ferrari.

VALID field_name values (use EXACTLY one per claim):
engine_type, engine_size, transmission, drivetrain, fuel_type, color, interior_color, mileage, body_style, sale_price, trim, horsepower, torque, matching_numbers, option_codes, production_count, rust_condition, paint_condition, mechanical_condition, body_condition, interior_condition

COMMENTS (${comments.length}):
---
${blocks}
---

For each comment, return claims in this JSON format:
[
  {
    "comment_index": 1,
    "claims": [
      {
        "field_name": "engine_type",
        "proposed_value": "427 big block",
        "confidence": 0.85,
        "quote": "matching numbers 427",
        "reasoning": "Commenter identifies the engine in THIS vehicle",
        "category": "A"
      }
    ]
  }
]

RULES:
1. ONLY claims about the ${desc} being sold — NOT other vehicles commenters mention
2. ONLY verifiable facts — NOT opinions ("beautiful", "holy grail", "STUPID money" are NOT claims)
3. "quote" must be an EXACT substring from the comment text
4. ONE field_name per claim from the list above — never combine with pipes
5. If a comment mentions engine AND transmission of THIS vehicle, make TWO separate claims
6. proposed_value must be a specific, concrete value — not "outstanding" or "good condition"
7. For mileage: must be a number. For engine_type: must be an engine designation. For color: must be a color name.
8. Skip: bids, congratulations, jokes, questions, price opinions, references to other vehicles
9. Empty claims array if nothing factual about THIS vehicle
10. confidence 0.5-0.95: higher if seller says it, lower if commenter is guessing
11. category: A=spec, B=condition, C=provenance/history

Return ONLY the JSON array. /no_think`;
}

// ── Ollama call ─────────────────────────────────────────────────────────

async function callOllama(prompt) {
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { num_predict: 4096, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Ollama ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return {
    content: data.message?.content || '',
    model: data.model || ollamaModel,
    evalCount: data.eval_count || 0,
    evalDuration: data.eval_duration || 0,
    totalDuration: data.total_duration || 0,
  };
}

// ── Response parser ─────────────────────────────────────────────────────

// Valid field names that match the dossier panel
const VALID_FIELDS = new Set([
  'engine_type', 'engine_size', 'transmission', 'drivetrain', 'fuel_type',
  'color', 'interior_color', 'mileage', 'body_style', 'sale_price', 'trim',
  'horsepower', 'torque', 'matching_numbers', 'option_codes', 'production_count',
  'rust_condition', 'paint_condition', 'mechanical_condition', 'body_condition', 'interior_condition',
  'doors', 'seats', 'weight_lbs',
]);

// Garbage value patterns — opinions, not facts
const GARBAGE_VALUES = /^(beautiful|stunning|gorgeous|amazing|awesome|incredible|outstanding|terrible|ugly|holy grail|stupid money|unique|sporty look|basically new|absolutely beautiful|good condition|run an exemplary|poor|excellent|great|nice)\s*$/i;

// Values that are too vague to be useful
const TOO_VAGUE = /^(yes|no|true|false|good|bad|fair|poor|unknown|n\/a|none)\s*$/i;

function parseClaims(llmContent, comments, vehicle) {
  const jsonMatch = llmContent.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { claims: [], errors: ['No JSON array in response'] };

  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch (e) { return { claims: [], errors: [`JSON parse: ${e.message}`] }; }

  const valid = [];
  const errors = [];
  const vehicleDesc = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ').toLowerCase();

  for (const entry of parsed) {
    const idx = (entry.comment_index ?? 0) - 1;
    if (idx < 0 || idx >= comments.length) { errors.push(`Bad index: ${entry.comment_index}`); continue; }
    const comment = comments[idx];
    for (const c of (entry.claims || [])) {
      const fieldName = c.field_name;
      const value = String(c.proposed_value || '').trim();
      const quote = String(c.quote || '');

      // Gate 1: Required fields
      if (!fieldName || !value || !quote) { errors.push(`Missing fields idx ${idx + 1}`); continue; }

      // Gate 2: field_name must be in valid set
      if (!VALID_FIELDS.has(fieldName)) { errors.push(`Invalid field '${fieldName}' idx ${idx + 1}`); continue; }

      // Gate 3: No piped multi-field names
      if (fieldName.includes('|')) { errors.push(`Piped field '${fieldName}' idx ${idx + 1}`); continue; }

      // Gate 4: Quote verification
      const normComment = comment.comment_text.toLowerCase().replace(/\s+/g, ' ');
      const normQuote = quote.toLowerCase().replace(/\s+/g, ' ');
      if (!normComment.includes(normQuote)) { errors.push(`Quote not found idx ${idx + 1}: "${quote.slice(0, 50)}"`); continue; }

      // Gate 5: Reject garbage/opinion values
      if (GARBAGE_VALUES.test(value) || TOO_VAGUE.test(value)) { errors.push(`Opinion/vague value '${value}' idx ${idx + 1}`); continue; }

      // Gate 6: Field-specific validation
      if (fieldName === 'mileage') {
        const num = parseInt(value.replace(/[^0-9]/g, ''), 10);
        if (isNaN(num) || num <= 0 || num > 999999) { errors.push(`Bad mileage '${value}' idx ${idx + 1}`); continue; }
      }
      if (fieldName === 'sale_price') {
        const num = parseInt(value.replace(/[^0-9]/g, ''), 10);
        if (isNaN(num) || num <= 0) { errors.push(`Bad price '${value}' idx ${idx + 1}`); continue; }
      }
      if (fieldName === 'horsepower' || fieldName === 'torque') {
        const num = parseInt(value.replace(/[^0-9]/g, ''), 10);
        if (isNaN(num) || num <= 0 || num > 5000) { errors.push(`Bad ${fieldName} '${value}' idx ${idx + 1}`); continue; }
      }

      valid.push({
        ...c,
        field_name: fieldName,
        proposed_value: value,
        confidence: Math.max(0.5, Math.min(0.95, Number(c.confidence) || 0.5)) + (comment.is_seller ? 0.05 : 0),
        comment_id: comment.id,
        comment_index: idx,
      });
    }
  }

  return { claims: valid, errors };
}

// ── Confidence with temporal decay ──────────────────────────────────────

function computeConfidence(rawConf, claimType, anchorDate) {
  let conf = rawConf;
  if (anchorDate && ['paint_condition', 'mechanical_condition', 'body_condition', 'rust_condition', 'interior_condition'].includes(claimType)) {
    const ageYears = (Date.now() - anchorDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const halfLife = { paint_condition: 2, mechanical_condition: 3, body_condition: 4, rust_condition: 5, interior_condition: 3 }[claimType] || 5;
    conf *= Math.pow(0.5, ageYears / halfLife);
  }
  return Math.max(0, Math.min(1, conf));
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔬 Comment Refinery — Local Ollama Extraction`);
  console.log(`   Model: ${ollamaModel} | Cost: $0`);
  console.log(`   Min density: ${minDensity} | Dry run: ${dryRun}\n`);

  // Check Ollama is up
  try {
    await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error('❌ Ollama not reachable at', OLLAMA_URL);
    process.exit(1);
  }

  // Get vehicles with pending claims
  let query = supabase
    .from('comment_claims_progress')
    .select('vehicle_id')
    .eq('llm_processed', false)
    .gte('claim_density_score', minDensity);

  if (vehicleId) query = query.eq('vehicle_id', vehicleId);

  const { data: pending } = await query.order('claim_density_score', { ascending: false }).limit(maxVehicles * 20);

  const vehicleIds = [...new Set((pending || []).map(r => r.vehicle_id))].slice(0, processAll ? maxVehicles : batchSize);

  if (vehicleIds.length === 0) {
    console.log('✅ No pending claims above threshold. Run claim_triage first.');
    return;
  }

  console.log(`📋 ${vehicleIds.length} vehicles with pending claims\n`);

  // Get vehicle context
  const { data: vehicles } = await supabase.from('vehicles').select('id, year, make, model, vin, sale_price').in('id', vehicleIds);
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

  let totalClaims = 0, totalComments = 0, totalErrors = 0;
  const startTime = Date.now();

  for (const vId of vehicleIds) {
    const vehicle = vehicleMap.get(vId);
    if (!vehicle) continue;
    const label = `${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`;

    // Get pending comments
    const { data: pendingComments } = await supabase
      .from('comment_claims_progress')
      .select('comment_id')
      .eq('vehicle_id', vId)
      .eq('llm_processed', false)
      .gte('claim_density_score', minDensity)
      .order('claim_density_score', { ascending: false })
      .limit(50);

    if (!pendingComments?.length) continue;

    const commentIds = pendingComments.map(p => p.comment_id);
    const { data: fullComments } = await supabase
      .from('auction_comments')
      .select('id, comment_text, author_username, is_seller, posted_at, bid_amount')
      .in('id', commentIds);

    if (!fullComments?.length) continue;

    // Existing evidence
    const { data: existing } = await supabase.from('field_evidence').select('field_name').eq('vehicle_id', vId).limit(50);
    const existingFields = [...new Set((existing || []).map(e => e.field_name))];

    console.log(`\n🚗 ${label} — ${fullComments.length} comments`);

    let vehicleClaims = 0;

    // Process in batches
    for (let i = 0; i < fullComments.length; i += commentsPerCall) {
      const batch = fullComments.slice(i, i + commentsPerCall);
      const prompt = buildPrompt(vehicle, batch, existingFields);

      process.stdout.write(`   Batch ${Math.floor(i / commentsPerCall) + 1}... `);
      const t0 = Date.now();

      let result;
      try {
        result = await callOllama(prompt);
      } catch (e) {
        console.log(`❌ ${e.message}`);
        totalErrors++;
        continue;
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const { claims, errors } = parseClaims(result.content, batch, vehicle);

      console.log(`${claims.length} claims in ${elapsed}s${errors.length ? ` (${errors.length} errors)` : ''}`);
      if (errors.length) errors.slice(0, 2).forEach(e => console.log(`     ⚠ ${e}`));

      // Show claims
      for (const c of claims) {
        const anchor = c.temporal_anchor && c.temporal_anchor !== 'null' && c.temporal_anchor !== 'current' ? new Date(c.temporal_anchor) : null;
        const conf = computeConfidence(c.confidence, c.claim_type, anchor);
        console.log(`     ${c.category} ${c.field_name || c.claim_type}: "${c.proposed_value}" (${Math.round(conf * 100)}%) — "${c.quote.slice(0, 50)}"`);
      }

      if (!dryRun && claims.length > 0) {
        // Write Category A/B to field_evidence
        const fieldClaims = claims.filter(c => c.category === 'A' || c.category === 'B');
        if (fieldClaims.length > 0) {
          const rows = fieldClaims.map(c => {
            const anchor = c.temporal_anchor && c.temporal_anchor !== 'null' && c.temporal_anchor !== 'current' ? new Date(c.temporal_anchor) : null;
            return {
              vehicle_id: vId,
              field_name: c.field_name || c.claim_type,
              proposed_value: c.proposed_value,
              source_type: 'auction_comment_claim',
              source_confidence: Math.round(computeConfidence(c.confidence, c.claim_type, anchor) * 100),
              extraction_context: batch.find(b => b.id === c.comment_id)?.comment_text?.substring(0, 500) || '',
              supporting_signals: [{ quote: c.quote, author: batch.find(b => b.id === c.comment_id)?.author_username || 'unknown', temporal_anchor: c.temporal_anchor, claim_type: c.claim_type, category: c.category, model: ollamaModel }],
              status: 'pending',
              raw_extraction_data: { reasoning: c.reasoning, contradicts_existing: c.contradicts_existing },
            };
          });
          const { error: feErr } = await supabase.from('field_evidence').upsert(rows, { onConflict: 'vehicle_id,field_name,source_type,proposed_value' });
          if (feErr) console.log(`     ❌ field_evidence: ${feErr.message}`);
        }

        // Write Category C to vehicle_observations
        const provClaims = claims.filter(c => c.category === 'C');
        for (const c of provClaims) {
          const { error: obsErr } = await supabase.functions.invoke('ingest-observation', {
            body: {
              source_slug: 'bat',
              kind: c.observation_kind || 'expert_opinion',
              observed_at: c.temporal_anchor && c.temporal_anchor !== 'null' ? c.temporal_anchor : batch.find(b => b.id === c.comment_id)?.posted_at || new Date().toISOString(),
              content_text: c.quote,
              structured_data: { claim_type: c.claim_type, proposed_value: c.proposed_value, reasoning: c.reasoning, author: batch.find(b => b.id === c.comment_id)?.author_username },
              vehicle_id: vId,
              extraction_method: 'comment_refinery_v1_local',
              agent_model: ollamaModel,
            },
          });
          if (obsErr) console.log(`     ❌ ingest-obs: ${obsErr.message}`);
        }
      }

      // Update progress
      if (!dryRun) {
        const claimCounts = new Map();
        for (const c of claims) claimCounts.set(c.comment_id, (claimCounts.get(c.comment_id) || 0) + 1);
        for (const cId of batch.map(b => b.id)) {
          await supabase.from('comment_claims_progress').update({
            llm_processed: true, llm_model: ollamaModel, llm_cost_cents: 0,
            claims_extracted: claimCounts.get(cId) || 0, processed_at: new Date().toISOString(),
          }).eq('comment_id', cId);
        }
      }

      vehicleClaims += claims.length;
      totalComments += batch.length;
    }

    totalClaims += vehicleClaims;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n✅ Done in ${elapsed}s — ${vehicleIds.length} vehicles, ${totalComments} comments, ${totalClaims} claims extracted, $0 cost`);
  if (totalErrors > 0) console.log(`⚠ ${totalErrors} LLM errors`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
