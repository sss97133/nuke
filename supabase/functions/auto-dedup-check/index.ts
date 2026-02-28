/**
 * AUTO-DEDUP-CHECK — Lightweight per-image dedup on INSERT
 *
 * Called as a non-blocking fire-and-forget from photo-pipeline-orchestrator
 * after the main pipeline completes.
 *
 * Flow:
 *   1. Fetch the new image record
 *   2. If no dhash, download tiny thumbnail (9x8) and compute dHash
 *   3. Compare against all other images for the same vehicle_id that have dhash
 *   4. If hamming distance <= threshold, establish duplicate relationship
 *   5. Provenance priority determines which image is "original":
 *      user_upload > photo_auto_sync > iphoto > bat_import_mirrored > extractor > bat_image_library > bat_import
 *   6. The original gets cross_source_provenance metadata appended
 *
 * POST /functions/v1/auto-dedup-check
 * Body: { "image_id": "<uuid>", "vehicle_id": "<uuid>" }
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEFAULT_THRESHOLD = 5;

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
// dHash computation (same algorithm as dedup-vehicle-images)
// ---------------------------------------------------------------------------

// JPEG decoder — jpeg-js via esm.sh (Canvas/ImageBitmap not available on Deno Deploy)
// deno-lint-ignore no-explicit-any
let jpegDecode: any = null;

async function ensureJpegDecoder() {
  if (!jpegDecode) {
    const mod = await import("https://esm.sh/jpeg-js@0.4.4");
    jpegDecode = mod.decode;
  }
}

function toRenderUrl(imageUrl: string): string {
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

async function fetchTinyImage(renderUrl: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(renderUrl, {
      headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });

    if (!resp.ok) {
      console.warn(`[auto-dedup] Failed to fetch ${renderUrl}: ${resp.status}`);
      return null;
    }

    const blob = await resp.blob();
    const arrayBuf = await blob.arrayBuffer();
    return new Uint8Array(arrayBuf);
  } catch (e) {
    console.warn(`[auto-dedup] Error fetching ${renderUrl}: ${e}`);
    return null;
  }
}

async function decodeToGrayscale(jpegBytes: Uint8Array): Promise<number[] | null> {
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
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        grayscale.push(lum);
      }
    }

    return grayscale;
  } catch (e) {
    console.warn(`[auto-dedup] JPEG decode error: ${e}`);
    return null;
  }
}

function computeDHash(grayscale: number[], width: number, height: number): string {
  const bits: number[] = [];

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

function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 64;

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    let xor = n1 ^ n2;
    while (xor > 0) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

// ---------------------------------------------------------------------------
// Compute or retrieve dhash for a single image
// ---------------------------------------------------------------------------
async function ensureDHash(image: { id: string; image_url: string; dhash: string | null }): Promise<string | null> {
  // Reuse existing dhash if present
  if (image.dhash && image.dhash.length === 16) {
    return image.dhash;
  }

  if (!image.image_url) return null;

  // Download tiny thumbnail and compute dHash
  const renderUrl = toRenderUrl(image.image_url);
  const jpegBytes = await fetchTinyImage(renderUrl);
  if (!jpegBytes) return null;

  const grayscale = await decodeToGrayscale(jpegBytes);
  if (!grayscale) return null;

  const expectedPixels = 9 * 8;
  if (grayscale.length < expectedPixels) return null;

  const hash = computeDHash(grayscale, 9, 8);

  // Persist the dhash for future comparisons
  await supabase
    .from("vehicle_images")
    .update({ dhash: hash })
    .eq("id", image.id);

  return hash;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const body = await req.json();
    const { image_id, vehicle_id } = body;
    const threshold = body.threshold ?? DEFAULT_THRESHOLD;

    if (!image_id) {
      return new Response(
        JSON.stringify({ error: "image_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 1: Fetch the new image
    const { data: newImage, error: newImgErr } = await supabase
      .from("vehicle_images")
      .select("id, image_url, source, created_at, dhash, vehicle_id, is_duplicate, duplicate_of")
      .eq("id", image_id)
      .maybeSingle();

    if (newImgErr || !newImage) {
      return new Response(
        JSON.stringify({ error: `Image not found: ${newImgErr?.message || "no data"}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Skip if already marked as duplicate
    if (newImage.is_duplicate && newImage.duplicate_of) {
      return new Response(
        JSON.stringify({
          success: true,
          image_id,
          skipped: true,
          reason: "already_marked_duplicate",
          duration_ms: Date.now() - startedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const effectiveVehicleId = vehicle_id || newImage.vehicle_id;
    if (!effectiveVehicleId) {
      return new Response(
        JSON.stringify({
          success: true,
          image_id,
          skipped: true,
          reason: "no_vehicle_id",
          duration_ms: Date.now() - startedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 2: Compute dHash for new image
    const newHash = await ensureDHash(newImage);
    if (!newHash) {
      return new Response(
        JSON.stringify({
          success: true,
          image_id,
          skipped: true,
          reason: "dhash_computation_failed",
          duration_ms: Date.now() - startedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 3: Fetch all other images for this vehicle that have dhash values
    const { data: existingImages, error: existErr } = await supabase
      .from("vehicle_images")
      .select("id, image_url, source, created_at, dhash, is_duplicate, duplicate_of, ai_scan_metadata")
      .eq("vehicle_id", effectiveVehicleId)
      .neq("id", image_id)
      .not("dhash", "is", null)
      .or("is_duplicate.is.null,is_duplicate.eq.false"); // Only compare against non-duplicates

    if (existErr) {
      console.warn(`[auto-dedup] Error fetching existing images: ${existErr.message}`);
      return new Response(
        JSON.stringify({ error: existErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!existingImages || existingImages.length === 0) {
      // No existing hashed images to compare against — nothing to dedup
      return new Response(
        JSON.stringify({
          success: true,
          image_id,
          duplicate_found: false,
          compared_against: 0,
          duration_ms: Date.now() - startedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 4: Find closest match
    let bestMatch: { id: string; source: string; created_at: string; distance: number; ai_scan_metadata: any } | null = null;

    for (const existing of existingImages) {
      if (!existing.dhash || existing.dhash.length !== 16) continue;

      const distance = hammingDistance(newHash, existing.dhash);
      if (distance <= threshold) {
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = {
            id: existing.id,
            source: existing.source,
            created_at: existing.created_at,
            distance,
            ai_scan_metadata: existing.ai_scan_metadata,
          };
        }
      }
    }

    if (!bestMatch) {
      // No duplicate found
      return new Response(
        JSON.stringify({
          success: true,
          image_id,
          duplicate_found: false,
          compared_against: existingImages.length,
          duration_ms: Date.now() - startedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 5: Determine which is the original based on source priority
    const newPriority = getSourcePriority(newImage.source);
    const existingPriority = getSourcePriority(bestMatch.source);

    // Collect all sources for provenance
    const allSources = [...new Set([newImage.source || "unknown", bestMatch.source || "unknown"])];

    let originalId: string;
    let duplicateId: string;
    let originalSource: string;
    let duplicateSource: string;
    let flipped = false;

    if (newPriority < existingPriority) {
      // New image is from a stronger source -- it becomes the original
      // The existing one should be marked as the duplicate
      originalId = image_id;
      duplicateId = bestMatch.id;
      originalSource = newImage.source || "unknown";
      duplicateSource = bestMatch.source || "unknown";
      flipped = true;
    } else {
      // Existing image keeps its position as the original
      originalId = bestMatch.id;
      duplicateId = image_id;
      originalSource = bestMatch.source || "unknown";
      duplicateSource = newImage.source || "unknown";
    }

    // Step 6: Apply updates
    // Mark the duplicate
    await supabase
      .from("vehicle_images")
      .update({
        is_duplicate: true,
        duplicate_of: originalId,
        dhash: duplicateId === image_id ? newHash : undefined,
      })
      .eq("id", duplicateId);

    // Update the original with provenance metadata
    // Merge with existing ai_scan_metadata to avoid clobbering pipeline results
    const existingMetadata = (originalId === image_id ? newImage : bestMatch)?.ai_scan_metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      cross_source_provenance: allSources,
      dedup_run_at: new Date().toISOString(),
      is_original: true,
      duplicate_sources: [
        ...(existingMetadata?.duplicate_sources || []),
        {
          source: duplicateSource,
          image_id: duplicateId,
          hamming_distance: bestMatch.distance,
          detected_at: new Date().toISOString(),
        },
      ],
    };

    await supabase
      .from("vehicle_images")
      .update({
        is_duplicate: false,
        dhash: originalId === image_id ? newHash : undefined,
        ai_scan_metadata: updatedMetadata,
      })
      .eq("id", originalId);

    console.log(
      `[auto-dedup] Duplicate found: ${duplicateId} (${duplicateSource}) -> original ${originalId} (${originalSource}), distance=${bestMatch.distance}${flipped ? " [FLIPPED]" : ""}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        image_id,
        duplicate_found: true,
        original_id: originalId,
        duplicate_id: duplicateId,
        original_source: originalSource,
        duplicate_source: duplicateSource,
        hamming_distance: bestMatch.distance,
        flipped,
        compared_against: existingImages.length,
        provenance: allSources,
        duration_ms: Date.now() - startedAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[auto-dedup] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
