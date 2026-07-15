/**
 * PHOTO PIPELINE ORCHESTRATOR
 *
 * Per-image trigger (not batch). Receives {image_id, image_url, vehicle_id, user_id}
 * from pg_net trigger on vehicle_images INSERT.
 *
 * Flow:
 * 1. Mark ai_processing_status = 'processing'
 * 2. Classify image type via Gemini Flash (cheap, fast)
 * 3. Route by type to appropriate AI pipeline
 * 4. If vehicle_id is null, attempt GPS/metadata matching
 * 5. Create observation via ingest-observation
 * 6. Update vehicle_field_evidence for extracted fields
 * 7. Mark ai_processing_status = 'completed'
 * 8. Frontend auto-notified via Supabase Realtime (already wired)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Image type classification categories
type ImageType =
  | "vehicle_exterior"
  | "vehicle_interior"
  | "engine_bay"
  | "undercarriage"
  | "detail_closeup"
  | "vin_plate"
  | "part_closeup"
  | "receipt_document"
  | "progress_shot"
  | "other";

type ImageMedium = 'photograph' | 'render' | 'drawing' | 'screenshot';

interface ClassificationResult {
  image_type: ImageType;
  confidence: number;
  is_automotive: boolean;
  description: string;
  detected_text?: string[];
  vin_detected?: string;
  image_medium?: ImageMedium;
  medium_context?: string;
  vehicle_hints?: {
    make?: string;
    model?: string;
    year_range?: string;
    color?: string;
  };
  /**
   * false = this is NOT a real Gemini verdict — it's a stand-in produced because
   * the classifier was rate-limited, errored, or unconfigured. Root-cause fix
   * (2026-07-06, the 429/hollow-completion incident): this flag is what lets
   * Step 7 stop lying with ai_processing_status='completed'. Absent/true = a
   * real classification (or no classifier condition applies).
   */
  classifier_ok?: boolean;
}

interface PipelineInput {
  image_id: string;
  image_url: string;
  vehicle_id: string | null;
  user_id: string | null;
}

// ============================================================
// MAIN HANDLER
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();

  try {
    const input = await req.json();

    // Batch mode: process images stuck in 'pending' (cleanup/catchup)
    if (input.action === "process_pending") {
      const limit = input.limit || 5;

      // 2026-07-06 perf fix: this used to be a single query ordered by
      // (user_id DESC NULLS LAST, created_at DESC). That combined ORDER BY has
      // no supporting index over a table where ~32.7M rows are
      // ai_processing_status='pending' (mostly scraped/NULL-user backlog), so
      // Postgres fell back to a Parallel Seq Scan + Sort across all of them,
      // which blew the statement timeout on every single invocation. The error
      // was swallowed by `if (!pendingImages...)`, so this action silently
      // no-op'd as "No pending images" on every cron tick (job 478, */5 min)
      // instead of ever draining the queue. Split into two indexed passes that
      // preserve the same "owner uploads first" intent:
      //   1. idx_vehicle_images_pending_user (user_id IS NOT NULL AND status='pending')
      //   2. idx_vehicle_images_pending_processing (status='pending'), top-up only
      const { data: ownerPending, error: ownerErr } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id, user_id")
        .eq("ai_processing_status", "pending")
        .eq("is_duplicate", false)
        .not("image_url", "is", null)
        .not("user_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (ownerErr) {
        console.error(`[photo-pipeline] process_pending owner-query error: ${ownerErr.message}`);
      }

      let pendingImages = ownerPending ?? [];

      if (pendingImages.length < limit) {
        const seenIds = new Set(pendingImages.map((r) => r.id));
        // Fetch a full `limit` rows (not just the remaining gap) as a buffer:
        // the backlog query has no user_id filter, so it can re-surface rows
        // already in pendingImages (owner rows are a subset of "pending"
        // overall) — the dedup loop below drops those, and over-fetching by
        // seenIds.size keeps this batch at `limit` total after dedup instead
        // of falling short and needing another cron tick to catch up.
        const { data: backlogPending, error: backlogErr } = await supabase
          .from("vehicle_images")
          .select("id, image_url, vehicle_id, user_id")
          .eq("ai_processing_status", "pending")
          .eq("is_duplicate", false)
          .not("image_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (backlogErr) {
          console.error(`[photo-pipeline] process_pending backlog-query error: ${backlogErr.message}`);
        }

        for (const row of backlogPending ?? []) {
          if (!seenIds.has(row.id)) {
            pendingImages.push(row);
            seenIds.add(row.id);
          }
          if (pendingImages.length >= limit) break;
        }
      }

      if (!pendingImages || pendingImages.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "No pending images", processed: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const results = [];
      // Process junk URLs inline (fast), real images via self-call
      const JUNK_RE = [
        /facebook\.com\/tr/i, /googleads/i, /doubleclick/i,
        /google-analytics/i, /googlesyndication/i, /adservice/i,
        /\.gif\?/, /pixel\./, /beacon\./,
      ];
      const junkIds: string[] = [];

      for (const img of pendingImages) {
        if (JUNK_RE.some(p => p.test(img.image_url))) {
          junkIds.push(img.id);
          results.push({ image_id: img.id, success: true, classification: "junk_url" });
          continue;
        }
        try {
          // Stagger requests to avoid Gemini 429 rate limiting
          if (results.length > 0) {
            await new Promise((r) => setTimeout(r, 2000));
          }
          const resp = await fetch(
            `${SUPABASE_URL}/functions/v1/photo-pipeline-orchestrator`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({
                image_id: img.id,
                image_url: img.image_url,
                vehicle_id: img.vehicle_id,
                user_id: img.user_id,
              }),
            },
          );
          const result = await resp.json();
          results.push({ image_id: img.id, success: true, classification: result.classification });
        } catch (err: any) {
          results.push({ image_id: img.id, success: false, error: err.message });
        }
      }

      // Bulk update junk URLs in one query
      if (junkIds.length > 0) {
        await supabase.from("vehicle_images").update({
          ai_processing_status: "completed",
          ai_scan_metadata: { pipeline_version: "v2", skipped: "junk_url_batch" },
        }).in("id", junkIds);
      }

      return new Response(
        JSON.stringify({ success: true, processed: results.length, results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { image_id, image_url, vehicle_id, user_id } = input as PipelineInput;

    if (!image_id || !image_url) {
      return new Response(
        JSON.stringify({ error: "image_id and image_url required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Skip garbage URLs (tracking pixels, ads, non-image URLs)
    const JUNK_PATTERNS = [
      /facebook\.com\/tr/i, /googleads/i, /doubleclick/i,
      /google-analytics/i, /googlesyndication/i, /adservice/i,
      /\.gif\?/, /pixel\./, /beacon\./,
    ];
    if (JUNK_PATTERNS.some(p => p.test(image_url))) {
      await supabase.from("vehicle_images").update({
        ai_processing_status: "completed",
        ai_scan_metadata: { pipeline_version: "v2", skipped: "junk_url", url_pattern: image_url.substring(0, 80) },
      }).eq("id", image_id);
      return new Response(
        JSON.stringify({ success: true, image_id, classification: "junk_url", skipped: true, duration_ms: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[photo-pipeline] Processing image ${image_id}`);

    // Step 1: Mark as processing + read pre-computed Apple ML data
    const { data: imageRow } = await supabase
      .from("vehicle_images")
      .select("apple_ml_labels, vehicle_score, latitude, longitude, taken_at, is_external")
      .eq("id", image_id)
      .maybeSingle();

    await supabase
      .from("vehicle_images")
      .update({ ai_processing_status: "processing" })
      .eq("id", image_id);

    // Step 1.5: Cross-sweep moment dedup. A library re-sweep (iphoto /
    // hd_archive / ssd_blast-style bulk ingest) re-lands an already-ingested
    // capture moment as a new export — different file_hash (invisible to
    // trg_flag_duplicate_image) and no phash yet (invisible to
    // flag_image_burst_duplicates). Run the third sibling detector on this
    // image's (vehicle, capture-day) BEFORE classification: if this frame just
    // lost a keeper election it skips Gemini entirely and never reaches the
    // BYOK deep queue. Scoped to is_external=false because that is the
    // detector's whole corpus (~98% of inflow is scraped and would pay a
    // no-op RPC per image otherwise); scoped to taken_at because a null
    // taken_at can never join a moment bucket.
    if (vehicle_id && imageRow?.taken_at && imageRow?.is_external === false) {
      const marked = await flagCrossSweepDuplicates(vehicle_id, imageRow.taken_at);
      if (marked > 0) {
        const { data: self } = await supabase
          .from("vehicle_images")
          .select("is_duplicate, ai_scan_metadata")
          .eq("id", image_id)
          .maybeSingle();
        if (self?.is_duplicate) {
          // Merge, never replace: the detector just wrote its
          // duplicate_collapse breadcrumb into ai_scan_metadata.
          await supabase.from("vehicle_images").update({
            ai_processing_status: "completed",
            ai_scan_metadata: {
              ...(self.ai_scan_metadata || {}),
              pipeline_version: "v2",
              skipped: "cross_sweep_duplicate",
            },
          }).eq("id", image_id);
          return new Response(
            JSON.stringify({ success: true, image_id, classification: "cross_sweep_duplicate", skipped: true, duration_ms: Date.now() - startedAt }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    const appleLabels: string[] = imageRow?.apple_ml_labels || [];
    const vehicleScore: number | null = imageRow?.vehicle_score;

    // Fast-path: if Apple ML pre-scored this as non-automotive (score 0), skip Gemini
    if (vehicleScore !== null && vehicleScore === 0 && appleLabels.length > 0) {
      console.log(`[photo-pipeline] Apple ML score=0, skipping Gemini (labels: ${appleLabels.join(', ')})`);
      await supabase.from("vehicle_images").update({
        ai_processing_status: "completed",
        ai_scan_metadata: {
          pipeline_version: "v2",
          skipped: "apple_ml_non_automotive",
          apple_ml_labels: appleLabels,
          vehicle_score: vehicleScore,
        },
      }).eq("id", image_id);
      return new Response(
        JSON.stringify({ success: true, image_id, classification: "non_automotive_apple_ml", skipped: true, duration_ms: Date.now() - startedAt }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 2: Classify image type (Gemini Flash)
    const classification = await classifyImage(image_url);
    // Merge Apple ML hints into classification if Gemini didn't detect vehicle hints
    if (appleLabels.length > 0 && !classification.vehicle_hints?.make) {
      classification.description = `${classification.description} [Apple ML: ${appleLabels.join(', ')}]`;
    }
    console.log(`[photo-pipeline] Classified as: ${classification.image_type} (${classification.confidence})`);

    // Step 3: If no vehicle_id, try to resolve
    let resolvedVehicleId = vehicle_id;
    if (!resolvedVehicleId) {
      resolvedVehicleId = await resolveVehicle(image_id, user_id, classification);
    }

    // Step 4: Route to appropriate handler
    const routeResult = await routeByType(
      classification,
      image_id,
      image_url,
      resolvedVehicleId,
      user_id,
    );

    // Step 5: Create observation
    if (resolvedVehicleId) {
      await createObservation(
        classification,
        image_id,
        image_url,
        resolvedVehicleId,
        routeResult,
      );
    }

    // Step 6: Update field evidence
    if (resolvedVehicleId && routeResult.extracted_fields) {
      await updateFieldEvidence(
        resolvedVehicleId,
        image_id,
        routeResult.extracted_fields,
        classification,
      );
    }

    // Step 7: Mark as completed — UNLESS the classifier itself never actually ran
    // (rate-limited / errored / unconfigured). Root-cause fix for the 429/hollow-
    // completion incident (2026-07-06): 13,718 rows were hitting Gemini 429s and
    // 7,138 of those settled as ai_processing_status='completed' with nothing but
    // a failure string in ai_scan_metadata — the flag was lying about what
    // happened. classifier_ok===false means classifyImage() never got a real
    // verdict; the honest terminal state is 'failed', NOT 'completed'. The rest
    // of the pipeline (resolveVehicle/routeByType/enqueueDeepByok/createObservation)
    // still ran above — this only changes the status label, so the BYOK deep-tier
    // rescue path is untouched.
    //
    // Why 'failed' and not a new 'needs_retry' status: reset_stuck_photo_pipeline_images()
    // (15-min cron) ALREADY sweeps 'failed' with exactly the retry-budgeted semantics
    // this needs (ai_retry_count < 3 -> reset to 'pending' for a fresh whole-pipeline
    // pass with new jittered backoff; >= 3 -> stays 'failed', an honest terminal state)
    // — verified live against the deployed function. The 2026-06-18 comment this
    // replaces believed re-throwing here caused an infinite failed->pending loop; that
    // is not what the live cron does (it's retry-count-gated), so the workaround
    // (silently faking 'completed') is no longer needed. A distinct 'needs_retry'
    // status was tried first but would need its own partial index — CONCURRENTLY
    // build on this table's 39M rows exceeds the 120s statement_timeout ceiling even
    // for a narrow predicate (confirmed empirically, twice, cleanly rolled back) — so
    // reusing 'failed' (zero new indexes, zero schema risk, already the flag frontend
    // code already renders) is the correct-not-just-easier choice.
    const durationMs = Date.now() - startedAt;
    const classifierFailed = classification.classifier_ok === false;
    const scanMeta: Record<string, any> = {
      pipeline_version: "v2",
      classification,
      route_result: routeResult.summary,
      duration_ms: durationMs,
      processed_at: new Date().toISOString(),
      classifier_failed: classifierFailed, // queryable top-level flag, not buried in nested JSON
    };
    // P3.2: stamp the observable deep-queue marker here (step 7 rewrites
    // ai_scan_metadata, so enqueueDeepByok deliberately doesn't write it itself —
    // it only flips the gate column, the real prepare() selection key). NOT
    // byok_deep_analysis, which would make prepare() think the deep work is done.
    if (routeResult.deep_enqueued) {
      scanMeta.deep_byok_enqueued = {
        enqueued_at: new Date().toISOString(),
        enqueued_by: "photo-pipeline-orchestrator",
        route: "inflow_deep_tier",
      };
    }
    const updatePayload: Record<string, any> = {
      ai_processing_status: classifierFailed ? "failed" : "completed",
      ai_scan_metadata: scanMeta,
    };
    if (resolvedVehicleId && !vehicle_id) {
      updatePayload.vehicle_id = resolvedVehicleId;
    }
    // Write image_medium from Gemini classification (Gemini is the authority for this field)
    if (classification.image_medium) {
      updatePayload.image_medium = classification.image_medium;
    }
    await supabase
      .from("vehicle_images")
      .update(updatePayload)
      .eq("id", image_id);

    // Late-resolution dedup pass: Step 1.5 could only see this row in the
    // detector's corpus if it was INSERTed with a vehicle_id. When the vehicle
    // was resolved during this run (VIN/GPS), the row only just acquired its
    // vehicle_id in the update above — sweep its capture day now. Without this,
    // a late-resolved re-sweep frame that happens to be the LAST row landed for
    // its moment group would never get swept (no later sibling re-runs the day).
    if (resolvedVehicleId && !vehicle_id && imageRow?.taken_at && imageRow?.is_external === false) {
      await flagCrossSweepDuplicates(resolvedVehicleId, imageRow.taken_at);
    }

    console.log(`[photo-pipeline] ${classifierFailed ? "Needs retry" : "Completed"} in ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        image_id,
        classification: classification.image_type,
        classifier_ok: !classifierFailed,
        vehicle_id: resolvedVehicleId,
        vehicle_resolved: !!resolvedVehicleId,
        route: routeResult.summary,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[photo-pipeline] Error:", error);

    // Try to mark as failed
    try {
      const { image_id } = await req.clone().json().catch(() => ({ image_id: null }));
      if (image_id) {
        await supabase
          .from("vehicle_images")
          .update({
            ai_processing_status: "failed",
            ai_scan_metadata: {
              pipeline_error: error.message,
              failed_at: new Date().toISOString(),
            },
          })
          .eq("id", image_id);
      }
    } catch (_) { /* best-effort */ }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// CROSS-SWEEP MOMENT DEDUP (sibling of trg_flag_duplicate_image / burst dedup)
// ============================================================

// Drains flag_cross_sweep_moment_duplicates() for one (vehicle, capture-day).
// p_max_groups (default 25) bounds a single call's write set because
// trg_sync_vehicle_primary_image fires per marked row and a dense unbounded
// UPDATE exceeds statement_timeout — so loop until rows_marked=0. The 8-pass
// cap (200 groups) is far past any real day (densest observed: 19 groups); if
// a pathological day ever exceeds it, the next landed image's pass continues
// the drain. Best-effort: dedup failure must never fail the pipeline.
async function flagCrossSweepDuplicates(vehicleId: string, takenAt: string): Promise<number> {
  const day = String(takenAt).slice(0, 10); // timestamptz arrives ISO-8601 UTC; detector buckets in UTC too
  let total = 0;
  try {
    for (let pass = 0; pass < 8; pass++) {
      const { data, error } = await supabase.rpc("flag_cross_sweep_moment_duplicates", {
        p_vehicle_id: vehicleId,
        p_day: day,
      });
      if (error) {
        console.warn(`[photo-pipeline] cross-sweep dedup ${vehicleId} ${day}: ${error.message}`);
        break;
      }
      const marked = Number((data as Record<string, unknown> | null)?.rows_marked ?? 0);
      total += marked;
      if (marked === 0) break;
    }
  } catch (e: any) {
    console.warn(`[photo-pipeline] cross-sweep dedup ${vehicleId} ${day}: ${e.message}`);
  }
  if (total > 0) {
    console.log(`[photo-pipeline] cross-sweep dedup: marked ${total} duplicate rows (vehicle ${vehicleId}, day ${day})`);
  }
  return total;
}

// ============================================================
// CLASSIFY IMAGE (Gemini Flash — cheap and fast)
// ============================================================

// Terminal "unclassified" result — used whenever the classifier is absent,
// rate-limited, or errors. Sets classifier_ok:false, which Step 7 reads to
// write ai_processing_status='failed' (not a fake 'completed') — the
// reset_stuck_photo_pipeline_images() cron (15-min, retry-count-gated) is
// what actually re-churns it, not this function. BYOK deep analysis / owner
// confirmation is the real classifier downstream once retries exhaust.
function UNCLASSIFIED_FALLBACK(reason: string): ClassificationResult {
  return {
    image_type: "other",
    confidence: 0.2,
    is_automotive: true,
    description: `Unclassified (classifier unavailable: ${String(reason).slice(0, 120)}) — left for BYOK/owner review`,
    classifier_ok: false,
  };
}

async function classifyImage(imageUrl: string): Promise<ClassificationResult> {
  // Prefer paid keys over free tier to avoid 429s
  const geminiKey = Deno.env.get("GOOGLE_AI_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY") ??
    Deno.env.get("GOOGLE_API_KEY") ??
    Deno.env.get("free_api_key");

  if (!geminiKey) {
    console.warn("[photo-pipeline] No Gemini key, falling back to basic classification");
    return {
      image_type: "other",
      confidence: 0.3,
      is_automotive: true,
      description: "No AI classification available",
      classifier_ok: false,
    };
  }

  // Fetch image as base64 (once, before retry loop)
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = btoa(
    new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
  );
  const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

  // Root-cause note (2026-07-06 429/hollow-completion incident): this per-invocation
  // backoff can't fix a THUNDERING HERD — the orchestrator is a per-row pg_net trigger
  // (AFTER INSERT ... FOR EACH ROW), so a single bulk photo sync (hundreds of rows in
  // one INSERT batch) fires hundreds of concurrent invocations that each independently
  // hit the same Gemini key's RPM quota at once. Fixed exponential delays (1s/2s/4s in
  // lockstep across every concurrent invocation) synchronize the retries right back
  // into the same collision. MAX_RETRIES 3->5 + a delay cap + +/-30% jitter de-syncs
  // the herd (textbook thundering-herd mitigation) — it reduces, but cannot alone
  // eliminate, collisions under a large burst. The real backstop is Step 7 below no
  // longer lying about 'completed' when this budget is exhausted.
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 1000;
  const MAX_DELAY_MS = 8000;
  const jitteredDelay = (attempt: number) => {
    const capped = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
    return Math.round(capped * (0.7 + Math.random() * 0.6)); // +/-30% jitter
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  text: `Classify this automotive image. Respond in JSON only:
{
  "image_type": one of ["vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage", "detail_closeup", "vin_plate", "part_closeup", "receipt_document", "progress_shot", "other"],
  "image_medium": one of ["photograph", "render", "drawing", "screenshot"],
  "medium_context": "brief explanation (e.g. '3D render of planned build', 'pencil sketch', 'screenshot from parts catalog', 'real photograph')",
  "confidence": 0.0-1.0,
  "is_automotive": true/false,
  "description": "brief description",
  "detected_text": ["any visible text/numbers"],
  "vin_detected": "17-char VIN if visible or null",
  "vehicle_hints": {"make": "...", "model": "...", "year_range": "...", "color": "..."}
}

image_medium definitions:
- "photograph": real camera photo of a physical vehicle
- "render": 3D render, CGI, digital mockup, or AI-generated image of a vehicle
- "drawing": hand-drawn sketch, pencil drawing, technical illustration, blueprint
- "screenshot": screenshot from a website, app, parts catalog, or software`,
                },
                {
                  inlineData: { mimeType, data: base64Image },
                },
              ],
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
              responseMimeType: "application/json",
              // Disable thinking for classification — it's unnecessary and consumes output tokens
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        },
      );

      // Rate limited — retry with capped exponential backoff + jitter (de-syncs
      // concurrent invocations from the same bulk-insert burst; see note above)
      if (response.status === 429) {
        const delay = jitteredDelay(attempt);
        console.warn(`[photo-pipeline] Gemini 429 (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const result = await response.json();
      // Gemini 2.5+ may include thinking parts before the actual response
      // Find the last text part (thinking parts come first, JSON response last)
      const parts = result.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p: any) => p.text && !p.thought).pop()?.text
        || parts[parts.length - 1]?.text;

      if (!text) throw new Error("No classification response");

      const parsed = JSON.parse(text);
      return {
        image_type: parsed.image_type || "other",
        confidence: parsed.confidence || 0.5,
        is_automotive: parsed.is_automotive !== false,
        description: parsed.description || "",
        detected_text: parsed.detected_text,
        vin_detected: parsed.vin_detected,
        image_medium: parsed.image_medium || "photograph",
        medium_context: parsed.medium_context,
        vehicle_hints: parsed.vehicle_hints,
        classifier_ok: true,
      };
    } catch (error: any) {
      // Classifier failure must NOT churn the row itself (this function still never
      // throws — the caller always gets a usable ClassificationResult so downstream
      // resolveVehicle/routeByType/enqueueDeepByok/createObservation keep running).
      // What changed 2026-07-06: churn is no longer avoided by mislabeling the row
      // 'completed'. classifier_ok:false tells Step 7 to write 'failed' instead, and
      // reset_stuck_photo_pipeline_images() (15-min cron) already sweeps 'failed' with
      // a retry budget (ai_retry_count < 3 -> reset to 'pending' for a fresh pass with
      // new jittered backoff; >= 3 -> stays 'failed', honest terminal) — verified live
      // against the deployed function, so this does not reopen an infinite-loop.
      console.error(`[photo-pipeline] Classification error (attempt ${attempt + 1}): ${error.message}`);
      return UNCLASSIFIED_FALLBACK(error.message);
    }
  }

  // All retries exhausted on 429 — classifier_ok:false routes this to 'failed'
  // (Step 7's honest terminal state), not a silent fake 'completed'.
  return UNCLASSIFIED_FALLBACK("Gemini rate limited (429) after retries");
}

// ============================================================
// RESOLVE VEHICLE (GPS, metadata, recent work)
// ============================================================

async function resolveVehicle(
  imageId: string,
  userId: string | null,
  classification: ClassificationResult,
): Promise<string | null> {
  // Strategy 1: VIN detected in image
  if (classification.vin_detected && classification.vin_detected.length === 17) {
    const { data: vinMatch } = await supabase
      .from("vehicles")
      .select("id")
      .eq("vin", classification.vin_detected)
      .maybeSingle();

    if (vinMatch) {
      console.log(`[photo-pipeline] Vehicle resolved via VIN: ${classification.vin_detected}`);
      return vinMatch.id;
    }
  }

  // Strategy 2: Image GPS → nearby vehicles with recent work
  const { data: image } = await supabase
    .from("vehicle_images")
    .select("latitude, longitude, taken_at")
    .eq("id", imageId)
    .maybeSingle();

  if (image?.latitude && image?.longitude) {
    const { data: nearbyMatch } = await supabase
      .rpc("auto_match_image_to_vehicles", {
        p_image_id: imageId,
        p_latitude: image.latitude,
        p_longitude: image.longitude,
        p_taken_at: image.taken_at,
        p_user_id: userId,
      })
      .maybeSingle();

    if (nearbyMatch?.vehicle_id && nearbyMatch?.confidence > 0.7) {
      console.log(`[photo-pipeline] Vehicle resolved via GPS (confidence: ${nearbyMatch.confidence})`);
      return nearbyMatch.vehicle_id;
    }
  }

  // Strategy 3 (REMOVED 2026-07-02): "user's most recent vehicle with work activity" stamped
  // ANY unresolved photo onto whatever vehicle was touched last — zero evidence, the exact
  // anti-pattern HARD_RULES §10 outlaws ("recent camera roll ≠ this build"). It auto-filed
  // 14 freshly-recovered owner-pool photos onto the Mustang 22s after insert while the
  // classifier was rate-limited. Attribution follows evidence (VIN, GPS>0.7) or stays NULL —
  // the owner pool + confirm queue are the honest home for unresolved frames.
  console.log("[photo-pipeline] Could not resolve vehicle — leaving in owner pool (no evidence)");
  return null;
}

// ============================================================
// ROUTE BY TYPE → call existing edge functions
// ============================================================

interface RouteResult {
  summary: string;
  handler: string;
  extracted_fields?: Record<string, any>;
  response_data?: any;
  /** Set when the frame was marked eligible for the BYOK deep queue (P3.2). */
  deep_enqueued?: boolean;
}

async function routeByType(
  classification: ClassificationResult,
  imageId: string,
  imageUrl: string,
  vehicleId: string | null,
  userId: string | null,
): Promise<RouteResult> {
  const type = classification.image_type;

  switch (type) {
    case "vehicle_exterior":
    case "vehicle_interior":
    case "detail_closeup":
    case "undercarriage":
    case "other": {
      // DEEP TIER: callAnalyzeImage enqueues for BYOK deep analysis (replaces the
      // dead yono-analyze sidecar) and returns deep_enqueued.
      if (vehicleId) {
        return await callAnalyzeImage(imageId, imageUrl, vehicleId, userId);
      }
      // No vehicle context — Gemini classification is sufficient
      const extracted: Record<string, any> = {};
      if (classification.vehicle_hints?.make) extracted.make = classification.vehicle_hints.make;
      if (classification.vehicle_hints?.model) extracted.model = classification.vehicle_hints.model;
      if (classification.vehicle_hints?.color) extracted.exterior_color = classification.vehicle_hints.color;
      if (classification.vin_detected) extracted.vin = classification.vin_detected;
      return {
        summary: `gemini-only: ${classification.image_type}`,
        handler: "gemini-flash",
        extracted_fields: Object.keys(extracted).length > 0 ? extracted : undefined,
      };
    }

    case "engine_bay": {
      // Vision analysis + engine-specific extraction
      const [analyzeResult, engineResult] = await Promise.allSettled([
        callAnalyzeImage(imageId, imageUrl, vehicleId, userId),
        callAnalyzeEngineBay(imageId, imageUrl, vehicleId),
      ]);

      const analyze = analyzeResult.status === "fulfilled" ? analyzeResult.value : null;
      const engine = engineResult.status === "fulfilled" ? engineResult.value : null;

      return {
        summary: `engine_bay: analyze-image ${analyze ? "ok" : "failed"}, analyze-engine-bay ${engine ? "ok" : "failed"}`,
        handler: "analyze-image + analyze-engine-bay",
        extracted_fields: {
          ...(analyze?.extracted_fields || {}),
          ...(engine?.extracted_fields || {}),
        },
      };
    }

    case "vin_plate": {
      // VIN-focused analysis
      const result = await callAnalyzeImage(imageId, imageUrl, vehicleId, userId);
      // VIN is extracted by analyze-image which has VIN OCR built in
      if (classification.vin_detected) {
        result.extracted_fields = {
          ...result.extracted_fields,
          vin: classification.vin_detected,
        };
      }
      return result;
    }

    case "part_closeup": {
      // Part number OCR
      return await callPartNumberOcr(imageId, imageUrl, vehicleId);
    }

    case "receipt_document": {
      // Receipt/invoice OCR
      return await callReceiptPhotoOcr(imageId, imageUrl, vehicleId, userId);
    }

    case "progress_shot": {
      // Work documentation → BYOK deep-fleet analysis.
      // Repointed 2026-07-06 off the dead `generate-work-logs` edge function
      // (undeployed — every call 404'd "Requested function was not found",
      // confirmed on 443 vehicle_images rows going back to at least 2026-05-24
      // and still firing daily). That function's write targets
      // (event_participants, work_order_materials, event_financial_records,
      // ai_scan_field_confidence, image_forensic_attribution) no longer exist
      // in the schema either — it wasn't a deploy slip, it was superseded.
      // Work-log composition now happens at READ time via the mcp-connector
      // `project_work_log` tool (composes vehicle_observations +
      // work_order_{labor,parts,payments} per day, see TOOLS.md). The
      // write-time job for a progress shot is just the same BYOK deep-fleet
      // enqueue every other route already uses (see callAnalyzeImage, which
      // was repointed off the dead yono-analyze sidecar the same way).
      // `compute-labor-estimate` (called here previously) was deleted in the
      // Phase 5 edge-function triage (commit 34d110a38) — labor estimation is
      // now `estimate_labor_from_description()` / `resolve_labor_rate()` SQL
      // RPCs, not a fire-and-forget edge call, so it's dropped rather than
      // redirected.
      if (!vehicleId) {
        return {
          summary: "progress_shot: skipped (no vehicle_id)",
          handler: "byok-deep-enqueue",
        };
      }

      const enqueued = await enqueueDeepByok(imageId, vehicleId);
      return {
        summary: enqueued
          ? "progress_shot: enqueued for fleet deep analysis"
          : "progress_shot: not enqueued (rejected gate or already deep)",
        handler: "byok-deep-enqueue",
        deep_enqueued: enqueued,
      };
    }

    default: {
      // Fallback to standard analysis
      return await callAnalyzeImage(imageId, imageUrl, vehicleId, userId);
    }
  }
}

// ============================================================
// DEEP-TIER ENQUEUE (BYOK fleet, replaces the dead yono-analyze sidecar)
// ============================================================

// W (image-ecosystem mandate §3.2): the daily-inflow deep route used to call
// yono-analyze → a Modal Florence-2 sidecar whose /health returns 404, so new
// photos fell through into nothing. Instead of restoring Modal, we feed the SAME
// deep engine the backlog uses (byok-image-batch.sh → deep-image-analysis-byok.mjs).
// That engine's prepare() selects frames WHERE vision_gate_status='approved' AND
// ai_scan_metadata.byok_deep_analysis IS MISSING; byok-fleet-next.mjs then ranks
// vehicles by their image_coverage_by_vehicle counter (inflow_7d first). So to
// enqueue a freshly-classified inflow photo for deep analysis we mark it gate-
// approved (respecting any prior rejection) WITHOUT writing byok_deep_analysis,
// then refresh the vehicle's coverage counter so the fleet coordinator sees it.
//
// Returns true if the frame was (or already is) eligible for the deep queue, so
// the caller can stamp the observable `deep_byok_enqueued` marker into the FINAL
// ai_scan_metadata write (the main handler clobbers ai_scan_metadata in step 7, so
// this helper must NOT write that JSONB itself — it flips only the gate column,
// which is the real prepare() selection key, plus refreshes the counter).
async function enqueueDeepByok(imageId: string, vehicleId: string): Promise<boolean> {
  try {
    const { data: row } = await supabase
      .from("vehicle_images")
      .select("vision_gate_status, ai_scan_metadata")
      .eq("id", imageId)
      .maybeSingle();

    // Respect the gate's verdict: a photo rejected as misattributed/personal must
    // NOT be auto-approved back into the deep queue (doctrine: the gate filters,
    // it doesn't permanently park real build photos — but only a human/approver
    // reverses a rejection, never the inflow path).
    const gate = (row?.vision_gate_status as string | null) ?? null;
    if (gate && gate.startsWith("rejected_")) return false;

    const meta = (row?.ai_scan_metadata as Record<string, any>) ?? {};
    // Already deep-analyzed? prepare() would skip it anyway; leave it alone.
    if (meta.byok_deep_analysis) return false;

    // The orchestrator resolved this image to a vehicle with confidence, so it is
    // gate-eligible for deep work. Only promote pending/null/review_needed —
    // never touch an existing 'approved' (idempotent) or a rejection (handled above).
    if (gate !== "approved") {
      await supabase
        .from("vehicle_images")
        .update({ vision_gate_status: "approved" })
        .eq("id", imageId);
    }

    // Refresh the per-vehicle coverage counter (indexed, never a full scan) so
    // byok-fleet-next.mjs's inflow lane ranks this vehicle for the next drain.
    await supabase.rpc("refresh_image_coverage", { p_vehicle_id: vehicleId });
    return true;
  } catch (e: any) {
    console.warn(`[photo-pipeline] enqueueDeepByok(${imageId}): ${e.message}`);
    return false;
  }
}

// ============================================================
// EDGE FUNCTION CALLERS
// ============================================================

async function callEdgeFunction(
  functionName: string,
  body: Record<string, any>,
): Promise<any> {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${functionName} returned ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function callAnalyzeImage(
  imageId: string,
  imageUrl: string,
  vehicleId: string | null,
  userId: string | null,
): Promise<RouteResult> {
  // DEEP TIER repointed off the dead yono-analyze Modal sidecar (W §3.2) onto the
  // BYOK fleet: enqueue the frame so deep-image-analysis-byok.mjs picks it up. The
  // rich appraiser fields (vin/year/make/model/zone/condition) the old sidecar was
  // meant to produce now come from the BYOK deep verdict downstream, not here.
  if (vehicleId) {
    const enqueued = await enqueueDeepByok(imageId, vehicleId);
    return {
      summary: enqueued
        ? "deep-byok: enqueued for fleet deep analysis"
        : "deep-byok: not enqueued (rejected gate or already deep)",
      handler: "byok-deep-enqueue",
      deep_enqueued: enqueued,
    };
  }
  return {
    summary: "deep-byok: skipped (no vehicle_id)",
    handler: "byok-deep-enqueue",
  };
}

async function callAnalyzeEngineBay(
  imageId: string,
  imageUrl: string,
  vehicleId: string | null,
): Promise<RouteResult> {
  try {
    const data = await callEdgeFunction("analyze-engine-bay", {
      mode: "single",
      image_id: imageId,
      image_url: imageUrl,
      vehicle_id: vehicleId,
    });

    const result = data?.result || data;
    const extracted_fields: Record<string, any> = {};
    if (result?.engine_family) extracted_fields.engine_family = result.engine_family;
    if (result?.engine_displacement) extracted_fields.engine_displacement = result.engine_displacement;
    if (result?.fuel_system) extracted_fields.fuel_system = result.fuel_system;

    return {
      summary: `analyze-engine-bay: ok`,
      handler: "analyze-engine-bay",
      extracted_fields: Object.keys(extracted_fields).length > 0 ? extracted_fields : undefined,
      response_data: data,
    };
  } catch (error: any) {
    console.warn(`[photo-pipeline] analyze-engine-bay failed: ${error.message}`);
    return {
      summary: `analyze-engine-bay: failed (${error.message})`,
      handler: "analyze-engine-bay",
    };
  }
}

async function callPartNumberOcr(
  imageId: string,
  imageUrl: string,
  vehicleId: string | null,
): Promise<RouteResult> {
  try {
    const data = await callEdgeFunction("part-number-ocr", {
      image_id: imageId,
      image_url: imageUrl,
      vehicle_id: vehicleId,
    });

    return {
      summary: `part-number-ocr: ${data?.parts_found || 0} parts found`,
      handler: "part-number-ocr",
      extracted_fields: data?.parts ? { parts: data.parts } : undefined,
      response_data: data,
    };
  } catch (error: any) {
    console.warn(`[photo-pipeline] part-number-ocr failed: ${error.message}`);
    // Fallback: run standard analysis instead
    return {
      summary: `part-number-ocr: failed, no fallback`,
      handler: "part-number-ocr",
    };
  }
}

async function callReceiptPhotoOcr(
  imageId: string,
  imageUrl: string,
  vehicleId: string | null,
  userId: string | null,
): Promise<RouteResult> {
  try {
    const data = await callEdgeFunction("receipt-photo-ocr", {
      image_id: imageId,
      image_url: imageUrl,
      vehicle_id: vehicleId,
      user_id: userId,
    });

    return {
      summary: `receipt-photo-ocr: ${data?.line_items_count || 0} items, ${data?.parts_found || 0} parts`,
      handler: "receipt-photo-ocr",
      extracted_fields: data?.extracted_fields,
      response_data: data,
    };
  } catch (error: any) {
    console.warn(`[photo-pipeline] receipt-photo-ocr failed: ${error.message}`);
    return {
      summary: `receipt-photo-ocr: failed (${error.message})`,
      handler: "receipt-photo-ocr",
    };
  }
}

// ============================================================
// CREATE OBSERVATION via ingest-observation
// ============================================================

async function createObservation(
  classification: ClassificationResult,
  imageId: string,
  imageUrl: string,
  vehicleId: string,
  routeResult: RouteResult,
): Promise<void> {
  try {
    const sourceSlug = classification.image_type === "receipt_document"
      ? "receipt_ocr"
      : classification.image_type === "part_closeup"
      ? "part_number_ocr"
      : "photo_pipeline";

    const kind = classification.image_type === "receipt_document"
      ? "work_record"
      : classification.image_type === "part_closeup"
      ? "specification"
      : classification.image_type === "progress_shot"
      ? "work_record"
      : "media";

    const sourceIdentifier = `photo-pipeline:${imageId}`;

    // ingest-observation's own content_hash dedup includes observed_at,
    // and this function stamps a fresh new Date() on every call — so a
    // retry of the SAME image (the classifier_ok:false -> 'failed' ->
    // reset_stuck_photo_pipeline_images() retry path this diff adds)
    // would otherwise create a new duplicate vehicle_observations row on
    // every retry instead of being recognized as the same testimony.
    // sourceIdentifier is stable across retries (keyed on imageId, not
    // time), so check for an existing row on it first.
    const { data: existingObs } = await supabase
      .from("vehicle_observations")
      .select("id")
      .eq("source_identifier", sourceIdentifier)
      .eq("kind", kind)
      .limit(1)
      .maybeSingle();
    if (existingObs) return;

    await callEdgeFunction("ingest-observation", {
      source_slug: sourceSlug,
      kind,
      observed_at: new Date().toISOString(),
      source_url: imageUrl,
      source_identifier: sourceIdentifier,
      content_text: classification.description,
      structured_data: {
        image_id: imageId,
        image_type: classification.image_type,
        confidence: classification.confidence,
        detected_text: classification.detected_text,
        route_handler: routeResult.handler,
        extracted_fields: routeResult.extracted_fields,
      },
      vehicle_id: vehicleId,
    });
  } catch (error: any) {
    // Non-blocking: observation creation failure shouldn't fail the pipeline
    console.warn(`[photo-pipeline] Observation creation failed: ${error.message}`);
  }
}

// ============================================================
// UPDATE FIELD EVIDENCE
// ============================================================

async function updateFieldEvidence(
  vehicleId: string,
  imageId: string,
  fields: Record<string, any>,
  classification: ClassificationResult,
): Promise<void> {
  const sourceType = classification.image_type === "receipt_document"
    ? "ai_visual"
    : "ai_visual";

  const entries = Object.entries(fields)
    .filter(([_, value]) => value != null && value !== "")
    .map(([fieldName, value]) => ({
      vehicle_id: vehicleId,
      field_name: fieldName,
      value_text: typeof value === "string" ? value : null,
      value_number: typeof value === "number" ? value : null,
      value_json: typeof value === "object" ? value : null,
      source_type: sourceType,
      source_id: imageId,
      confidence_score: Math.round(classification.confidence * 100),
      extraction_model: "photo-pipeline-v1",
      metadata: {
        image_type: classification.image_type,
        pipeline: "photo-pipeline-orchestrator",
      },
    }));

  if (entries.length === 0) return;

  try {
    const { error } = await supabase
      .from("vehicle_field_evidence")
      .upsert(entries, {
        onConflict: "vehicle_id,field_name,source_type,source_id",
        ignoreDuplicates: false,
      });

    if (error) {
      console.warn(`[photo-pipeline] Field evidence upsert error: ${error.message}`);
    } else {
      console.log(`[photo-pipeline] Updated ${entries.length} field evidence entries`);
    }
  } catch (error: any) {
    console.warn(`[photo-pipeline] Field evidence failed: ${error.message}`);
  }
}
