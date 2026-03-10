#!/usr/bin/env node
// Fast snapshot migration — resilient to connection drops
// Usage: dotenvx run -- node scripts/migrate-snapshots.mjs [--workers 4] [--batch 10] [--concurrency 6]

import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "listing-snapshots";
const args = process.argv.slice(2);
const flag = (name) => args.find((_, i, a) => a[i - 1] === `--${name}`);
const WORKERS = parseInt(flag("workers") || "4");
const BATCH = parseInt(flag("batch") || "10");
const UPLOAD_CONCURRENCY = parseInt(flag("concurrency") || "6");

const DB_URL = "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

let pool = createPool();

function createPool() {
  const p = new pg.Pool({
    connectionString: DB_URL,
    max: WORKERS + 4,
    statement_timeout: 120000,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
  });
  p.on("error", (err) => {
    console.error(`\n[Pool] ${err.message}`);
  });
  return p;
}

// Query with timeout — prevents workers from hanging forever
async function queryWithTimeout(sql, params, timeoutMs = 90000) {
  return Promise.race([
    pool.query(sql, params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Query timeout")), timeoutMs),
    ),
  ]);
}

function buildPath(platform, fetchedAt, id, ext) {
  const d = new Date(fetchedAt);
  return `${platform}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${id}.${ext}`;
}

let totalMigrated = 0;
let totalBytes = 0;
let totalErrors = 0;
const startTime = Date.now();

function printProgress(remaining) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = elapsed > 0 ? (totalMigrated / (elapsed / 60)).toFixed(0) : "0";
  const mbMoved = (totalBytes / 1024 / 1024).toFixed(0);
  const eta = totalMigrated > 0 ? (remaining / (totalMigrated / elapsed) / 3600).toFixed(1) : "?";
  process.stdout.write(
    `\r[${elapsed.toFixed(0)}s] ${totalMigrated} done | ${mbMoved} MB | ${rate}/min | ETA ${eta}h | ${totalErrors} err | ${remaining} left    `,
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

let globalRemaining = 0;

async function worker(id) {
  let idle = 0;
  let consecutiveErrors = 0;
  while (true) {
    let client;
    try {
      client = await pool.connect();

      // Step 1: Claim IDs only (no TOAST — fast)
      const { rows: claimed } = await client.query(
        `UPDATE listing_page_snapshots
         SET html_storage_path = 'claiming'
         WHERE id IN (
           SELECT id FROM listing_page_snapshots
           WHERE html_storage_path IS NULL AND success = true AND content_length > 0
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         ) RETURNING id`,
        [BATCH],
      );
      client.release();
      client = null;
      consecutiveErrors = 0;

      if (!claimed.length) {
        idle++;
        if (idle > 3) { console.log(`\n[W${id}] No more rows. Done.`); return; }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      idle = 0;
      const claimedIds = claimed.map((r) => r.id);

      // Step 2: Read HTML (separate query, with timeout)
      const { rows } = await queryWithTimeout(
        `SELECT id, platform, fetched_at, html, markdown FROM listing_page_snapshots WHERE id = ANY($1)`,
        [claimedIds],
        90000,
      );

      // Upload concurrently
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

      // Batch mark migrated
      if (uploaded.length) {
        const ids = uploaded.map((u) => u.id);
        const htmlPaths = uploaded.map((u) => u.htmlPath);
        const mdPaths = uploaded.map((u) => u.mdPath);
        await queryWithTimeout(
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
        globalRemaining -= uploaded.length;
      }

      // Unclaim failures
      if (failed.length) {
        await queryWithTimeout(
          `UPDATE listing_page_snapshots SET html_storage_path = NULL
           WHERE id = ANY($1) AND html_storage_path = 'claiming'`,
          [failed],
        );
      }

      printProgress(globalRemaining);
    } catch (e) {
      if (client) { try { client.release(true); } catch (_) {} }
      consecutiveErrors++;
      console.error(`\n[W${id}] Error #${consecutiveErrors}: ${e.message}`);

      // On connection errors, recreate pool
      if (e.message.includes("DbHandler") || e.message.includes("timeout") || e.message.includes("terminated") || e.message.includes("Connection")) {
        console.error(`\n[W${id}] Pool reset due to connection issue`);
        try { await pool.end(); } catch (_) {}
        pool = createPool();
      }

      if (consecutiveErrors > 15) {
        console.error(`\n[W${id}] Too many errors, stopping.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 2000 + consecutiveErrors * 1000));
    }
  }
}

process.on("uncaughtException", (err) => {
  console.error(`\n[FATAL] ${err.message}`);
});

// Quick count
const { rows: [{ cnt }] } = await pool.query(
  `SELECT COUNT(*)::INT as cnt FROM listing_page_snapshots
   WHERE html_storage_path IS NULL AND success = true AND content_length > 0`,
);
globalRemaining = cnt;
console.log(`Starting: ${cnt} snapshots | ${WORKERS} workers | batch ${BATCH} | ${UPLOAD_CONCURRENCY} concurrent uploads/worker`);
console.log(`Pool: ${pool.options.max} connections | Query timeout: 90s\n`);

const workers = [];
for (let i = 0; i < WORKERS; i++) {
  workers.push(worker(i));
  await new Promise((r) => setTimeout(r, 300));
}
await Promise.all(workers);
try { await pool.end(); } catch (_) {}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
console.log(`\n\nDone! ${totalMigrated} migrated, ${(totalBytes / 1024 / 1024).toFixed(0)} MB in ${elapsed}s, ${totalErrors} errors`);
