/**
 * yono-batch-process — Background batch classifier for 32M pending images
 *
 * Pulls pending vehicle_images in batches, runs YONO classification on each,
 * stores results in ai_scan_metadata.yono, marks status as 'yono_complete'.
 *
 * Cost: $0 (YONO is local, zero cloud API calls)
 * Rate: ~200-500 images/minute depending on sidecar throughput
 *
 * Trigger: cron, manual POST, or called by yono-overnight.sh
 *
 * Request:
 *   POST /yono-batch-process
 *   {
 *     batch_size?: number    // default 100, max 500
 *     vehicle_id?: string    // restrict to one vehicle
 *     dry_run?: boolean      // classify but don't write
 *   }
 *
 * Response:
 *   {
 *     processed: number
 *     skipped: number          // sidecar unavailable
 *     errors: number
 *     high_confidence: number  // confidence >= 0.7
 *     elapsed_ms: number
 *     remaining_estimate: number  // rough total pending
 *   }
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(body.batch_size ?? 100, 500);
  const vehicleId: string | undefined = body.vehicle_id;
  const dryRun: boolean = body.dry_run ?? false;

  // ── 1. Check sidecar health ──────────────────────────────────────────────
  let sidecarAvailable = false;
  try {
    const h = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    sidecarAvailable = h.ok;
  } catch {
    // not running
  }

  if (!sidecarAvailable) {
    return new Response(
      JSON.stringify({
        processed: 0,
        skipped: 0,
        errors: 0,
        high_confidence: 0,
        elapsed_ms: Date.now() - t0,
        remaining_estimate: -1,
        error: "YONO sidecar not available at " + SIDECAR_URL,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // ── 2. Pull pending images ───────────────────────────────────────────────
  let query = supabase
    .from("vehicle_images")
    .select("id, image_url, vehicle_id, ai_scan_metadata")
    .is("image_url", "not.null" as any)
    .in("ai_processing_status", ["pending", "new"])
    .not("image_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data: images, error: fetchErr } = await query;

  if (fetchErr || !images) {
    return new Response(
      JSON.stringify({ error: fetchErr?.message || "Failed to fetch images" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // ── 3. Get rough remaining count ─────────────────────────────────────────
  const { count: remainingCount } = await supabase
    .from("vehicle_images")
    .select("*", { count: "exact", head: true })
    .in("ai_processing_status", ["pending", "new"]);

  // ── 4. Classify each image ───────────────────────────────────────────────
  let processed = 0;
  let errors = 0;
  let highConfidence = 0;

  const classifyPromises = images.map(async (img) => {
    try {
      const resp = await fetch(`${SIDECAR_URL}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: img.image_url, top_k: 5 }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        errors++;
        return;
      }

      const result = await resp.json();
      if (!result.make) {
        errors++;
        return;
      }

      const yonoMeta = {
        make: result.make,
        confidence: result.confidence,
        top5: result.top5,
        is_vehicle: result.is_vehicle,
        ms: result.ms,
        classified_at: new Date().toISOString(),
      };

      if ((result.confidence || 0) >= 0.7) highConfidence++;

      if (!dryRun) {
        const existingMeta = img.ai_scan_metadata || {};
        await supabase
          .from("vehicle_images")
          .update({
            ai_processing_status: "yono_complete",
            ai_scan_metadata: { ...existingMeta, yono: yonoMeta },
          })
          .eq("id", img.id);
      }

      processed++;
    } catch (e) {
      errors++;
      console.error(`[batch] Error classifying ${img.id}:`, e);
    }
  });

  // Process concurrently in batches of 20 to avoid overwhelming the sidecar
  const concurrency = 20;
  for (let i = 0; i < classifyPromises.length; i += concurrency) {
    await Promise.all(classifyPromises.slice(i, i + concurrency));
  }

  const elapsed = Date.now() - t0;

  return new Response(
    JSON.stringify({
      processed,
      skipped: 0,
      errors,
      high_confidence: highConfidence,
      elapsed_ms: elapsed,
      remaining_estimate: (remainingCount ?? 0) - processed,
      batch_size: batchSize,
      dry_run: dryRun,
      sidecar: SIDECAR_URL,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
