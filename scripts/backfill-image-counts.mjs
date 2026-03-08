#!/usr/bin/env node
/**
 * backfill-image-counts.mjs
 *
 * Backfills image_count on vehicles that have images but image_count=0.
 * Uses cursor-paginated combined CTE via Supabase Management API.
 *
 * Usage:
 *   dotenvx run -- node scripts/backfill-image-counts.mjs
 *   dotenvx run -- node scripts/backfill-image-counts.mjs --batch-size 200
 *   dotenvx run -- node scripts/backfill-image-counts.mjs --dry-run
 */

const PROJECT_ID = 'qkgaybvrernstplzjaam';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

const args = process.argv.slice(2);
let BATCH_SIZE = 500;
let DRY_RUN = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--batch-size' && args[i + 1]) BATCH_SIZE = parseInt(args[++i]);
  if (args[i] === '--dry-run') DRY_RUN = true;
}

async function query(sql) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const data = await resp.json();
  if (data.message) throw new Error(data.message.slice(0, 200));
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Image count backfill | batch=${BATCH_SIZE} | dry_run=${DRY_RUN}`);

  // Get initial count
  const initial = await query(
    `SELECT count(*) FILTER (WHERE image_count > 0) as with_img FROM vehicles WHERE is_public = true;`
  );
  console.log(`Starting count: ${initial[0].with_img} vehicles with image_count > 0`);
  console.log('---');

  let cursor = '00000000-0000-0000-0000-000000000000';
  let totalUpdated = 0;
  let totalChecked = 0;
  let batchNum = 0;
  let consecutiveErrors = 0;
  const startTime = Date.now();

  while (true) {
    batchNum++;

    const sql = `SET statement_timeout = '90s';
WITH candidates AS (
  SELECT v.id
  FROM vehicles v
  WHERE v.image_count = 0
    AND v.is_public = true
    AND v.id > '${cursor}'
    AND EXISTS (
      SELECT 1 FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
        AND vi.is_duplicate IS NOT TRUE
    )
  ORDER BY v.id
  LIMIT ${BATCH_SIZE}
)${DRY_RUN ? `
SELECT count(*) as found, min(id)::text as first_id, max(id)::text as last_id FROM candidates;` : `,
counts AS (
  SELECT vi.vehicle_id, count(*) AS cnt
  FROM vehicle_images vi
  INNER JOIN candidates c ON c.id = vi.vehicle_id
  WHERE vi.is_duplicate IS NOT TRUE
  GROUP BY vi.vehicle_id
),
do_update AS (
  UPDATE vehicles v
  SET image_count = counts.cnt
  FROM counts
  WHERE v.id = counts.vehicle_id
  RETURNING v.id
)
SELECT count(d.id)::int as updated, max(c.id)::text as last_id
FROM candidates c
LEFT JOIN do_update d ON d.id = c.id;`}`;

    try {
      const result = await query(sql);
      consecutiveErrors = 0;

      const row = result[0];
      if (!row || !row.last_id) {
        // No candidates found - check if we've exhausted the UUID space
        // Jump forward through barren regions
        try {
          const jump = await query(
            `SELECT id::text FROM vehicles WHERE image_count = 0 AND is_public = true AND id > '${cursor}' ORDER BY id OFFSET 9999 LIMIT 1;`
          );
          if (jump[0]?.id) {
            cursor = jump[0].id;
            totalChecked += 10000;
            if (batchNum % 5 === 0) {
              console.log(`Batch ${batchNum}: skipped barren region, cursor=${cursor.slice(0, 8)}... (checked ~${totalChecked})`);
            }
            await sleep(200);
            continue;
          }
        } catch {
          // jump query failed, probably at end
        }
        console.log(`No more candidates. Total checked ~${totalChecked}`);
        break;
      }

      const updated = DRY_RUN ? parseInt(row.found || 0) : parseInt(row.updated || 0);
      cursor = row.last_id;
      totalUpdated += updated;
      totalChecked += BATCH_SIZE;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (totalUpdated / Math.max(1, elapsed)).toFixed(1);

      if (batchNum % 5 === 0 || updated > 0) {
        console.log(
          `Batch ${batchNum}: +${updated} | Total: ${totalUpdated} | ${elapsed}s | ${rate}/s | cursor=${cursor.slice(0, 8)}...`
        );
      }

      await sleep(300);
    } catch (err) {
      consecutiveErrors++;
      console.error(`Batch ${batchNum} error (${consecutiveErrors}x): ${err.message.slice(0, 100)}`);
      if (consecutiveErrors >= 5) {
        console.error('Too many consecutive errors, stopping.');
        break;
      }
      await sleep(3000 * consecutiveErrors);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('---');
  console.log(`DONE | Updated: ${totalUpdated} | Time: ${totalElapsed}s`);

  // Final verification
  const final = await query(
    `SELECT count(*) FILTER (WHERE image_count > 0) as with_img FROM vehicles WHERE is_public = true;`
  );
  console.log(`Final count: ${final[0].with_img} vehicles with image_count > 0`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
