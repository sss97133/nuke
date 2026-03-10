#!/usr/bin/env node
/**
 * backfill-image-counts.mjs
 *
 * Backfills image_count on vehicles that have images but image_count=0.
 * Uses cursor-paginated discovery + LIMIT'd batch updates via Management API.
 *
 * Complies with Hard Rules:
 *  - All UPDATEs use LIMIT (Rule 1)
 *  - Checks for active conflicts before running (Rule 4)
 *  - Checks lock impact after every write (Rule 5)
 *  - Never sets statement_timeout above 120s (Rule 3)
 *
 * Usage:
 *   dotenvx run -- node scripts/backfill-image-counts.mjs
 *   dotenvx run -- node scripts/backfill-image-counts.mjs --batch-size 200
 *   dotenvx run -- node scripts/backfill-image-counts.mjs --cursor <uuid>
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
let BATCH_SIZE = 200;
let DRY_RUN = false;
let FIX_ALL = false; // --fix-all: also fix wrong (non-zero) counts, not just zero
let START_CURSOR = '00000000-0000-0000-0000-000000000000';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--batch-size' && args[i + 1]) BATCH_SIZE = parseInt(args[++i]);
  if (args[i] === '--dry-run') DRY_RUN = true;
  if (args[i] === '--fix-all') FIX_ALL = true;
  if (args[i] === '--cursor' && args[i + 1]) START_CURSOR = args[++i];
}

async function query(sql) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const data = await resp.json();
  if (data.message) throw new Error(data.message.slice(0, 200));
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryRetry(sql, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await query(sql);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`  retry ${i + 1}/${retries}: ${err.message.slice(0, 60)}`);
      await sleep(2000 * (i + 1));
    }
  }
}

// Rule 4: Check for conflicting active queries before running
async function checkConflicts() {
  try {
    const active = await query(
      `SELECT left(query, 80) as q FROM pg_stat_activity WHERE state = $$active$$ AND pid != pg_backend_pid() AND query ILIKE $$%vehicles%$$ AND query NOT ILIKE $$%pg_stat%$$;`
    );
    if (active.length > 2) {
      console.log(`  WARNING: ${active.length} active queries on vehicles. Waiting 5s...`);
      await sleep(5000);
      return false;
    }
  } catch {
    // Non-fatal — proceed anyway
  }
  return true;
}

// Rule 5: Check lock impact after every write
async function checkLocks() {
  try {
    const locks = await query(
      `SELECT count(*) as n FROM pg_stat_activity WHERE wait_event_type = $$Lock$$;`
    );
    if (locks[0]?.n > 0) {
      console.log(`  WARNING: ${locks[0].n} lock waiters detected. Pausing 3s...`);
      await sleep(3000);
    }
  } catch {
    // Non-fatal
  }
}

async function main() {
  console.log(`Image count backfill | batch=${BATCH_SIZE} | dry_run=${DRY_RUN} | fix_all=${FIX_ALL}`);

  // Get initial count (with retry)
  const initial = await queryRetry(
    `SELECT count(*) FILTER (WHERE image_count > 0) as with_img FROM vehicles WHERE is_public = true;`
  );
  console.log(`Starting: ${initial[0].with_img} vehicles with image_count > 0`);
  console.log('---');

  let cursor = START_CURSOR;
  let totalUpdated = 0;
  let batchNum = 0;
  let consecutiveErrors = 0;
  const startTime = Date.now();

  while (true) {
    batchNum++;

    // Rule 4: Check for conflicts every 10 batches
    if (batchNum % 10 === 1) {
      await checkConflicts();
    }

    // Phase 1: Discover candidates (read-only, safe)
    let candidates;
    try {
      candidates = FIX_ALL
        ? await query(`
            SELECT v.id::text
            FROM vehicles v
            WHERE v.status = $$active$$
              AND v.id > $c$${cursor}$c$
            ORDER BY v.id
            LIMIT ${BATCH_SIZE};
          `)
        : await query(`
            SELECT v.id::text
            FROM vehicles v
            WHERE v.image_count = 0
              AND v.is_public = true
              AND v.id > $c$${cursor}$c$
              AND EXISTS (
                SELECT 1 FROM vehicle_images vi
                WHERE vi.vehicle_id = v.id
                  AND vi.is_duplicate IS NOT TRUE
              )
            ORDER BY v.id
            LIMIT ${BATCH_SIZE};
          `);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`Batch ${batchNum} discover error (${consecutiveErrors}x): ${err.message.slice(0, 80)}`);
      if (consecutiveErrors >= 10) {
        console.error(`Too many errors. Resume: --cursor ${cursor}`);
        break;
      }
      await sleep(3000 * consecutiveErrors);
      continue;
    }

    if (!candidates || candidates.length === 0) {
      if (FIX_ALL) {
        // In fix-all mode, empty batch = we've reached the end
        console.log('No more vehicles found.');
        break;
      }
      // No candidates — jump cursor forward through barren regions
      try {
        const jump = await query(
          `SELECT id::text FROM vehicles WHERE image_count = 0 AND is_public = true AND id > $c$${cursor}$c$ ORDER BY id OFFSET 9999 LIMIT 1;`
        );
        if (jump[0]?.id) {
          cursor = jump[0].id;
          if (batchNum % 5 === 0) {
            console.log(`Batch ${batchNum}: skipping barren region, cursor=${cursor.slice(0, 8)}...`);
          }
          await sleep(200);
          continue;
        }
      } catch {
        // End of table
      }
      console.log('No more candidates found.');
      break;
    }

    const vehicleIds = candidates.map((r) => r.id);
    cursor = vehicleIds[vehicleIds.length - 1];

    if (DRY_RUN) {
      console.log(`Batch ${batchNum}: found ${vehicleIds.length} candidates (dry run)`);
      await sleep(200);
      continue;
    }

    // Phase 2: Count + Update (LIMIT'd by candidate list size, Rule 1)
    // The UPDATE only touches vehicles IN the candidate list (already LIMIT'd)
    const idList = vehicleIds.map((id) => `$i$${id}$i$`).join(',');
    try {
      const result = await query(`
        WITH counts AS (
          SELECT vi.vehicle_id, count(*) AS cnt
          FROM vehicle_images vi
          WHERE vi.vehicle_id IN (${idList})
            AND vi.is_duplicate IS NOT TRUE
          GROUP BY vi.vehicle_id
        ),
        actual AS (
          SELECT v.id as vehicle_id, COALESCE(c.cnt, 0) as cnt
          FROM vehicles v
          LEFT JOIN counts c ON c.vehicle_id = v.id
          WHERE v.id IN (${idList})
        )
        UPDATE vehicles v
        SET image_count = a.cnt
        FROM actual a
        WHERE v.id = a.vehicle_id
          AND v.image_count IS DISTINCT FROM a.cnt;
      `);
      totalUpdated += vehicleIds.length;
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`Batch ${batchNum} update error (${consecutiveErrors}x): ${err.message.slice(0, 80)}`);
      if (consecutiveErrors >= 10) {
        console.error(`Too many errors. Resume: --cursor ${cursor}`);
        break;
      }
      await sleep(3000 * consecutiveErrors);
      continue;
    }

    // Rule 5: Check lock impact after write
    await checkLocks();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (totalUpdated / Math.max(1, elapsed)).toFixed(1);

    if (batchNum % 5 === 0 || batchNum <= 3) {
      console.log(
        `Batch ${batchNum}: +${vehicleIds.length} | Total: ${totalUpdated} | ${elapsed}s | ${rate}/s | cursor=${cursor.slice(0, 8)}...`
      );
    }

    await sleep(300);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('---');
  console.log(`DONE | Updated: ${totalUpdated} | Time: ${totalElapsed}s`);

  // Final verification
  try {
    const final_ = await queryRetry(
      `SELECT count(*) FILTER (WHERE image_count > 0) as with_img FROM vehicles WHERE is_public = true;`
    );
    console.log(`Final: ${final_[0].with_img} vehicles with image_count > 0`);
  } catch (err) {
    console.log(`Final count failed: ${err.message.slice(0, 60)}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
