#!/usr/bin/env node
/**
 * Comment Refinery — Batch triage by vehicle ($0 cost)
 *
 * Gets top vehicles by comment count, triages each one via the edge function.
 * Then kicks off local Ollama extraction.
 *
 * Usage:
 *   dotenvx run -- node scripts/refinery-triage-batch.mjs [--max-vehicles 500] [--extract]
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const maxVehicles = parseInt(getArg('--max-vehicles') || '100', 10);
const doExtract = args.includes('--extract');

async function main() {
  console.log(`\n📊 Comment Refinery — Batch Triage`);
  console.log(`   Max vehicles: ${maxVehicles}\n`);

  // Use vehicle_events (pre-aggregated comment_count) — fast, no GROUP BY on 11M rows
  const { data: topVehicles, error } = await supabase.rpc('execute_sql', {
    query: `
      SELECT ve.vehicle_id, ve.comment_count, v.year, v.make, v.model
      FROM vehicle_events ve
      JOIN vehicles v ON v.id = ve.vehicle_id AND v.deleted_at IS NULL
      WHERE ve.source_platform = 'bat'
        AND ve.vehicle_id IS NOT NULL
        AND ve.comment_count >= 5
        AND NOT EXISTS (
          SELECT 1 FROM comment_claims_progress ccp
          WHERE ccp.vehicle_id = ve.vehicle_id
          LIMIT 1
        )
      ORDER BY ve.comment_count DESC
      LIMIT ${maxVehicles}
    `
  });

  if (error) {
    console.error('❌ Query error:', error.message);
    process.exit(1);
  }

  if (!topVehicles?.length) {
    console.log('✅ All vehicles already triaged.');
    return;
  }

  console.log(`📋 ${topVehicles.length} vehicles to triage (${topVehicles[0].comment_count} to ${topVehicles[topVehicles.length - 1].comment_count} comments each)\n`);

  let totalTriaged = 0, totalPassed = 0;

  for (let i = 0; i < topVehicles.length; i++) {
    const v = topVehicles[i];
    const label = `${v.year || '?'} ${v.make || '?'} ${v.model || '?'}`;

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/analyze-comments-fast`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'claim_triage',
        vehicle_id: v.vehicle_id,
        batch_size: 500,
      }),
    });

    const result = await resp.json();
    totalTriaged += result.triaged || 0;
    totalPassed += result.passed_filter || 0;

    if ((i + 1) % 10 === 0 || i === topVehicles.length - 1) {
      console.log(`   [${i + 1}/${topVehicles.length}] ${label} — ${result.triaged || 0} triaged, ${result.passed_filter || 0} passed (${result.pass_rate || 0}%)`);
    }
  }

  console.log(`\n✅ Triage complete: ${totalTriaged} comments triaged, ${totalPassed} passed filter (${totalTriaged > 0 ? Math.round(totalPassed / totalTriaged * 100) : 0}%)`);

  // Show how many are ready for extraction
  const { count } = await supabase
    .from('comment_claims_progress')
    .select('id', { count: 'exact', head: true })
    .eq('llm_processed', false)
    .gte('claim_density_score', 0.3);

  console.log(`📬 ${count || 0} comments ready for LLM extraction\n`);

  if (doExtract && count > 0) {
    console.log('🚀 Starting local Ollama extraction...\n');
    const { execSync } = await import('child_process');
    execSync('dotenvx run -- node scripts/refinery-extract-claims.mjs --all --max-vehicles 500 --model qwen2.5:7b', { stdio: 'inherit' });
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
