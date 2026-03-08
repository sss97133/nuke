#!/usr/bin/env node
// Fast snapshot migration — parallel uploads, no contention
// Usage: dotenvx run -- node scripts/migrate-snapshots.mjs [--workers 4] [--batch 50] [--concurrency 6]

import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "listing-snapshots";
const args = process.argv.slice(2);
const flag = (name) => args.find((_, i, a) => a[i - 1] === `--${name}`);
const WORKERS = parseInt(flag("workers") || "4");
const BATCH = parseInt(flag("batch") || "50");
const UPLOAD_CONCURRENCY = parseInt(flag("concurrency") || "6");

const DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const pool = new pg.Pool({
  connectionString: DB_URL,
  max: WORKERS + 4,
  statement_timeout: 300000,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Prevent unhandled pool errors from crashing the process
pool.on("error", (err) => {
  console.error(`\n[Pool] Connection error (non-fatal): ${err.message}`);
});

function buildPath(platform, fetchedAt, id, ext) {
  const d = new Date(fetchedAt);
  return `${platform}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${id}.${ext}`;
}

let totalMigrated = 0;
let totalBytes = 0;
let totalErrors = 0;
const startTime = Date.now();
const REMAINING_EST = 598000;

function printProgress() {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = elapsed > 0 ? (totalMigrated / (elapsed / 60)).toFixed(0) : "0";
  const mbMoved = (totalBytes / 1024 / 1024).toFixed(0);
  const eta = totalMigrated > 0 ? ((REMAINING_EST - totalMigrated) / (totalMigrated / elapsed) / 3600).toFixed(1) : "?";
  process.stdout.write(
    `\r[${elapsed.toFixed(0)}s] ${totalMigrated} done | ${mbMoved} MB | ${rate}/min | ETA ${eta}h | ${totalErrors} err    `,
  );
}

async function uploadOne(row) {
  const platform = row.platform || "unknown";
  const fetchedAt = row.fetched_at?.toISOString() || new Date().toISOString();
  const htmlPath = buildPath(platform, fetchedAt, row.id, "html");
  const htmlBytes = Buffer.from(row.html, "utf-8");
  let bytes = htmlBytes.length;

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(htmlPath, htmlBytes, { contentType: "text/html", upsert: true });
  if (uploadErr) throw new Error(`Upload ${row.id}: ${uploadErr.message}`);

  let mdPath = null;
  if (row.markdown) {
    mdPath = buildPath(platform, fetchedAt, row.id, "md");
    const mdBytes = Buffer.from(row.markdown, "utf-8");
    bytes += mdBytes.length;
    await supabase.storage
      .from(BUCKET)
      .upload(mdPath, mdBytes, { contentType: "text/markdown", upsert: true });
  }

  return { id: row.id, htmlPath, mdPath, bytes };
}

async function worker(id) {
  let idle = 0;
  let consecutiveErrors = 0;
  while (true) {
    let client;
    try {
      client = await pool.connect();

      // Claim + read in one query using FOR UPDATE SKIP LOCKED
      const { rows } = await client.query(
        `WITH claimed AS (
           SELECT id FROM listing_page_snapshots
           WHERE html_storage_path IS NULL AND success = true AND content_length > 0
           ORDER BY content_length ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE listing_page_snapshots lps
         SET html_storage_path = 'claiming'
         FROM claimed
         WHERE lps.id = claimed.id
         RETURNING lps.id, lps.platform, lps.fetched_at, lps.html, lps.markdown`,
        [BATCH],
      );
      client.release();
      client = null;
      consecutiveErrors = 0;

      if (!rows.length) {
        idle++;
        if (idle > 3) { console.log(`\n[W${id}] No more rows. Done.`); return; }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      idle = 0;

      // Upload concurrently (no DB connections needed for uploads)
      const uploaded = [];
      const failed = [];
      let idx = 0;
      const uploadWorkers = Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, rows.length) },
        async () => {
          while (idx < rows.length) {
            const i = idx++;
            const row = rows[i];
            if (!row.html) { failed.push(row.id); continue; }
            try {
              uploaded.push(await uploadOne(row));
            } catch (e) {
              totalErrors++;
              if (totalErrors <= 20) console.error(`\n[W${id}] ${e.message}`);
              failed.push(row.id);
            }
          }
        },
      );
      await Promise.all(uploadWorkers);

      // Batch mark migrated in DB
      if (uploaded.length) {
        const ids = uploaded.map((u) => u.id);
        const htmlPaths = uploaded.map((u) => u.htmlPath);
        const mdPaths = uploaded.map((u) => u.mdPath);
        await pool.query(
          `UPDATE listing_page_snapshots
           SET html_storage_path = paths.hp,
               markdown_storage_path = paths.mp,
               html = NULL,
               markdown = NULL
           FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::text[]) AS hp, unnest($3::text[]) AS mp) paths
           WHERE listing_page_snapshots.id = paths.id`,
          [ids, htmlPaths, mdPaths],
        );
        totalMigrated += uploaded.length;
        for (const u of uploaded) totalBytes += u.bytes;
      }

      // Unclaim failures
      if (failed.length) {
        await pool.query(
          `UPDATE listing_page_snapshots SET html_storage_path = NULL
           WHERE id = ANY($1) AND html_storage_path = 'claiming'`,
          [failed],
        );
      }

      printProgress();
    } catch (e) {
      if (client) { try { client.release(true); } catch (_) {} }
      consecutiveErrors++;
      console.error(`\n[W${id}] Error #${consecutiveErrors}: ${e.message}`);
      if (consecutiveErrors > 10) {
        console.error(`\n[W${id}] Too many consecutive errors, stopping.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 3000 + consecutiveErrors * 1000));
    }
  }
}

process.on("uncaughtException", (err) => {
  console.error(`\n[FATAL] ${err.message}`);
  // Don't exit — let workers finish gracefully
});

// Quick count
const { rows: [{ cnt }] } = await pool.query(
  `SELECT COUNT(*)::INT as cnt FROM listing_page_snapshots
   WHERE html_storage_path IS NULL AND success = true AND content_length > 0`,
);
console.log(`Starting: ${cnt} snapshots | ${WORKERS} workers | batch ${BATCH} | ${UPLOAD_CONCURRENCY} concurrent uploads/worker`);
console.log(`Max concurrent uploads: ${WORKERS * UPLOAD_CONCURRENCY} | Pool: ${pool.options.max} connections\n`);

const workers = [];
for (let i = 0; i < WORKERS; i++) {
  workers.push(worker(i));
  await new Promise((r) => setTimeout(r, 300));
}
await Promise.all(workers);
await pool.end();

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
console.log(`\n\nDone! ${totalMigrated} migrated, ${(totalBytes / 1024 / 1024).toFixed(0)} MB in ${elapsed}s, ${totalErrors} errors`);
