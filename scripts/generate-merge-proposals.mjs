#!/usr/bin/env node
/**
 * generate-merge-proposals.mjs — Generate AI-inspected merge candidates
 *
 * Finds duplicate candidates across multiple signals (URL, VIN, image hash),
 * compiles evidence for each pair, then sends to LLM for verification.
 *
 * The LLM sees ALL evidence and decides:
 *   - MERGE: same physical vehicle (confidence + reasoning)
 *   - SKIP: different vehicles despite signal overlap
 *   - REVIEW: ambiguous, needs human judgment
 *
 * Results stored in merge_proposals table for batch review/execution.
 *
 * Usage:
 *   dotenvx run -- node scripts/generate-merge-proposals.mjs --source vin
 *   dotenvx run -- node scripts/generate-merge-proposals.mjs --source url-normalized
 *   dotenvx run -- node scripts/generate-merge-proposals.mjs --source image-hash
 *   dotenvx run -- node scripts/generate-merge-proposals.mjs --execute-approved
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const source = args[args.indexOf('--source') + 1] || '';
const executeApproved = args.includes('--execute-approved');
const limit = parseInt(args[args.indexOf('--limit') + 1] || '50');

function getPool() {
  return new pg.Pool({
    connectionString: `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD || 'RbzKq32A0uhqvJMQ'}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    max: 1,
    idleTimeoutMillis: 30000,
  });
}

// ---------------------------------------------------------------------------
// Gather evidence for a pair of vehicles
// ---------------------------------------------------------------------------
async function gatherEvidence(pool, idA, idB) {
  // Get full vehicle records
  const vehicleQ = await pool.query(`
    SELECT id, year, make, model, vin, sale_price, listing_url, source,
           description, trim, engine_type, transmission, color, mileage,
           discovery_url, discovery_source, created_at,
           (SELECT count(*) FROM vehicle_images WHERE vehicle_id = v.id) as image_count,
           (SELECT count(*) FROM vehicle_observations WHERE vehicle_id = v.id) as observation_count,
           (SELECT count(*) FROM auction_comments WHERE vehicle_id = v.id) as comment_count
    FROM vehicles v
    WHERE id IN ($1::uuid, $2::uuid)
  `, [idA, idB]);

  const vehicles = vehicleQ.rows;
  if (vehicles.length !== 2) return null;

  const vA = vehicles.find(v => v.id === idA);
  const vB = vehicles.find(v => v.id === idB);

  // Check for shared images (by dhash)
  const sharedImages = await pool.query(`
    SELECT a.dhash, a.id as img_a, b.id as img_b
    FROM vehicle_images a
    JOIN vehicle_images b ON a.dhash = b.dhash AND a.dhash IS NOT NULL
    WHERE a.vehicle_id = $1 AND b.vehicle_id = $2
    LIMIT 10
  `, [idA, idB]);

  return {
    vehicleA: vA,
    vehicleB: vB,
    sharedImageHashes: sharedImages.rows.length,
    signals: {
      sameVin: vA.vin && vB.vin && vA.vin === vB.vin,
      sameYear: vA.year && vB.year && vA.year === vB.year,
      sameMake: vA.make && vB.make && vA.make.toLowerCase() === vB.make.toLowerCase(),
      samePrice: vA.sale_price && vB.sale_price && Math.abs(vA.sale_price - vB.sale_price) < 100,
      sameUrl: vA.listing_url && vB.listing_url && vA.listing_url === vB.listing_url,
      hasSharedImages: sharedImages.rows.length > 0,
    }
  };
}

// ---------------------------------------------------------------------------
// AI verification via local Ollama
// ---------------------------------------------------------------------------
async function aiVerifyPair(evidence) {
  const { vehicleA: a, vehicleB: b, sharedImageHashes, signals } = evidence;

  const prompt = `You are a vehicle data analyst. Determine if these two database records represent the SAME PHYSICAL VEHICLE or different vehicles.

RECORD A:
- ID: ${a.id}
- Year: ${a.year || 'unknown'} | Make: ${a.make || 'unknown'} | Model: ${a.model || 'unknown'}
- VIN: ${a.vin || 'none'}
- Price: ${a.sale_price ? '$' + Number(a.sale_price).toLocaleString() : 'unknown'}
- Source: ${a.source || 'unknown'} | Discovery: ${a.discovery_source || 'unknown'}
- URL: ${a.listing_url || 'none'}
- Color: ${a.color || 'unknown'} | Engine: ${a.engine_type || 'unknown'} | Trans: ${a.transmission || 'unknown'}
- Mileage: ${a.mileage || 'unknown'} | Trim: ${a.trim || 'unknown'}
- Images: ${a.image_count} | Observations: ${a.observation_count} | Comments: ${a.comment_count}
- Created: ${a.created_at}

RECORD B:
- ID: ${b.id}
- Year: ${b.year || 'unknown'} | Make: ${b.make || 'unknown'} | Model: ${b.model || 'unknown'}
- VIN: ${b.vin || 'none'}
- Price: ${b.sale_price ? '$' + Number(b.sale_price).toLocaleString() : 'unknown'}
- Source: ${b.source || 'unknown'} | Discovery: ${b.discovery_source || 'unknown'}
- URL: ${b.listing_url || 'none'}
- Color: ${b.color || 'unknown'} | Engine: ${b.engine_type || 'unknown'} | Trans: ${b.transmission || 'unknown'}
- Mileage: ${b.mileage || 'unknown'} | Trim: ${b.trim || 'unknown'}
- Images: ${b.image_count} | Observations: ${b.observation_count} | Comments: ${b.comment_count}
- Created: ${b.created_at}

MATCHING SIGNALS:
- Same VIN: ${signals.sameVin}
- Same Year: ${signals.sameYear}
- Same Make: ${signals.sameMake}
- Same Price: ${signals.samePrice}
- Shared image hashes: ${sharedImageHashes}

IMPORTANT CONSIDERATIONS:
- VINs can be wrong (Bonhams uses engine/chassis numbers as VINs)
- Replicas (Factory Five, Kirkham, CAV) are DIFFERENT vehicles from originals even if they share a style
- Same car can appear at multiple auctions (Mecum, BaT, Barrett-Jackson) — those ARE the same vehicle
- Make normalization: "Shelby" and "Ford" often refer to same Shelby vehicles; "Datsun" and "Nissan" are the same company
- Price differences across auctions are normal for the same car

Respond ONLY with a JSON object:
{
  "decision": "MERGE" | "SKIP" | "REVIEW",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence explanation",
  "preferred_primary": "A" | "B" (which has more/better data)
}`;

  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:7b',
        prompt,
        stream: false,
        options: { temperature: 0.1 }
      })
    });

    if (!resp.ok) throw new Error(`Ollama returned ${resp.status}`);
    const result = await resp.json();
    const text = result.response.trim();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response: ' + text.slice(0, 200));

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error(`  AI error: ${e.message}`);
    return { decision: 'REVIEW', confidence: 0, reasoning: `AI error: ${e.message}`, preferred_primary: 'A' };
  }
}

// ---------------------------------------------------------------------------
// Find VIN duplicate candidates
// ---------------------------------------------------------------------------
async function findVinCandidates(pool) {
  const result = await pool.query(`
    SELECT
      vin,
      array_agg(id::text ORDER BY created_at ASC) as ids
    FROM vehicles
    WHERE vin IS NOT NULL
      AND vin != ''
      AND length(vin) >= 6
      AND vin NOT IN ('unknown', 'string', 'number', 'null', 'n/a', 'none', 'tbd')
      AND status NOT IN ('merged', 'deleted', 'archived')
    GROUP BY vin
    HAVING count(*) > 1
    LIMIT ${limit}
  `);

  const pairs = [];
  for (const row of result.rows) {
    for (let i = 1; i < row.ids.length; i++) {
      pairs.push([row.ids[0], row.ids[i]]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Find URL-normalized candidates (non-exact, requires normalization)
// ---------------------------------------------------------------------------
async function findUrlNormalizedCandidates(pool) {
  // Find JamesEdition-style URL variants not yet caught by exact dedup
  const result = await pool.query(`
    SELECT id::text, listing_url
    FROM vehicles
    WHERE source = 'jamesedition'
      AND listing_url IS NOT NULL
      AND status NOT IN ('merged', 'deleted', 'archived')
    ORDER BY listing_url
  `);

  // Group by extracted listing ID
  const byId = {};
  for (const row of result.rows) {
    const m = row.listing_url.match(/(\d{7,})/);
    if (!m) continue;
    const lid = m[1];
    if (!byId[lid]) byId[lid] = [];
    byId[lid].push(row.id);
  }

  const pairs = [];
  for (const [, ids] of Object.entries(byId)) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      pairs.push([ids[0], ids[i]]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const pool = getPool();

  // Ensure merge_proposals table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merge_proposals (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      vehicle_a_id uuid NOT NULL REFERENCES vehicles(id),
      vehicle_b_id uuid NOT NULL REFERENCES vehicles(id),
      detection_source text NOT NULL,
      ai_decision text NOT NULL CHECK (ai_decision IN ('MERGE', 'SKIP', 'REVIEW')),
      ai_confidence numeric(3,2),
      ai_reasoning text,
      preferred_primary text CHECK (preferred_primary IN ('A', 'B')),
      evidence jsonb,
      status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
      created_at timestamptz DEFAULT now(),
      executed_at timestamptz,
      UNIQUE(vehicle_a_id, vehicle_b_id)
    )
  `);

  if (executeApproved) {
    console.log('\n━━━ EXECUTING APPROVED MERGE PROPOSALS ━━━\n');

    const approved = await pool.query(`
      SELECT * FROM merge_proposals
      WHERE status = 'approved' AND ai_decision = 'MERGE'
      ORDER BY ai_confidence DESC
    `);

    console.log(`Found ${approved.rows.length} approved proposals\n`);

    let executed = 0;
    for (const p of approved.rows) {
      const primaryId = p.preferred_primary === 'B' ? p.vehicle_b_id : p.vehicle_a_id;
      const dupId = p.preferred_primary === 'B' ? p.vehicle_a_id : p.vehicle_b_id;

      try {
        const result = await pool.query(
          'SELECT merge_into_primary($1::uuid, $2::uuid) AS result',
          [primaryId, dupId]
        );
        const r = result.rows[0]?.result;
        if (r && !r.skipped) {
          await pool.query(
            "UPDATE merge_proposals SET status = 'executed', executed_at = now() WHERE id = $1",
            [p.id]
          );
          executed++;
          console.log(`  [OK] ${dupId.slice(0, 8)} → ${primaryId.slice(0, 8)}`);
        }
      } catch (e) {
        console.error(`  [ERR] ${p.id}: ${e.message.slice(0, 100)}`);
      }
    }

    console.log(`\nExecuted ${executed}/${approved.rows.length} merges`);
    await pool.end();
    return;
  }

  if (!source) {
    console.log('Usage:');
    console.log('  --source vin            Find and verify VIN duplicates');
    console.log('  --source url-normalized  Find URL-normalized duplicates');
    console.log('  --execute-approved       Execute approved merge proposals');
    console.log('  --limit N               Max candidates to process (default 50)');
    await pool.end();
    return;
  }

  console.log(`\n━━━ GENERATING MERGE PROPOSALS (source: ${source}) ━━━\n`);

  let pairs;
  if (source === 'vin') {
    pairs = await findVinCandidates(pool);
  } else if (source === 'url-normalized') {
    pairs = await findUrlNormalizedCandidates(pool);
  } else {
    console.log('Unknown source:', source);
    await pool.end();
    return;
  }

  console.log(`Found ${pairs.length} candidate pairs to verify\n`);

  let processed = 0;
  let decisions = { MERGE: 0, SKIP: 0, REVIEW: 0 };

  for (const [idA, idB] of pairs) {
    // Check if already proposed
    const existing = await pool.query(
      'SELECT 1 FROM merge_proposals WHERE (vehicle_a_id=$1 AND vehicle_b_id=$2) OR (vehicle_a_id=$2 AND vehicle_b_id=$1)',
      [idA, idB]
    );
    if (existing.rows.length > 0) continue;

    const evidence = await gatherEvidence(pool, idA, idB);
    if (!evidence) continue;

    console.log(`  Verifying: ${evidence.vehicleA.year || '?'} ${evidence.vehicleA.make || '?'} ${evidence.vehicleA.model || '?'} [${evidence.vehicleA.source}] vs ${evidence.vehicleB.year || '?'} ${evidence.vehicleB.make || '?'} ${evidence.vehicleB.model || '?'} [${evidence.vehicleB.source}]`);

    const aiResult = await aiVerifyPair(evidence);
    decisions[aiResult.decision] = (decisions[aiResult.decision] || 0) + 1;

    console.log(`    → ${aiResult.decision} (${(aiResult.confidence * 100).toFixed(0)}%) — ${aiResult.reasoning}`);

    // Store proposal
    await pool.query(`
      INSERT INTO merge_proposals (vehicle_a_id, vehicle_b_id, detection_source, ai_decision, ai_confidence, ai_reasoning, preferred_primary, evidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (vehicle_a_id, vehicle_b_id) DO UPDATE SET
        ai_decision = EXCLUDED.ai_decision,
        ai_confidence = EXCLUDED.ai_confidence,
        ai_reasoning = EXCLUDED.ai_reasoning,
        preferred_primary = EXCLUDED.preferred_primary
    `, [
      idA, idB, source,
      aiResult.decision,
      aiResult.confidence,
      aiResult.reasoning,
      aiResult.preferred_primary,
      JSON.stringify({ signals: evidence.signals, sharedImageHashes: evidence.sharedImageHashes })
    ]);

    processed++;
  }

  console.log(`\n━━━ COMPLETE ━━━`);
  console.log(`Processed: ${processed}`);
  console.log(`Decisions: MERGE=${decisions.MERGE} SKIP=${decisions.SKIP} REVIEW=${decisions.REVIEW}`);
  console.log(`\nApproved proposals can be executed with: --execute-approved`);

  await pool.end();
}

main().catch(console.error);
