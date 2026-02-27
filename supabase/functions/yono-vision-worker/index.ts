/**
 * yono-vision-worker — processes vehicle_images through YONO vision analysis
 *
 * Claims a batch of unanalyzed images, sends them to the YONO Modal sidecar
 * (/analyze/batch), and writes results back to vehicle_images.
 *
 * Uses yono_queued_at for distributed locking — safe to run multiple workers.
 * Stale claims (>10 min) are automatically re-eligible.
 *
 * Cron: runs every 2 minutes via pg_cron (2 staggered workers).
 *
 * Fields written to vehicle_images:
 *   vehicle_zone, zone_confidence, condition_score, damage_flags,
 *   modification_flags, photo_quality_score, vision_analyzed_at,
 *   vision_model_version, yono_queued_at (cleared on completion)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 20;
const SIDECAR_TIMEOUT_MS = 150_000; // 2.5 min for batch of 10 @ ~10s each

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function checkSidecarVision(): Promise<boolean> {
  try {
    // 15s timeout — Modal cold start takes 10-12s even with min_containers=1
    const resp = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return false;
    const health = await resp.json();
    return health.vision_available === true;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(
    body.batch_size ?? DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE
  );

  // 1. Gate on sidecar availability
  const visionUp = await checkSidecarVision();
  if (!visionUp) {
    return json({
      processed: 0,
      skipped: 0,
      elapsed_ms: Date.now() - t0,
      reason: "sidecar unavailable — will retry next run",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey);

  // 2. Claim batch atomically (FOR UPDATE SKIP LOCKED + set yono_queued_at)
  const { data: batch, error: claimErr } = await supabase.rpc(
    "claim_yono_vision_batch",
    { p_batch_size: batchSize }
  );

  if (claimErr) {
    console.error("Claim error:", claimErr);
    return json({ processed: 0, error: claimErr.message }, 500);
  }

  if (!batch || batch.length === 0) {
    return json({
      processed: 0,
      elapsed_ms: Date.now() - t0,
      reason: "queue empty",
    });
  }

  console.log(`[yono-vision-worker] claimed ${batch.length} images`);

  // 3. Call sidecar batch analyze
  let sidecarResults: Array<Record<string, unknown>> = [];
  try {
    const sidecarResp = await fetch(`${SIDECAR_URL}/analyze/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: batch.map((row: { image_url: string }) => ({
          image_url: row.image_url,
        })),
      }),
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });

    if (!sidecarResp.ok) {
      throw new Error(`Sidecar batch failed: ${sidecarResp.status}`);
    }

    const sidecarBody = await sidecarResp.json();
    sidecarResults = sidecarBody.results ?? [];
  } catch (err) {
    // Sidecar call failed entirely — release locks so images are re-eligible
    const releaseIds = batch.map((r: { id: string }) => r.id);
    await supabase
      .from("vehicle_images")
      .update({ yono_queued_at: null })
      .in("id", releaseIds);

    console.error("Sidecar batch error:", err);
    return json(
      {
        processed: 0,
        released: releaseIds.length,
        error: String(err),
      },
      500
    );
  }

  // 4. Write results back — one update per image
  const now = new Date().toISOString();
  let processed = 0;
  let skipped = 0;

  const writes = batch.map(
    async (row: { id: string; image_url: string }, i: number) => {
      const result = sidecarResults[i];

      if (!result || result.error) {
        // Image failed (bad URL, timeout, etc.) — mark done to avoid retry loop
        skipped++;
        await supabase
          .from("vehicle_images")
          .update({
            vision_analyzed_at: now,
            vision_model_version: "error",
            yono_queued_at: null,
          })
          .eq("id", row.id);
        return;
      }

      processed++;
      await supabase
        .from("vehicle_images")
        .update({
          vehicle_zone: result.vehicle_zone,
          zone_confidence: result.zone_confidence,
          surface_coord_u: result.surface_coord_u ?? null,
          surface_coord_v: result.surface_coord_v ?? null,
          condition_score: result.condition_score,
          damage_flags: result.damage_flags,
          modification_flags: result.modification_flags,
          photo_quality_score: result.photo_quality,
          vision_analyzed_at: now,
          vision_model_version: result.model,
          yono_queued_at: null,
        })
        .eq("id", row.id);
    }
  );

  await Promise.allSettled(writes);

  const elapsed = Date.now() - t0;
  console.log(
    `[yono-vision-worker] done: ${processed} analyzed, ${skipped} skipped, ${elapsed}ms`
  );

  return json({
    processed,
    skipped,
    elapsed_ms: elapsed,
    batch_size: batch.length,
  });
});
