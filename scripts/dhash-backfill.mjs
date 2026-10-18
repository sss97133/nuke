/**
 * dhash-backfill.mjs — Backfill image_identities.phash_hex (node-canvas dHash)
 *
 * Task #7: storage-etag-rooted identities carry no perceptual hash. Compute the
 * canonical node-canvas 9x8 dHash (VERBATIM from scripts/compute-hero-fingerprints.mjs)
 * and write it to image_identities.phash_hex WHERE phash_hex IS NULL only.
 *
 * HARD RULES (team lead):
 *  - Write ONLY image_identities.phash_hex, ONLY where NULL. Never overwrite. No deletes.
 *  - phash_hex has a UNIQUE index. On collision (23505) DO NOT write — log the pair to
 *    output/dhash-backfill-collisions.jsonl. Collisions = probable dup identities.
 *  - Batches of ~150, resumable (re-query NULL each batch), progress to logs/dhash-backfill.log
 *  - If >20% of a batch errors (fetch/decode), stop and report.
 *
 * TWO PHASES (decoupled because the identity->url map is the expensive part on a
 * 38.75M-row unindexed vehicle_images):
 *
 *   node dhash-backfill.mjs --build-map           # Phase 1a: fast, needs index on
 *                                                 #   vehicle_images(image_identity_id)
 *   node dhash-backfill.mjs --build-map --bucket  # Phase 1b: no index; 256 uuid-prefix
 *                                                 #   range scans w/ enable_seqscan=off (~hours)
 *   node dhash-backfill.mjs --run                 # Phase 2: read map, compute+write, resumable
 *   node dhash-backfill.mjs --probe               # counts only
 *
 * Map file: output/dhash-identity-url-map.jsonl  {"id":"<uuid>","url":"http..."|null}
 */

import pg from "pg";
import { createCanvas, loadImage } from "canvas";
import https from "https";
import http from "http";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "fs";

const REPO = "/Users/skylar/nuke";
const LOG_PATH = `${REPO}/logs/dhash-backfill.log`;
const COLLISION_PATH = `${REPO}/output/dhash-backfill-collisions.jsonl`;
const MAP_PATH = `${REPO}/output/dhash-identity-url-map.jsonl`;
// Fetch-failed and collided ids stay NULL forever, so a resume front-loads them
// into batch#1 and trips the 20% abort gate (seen 2026-07-07: 43% on restart).
// Record fetch failures here and exclude them (plus collision-file ids) from todo.
const DEAD_PATH = `${REPO}/output/dhash-backfill-deadurls.jsonl`;
try { mkdirSync(`${REPO}/logs`, { recursive: true }); } catch {}
try { mkdirSync(`${REPO}/output`, { recursive: true }); } catch {}

const args = process.argv.slice(2);
const MODE = args.includes("--gate") ? "gate"
  : args.includes("--build-map") ? "build-map"
  : args.includes("--run") ? "run" : "probe";
const BUCKET_MODE = args.includes("--bucket");
const BATCH = args.includes("--batch") ? parseInt(args[args.indexOf("--batch") + 1], 10) : 150;
const MAX_BATCHES = args.includes("--max-batches") ? parseInt(args[args.indexOf("--max-batches") + 1], 10) : Infinity;
const FETCH_CONCURRENCY = 4;
// Perceptual space tag (team-lead census bookkeeping): this backfill + the local
// Mac index are the one matchable space. Pre-existing 11,681 phash + 253 legacy
// raw-16hex are OTHER spaces (sha256-tier), never hamming-matched against these.
const HASH_SPACE = "dhash boxmean/area-avg 9x8 v2";
const FETCH_TIMEOUT = 15000;
const ERROR_ABORT_FRAC = 0.20;
const SLEEP_MS = 150;

const DB_URL = process.env.SUPABASE_DB_URL
  || `postgresql://postgres.qkgaybvrernstplzjaam:${process.env.SUPABASE_DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

// ---- dHash bit-packing (row-major left>right, MSB-first nibbles) ----
// Same bit logic as compute-hero-fingerprints.mjs / dedup-vehicle-images.
function computeDHash(grayscale, width, height) {
  const bits = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      bits.push(grayscale[y * width + x] > grayscale[y * width + x + 1] ? 1 : 0);
    }
  }
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
  }
  return hex;
}

// ---- AREA-AVERAGED 9x8 luma (box-mean over decoded pixels) ----
// The cross-runtime common space verified 2026-07-07 (DHash.swift): CGContext.draw
// area-averages at extreme downscale, but node-canvas drawImage(9,8) does NOT — it
// measured mean hamming 17.8 vs the Swift hash on identical bytes (space-breaking).
// So decode to native pixels and box-mean to 9x8 ourselves. luma is linear in R,G,B
// so avg-then-luma == luma-then-avg. Worst-case cross-runtime with box-mean: ~4 bits.
// Match the team-lead's reference node-boxmean.mjs, which decodes at NATIVE (no
// resampler in the trust path). Cap set above any real corpus image (max seen
// ~5712px) so scale is effectively always 1 → byte-identical to the reference.
// Only a pathological >8192px image would get a mild pre-scale.
const GRID_CAP = 8192;
function computeDHashAreaAvg(img) {
  const W0 = img.width, H0 = img.height;
  if (!W0 || !H0) return null;
  const scale = Math.min(1, GRID_CAP / Math.max(W0, H0));
  const W = Math.max(9, Math.round(W0 * scale));
  const H = Math.max(8, Math.round(H0 * scale));
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H); // scale===1 for the vast majority → true decoded pixels
  const data = ctx.getImageData(0, 0, W, H).data;
  const gw = 9, gh = 8;
  const grayscale = new Array(gw * gh);
  for (let oy = 0; oy < gh; oy++) {
    const y0 = Math.floor((oy * H) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * H) / gh));
    for (let ox = 0; ox < gw; ox++) {
      const x0 = Math.floor((ox * W) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * W) / gw));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
        }
      }
      grayscale[oy * gw + ox] = (0.299 * sr + 0.587 * sg + 0.114 * sb) / n;
    }
  }
  return computeDHash(grayscale, gw, gh);
}

async function computeDHashFromUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) return null;
  try { new URL(imageUrl); } catch { return null; }
  const imgBuffer = await fetchImageBuffer(imageUrl);
  if (!imgBuffer || imgBuffer.length < 100) return null;
  try {
    const img = await loadImage(imgBuffer);
    return computeDHashAreaAvg(img);
  } catch { return null; }
}
function fetchImageBuffer(url, redirects = 0) {
  if (redirects > 3) return Promise.resolve(null);
  if (!url || !url.startsWith("http")) return Promise.resolve(null);
  return new Promise((resolve) => {
    try { new URL(url); } catch { return resolve(null); }
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, { timeout: FETCH_TIMEOUT }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let r = res.headers.location;
        if (r.startsWith("/")) { const u = new URL(url); r = `${u.protocol}//${u.host}${r}`; }
        res.resume(); resolve(fetchImageBuffer(r, redirects + 1)); return;
      }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}
async function parallelLimit(tasks, limit) {
  const results = []; let idx = 0;
  async function worker() { while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); } }
  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(line) {
  const msg = `${new Date().toISOString()} ${line}`;
  console.log(msg);
  try { appendFileSync(LOG_PATH, msg + "\n"); } catch {}
}
async function retry(fn, n = 5) {
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { if (i === n - 1) throw e; await sleep(1500 * (i + 1)); } }
}
function loadMap() {
  const m = new Map();
  if (!existsSync(MAP_PATH)) return m;
  for (const line of readFileSync(MAP_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); m.set(r.id, r.url || null); } catch {}
  }
  return m;
}

// ---------- Phase 1: build identity -> url map ----------
async function buildMap(pool) {
  await retry(() => pool.query("set statement_timeout=115000"));
  const have = loadMap();
  log(`[map] existing map entries: ${have.size} (mode=${BUCKET_MODE ? "bucket" : "index"})`);

  if (!BUCKET_MODE) {
    // Fast path: needs index on vehicle_images(image_identity_id). Correlated
    // index-probe per NULL identity, paged by identity id.
    let cursor = "00000000-0000-0000-0000-000000000000";
    let done = 0, withUrl = 0;
    for (;;) {
      // Prefer uncropped full/large; fall back to medium/thumbnail/preview.
      // Box-mean is resolution-robust (0-2 bits across sizes) so any aspect-
      // preserving variant yields the same hash — this only rescues reachability.
      const page = await retry(() => pool.query({
        text: `select ii.id,
                 (select coalesce(
                     case when vi.image_url     like 'http%' then vi.image_url end,
                     case when vi.large_url      like 'http%' then vi.large_url end,
                     case when vi.medium_url     like 'http%' then vi.medium_url end,
                     case when vi.thumbnail_url  like 'http%' then vi.thumbnail_url end,
                     case when vi.safe_preview_url like 'http%' then vi.safe_preview_url end)
                    from vehicle_images vi
                    where vi.image_identity_id = ii.id
                      and (vi.image_url like 'http%' or vi.large_url like 'http%'
                           or vi.medium_url like 'http%' or vi.thumbnail_url like 'http%'
                           or vi.safe_preview_url like 'http%')
                    order by (vi.is_duplicate is true), vi.created_at asc nulls last
                    limit 1) as url
               from image_identities ii
               where ii.phash_hex is null and ii.id > $1
               order by ii.id
               limit 2000`,
        values: [cursor],
      }));
      if (page.rows.length === 0) break;
      for (const r of page.rows) {
        if (have.has(r.id)) continue;
        appendFileSync(MAP_PATH, JSON.stringify({ id: r.id, url: r.url || null }) + "\n");
        have.set(r.id, r.url || null);
        if (r.url) withUrl++;
        done++;
      }
      cursor = page.rows[page.rows.length - 1].id;
      log(`[map] indexed progress cursor=${cursor.slice(0, 8)} added=${done} withUrl=${withUrl}`);
    }
    log(`[map] DONE indexed added=${done} withUrl=${withUrl}`);
    return;
  }

  // Bucket path (no index): 256 uuid first-byte ranges, forced index range scan.
  await retry(() => pool.query("set enable_seqscan=off"));
  const ids = (await retry(() => pool.query(`select id from image_identities where phash_hex is null`))).rows.map((r) => r.id);
  const need = new Set(ids.filter((id) => !have.has(id)));
  log(`[map] bucket mode total_null=${ids.length} need=${need.size}`);
  const hx = (n) => n.toString(16).padStart(2, "0");
  let mapped = 0;
  for (let b = 0; b < 256; b++) {
    const lo = `${hx(b)}000000-0000-0000-0000-000000000000`;
    const hi = b === 255 ? "ffffffff-ffff-ffff-ffff-ffffffffffff" : `${hx(b + 1)}000000-0000-0000-0000-000000000000`;
    const t = Date.now();
    const rows = (await retry(() => pool.query({
      text: `select vi.image_identity_id iid, min(vi.image_url) filter (where vi.image_url like 'http%') url
             from vehicle_images vi
             where vi.id >= $1 and ${b === 255 ? "vi.id <= $2" : "vi.id < $2"}
               and vi.image_identity_id = any($3::uuid[])
             group by vi.image_identity_id`,
      values: [lo, hi, ids],
    }))).rows;
    for (const r of rows) {
      if (!need.has(r.iid)) continue;
      appendFileSync(MAP_PATH, JSON.stringify({ id: r.iid, url: r.url || null }) + "\n");
      need.delete(r.iid); mapped++;
    }
    log(`[map] bucket ${hx(b)} matched=${rows.length} mapped_total=${mapped} remaining=${need.size} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    if (need.size === 0) { log(`[map] all identities mapped early at bucket ${hx(b)}`); break; }
  }
  for (const id of need) appendFileSync(MAP_PATH, JSON.stringify({ id, url: null }) + "\n");
  log(`[map] DONE bucket mapped=${mapped} unmapped(no vehicle_images row)=${need.size}`);
}

// ---------- Phase 2: compute + write ----------
async function run(pool) {
  await retry(() => pool.query("set statement_timeout=115000"));
  const urlMap = loadMap();
  // Drive off the map's REACHABLE entries (those with a url). Null-url identities
  // never leave the NULL set, so a `where phash_hex is null order by id` poll would
  // get stuck re-processing them. Iterating reachable entries guarantees progress.
  const reachable = [...urlMap.entries()].filter(([, u]) => !!u).map(([id, url]) => ({ id, url }));
  const reachableIds = reachable.map((r) => r.id);
  log(`[run] map=${urlMap.size} reachable(with url)=${reachable.length} unreachable(no url)=${urlMap.size - reachable.length}`);

  // Which reachable identities are still NULL (resume skips already-written).
  const stillNull = new Set();
  for (let i = 0; i < reachableIds.length; i += 5000) {
    const chunk = reachableIds.slice(i, i + 5000);
    const rows = (await retry(() => pool.query({
      text: `select id from image_identities where phash_hex is null and id = any($1::uuid[])`,
      values: [chunk],
    }))).rows;
    for (const r of rows) stillNull.add(r.id);
  }
  // Exclude ids already known-bad: prior fetch failures (dead list) and prior
  // collisions (unique-index holders elsewhere; they can never be written).
  const skip = new Set();
  for (const p of [DEAD_PATH, COLLISION_PATH]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const o = JSON.parse(line); if (o.id) skip.add(o.id); if (o.identity_a) skip.add(o.identity_a); } catch {}
    }
  }
  const todo = reachable.filter((r) => stillNull.has(r.id) && !skip.has(r.id));
  log(`[run] todo(reachable & still NULL)=${todo.length} (skipped known-bad=${skip.size})`);

  const stats = { batches: 0, backfilled: 0, collided: 0, fetchFail: 0, dupInBatch: 0, alreadySet: 0 };
  const seenThisRun = new Map();

  for (let start = 0; start < todo.length && stats.batches < MAX_BATCHES; start += BATCH) {
    const batch = todo.slice(start, start + BATCH);
    const tasks = batch.map((row) => async () => {
      const hash = await computeDHashFromUrl(row.url);
      if (!hash || hash.length !== 16) return { id: row.id, hash: null, reason: "fetch_or_decode_fail", url: row.url };
      return { id: row.id, hash, url: row.url };
    });
    const results = await parallelLimit(tasks, FETCH_CONCURRENCY);

    let bErr = 0, bWrote = 0, bColl = 0, bDup = 0;
    for (const r of results) {
      if (!r.hash) {
        bErr++; stats.fetchFail++;
        try { appendFileSync(DEAD_PATH, JSON.stringify({ ts: new Date().toISOString(), id: r.id, url: r.url, reason: r.reason || "fetch_or_decode_fail" }) + "\n"); } catch {}
        continue;
      }
      if (seenThisRun.has(r.hash)) { bDup++; stats.dupInBatch++; stats.collided++; recordCollision(r.hash, r.id, seenThisRun.get(r.hash), "intra_run"); continue; }
      try {
        const w = await retry(() => pool.query({
          text: `update image_identities set phash_hex=$1, updated_at=now() where id=$2 and phash_hex is null returning id`,
          values: [r.hash, r.id],
        }), 3);
        if (w.rowCount === 1) { bWrote++; stats.backfilled++; seenThisRun.set(r.hash, r.id); }
        else { stats.alreadySet++; } // raced or already written
      } catch (e) {
        if (e && e.code === "23505") { bColl++; stats.collided++; const other = await findHolder(pool, r.hash); recordCollision(r.hash, r.id, other, "db_unique"); }
        else { bErr++; stats.fetchFail++; log(`[run] write error id=${r.id}: ${e.code || ""} ${String(e.message || e).slice(0, 120)}`); }
      }
    }
    stats.batches++;
    const errFrac = bErr / batch.length;
    log(`[run] batch#${stats.batches} n=${batch.length} wrote=${bWrote} collide=${bColl} dup=${bDup} err=${bErr}(${(100 * errFrac).toFixed(0)}%) | cum backfilled=${stats.backfilled} collided=${stats.collided} fetchFail=${stats.fetchFail} @${start + batch.length}/${todo.length}`);
    if (errFrac > ERROR_ABORT_FRAC && batch.length >= 20) { log(`[run] ABORT: batch error fraction ${(100 * errFrac).toFixed(0)}% > ${(100 * ERROR_ABORT_FRAC).toFixed(0)}%`); break; }
    await sleep(SLEEP_MS);
  }
  const lock = await retry(() => pool.query("select count(*) c from pg_stat_activity where wait_event_type='Lock'"));
  log(`[run] lock waiters after writes: ${lock.rows[0].c}`);
  const cov = await retry(() => pool.query(`select count(*) total, count(*) filter (where phash_hex is not null) have, count(*) filter (where phash_hex is null) still_null from image_identities`));
  log(`[run] DONE stats=${JSON.stringify(stats)} coverage=${JSON.stringify(cov.rows[0])}`);
}
function recordCollision(hash, idA, idB, kind) {
  try { appendFileSync(COLLISION_PATH, JSON.stringify({ ts: new Date().toISOString(), phash_hex: hash, identity_a: idA, identity_b: idB, kind }) + "\n"); } catch {}
}
async function findHolder(pool, hash) {
  try { const { rows } = await pool.query({ text: `select id from image_identities where phash_hex=$1 limit 1`, values: [hash] }); return rows[0]?.id || null; } catch { return null; }
}
async function probe(pool) {
  await retry(() => pool.query("set statement_timeout=115000"));
  const t = await retry(() => pool.query(`select count(*) total, count(*) filter (where phash_hex is null) nullph, count(*) filter (where phash_hex is not null) haveph from image_identities`));
  log(`[probe] ${JSON.stringify(t.rows[0])} map_entries=${loadMap().size}`);
}

// ---------- Pre-flight gate: runner's hash vs team-lead's verified vectors ----------
// Uses the SAME code path as the backfill (loadImage auto-orient -> computeDHashAreaAvg).
// Threshold: hamming <= 4 per file, else STOP.
const GATE_DIR = "/private/tmp/claude-501/-Users-skylar/a1798f0c-2290-4867-880d-1494b899a3d5/scratchpad/hashval";
const GATE_EXPECT = {
  "IMG_0438.jpg": "3ea6c24d46e4d4ac", "IMG_0450.jpg": "0060e3a5a5bcf47b",
  "IMG_0464.jpg": "fff3d9c858e2d95b", "IMG_0467.jpg": "00006367d4f878d1",
  "IMG_0499.jpg": "30e8cccc464466c6", "IMG_3131.PNG": "4d8f60f0e8e88ee0",
  "IMG_9257.jpg": "88684b2369c89c84", "IMG_9318.jpg": "f09f9e17177d7be5",
};
function hamHex(a, b) {
  if (!a || !b || a.length !== 16 || b.length !== 16) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}
async function gate(pool) {
  log(`[gate] space="${HASH_SPACE}" threshold<=4`);
  let worst = 0, fails = 0;
  for (const [name, expect] of Object.entries(GATE_EXPECT)) {
    const img = await loadImage(readFileSync(`${GATE_DIR}/${name}`));
    const got = computeDHashAreaAvg(img);
    const h = hamHex(got, expect);
    worst = Math.max(worst, h);
    if (h > 4) fails++;
    log(`[gate] ${name} got=${got} expect=${expect} ham=${h}${h > 4 ? " FAIL" : ""}`);
  }
  log(`[gate] worst=${worst} fails=${fails} -> ${fails === 0 ? "PASS" : "FAIL"}`);
  // Sanity-check ALREADY-WRITTEN rows are in this space (answers: which space did my session writes use?)
  const written = (await retry(() => pool.query(
    `select ii.id, ii.phash_hex from image_identities ii
      where ii.phash_hex is not null and length(ii.phash_hex)=16 and ii.updated_at > now() - interval '2 hours'
      order by ii.updated_at desc limit 6`))).rows;
  const urlMap = loadMap();
  log(`[gate] verifying ${written.length} of MY session-written rows against box-mean re-hash:`);
  for (const r of written) {
    const url = urlMap.get(r.id);
    if (!url) { log(`[gate]   ${r.id.slice(0,8)} stored=${r.phash_hex} (no url in map, skip)`); continue; }
    const rehash = await computeDHashFromUrl(url);
    log(`[gate]   ${r.id.slice(0,8)} stored=${r.phash_hex} rehash=${rehash} ham=${hamHex(r.phash_hex, rehash)}`);
  }
  return fails === 0;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 3, connectionTimeoutMillis: 20000 });
  try {
    if (MODE === "gate") { const ok = await gate(pool); await pool.end(); process.exit(ok ? 0 : 3); }
    else if (MODE === "build-map") await buildMap(pool);
    else if (MODE === "run") { log(`[run] space="${HASH_SPACE}"`); await run(pool); }
    else await probe(pool);
  } finally { await pool.end(); }
}
main().catch((e) => { log(`[fatal] ${String((e && e.stack) || e)}`); process.exit(1); });
