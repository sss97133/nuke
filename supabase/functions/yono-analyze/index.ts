/**
 * yono-analyze — YONO vision analysis edge function
 *
 * Proxies to the local YONO Python sidecar (port 8472) /analyze endpoint.
 * Returns what TEXT CANNOT tell you: condition, damage, modifications, photo quality.
 *
 * This is separate from yono-classify which handles make/model classification.
 *
 * Request:
 *   POST /yono-analyze
 *   {
 *     image_url: string,
 *     image_id?: string,     // vehicle_images.id — if provided, updates vehicle_images row
 *     batch?: boolean        // use /analyze/batch endpoint
 *   }
 *
 *   For batch:
 *   { images: [{ image_url: string, image_id?: string }] }
 *
 * Response (sidecar up):
 *   {
 *     available: true,
 *     vehicle_zone: string,           // from 41-zone taxonomy (VISION_ARCHITECTURE.md)
 *     zone_confidence: number,        // 0-1
 *     surface_coord_u: null,          // populated after COLMAP Phase 1
 *     surface_coord_v: null,
 *     condition_score: number,        // 1-5
 *     damage_flags: string[],         // ["rust", "dent", ...]
 *     modification_flags: string[],   // ["lift_kit", ...]
 *     interior_quality: number|null,  // 1-5 or null
 *     photo_quality: number,          // 1-5
 *     ms: number,
 *     model: string,                  // "finetuned_v2"|"zeroshot_florence2"
 *     source: "yono_vision"
 *   }
 *   or { available: false, reason: "..." } if sidecar is down
 *
 * DB write (if image_id provided):
 *   Updates vehicle_images: condition_score, damage_flags, modification_flags,
 *   photo_quality_score, vision_analyzed_at, vision_model_version
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";
const SIDECAR_TIMEOUT_MS = 30_000; // Vision is slower than classify (Florence-2 inference)
const SIDECAR_TOKEN = Deno.env.get("MODAL_SIDECAR_TOKEN") || "";

function sidecarHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(SIDECAR_TOKEN ? { "Authorization": `Bearer ${SIDECAR_TOKEN}` } : {}),
    ...extra,
  };
}

interface AnalysisResult {
  vehicle_zone: string;
  zone_confidence: number | null;
  surface_coord_u: number | null;
  surface_coord_v: number | null;
  condition_score: number;
  damage_flags: string[];
  modification_flags: string[];
  interior_quality: number | null;
  photo_quality: number;
  ms: number;
  model: string;
  image_url: string;
}

async function checkSidecarHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return false;
    const health = await resp.json();
    // Check if vision is available (not just classify)
    return health.vision_available === true;
  } catch {
    return false;
  }
}

async function analyzeImage(imageUrl: string): Promise<AnalysisResult | null> {
  const resp = await fetch(`${SIDECAR_URL}/analyze`, {
    method: "POST",
    headers: sidecarHeaders(),
    body: JSON.stringify({ image_url: imageUrl }),
    signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Sidecar analyze failed: ${resp.status} — ${errText}`);
  }

  return await resp.json();
}

async function writeToDb(
  supabase: ReturnType<typeof createClient>,
  imageId: string,
  result: AnalysisResult
): Promise<void> {
  const { error } = await supabase
    .from("vehicle_images")
    .update({
      // Zone (L0 coordinate)
      vehicle_zone: result.vehicle_zone,
      zone_confidence: result.zone_confidence,
      // Surface coordinates (L2, populated by COLMAP — keep null until then)
      surface_coord_u: result.surface_coord_u ?? null,
      surface_coord_v: result.surface_coord_v ?? null,
      // Condition analysis
      condition_score: result.condition_score,
      damage_flags: result.damage_flags,
      modification_flags: result.modification_flags,
      photo_quality_score: result.photo_quality,
      vision_analyzed_at: new Date().toISOString(),
      vision_model_version: result.model,
    })
    .eq("id", imageId);

  if (error) {
    console.error(`DB write failed for image ${imageId}:`, error);
    // Don't throw — DB write failure shouldn't kill the response
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Check sidecar health (vision-aware)
    const visionAvailable = await checkSidecarHealth();

    if (!visionAvailable) {
      return new Response(
        JSON.stringify({
          available: false,
          reason: "YONO vision sidecar not running or vision model not loaded",
          sidecar_url: SIDECAR_URL,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Batch mode
    if (body.images && Array.isArray(body.images)) {
      if (body.images.length > 20) {
        return new Response(
          JSON.stringify({ error: "Max 20 images per batch" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Setup DB client if any image_ids provided
      const hasImageIds = body.images.some((img: { image_id?: string }) => img.image_id);
      let supabase: ReturnType<typeof createClient> | null = null;
      if (hasImageIds) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
        if (supabaseUrl && serviceKey) {
          supabase = createClient(supabaseUrl, serviceKey);
        }
      }

      // Call batch endpoint
      const batchResp = await fetch(`${SIDECAR_URL}/analyze/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: body.images.map((img: { image_url: string }) => ({
            image_url: img.image_url,
          })),
        }),
        signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS * body.images.length),
      });

      if (!batchResp.ok) {
        throw new Error(`Batch analyze failed: ${batchResp.status}`);
      }

      const batchResult = await batchResp.json();

      // Write to DB if image_ids provided
      if (supabase) {
        const writePromises = batchResult.results.map(
          (result: AnalysisResult, i: number) => {
            const imageId = body.images[i]?.image_id;
            if (imageId && !result.hasOwnProperty("error")) {
              return writeToDb(supabase!, imageId, result);
            }
            return Promise.resolve();
          }
        );
        await Promise.allSettled(writePromises);
      }

      return new Response(
        JSON.stringify({
          available: true,
          source: "yono_vision",
          ...batchResult,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Single image mode
    const { image_url, image_id } = body;

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "Missing image_url" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const result = await analyzeImage(image_url);

    if (!result) {
      return new Response(
        JSON.stringify({
          available: true,
          error: "Analysis returned no result",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Write to DB if image_id provided
    if (image_id) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
      if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey);
        await writeToDb(supabase, image_id, result);
      }
    }

    const { source: _src, ...rest } = result as AnalysisResult & { source?: string };

    return new Response(
      JSON.stringify({
        available: true,
        source: "yono_vision",
        ...rest,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");

    return new Response(
      JSON.stringify({
        available: false,
        reason: isTimeout
          ? "YONO vision sidecar timeout (Florence-2 inference too slow)"
          : `Error: ${msg}`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
