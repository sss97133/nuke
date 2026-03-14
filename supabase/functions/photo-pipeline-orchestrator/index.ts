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
      const { data: pendingImages } = await supabase
        .from("vehicle_images")
        .select("id, image_url, vehicle_id, user_id")
        .eq("ai_processing_status", "pending")
        .eq("is_duplicate", false)
        .not("image_url", "is", null)
        .order("created_at", { ascending: true })
        .limit(limit);

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

    // Step 1: Mark as processing
    await supabase
      .from("vehicle_images")
      .update({ ai_processing_status: "processing" })
      .eq("id", image_id);

    // Step 2: Classify image type
    const classification = await classifyImage(image_url);
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

    // Step 7: Mark as completed (single update)
    const durationMs = Date.now() - startedAt;
    const updatePayload: Record<string, any> = {
      ai_processing_status: "completed",
      ai_scan_metadata: {
        pipeline_version: "v2",
        classification,
        route_result: routeResult.summary,
        duration_ms: durationMs,
        processed_at: new Date().toISOString(),
      },
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

    console.log(`[photo-pipeline] Completed in ${durationMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        image_id,
        classification: classification.image_type,
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
// CLASSIFY IMAGE (Gemini Flash — cheap and fast)
// ============================================================

async function classifyImage(imageUrl: string): Promise<ClassificationResult> {
  const geminiKey = Deno.env.get("free_api_key") ??
    Deno.env.get("GOOGLE_AI_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY") ??
    Deno.env.get("GOOGLE_API_KEY");

  if (!geminiKey) {
    console.warn("[photo-pipeline] No Gemini key, falling back to basic classification");
    return {
      image_type: "other",
      confidence: 0.3,
      is_automotive: true,
      description: "No AI classification available",
    };
  }

  try {
    // Fetch image as base64
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
    );
    const mimeType = imageResponse.headers.get("content-type") || "image/jpeg";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
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
            maxOutputTokens: 500,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

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
    };
  } catch (error: any) {
    console.warn("[photo-pipeline] Classification failed, using fallback:", error.message);
    return {
      image_type: "other",
      confidence: 0.3,
      is_automotive: true,
      description: `Classification failed: ${error.message}`,
    };
  }
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

  // Strategy 3: User's most recent vehicle with work activity
  if (userId) {
    const { data: recentVehicle } = await supabase
      .from("vehicle_images")
      .select("vehicle_id")
      .eq("user_id", userId)
      .not("vehicle_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentVehicle?.vehicle_id) {
      console.log("[photo-pipeline] Vehicle resolved via recent activity");
      return recentVehicle.vehicle_id;
    }
  }

  console.log("[photo-pipeline] Could not resolve vehicle");
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
      // Run YONO zone + stage analysis in background (cheap, local)
      if (vehicleId) {
        callEdgeFunction("yono-analyze", {
          image_url: imageUrl,
          image_id: imageId,
        }).catch((e: any) => console.warn("[photo-pipeline] yono-analyze:", e.message));
      }

      // Only call expensive analyze-image if we have a vehicle to enrich
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
      // Work documentation → generate work logs + labor estimation pipeline
      const workLogResult = await callGenerateWorkLogs(imageId, imageUrl, vehicleId, userId);

      // Run YONO analysis for zone + stage classification (non-blocking pipeline)
      if (vehicleId) {
        try {
          // 1. YONO analyze for zone + stage
          const yonoResp = await callEdgeFunction("yono-analyze", {
            image_url: imageUrl,
            image_id: imageId,
          });

          // 2. Escalation router — validates YONO if confidence is low
          if (yonoResp?.available && yonoResp?.vehicle_zone) {
            callEdgeFunction("yono-escalation-router", {
              image_id: imageId,
              image_url: imageUrl,
              yono_result: {
                vehicle_zone: yonoResp.vehicle_zone,
                zone_confidence: yonoResp.zone_confidence,
                fabrication_stage: yonoResp.fabrication_stage,
                stage_confidence: yonoResp.stage_confidence,
                condition_score: yonoResp.condition_score,
                damage_flags: yonoResp.damage_flags,
                modification_flags: yonoResp.modification_flags,
                photo_quality: yonoResp.photo_quality,
              },
              prediction_type: "all",
            }).catch((e: any) => console.warn("[photo-pipeline] escalation-router:", e.message));
          }

          // 3. Before/after detection (if prior zone images exist)
          if (yonoResp?.vehicle_zone) {
            const { data: priorImages } = await supabase
              .from("vehicle_images")
              .select("id")
              .eq("vehicle_id", vehicleId)
              .eq("vehicle_zone", yonoResp.vehicle_zone)
              .neq("id", imageId)
              .not("taken_at", "is", null)
              .order("taken_at", { ascending: false })
              .limit(5);

            if (priorImages && priorImages.length > 0) {
              const allIds = [
                ...priorImages.map((p: any) => p.id),
                imageId,
              ];
              callEdgeFunction("detect-before-after", {
                vehicleId,
                imageIds: allIds,
              }).catch((e: any) => console.warn("[photo-pipeline] detect-before-after:", e.message));
            }
          }

          // 5. Compute labor estimate
          callEdgeFunction("compute-labor-estimate", {
            vehicle_id: vehicleId,
          }).catch((e: any) => console.warn("[photo-pipeline] compute-labor-estimate:", e.message));

        } catch (e: any) {
          console.warn("[photo-pipeline] Labor estimation pipeline error:", e.message);
        }
      }

      return workLogResult;
    }

    default: {
      // Fallback to standard analysis
      return await callAnalyzeImage(imageId, imageUrl, vehicleId, userId);
    }
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
  try {
    const data = await callEdgeFunction("yono-analyze", {
      image_id: imageId,
      image_url: imageUrl,
      vehicle_id: vehicleId,
      user_id: userId,
      timeline_event_id: null,
    });

    // Extract fields from analysis result
    const metadata = data?.ai_scan_metadata || data;
    const appraiser = metadata?.appraiser || {};

    const extracted_fields: Record<string, any> = {};
    if (appraiser.vin) extracted_fields.vin = appraiser.vin;
    if (appraiser.year) extracted_fields.year = appraiser.year;
    if (appraiser.make) extracted_fields.make = appraiser.make;
    if (appraiser.model) extracted_fields.model = appraiser.model;
    if (appraiser.exterior_color) extracted_fields.exterior_color = appraiser.exterior_color;
    if (appraiser.detected_angle) extracted_fields.detected_angle = appraiser.detected_angle;

    return {
      summary: `analyze-image: ${data?.success ? "ok" : "partial"}`,
      handler: "analyze-image",
      extracted_fields: Object.keys(extracted_fields).length > 0 ? extracted_fields : undefined,
      response_data: data,
    };
  } catch (error: any) {
    console.warn(`[photo-pipeline] analyze-image failed: ${error.message}`);
    return {
      summary: `analyze-image: failed (${error.message})`,
      handler: "analyze-image",
    };
  }
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

async function callGenerateWorkLogs(
  imageId: string,
  imageUrl: string,
  vehicleId: string | null,
  userId: string | null,
): Promise<RouteResult> {
  if (!vehicleId) {
    return {
      summary: "generate-work-logs: skipped (no vehicle_id)",
      handler: "generate-work-logs",
    };
  }

  try {
    // Get image IDs for this vehicle's recent session (last 30 min)
    const { data: recentImages } = await supabase
      .from("vehicle_images")
      .select("id")
      .eq("vehicle_id", vehicleId)
      .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true });

    const imageIds = recentImages?.map((i: any) => i.id) || [imageId];

    const data = await callEdgeFunction("generate-work-logs", {
      vehicleId,
      imageIds,
    });

    return {
      summary: `generate-work-logs: ${data?.success ? "ok" : "partial"}`,
      handler: "generate-work-logs",
      extracted_fields: data?.workLog ? {
        work_title: data.workLog.title,
        labor_hours: data.workLog.estimatedLaborHours,
        parts_count: data.partsCount,
      } : undefined,
      response_data: data,
    };
  } catch (error: any) {
    console.warn(`[photo-pipeline] generate-work-logs failed: ${error.message}`);
    return {
      summary: `generate-work-logs: failed (${error.message})`,
      handler: "generate-work-logs",
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

    await callEdgeFunction("ingest-observation", {
      source_slug: sourceSlug,
      kind,
      observed_at: new Date().toISOString(),
      source_url: imageUrl,
      source_identifier: `photo-pipeline:${imageId}`,
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
