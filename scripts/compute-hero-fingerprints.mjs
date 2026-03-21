/**
 * compute-hero-fingerprints.mjs — Populates vehicle_hero_fingerprints table
 *
 * For each active vehicle, finds the primary/hero image and copies (or computes)
 * its dHash into the hero_fingerprints table for cross-vehicle comparison.
 *
 * Algorithm (MUST match dedup-vehicle-images edge function exactly):
 *   1. Resize image to 9x8 pixels
 *   2. Convert to grayscale (0.299*R + 0.587*G + 0.114*B)
 *   3. For each row, compare each pixel to its right neighbor
 *      left > right → 1, else → 0
 *   4. 8 comparisons × 8 rows = 64 bits → 16-char hex string
 *
 * Usage:
 *   dotenvx run -- node scripts/compute-hero-fingerprints.mjs
 *   dotenvx run -- node scripts/compute-hero-fingerprints.mjs --limit 500
 *   dotenvx run -- node scripts/compute-hero-fingerprints.mjs --continue
 *   dotenvx run -- node scripts/compute-hero-fingerprints.mjs --continue --limit 2000
 *   dotenvx run -- node scripts/compute-hero-fingerprints.mjs --dry-run
 *
 * Flags:
 *   --limit N     Process at most N vehicles (default: all)
 *   --continue    Skip vehicles already in hero_fingerprints
 *   --dry-run     Preview what would be computed, don't write
 *   --force       Recompute even if hero_fingerprints row exists
 */

import pg from "pg";
import { createCanvas, loadImage } from "canvas";
import https from "https";
import http from "http";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BATCH_SIZE = 100;       // Vehicles per DB fetch batch
const WRITE_BATCH = 500;      // Rows per INSERT batch
const PROGRESS_EVERY = 500;   // Report progress every N vehicles
const SLEEP_MS = 100;         // Sleep between write batches (hard rule #8)
const FETCH_CONCURRENCY = 20; // Max concurrent image downloads
const FETCH_TIMEOUT = 15000;  // 15s per image fetch

const DB_URL = process.env.SUPABASE_DB_URL
  || "postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const limitArg = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1], 10)
  : null;
const continueMode = args.includes("--continue");
const dryRun = args.includes("--dry-run");
const forceMode = args.includes("--force");

// ---------------------------------------------------------------------------
// dHash computation — exact match with dedup-vehicle-images/index.ts
// ---------------------------------------------------------------------------

/**
 * Compute dHash from a 9x8 grayscale array.
 * 9 columns, 8 rows → 8 comparisons per row × 8 rows = 64 bits → 16 hex chars.
 */
function computeDHash(grayscale, width, height) {
  const bits = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = grayscale[y * width + x];
      const right = grayscale[y * width + x + 1];
      bits.push(left > right ? 1 : 0);
    }
  }

  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * Download image, resize to 9x8, extract grayscale, compute dHash.
 * Uses node-canvas for the resize+grayscale step.
 */
async function computeDHashFromUrl(imageUrl) {
  // Validate URL before attempting fetch
  if (!imageUrl || typeof imageUrl !== "string") return null;
  if (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) return null;
  try { new URL(imageUrl); } catch { return null; }

  const imgBuffer = await fetchImageBuffer(imageUrl);
  if (!imgBuffer || imgBuffer.length < 100) return null;

  try {
    const img = await loadImage(imgBuffer);

    // Draw at 9x8 — exact same dimensions as dedup-vehicle-images
    const canvas = createCanvas(9, 8);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 9, 8);

    const imageData = ctx.getImageData(0, 0, 9, 8);
    const data = imageData.data; // RGBA

    // Convert to grayscale using exact same formula as dedup-vehicle-images
    const grayscale = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) {
        const i = (y * 9 + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        grayscale.push(lum);
      }
    }

    return computeDHash(grayscale, 9, 8);
  } catch (e) {
    return null;
  }
}

/**
 * Fetch image as Buffer with timeout. Follows up to 3 redirects.
 */
function fetchImageBuffer(url, redirects = 0) {
  if (redirects > 3) return Promise.resolve(null);
  if (!url || !url.startsWith("http")) return Promise.resolve(null);

  return new Promise((resolve) => {
    try { new URL(url); } catch { return resolve(null); }
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, { timeout: FETCH_TIMEOUT }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith("/")) {
          const u = new URL(url);
          redirectUrl = `${u.protocol}//${u.host}${redirectUrl}`;
        }
        res.resume(); // drain
        resolve(fetchImageBuffer(redirectUrl, redirects + 1));
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", () => resolve(null));
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Process a batch of promises with concurrency limit.
 */
async function parallelLimit(tasks, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 3 });

  console.log(`[hero-fp] Starting hero fingerprint computation`);
  console.log(`  limit: ${limitArg ?? "all"}, continue: ${continueMode}, dry-run: ${dryRun}, force: ${forceMode}`);

  const stats = {
    processed: 0,
    copiedFromExisting: 0,
    computedNew: 0,
    fetchFailed: 0,
    noImages: 0,
    skipped: 0,
    written: 0,
  };

  // Build the query to find vehicles that need fingerprints
  let vehicleQuery;
  if (continueMode && !forceMode) {
    // Skip vehicles already in hero_fingerprints
    vehicleQuery = `
      SELECT v.id as vehicle_id, v.primary_image_url
      FROM vehicles v
      LEFT JOIN vehicle_hero_fingerprints hf ON hf.vehicle_id = v.id
      WHERE v.status = 'active'
        AND hf.vehicle_id IS NULL
      ORDER BY v.id
    `;
  } else if (forceMode) {
    vehicleQuery = `
      SELECT v.id as vehicle_id, v.primary_image_url
      FROM vehicles v
      WHERE v.status = 'active'
      ORDER BY v.id
    `;
  } else {
    vehicleQuery = `
      SELECT v.id as vehicle_id, v.primary_image_url
      FROM vehicles v
      WHERE v.status = 'active'
      ORDER BY v.id
    `;
  }

  if (limitArg) {
    vehicleQuery += ` LIMIT ${limitArg}`;
  }

  const { rows: vehicles } = await pool.query(vehicleQuery);
  console.log(`[hero-fp] Found ${vehicles.length} vehicles to process`);

  if (vehicles.length === 0) {
    console.log("[hero-fp] Nothing to do.");
    await pool.end();
    return;
  }

  // Collect results for batch insert
  const toWrite = [];
  let batchStart = 0;

  while (batchStart < vehicles.length) {
    const batch = vehicles.slice(batchStart, batchStart + BATCH_SIZE);
    const vehicleIds = batch.map((v) => v.vehicle_id);

    // Fetch existing dhashes for these vehicles' images in one query
    // Look for images that match primary_image_url OR are the first image
    const { rows: existingHashes } = await pool.query(
      `
      SELECT DISTINCT ON (vi.vehicle_id)
        vi.vehicle_id,
        vi.id as image_id,
        vi.image_url,
        vi.dhash
      FROM vehicle_images vi
      WHERE vi.vehicle_id = ANY($1)
        AND vi.is_duplicate IS NOT TRUE
      ORDER BY vi.vehicle_id,
        CASE WHEN vi.is_primary = true THEN 0 ELSE 1 END,
        vi.display_order ASC NULLS LAST,
        vi.position ASC NULLS LAST,
        vi.created_at ASC
      `,
      [vehicleIds]
    );

    // Index by vehicle_id for fast lookup
    const hashMap = new Map();
    for (const row of existingHashes) {
      hashMap.set(row.vehicle_id, row);
    }

    // Process each vehicle in this batch
    const tasks = batch.map((vehicle) => async () => {
      const existing = hashMap.get(vehicle.vehicle_id);

      if (!existing && !vehicle.primary_image_url) {
        stats.noImages++;
        return null;
      }

      // Case 1: existing image record has a valid dhash — just copy it
      if (existing?.dhash && existing.dhash.length === 16) {
        stats.copiedFromExisting++;
        return {
          vehicle_id: vehicle.vehicle_id,
          dhash: existing.dhash,
          image_id: existing.image_id,
          image_url: existing.image_url,
        };
      }

      // Case 2: need to compute dhash from the image URL
      const imageUrl = existing?.image_url || vehicle.primary_image_url;
      if (!imageUrl) {
        stats.noImages++;
        return null;
      }

      const hash = await computeDHashFromUrl(imageUrl);
      if (!hash) {
        stats.fetchFailed++;
        return null;
      }

      stats.computedNew++;
      return {
        vehicle_id: vehicle.vehicle_id,
        dhash: hash,
        image_id: existing?.image_id || null,
        image_url: imageUrl,
      };
    });

    const results = await parallelLimit(tasks, FETCH_CONCURRENCY);

    for (const r of results) {
      if (r) toWrite.push(r);
    }

    stats.processed += batch.length;
    batchStart += BATCH_SIZE;

    // Write in batches of WRITE_BATCH
    while (toWrite.length >= WRITE_BATCH) {
      const writeBatch = toWrite.splice(0, WRITE_BATCH);
      if (!dryRun) {
        await writeFingerprintBatch(pool, writeBatch);
        stats.written += writeBatch.length;
        await sleep(SLEEP_MS);
      }
    }

    // Progress report
    if (stats.processed % PROGRESS_EVERY === 0 || batchStart >= vehicles.length) {
      console.log(
        `[hero-fp] Progress: ${stats.processed}/${vehicles.length} | ` +
        `copied: ${stats.copiedFromExisting}, computed: ${stats.computedNew}, ` +
        `failed: ${stats.fetchFailed}, no-images: ${stats.noImages}, ` +
        `written: ${stats.written}`
      );
    }
  }

  // Flush remaining
  if (toWrite.length > 0 && !dryRun) {
    await writeFingerprintBatch(pool, toWrite);
    stats.written += toWrite.length;
  }

  // Check lock impact
  const { rows: lockRows } = await pool.query(
    "SELECT count(*) as cnt FROM pg_stat_activity WHERE wait_event_type='Lock'"
  );
  console.log(`[hero-fp] Lock waiters after writes: ${lockRows[0].cnt}`);

  console.log(`\n[hero-fp] COMPLETE`);
  console.log(`  Vehicles processed: ${stats.processed}`);
  console.log(`  Copied from existing dhash: ${stats.copiedFromExisting}`);
  console.log(`  Computed new dhash: ${stats.computedNew}`);
  console.log(`  Fetch failed: ${stats.fetchFailed}`);
  console.log(`  No images: ${stats.noImages}`);
  console.log(`  Rows written: ${stats.written}`);
  console.log(`  Dry run: ${dryRun}`);

  await pool.end();
}

/**
 * Upsert a batch of fingerprint rows.
 * Uses ON CONFLICT to handle --force/recompute mode.
 */
async function writeFingerprintBatch(pool, rows) {
  if (rows.length === 0) return;

  // Build multi-row INSERT with ON CONFLICT
  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const row of rows) {
    values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, now())`);
    params.push(row.vehicle_id, row.dhash, row.image_id, row.image_url);
    paramIdx += 4;
  }

  const sql = `
    INSERT INTO vehicle_hero_fingerprints (vehicle_id, dhash, image_id, image_url, computed_at)
    VALUES ${values.join(", ")}
    ON CONFLICT (vehicle_id)
    DO UPDATE SET
      dhash = EXCLUDED.dhash,
      image_id = EXCLUDED.image_id,
      image_url = EXCLUDED.image_url,
      computed_at = EXCLUDED.computed_at
  `;

  await pool.query(sql, params);
}

main().catch((e) => {
  console.error("[hero-fp] Fatal error:", e);
  process.exit(1);
});
