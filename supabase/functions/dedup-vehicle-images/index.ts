/**
 * dedup-vehicle-images — Cross-source perceptual dedup for vehicle images
 *
 * Takes a vehicle_id, downloads each image at tiny resolution (9x8) via
 * Supabase storage render endpoint, computes a 64-bit dHash (difference hash),
 * groups images by hamming distance <= threshold, and marks duplicates.
 *
 * Provenance priority (original wins):
 *   1. user_upload        — user shot it
 *   2. photo_auto_sync    — came from user's device
 *   3. iphoto             — imported from Apple Photos
 *   4. bat_import_mirrored — mirrored from BaT listing
 *   5. extractor          — extracted by pipeline
 *   6. bat_image_library  — from BaT image library
 *   7. bat_import         — raw BaT import
 *   8. (everything else)
 *
 * For each duplicate group, the highest-priority source becomes the "original".
 * All others get: is_duplicate=true, duplicate_of=<original_id>, dhash computed.
 * The original gets: provenance metadata appended showing cross-source presence.
 *
 * POST /functions/v1/dedup-vehicle-images
 * Body: { "vehicle_id": "<uuid>", "dry_run": true|false, "threshold": 0-10 }
 *
 * dry_run (default: true) — preview results without writing
 * threshold (default: 5) — max hamming distance to consider as duplicate
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// ---------------------------------------------------------------------------
// Source priority: lower number = higher priority = more likely the original
// ---------------------------------------------------------------------------
const SOURCE_PRIORITY: Record<string, number> = {
  user_upload: 1,
  photo_auto_sync: 2,
  iphoto: 3,
  bat_import_mirrored: 4,
  extractor: 5,
  bat_image_library: 6,
  bat_import: 7,
};

function getSourcePriority(source: string | null): number {
  if (!source) return 99;
  return SOURCE_PRIORITY[source] ?? 50;
}

// ---------------------------------------------------------------------------
// Image fetching + dHash computation
// ---------------------------------------------------------------------------

/**
 * Convert an image_url from the `object/public/` path to the `render/image/public/` path
 * with resize parameters for a tiny 9x8 thumbnail.
 */
function toRenderUrl(imageUrl: string, supabaseUrl: string): string {
  // Images are stored as:
  //   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  // The render endpoint is:
  //   https://<project>.supabase.co/storage/v1/render/image/public/<bucket>/<path>?width=9&height=8...

  const objectPublicMarker = "/storage/v1/object/public/";
  const idx = imageUrl.indexOf(objectPublicMarker);

  if (idx === -1) {
    // External URL — can't use render endpoint; fetch directly
    return imageUrl;
  }

  const base = imageUrl.substring(0, idx);
  const pathAfter = imageUrl.substring(idx + objectPublicMarker.length);

  return `${base}/storage/v1/render/image/public/${pathAfter}?width=9&height=8&resize=cover&quality=20`;
}

/**
 * Fetch a tiny 9x8 image and return raw pixel luminance values.
 * Returns null if fetch fails.
 */
async function fetchTinyImage(
  renderUrl: string,
  serviceKey: string,
): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(renderUrl, {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
      },
    });

    if (!resp.ok) {
      console.warn(`Failed to fetch ${renderUrl}: ${resp.status}`);
      return null;
    }

    const blob = await resp.blob();
    const arrayBuf = await blob.arrayBuffer();
    return new Uint8Array(arrayBuf);
  } catch (e) {
    console.warn(`Error fetching ${renderUrl}: ${e}`);
    return null;
  }
}

// JPEG decoder — jpeg-js via esm.sh (Canvas/ImageBitmap not available on Deno Deploy)
// deno-lint-ignore no-explicit-any
let jpegDecode: any = null;

async function ensureJpegDecoder() {
  if (!jpegDecode) {
    const mod = await import("https://esm.sh/jpeg-js@0.4.4");
    jpegDecode = mod.decode;
  }
}

/**
 * Decode JPEG bytes to grayscale array (9x8 = 72 values).
 * Returns null on failure.
 */
async function decodeToGrayscale(
  jpegBytes: Uint8Array,
): Promise<number[] | null> {
  try {
    await ensureJpegDecoder();
    const decoded = jpegDecode(jpegBytes, {
      useTArray: true,
      formatAsRGBA: true,
    });

    const { data, width, height } = decoded;
    const grayscale: number[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // Standard luminance formula
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        grayscale.push(lum);
      }
    }

    return grayscale;
  } catch (e) {
    console.warn(`JPEG decode error: ${e}`);
    return null;
  }
}

/**
 * Compute dHash (difference hash) from a 9x8 grayscale image.
 *
 * dHash: for each row, compare each pixel to its right neighbor.
 * If left > right, bit = 1. Otherwise bit = 0.
 * 9 columns x 8 rows = 8 comparisons per row x 8 rows = 64 bits.
 *
 * Returns a 16-char hex string (64-bit hash).
 */
function computeDHash(grayscale: number[], width: number, height: number): string {
  const bits: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const left = grayscale[y * width + x];
      const right = grayscale[y * width + x + 1];
      bits.push(left > right ? 1 : 0);
    }
  }

  // Convert 64 bits to 16-char hex string
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }

  return hex;
}

/**
 * Compute hamming distance between two hex hash strings.
 */
function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 64; // max distance

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    // Count differing bits in the 4-bit nibble
    let xor = n1 ^ n2;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Duplicate group finder (union-find)
// ---------------------------------------------------------------------------

/**
 * Group images by perceptual similarity using union-find.
 * Any two images with hamming distance <= threshold are in the same group.
 */
function findDuplicateGroups(
  images: Array<{ id: string; hash: string; source: string; created_at: string }>,
  threshold: number,
): Array<Array<{ id: string; hash: string; source: string; created_at: string }>> {
  const n = images.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path compression
      x = parent[x];
    }
    return x;
  }

  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra]++;
    }
  }

  // O(n^2) comparison — fine for up to ~1000 images per vehicle
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (hammingDistance(images[i].hash, images[j].hash) <= threshold) {
        union(i, j);
      }
    }
  }

  // Collect groups
  const groups = new Map<number, Array<typeof images[0]>>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(images[i]);
  }

  // Only return groups with more than one member (actual duplicates)
  return [...groups.values()].filter((g) => g.length > 1);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const start = performance.now();

  try {
    const body = await req.json();
    const vehicleId = body.vehicle_id;
    const dryRun = body.dry_run !== false; // default true
    const threshold = body.threshold ?? 5;
    const batchSize = body.batch_size ?? 50; // concurrent fetch batch size

    if (!vehicleId) {
      return new Response(
        JSON.stringify({ error: "vehicle_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceKey);

    // -----------------------------------------------------------------------
    // Step 1: Fetch all images for this vehicle
    // -----------------------------------------------------------------------
    const { data: images, error: fetchErr } = await supabase
      .from("vehicle_images")
      .select("id, image_url, source, created_at, is_duplicate, duplicate_of, dhash, storage_path")
      .eq("vehicle_id", vehicleId)
      .order("created_at", { ascending: true });

    if (fetchErr) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch images: ${fetchErr.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!images || images.length === 0) {
      return new Response(
        JSON.stringify({ error: "No images found for this vehicle" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const totalImages = images.length;
    console.log(`[dedup] Vehicle ${vehicleId}: ${totalImages} images to process`);

    // -----------------------------------------------------------------------
    // Step 2: Compute dHash for each image (or reuse existing)
    // -----------------------------------------------------------------------
    const hashedImages: Array<{
      id: string;
      hash: string;
      source: string;
      created_at: string;
      image_url: string;
    }> = [];
    const hashErrors: string[] = [];
    let skippedAlreadyDuplicate = 0;
    let reusedExistingHash = 0;

    // Process in batches to avoid overwhelming network
    for (let batchStart = 0; batchStart < images.length; batchStart += batchSize) {
      const batch = images.slice(batchStart, batchStart + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (img) => {
          // Skip images already marked as duplicates (from a prior run)
          if (img.is_duplicate && img.duplicate_of) {
            skippedAlreadyDuplicate++;
            return null;
          }

          // Reuse existing dhash if present
          if (img.dhash && img.dhash.length === 16) {
            reusedExistingHash++;
            return {
              id: img.id,
              hash: img.dhash,
              source: img.source ?? "unknown",
              created_at: img.created_at,
              image_url: img.image_url,
            };
          }

          // Compute dHash: fetch tiny image, decode, hash
          const renderUrl = toRenderUrl(img.image_url, supabaseUrl);
          const jpegBytes = await fetchTinyImage(renderUrl, serviceKey);
          if (!jpegBytes) {
            hashErrors.push(`${img.id}: fetch failed`);
            return null;
          }

          const grayscale = await decodeToGrayscale(jpegBytes);
          if (!grayscale) {
            hashErrors.push(`${img.id}: decode failed`);
            return null;
          }

          // The render endpoint should give us 9x8, but verify
          const expectedPixels = 9 * 8;
          if (grayscale.length < expectedPixels) {
            hashErrors.push(`${img.id}: unexpected size ${grayscale.length} (expected ${expectedPixels})`);
            return null;
          }

          const hash = computeDHash(grayscale, 9, 8);

          return {
            id: img.id,
            hash,
            source: img.source ?? "unknown",
            created_at: img.created_at,
            image_url: img.image_url,
          };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          hashedImages.push(result.value);
        }
      }

      console.log(
        `[dedup] Hashed ${Math.min(batchStart + batchSize, images.length)}/${totalImages} images`,
      );
    }

    console.log(
      `[dedup] Hashing complete: ${hashedImages.length} hashed, ${hashErrors.length} errors, ` +
        `${skippedAlreadyDuplicate} skipped (already duplicate), ${reusedExistingHash} reused`,
    );

    // -----------------------------------------------------------------------
    // Step 3: Find duplicate groups
    // -----------------------------------------------------------------------
    const dupGroups = findDuplicateGroups(hashedImages, threshold);

    console.log(`[dedup] Found ${dupGroups.length} duplicate groups`);

    // -----------------------------------------------------------------------
    // Step 4: For each group, determine the original and mark duplicates
    // -----------------------------------------------------------------------
    const groupReports: Array<{
      original: { id: string; source: string; hash: string };
      duplicates: Array<{ id: string; source: string; hash: string; hamming_distance: number }>;
    }> = [];

    const updatesToApply: Array<{
      id: string;
      is_duplicate: boolean;
      duplicate_of: string;
      dhash: string;
    }> = [];

    const originalsToUpdate: Array<{
      id: string;
      dhash: string;
      cross_source_provenance: string[];
    }> = [];

    for (const group of dupGroups) {
      // Sort by source priority (lowest = best), then by created_at (earliest first)
      group.sort((a, b) => {
        const pA = getSourcePriority(a.source);
        const pB = getSourcePriority(b.source);
        if (pA !== pB) return pA - pB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      const original = group[0];
      const duplicates = group.slice(1);

      // Collect all sources in this group for provenance tracking
      const allSources = [...new Set(group.map((g) => g.source))];

      const groupReport = {
        original: { id: original.id, source: original.source, hash: original.hash },
        duplicates: duplicates.map((d) => ({
          id: d.id,
          source: d.source,
          hash: d.hash,
          hamming_distance: hammingDistance(original.hash, d.hash),
        })),
      };
      groupReports.push(groupReport);

      // Track original for provenance update
      originalsToUpdate.push({
        id: original.id,
        dhash: original.hash,
        cross_source_provenance: allSources,
      });

      // Track duplicates for marking
      for (const dup of duplicates) {
        updatesToApply.push({
          id: dup.id,
          is_duplicate: true,
          duplicate_of: original.id,
          dhash: dup.hash,
        });
      }
    }

    // Also store dhash for all non-duplicate images (for future runs)
    const singletons = hashedImages.filter(
      (img) =>
        !updatesToApply.some((u) => u.id === img.id) &&
        !originalsToUpdate.some((o) => o.id === img.id),
    );

    // -----------------------------------------------------------------------
    // Step 5: Apply updates (unless dry_run)
    // -----------------------------------------------------------------------
    let updatesApplied = 0;
    let hashesStored = 0;

    if (!dryRun) {
      // Mark duplicates in batches of 50
      for (let i = 0; i < updatesToApply.length; i += 50) {
        const batch = updatesToApply.slice(i, i + 50);
        const promises = batch.map((upd) =>
          supabase
            .from("vehicle_images")
            .update({
              is_duplicate: upd.is_duplicate,
              duplicate_of: upd.duplicate_of,
              dhash: upd.dhash,
            })
            .eq("id", upd.id),
        );
        const results = await Promise.allSettled(promises);
        for (const r of results) {
          if (r.status === "fulfilled" && !r.value.error) updatesApplied++;
        }
      }

      // Update originals with provenance + dhash
      for (const orig of originalsToUpdate) {
        const { error } = await supabase
          .from("vehicle_images")
          .update({
            dhash: orig.dhash,
            is_duplicate: false,
            // Store provenance in ai_scan_metadata (existing jsonb field)
            ai_scan_metadata: {
              cross_source_provenance: orig.cross_source_provenance,
              dedup_run_at: new Date().toISOString(),
              is_original: true,
            },
          })
          .eq("id", orig.id);

        if (!error) hashesStored++;
      }

      // Store dhash for singletons (images with no duplicates) — batch of 50
      for (let i = 0; i < singletons.length; i += 50) {
        const batch = singletons.slice(i, i + 50);
        const promises = batch.map((img) =>
          supabase
            .from("vehicle_images")
            .update({ dhash: img.hash })
            .eq("id", img.id),
        );
        const results = await Promise.allSettled(promises);
        for (const r of results) {
          if (r.status === "fulfilled" && !r.value.error) hashesStored++;
        }
      }

      console.log(
        `[dedup] Applied: ${updatesApplied} duplicates marked, ${hashesStored} hashes stored`,
      );
    }

    // -----------------------------------------------------------------------
    // Step 6: Build report
    // -----------------------------------------------------------------------
    const sourceCounts: Record<string, number> = {};
    for (const img of images) {
      const s = img.source ?? "unknown";
      sourceCounts[s] = (sourceCounts[s] || 0) + 1;
    }

    const duplicatesBySource: Record<string, number> = {};
    for (const upd of updatesToApply) {
      const img = hashedImages.find((h) => h.id === upd.id);
      if (img) {
        duplicatesBySource[img.source] = (duplicatesBySource[img.source] || 0) + 1;
      }
    }

    const report = {
      vehicle_id: vehicleId,
      dry_run: dryRun,
      threshold,
      total_images: totalImages,
      images_hashed: hashedImages.length,
      hash_errors: hashErrors.length,
      skipped_already_duplicate: skippedAlreadyDuplicate,
      reused_existing_hash: reusedExistingHash,
      duplicate_groups_found: dupGroups.length,
      total_duplicates_identified: updatesToApply.length,
      images_after_dedup: totalImages - updatesToApply.length,
      source_breakdown: sourceCounts,
      duplicates_by_source: duplicatesBySource,
      ...(dryRun
        ? {}
        : {
            updates_applied: updatesApplied,
            hashes_stored: hashesStored,
          }),
      groups: groupReports.slice(0, 20).map((g) => ({
        original: g.original,
        duplicate_count: g.duplicates.length,
        duplicates: g.duplicates.slice(0, 5), // limit detail for large groups
      })),
      ...(groupReports.length > 20
        ? { note: `Showing 20 of ${groupReports.length} groups. Remaining groups omitted.` }
        : {}),
      duration_ms: Math.round(performance.now() - start),
    };

    return new Response(JSON.stringify(report, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(`[dedup] Unhandled error: ${e}`);
    return new Response(
      JSON.stringify({
        error: `Unhandled error: ${e instanceof Error ? e.message : String(e)}`,
        duration_ms: Math.round(performance.now() - start),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
