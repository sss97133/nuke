/**
 * Fix corrupted Facebook Marketplace images in Supabase storage.
 *
 * The original fb-marketplace-local-scraper.mjs used `Buffer.toString()` on binary
 * image data inside `dnsFetch()`, which converted bytes through UTF-8 encoding.
 * This replaced every 0xFF byte (common in JPEG headers and data) with the UTF-8
 * replacement character sequence EF BF BD, inflating file sizes by ~75% and
 * corrupting the images.
 *
 * This script:
 *   1. Queries all FB marketplace images from vehicle_images
 *   2. Downloads each stored file from Supabase storage
 *   3. Checks for corruption (presence of UTF-8 replacement bytes or inflated size)
 *   4. Re-downloads the original from source_url (FB CDN)
 *   5. Re-uploads the clean binary to the same storage path
 *
 * Usage:
 *   dotenvx run -- node scripts/fix-fb-corrupted-images.mjs
 *   dotenvx run -- node scripts/fix-fb-corrupted-images.mjs --dry-run
 *   dotenvx run -- node scripts/fix-fb-corrupted-images.mjs --batch-size 50
 *   dotenvx run -- node scripts/fix-fb-corrupted-images.mjs --check-only
 */

import { createClient } from "@supabase/supabase-js";
import https from "https";
import http from "http";

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Standard supabase client — NO custom fetch, uses native Node.js fetch
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const CHECK_ONLY = args.includes("--check-only");
const CONCURRENCY = 10;
const bsIdx = args.indexOf("--batch-size");
const BATCH_SIZE = bsIdx !== -1 ? parseInt(args[bsIdx + 1]) || 100 : 100;

// UTF-8 replacement character: U+FFFD encoded as EF BF BD
const REPLACEMENT_BYTES = Buffer.from([0xef, 0xbf, 0xbd]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Download a URL as a raw Buffer using standard Node.js https/http module.
 * Follows up to 5 redirects. Returns null on failure.
 */
function downloadBuffer(url, maxRedirects = 5) {
  return new Promise((resolve) => {
    if (maxRedirects <= 0) {
      resolve(null);
      return;
    }

    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const req = transport.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        timeout: 30000,
      },
      (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          res.resume(); // drain response
          resolve(downloadBuffer(redirectUrl, maxRedirects - 1));
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
      }
    );

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Check if a buffer contains the UTF-8 replacement byte sequence (EF BF BD).
 * Returns the count of occurrences found.
 */
function countReplacementBytes(buf) {
  let count = 0;
  for (let i = 0; i <= buf.length - 3; i++) {
    if (
      buf[i] === 0xef &&
      buf[i + 1] === 0xbf &&
      buf[i + 2] === 0xbd
    ) {
      count++;
      i += 2; // skip past this occurrence
    }
  }
  return count;
}

/**
 * Extract the storage path from a full Supabase image URL.
 * image_url looks like: https://xxx.supabase.co/storage/v1/object/public/vehicle-photos/UUID/fb-marketplace/123-0.jpg
 * We need: UUID/fb-marketplace/123-0.jpg
 */
function extractStoragePath(imageUrl) {
  const marker = "/storage/v1/object/public/vehicle-photos/";
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return null;
  return imageUrl.slice(idx + marker.length);
}

/**
 * Process a batch of items with limited concurrency.
 */
async function processWithConcurrency(items, concurrency, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== FB Marketplace Corrupted Image Fixer ===");
  console.log(`Mode: ${CHECK_ONLY ? "CHECK ONLY" : DRY_RUN ? "DRY RUN" : "LIVE FIX"}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log();

  // Step 1: Query all FB marketplace images
  console.log("Fetching FB marketplace images from vehicle_images...");

  let allImages = [];
  let offset = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("vehicle_images")
      .select("id, vehicle_id, image_url, source_url")
      .eq("source", "facebook_marketplace")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("Error fetching vehicle_images:", error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;
    allImages.push(...data);
    offset += data.length;

    if (data.length < PAGE_SIZE) break;
  }

  console.log(`Found ${allImages.length} FB marketplace images total.`);
  console.log();

  // Filter to only images that have both a Supabase storage URL and a source_url
  const processable = allImages.filter((img) => {
    const storagePath = extractStoragePath(img.image_url);
    if (!storagePath) {
      return false; // image_url is not a Supabase storage URL
    }
    if (!img.source_url) {
      return false; // no original URL to re-download from
    }
    return true;
  });

  console.log(`${processable.length} images have Supabase storage URLs + source_url (can be checked/fixed).`);
  console.log(`${allImages.length - processable.length} images skipped (no storage path or no source_url).`);
  console.log();

  // Step 2: Process in batches
  const stats = {
    checked: 0,
    corrupted: 0,
    fixed: 0,
    downloadFailed: 0,
    uploadFailed: 0,
    clean: 0,
    storageFetchFailed: 0,
  };

  for (let batchStart = 0; batchStart < processable.length; batchStart += BATCH_SIZE) {
    const batch = processable.slice(batchStart, batchStart + BATCH_SIZE);
    const batchEnd = Math.min(batchStart + BATCH_SIZE, processable.length);
    console.log(`--- Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: images ${batchStart + 1}-${batchEnd} of ${processable.length} ---`);

    await processWithConcurrency(batch, CONCURRENCY, async (img, _idx) => {
      const storagePath = extractStoragePath(img.image_url);
      stats.checked++;

      // Download current file from Supabase storage to check for corruption
      const { data: fileData, error: dlError } = await supabase.storage
        .from("vehicle-photos")
        .download(storagePath);

      if (dlError || !fileData) {
        stats.storageFetchFailed++;
        console.log(`  [SKIP] ${storagePath} — storage download failed: ${dlError?.message || "no data"}`);
        return;
      }

      // Convert Blob to Buffer
      const storedBuffer = Buffer.from(await fileData.arrayBuffer());

      // Check for corruption: look for UTF-8 replacement byte sequences
      const replacementCount = countReplacementBytes(storedBuffer);
      const isCorrupted = replacementCount >= 3; // A few occurrences = definitely corrupted
                                                   // (valid JPEGs virtually never contain EF BF BD sequences)

      if (!isCorrupted) {
        stats.clean++;
        return; // Image is fine
      }

      stats.corrupted++;
      const inflationPct = replacementCount > 0
        ? `~${Math.round((replacementCount * 2) / (storedBuffer.length - replacementCount * 2) * 100)}% inflated`
        : "";

      console.log(
        `  [CORRUPT] ${storagePath} — ${replacementCount} replacement sequences found (${storedBuffer.length} bytes, ${inflationPct})`
      );

      if (CHECK_ONLY || DRY_RUN) {
        return;
      }

      // Step 3: Re-download from original FB CDN URL
      const freshBuffer = await downloadBuffer(img.source_url);

      if (!freshBuffer || freshBuffer.length < 1000) {
        stats.downloadFailed++;
        console.log(
          `  [FAIL] Could not re-download from source_url (expired/403/404): ${img.source_url.slice(0, 80)}...`
        );
        return;
      }

      // Verify the re-downloaded file is not corrupted
      const freshReplacements = countReplacementBytes(freshBuffer);
      if (freshReplacements >= 3) {
        stats.downloadFailed++;
        console.log(
          `  [FAIL] Re-downloaded file is also corrupted (${freshReplacements} replacements) — skipping`
        );
        return;
      }

      // Determine content type from the buffer magic bytes
      let contentType = "image/jpeg";
      if (freshBuffer[0] === 0x89 && freshBuffer[1] === 0x50) {
        contentType = "image/png";
      } else if (
        freshBuffer[0] === 0x52 &&
        freshBuffer[1] === 0x49 &&
        freshBuffer[2] === 0x46 &&
        freshBuffer[3] === 0x46
      ) {
        contentType = "image/webp";
      }

      // Step 4: Re-upload to the same storage path with upsert
      const { error: uploadError } = await supabase.storage
        .from("vehicle-photos")
        .upload(storagePath, freshBuffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        stats.uploadFailed++;
        console.log(`  [FAIL] Upload failed for ${storagePath}: ${uploadError.message}`);
        return;
      }

      stats.fixed++;
      console.log(
        `  [FIXED] ${storagePath} — ${storedBuffer.length} bytes -> ${freshBuffer.length} bytes (${contentType})`
      );
    });

    // Progress summary after each batch
    console.log(
      `  Progress: ${stats.checked} checked, ${stats.corrupted} corrupted, ${stats.fixed} fixed, ` +
        `${stats.downloadFailed} download failures, ${stats.uploadFailed} upload failures, ${stats.clean} clean`
    );
    console.log();
  }

  // Final summary
  console.log("=== Summary ===");
  console.log(`Total checked:           ${stats.checked}`);
  console.log(`Clean (not corrupted):   ${stats.clean}`);
  console.log(`Corrupted found:         ${stats.corrupted}`);
  console.log(`Successfully fixed:      ${stats.fixed}`);
  console.log(`Download failed (CDN):   ${stats.downloadFailed}`);
  console.log(`Upload failed:           ${stats.uploadFailed}`);
  console.log(`Storage fetch failed:    ${stats.storageFetchFailed}`);

  if (CHECK_ONLY) {
    console.log("\n(Check-only mode — no files were modified)");
  } else if (DRY_RUN) {
    console.log("\n(Dry run — no files were modified)");
  }

  if (stats.downloadFailed > 0) {
    console.log(
      `\nNote: ${stats.downloadFailed} images could not be re-downloaded. ` +
        `FB CDN URLs expire after some time. These images may need to be ` +
        `re-scraped from the original listings if still available.`
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
