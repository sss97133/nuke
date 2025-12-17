import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/**
 * Cleanup function to remove contaminated images from BaT vehicles.
 * 
 * Problem: Older imports used regex fallback that captured images from related auctions.
 * This function identifies and removes images that don't belong to the vehicle's actual gallery.
 * 
 * Strategy:
 * 1. Get the vehicle's canonical image URLs from origin_metadata.image_urls (from DOM map extractor)
 * 2. Find all vehicle_images for the vehicle that are BaT URLs
 * 3. Keep only images that match the canonical list OR are within the same date bucket as the majority
 * 4. Delete contaminated images (those from different date buckets that aren't in canonical list)
 */

type ReqBody = {
  vehicle_id?: string; // If provided, only clean this vehicle (for testing)
  dry_run?: boolean;
  batch_size?: number; // Default: process all vehicles
  limit?: number; // Max vehicles to process (safety limit, default 1000)
};

function bucketKey(url: string): string | null {
  const m = String(url || '').match(/\/wp-content\/uploads\/(\d{4})\/(\d{2})\//);
  return m ? `${m[1]}/${m[2]}` : null;
}

function normalizeImageUrl(url: string): string {
  return String(url || '')
    .split('#')[0]
    .split('?')[0]
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/-scaled\./g, '.')
    .trim();
}

async function isAuthorized(req: Request): Promise<{ ok: boolean; error?: string }> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader) return { ok: false, error: "Missing Authorization header" };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && authHeader.trim() === `Bearer ${serviceKey}`) return { ok: true };

  return { ok: false, error: "Unauthorized" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await isAuthorized(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ success: false, error: auth.error || "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const limit = Math.max(1, Math.min(5000, Number(body.limit || 1000))); // Safety limit
    const batchSize = Math.max(1, Math.min(100, Number(body.batch_size || 100))); // Process in batches

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Get vehicles to process
    let vehicles: any[] = [];
    if (body.vehicle_id) {
      // Single vehicle mode (for testing)
      const { data, error } = await admin
        .from("vehicles")
        .select("id, year, make, model, profile_origin, discovery_url, listing_url, bat_auction_url, origin_metadata")
        .eq("id", body.vehicle_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) vehicles = [data];
    } else {
      // Batch mode: Find ALL BaT vehicles that have BaT images
      // First, get all BaT vehicles (we'll filter by image existence in the processing loop)
      const { data, error } = await admin
        .from("vehicles")
        .select("id, year, make, model, profile_origin, discovery_url, listing_url, bat_auction_url, origin_metadata, discovery_source")
        .or("profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%")
        .limit(limit);
      if (error) throw new Error(error.message);
      vehicles = data || [];
    }

    const results: any = {
      success: true,
      dry_run: dryRun,
      vehicles_processed: 0,
      vehicles_cleaned: 0,
      images_removed: 0,
      vehicles: [] as any[],
    };

    for (const vehicle of vehicles) {
      const vehicleResult: any = {
        vehicle_id: vehicle.id,
        vehicle_name: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        canonical_images: 0,
        total_images: 0,
        contaminated_images: 0,
        images_removed: 0,
        errors: [] as string[],
      };

      try {
        // Get canonical image URLs from origin_metadata (from DOM map extractor)
        const om = (vehicle.origin_metadata && typeof vehicle.origin_metadata === "object") ? vehicle.origin_metadata : {};
        const canonicalUrls = Array.isArray((om as any)?.image_urls) ? (om as any).image_urls : [];
        const canonicalSet = new Set(canonicalUrls.map(normalizeImageUrl).filter(Boolean));
        vehicleResult.canonical_images = canonicalSet.size;

        // Get all BaT images for this vehicle
        const { data: images, error: imgErr } = await admin
          .from("vehicle_images")
          .select("id, image_url, source_url, storage_path, created_at")
          .eq("vehicle_id", vehicle.id)
          .or("image_url.ilike.%bringatrailer.com/wp-content/uploads/%,source_url.ilike.%bringatrailer.com/wp-content/uploads/%");

        if (imgErr) {
          vehicleResult.errors.push(`Error fetching images: ${imgErr.message}`);
          results.vehicles.push(vehicleResult);
          continue;
        }

        vehicleResult.total_images = images?.length || 0;

        if (!images || images.length === 0) {
          vehicleResult.skipped_reason = "no_bat_images";
          results.vehicles_skipped++;
          results.vehicles.push(vehicleResult);
          continue;
        }

        // Analyze buckets
        const bucketCounts = new Map<string, number>();
        const imagesByBucket = new Map<string, any[]>();

        for (const img of images) {
          const url = normalizeImageUrl(img.source_url || img.image_url || "");
          if (!url.includes("bringatrailer.com/wp-content/uploads/")) continue;

          const bucket = bucketKey(url);
          if (!bucket) continue;

          bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
          if (!imagesByBucket.has(bucket)) imagesByBucket.set(bucket, []);
          imagesByBucket.get(bucket)!.push(img);
        }

        // Find the dominant bucket (should match the listing date)
        let dominantBucket: string | null = null;
        let dominantCount = 0;
        for (const [bucket, count] of bucketCounts.entries()) {
          if (count > dominantCount) {
            dominantBucket = bucket;
            dominantCount = count;
          }
        }

        // Identify contaminated images: BaT URLs that are:
        // 1. Not in the canonical list, AND
        // 2. Not in the dominant bucket
        const toRemove: string[] = [];
        for (const img of images) {
          const url = normalizeImageUrl(img.source_url || img.image_url || "");
          if (!url.includes("bringatrailer.com/wp-content/uploads/")) continue;

          const isCanonical = canonicalSet.has(url);
          const bucket = bucketKey(url);
          const isInDominantBucket = bucket === dominantBucket;

          // Keep if canonical OR in dominant bucket
          if (isCanonical || isInDominantBucket) continue;

          // This image is contaminated
          toRemove.push(img.id);
        }

        vehicleResult.contaminated_images = toRemove.length;

        if (toRemove.length > 0) {
          if (!dryRun) {
            const { error: delErr } = await admin
              .from("vehicle_images")
              .delete()
              .in("id", toRemove);

            if (delErr) {
              vehicleResult.errors.push(`Error deleting images: ${delErr.message}`);
            } else {
              vehicleResult.images_removed = toRemove.length;
              results.images_removed += toRemove.length;
              results.vehicles_cleaned++;
            }
          } else {
            vehicleResult.images_removed = toRemove.length; // Would be removed
            results.vehicles_cleaned++; // Count in dry-run too
          }
        } else {
          vehicleResult.skipped_reason = "no_contamination_found";
          results.vehicles_skipped++;
        }

      } catch (e: any) {
        vehicleResult.errors.push(e?.message || String(e));
      }

      results.vehicles.push(vehicleResult);
      results.vehicles_processed++;
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

