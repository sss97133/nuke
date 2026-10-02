#!/usr/bin/env node
/** Existing broadcast worker: validated source-grain preparation and read-only queue status.
 *
 * The former global lot/YMM matcher attached Kissimmee 2026 footage to older, unrelated lots,
 * guessed span ends and overwrote auction results. That write path is retired here.
 *
 * node scripts/broadcast-backfill-worker.ts --receipt staged.json --output validated.json
 * node scripts/broadcast-backfill-worker.ts --status
 *
 * Preparation is offline. Writes belong to ingest-observation, then receipt verification.
 * Source discovery is provisional; this contract does not imply every broadcast has this shape.
 */
import * as fs from 'node:fs';
import { prepareBroadcastReceipt, assayBroadcastReceipt } from './lib/broadcast-evidence.mjs';

async function main() {
  const args = process.argv.slice(2);
  const receiptFlag = args.indexOf('--receipt');
  if (receiptFlag >= 0) {
    const receiptPath = args[receiptFlag + 1];
    if (!receiptPath) throw new Error('--receipt requires a JSON file');
    const observations = prepareBroadcastReceipt(JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
    const result = { mode: 'validated_dry_run', observations,
      options: { stop_on_error: true, gap_fill: false, write_evidence: false },
      assay: assayBroadcastReceipt(observations) };
    const outputFlag = args.indexOf('--output');
    if (outputFlag >= 0) {
      const outputPath = args[outputFlag + 1];
      if (!outputPath) throw new Error('--output requires a path');
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ mode: result.mode, output: outputPath, assay: result.assay }, null, 2));
    } else console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.includes('--status')) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.from('broadcast_backfill_queue')
      .select('id,video_id,auction_house,auction_name,broadcast_date,duration_seconds,status,lots_extracted,lots_linked,error_message')
      .order('priority', { ascending: false });
    if (error) throw error;
    console.log(JSON.stringify({ queue: data, semantics: 'Queue status is not a source-coverage assay.' }, null, 2));
    return;
  }
  throw new Error('Automatic legacy matching is disabled. Use --receipt for validated source-grain preparation.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
