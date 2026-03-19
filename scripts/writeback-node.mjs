#!/usr/bin/env node
/**
 * writeback-node.mjs — Write extraction results to DB via pg client
 * Usage: dotenvx run -- node scripts/writeback-node.mjs
 */
import pg from 'pg';
import { createReadStream, readFileSync, appendFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

const RESULTS = '/Users/skylar/nuke/data/descriptions-results.jsonl';
const WRITTEN = '/Users/skylar/nuke/data/descriptions-written-ids.txt';

async function main() {
  const client = new pg.Client({
    host: '54.177.55.191',
    port: 6543,
    user: 'postgres.qkgaybvrernstplzjaam',
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected to DB');

  if (!existsSync(WRITTEN)) appendFileSync(WRITTEN, '');
  const writtenSet = new Set(readFileSync(WRITTEN, 'utf8').trim().split('\n').filter(Boolean));
  console.log(`Already written: ${writtenSet.size}`);

  const rl = createInterface({ input: createReadStream(RESULTS) });
  let written = 0, fills = 0, errors = 0, skipped = 0;

  for await (const line of rl) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (writtenSet.has(r.id)) { skipped++; continue; }
    if (!r.fills || Object.keys(r.fills).length === 0) {
      appendFileSync(WRITTEN, r.id + '\n');
      skipped++;
      continue;
    }

    try {
      const setClauses = [];
      const vals = [];
      let i = 1;
      for (const [k, v] of Object.entries(r.fills)) {
        if (v === null || v === undefined) continue;
        if (k === 'modifications') {
          setClauses.push(`${k} = $${i}::jsonb`);
          vals.push(JSON.stringify(v));
        } else {
          setClauses.push(`${k} = $${i}`);
          vals.push(v);
        }
        i++;
      }
      if (setClauses.length === 0) { appendFileSync(WRITTEN, r.id + '\n'); continue; }

      await client.query(
        `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = $${i} AND status = 'active'`,
        [...vals, r.id]
      );

      await client.query(
        `INSERT INTO description_discoveries (vehicle_id, discovered_at, model_used, prompt_version, raw_extraction, keys_found, total_fields)
         VALUES ($1, now(), 'qwen2.5:7b', 'local-v1', $2::jsonb, $3, 30)
         ON CONFLICT (vehicle_id) DO UPDATE SET raw_extraction = EXCLUDED.raw_extraction, discovered_at = EXCLUDED.discovered_at, keys_found = EXCLUDED.keys_found`,
        [r.id, JSON.stringify(r.extraction), r.non_null]
      );

      written++;
      fills += setClauses.length;
      appendFileSync(WRITTEN, r.id + '\n');

      if (written % 50 === 0) console.log(`  ${written} written, ${fills} fills, ${errors} err`);
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`Error ${r.id}: ${err.message}`);
      // Still mark as written to avoid retrying bad data
      appendFileSync(WRITTEN, r.id + '\n');
    }
  }

  await client.end();
  console.log(`\nDone: ${written} vehicles, ${fills} col fills, ${errors} errors, ${skipped} skipped`);
}

main().catch(console.error);
