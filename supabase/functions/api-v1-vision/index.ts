/**
 * API v1 - Vision Endpoint
 *
 * Developer-facing vehicle image intelligence API.
 * This is the consumer deliverable: nuke.vision.analyze(photoUrl)
 *
 * Backed by YONO (free, fast local models) with optional Gemini/GPT fallback.
 * YONO provides: make classification, condition scoring, damage detection,
 * zone identification, modification detection, and photo quality assessment.
 *
 * Routes:
 *   POST /api-v1-vision/classify   — image URL → make/confidence/top5
 *   POST /api-v1-vision/analyze    — image URL → full analysis (make, condition, zone, damage, comps)
 *   POST /api-v1-vision/batch      — array of URLs → array of classify results
 *
 * Authentication: Bearer JWT, service role key, or X-API-Key: nk_live_*
 *
 * Example:
 *   curl -X POST .../api-v1-vision/analyze \
 *     -H "Authorization: Bearer ..." \
 *     -d '{"image_url": "https://..."}'
 *
 *   → {
 *       "make": "Porsche",
 *       "confidence": 0.91,
 *       "family": "german",
 *       "top5": [["Porsche", 0.91], ...],
 *       "vehicle_zone": "ext_front_driver",
 *       "condition_score": 4,
 *       "damage_flags": [],
 *       "modification_flags": [],
 *       "photo_quality": 4,
 *       "source": "yono",
 *       "cost_usd": 0,
 *       "comps": [...] | null
 *     }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";
const SIDECAR_TOKEN = Deno.env.get("MODAL_SIDECAR_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";

// Sidecar timeout: Modal cold start can take 10-15s, plus image download + inference
const CLASSIFY_TIMEOUT_MS = 60_000;
const ANALYZE_TIMEOUT_MS = 90_000;

function sidecarHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(SIDECAR_TOKEN ? { Authorization: `Bearer ${SIDECAR_TOKEN}` } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await authenticateRequest(req, supabase, { endpoint: 'vision' });
  if (auth.error || !auth.userId) {
    return json({ error: auth.error || "Authentication required" }, auth.status || 401);
  }
  const userId = auth.userId;

  // ── Route ─────────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/api-v1-vision\/?/, "")
    .replace(/^\//, "");

  // GET /api-v1-vision — info
  if (req.method === "GET" && (!path || path === "")) {
    // Check sidecar health for live status
    let health: Record<string, unknown> | null = null;
    try {
      const hResp = await fetch(`${SIDECAR_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (hResp.ok) health = await hResp.json();
    } catch {
      // sidecar down
    }

    return json({
      name: "Nuke Vision API",
      version: "1.1",
      endpoints: {
        classify:
          "POST /api-v1-vision/classify — { image_url } → { make, confidence, top5, source, ms, cost_usd }",
        analyze:
          "POST /api-v1-vision/analyze  — { image_url } → { make, condition_score, vehicle_zone, damage_flags, comps, ... }",
        batch:
          "POST /api-v1-vision/batch    — { images: [{image_url},...] } → { results: [...] }",
      },
      cost: "All endpoints: $0.00/image (YONO local inference, zero cloud API calls)",
      model: {
        classify: "Hierarchical EfficientNet-B0 (tier1: family, tier2: make)",
        analyze:
          "Florence-2-base + fine-tuned heads (condition, damage, zone, modifications)",
      },
      sidecar_status: health
        ? {
            status: health.status,
            tier1: health.tier1,
            tier2_families: health.tier2_families,
            flat_classes: health.flat_classes,
            vision_available: health.vision_available,
            vision_mode: health.vision_mode,
            zone_classifier: health.zone_classifier,
          }
        : { status: "unavailable" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));

    if (path === "classify") {
      return await handleClassify(body, t0);
    } else if (path === "analyze") {
      return await handleAnalyze(body, supabase, t0);
    } else if (path === "batch") {
      return await handleBatch(body, t0);
    } else {
      return json(
        {
          error: `Unknown endpoint: /${path}. See GET /api-v1-vision for routes.`,
        },
        404
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});

// ── /classify ─────────────────────────────────────────────────────────────

async function handleClassify(body: any, t0: number): Promise<Response> {
  const { image_url, top_k = 5 } = body;
  if (!image_url) return json({ error: "Missing image_url" }, 400);

  const yonoResult = await callYonoClassify(image_url, top_k);
  if (yonoResult) {
    return json({
      make: yonoResult.make,
      family: yonoResult.family ?? null,
      family_confidence: yonoResult.family_confidence ?? null,
      confidence: yonoResult.confidence,
      top5: yonoResult.top5,
      is_vehicle: yonoResult.is_vehicle,
      source: "yono",
      yono_source: yonoResult.source ?? "unknown",
      ms: yonoResult.ms,
      cost_usd: 0,
      elapsed_ms: Date.now() - t0,
    });
  }

  return json({
    make: null,
    family: null,
    family_confidence: null,
    confidence: 0,
    top5: [],
    is_vehicle: null,
    source: "unavailable",
    cost_usd: 0,
    error: "YONO vision service is temporarily unavailable. Retry later.",
    elapsed_ms: Date.now() - t0,
  }, 503);
}

// ── /analyze ──────────────────────────────────────────────────────────────
// Full vehicle image intelligence: make + condition + zone + damage + comps
// This is the consumer API: nuke.vision.analyze(photoUrl)

async function handleAnalyze(
  body: any,
  supabase: any,
  t0: number
): Promise<Response> {
  const { image_url, include_comps = false } = body;
  if (!image_url) return json({ error: "Missing image_url" }, 400);

  // Run classify and analyze in parallel against YONO sidecar (both free)
  const [classifyResult, analyzeResult] = await Promise.all([
    callYonoClassify(image_url, 5),
    callYonoAnalyze(image_url),
  ]);

  // Fetch comps if make was identified and caller wants them
  let comps: unknown[] | null = null;
  if (include_comps && classifyResult?.make && classifyResult.is_vehicle) {
    comps = await fetchComps(classifyResult.make, supabase);
  }

  // Merge classify + analyze results into unified response
  const make = classifyResult?.make ?? null;
  const classifySource = classifyResult?.source ?? null;
  const analyzeSource = analyzeResult?.model ?? null;

  let source = "unavailable";
  let statusCode = 200;
  if (classifyResult && analyzeResult) source = "yono";
  else if (classifyResult) source = "yono_classify_only";
  else if (analyzeResult) source = "yono_analyze_only";
  else statusCode = 503; // Both services unavailable

  return json({
    // Classification
    make,
    family: classifyResult?.family ?? null,
    family_confidence: classifyResult?.family_confidence ?? null,
    confidence: classifyResult?.confidence ?? 0,
    top5: classifyResult?.top5 ?? [],
    is_vehicle: classifyResult?.is_vehicle ?? null,

    // Vision analysis (condition, zone, damage)
    vehicle_zone: analyzeResult?.vehicle_zone ?? null,
    zone_confidence: analyzeResult?.zone_confidence ?? null,
    zone_source: analyzeResult?.zone_source ?? null,
    condition_score: analyzeResult?.condition_score ?? null,
    damage_flags: analyzeResult?.damage_flags ?? [],
    modification_flags: analyzeResult?.modification_flags ?? [],
    interior_quality: analyzeResult?.interior_quality ?? null,
    photo_quality: analyzeResult?.photo_quality ?? null,
    photo_type: analyzeResult?.photo_type ?? null,

    // Comparable sales (optional)
    comps: comps,

    // Meta
    source,
    classify_model: classifySource,
    analyze_model: analyzeSource,
    classify_ms: classifyResult?.ms ?? null,
    analyze_ms: analyzeResult?.ms ?? null,
    cost_usd: 0,
    elapsed_ms: Date.now() - t0,
    image_url,
    ...(statusCode === 503 ? { error: "YONO vision service is temporarily unavailable. Retry later." } : {}),
  }, statusCode);
}

// ── /batch ────────────────────────────────────────────────────────────────

async function handleBatch(body: any, t0: number): Promise<Response> {
  const images: Array<{ image_url: string; top_k?: number }> =
    body.images ?? [];
  if (!Array.isArray(images) || images.length === 0) {
    return json({ error: "Missing images array" }, 400);
  }
  if (images.length > 100) {
    return json({ error: "Max 100 images per batch" }, 400);
  }

  const results = await Promise.all(
    images.map(async (img) => {
      if (!img.image_url) {
        return { image_url: img.image_url, error: "Missing image_url" };
      }
      const yonoResult = await callYonoClassify(
        img.image_url,
        img.top_k ?? 5
      );
      if (yonoResult) {
        return {
          image_url: img.image_url,
          make: yonoResult.make,
          family: yonoResult.family ?? null,
          family_confidence: yonoResult.family_confidence ?? null,
          confidence: yonoResult.confidence,
          top5: yonoResult.top5,
          is_vehicle: yonoResult.is_vehicle,
          ms: yonoResult.ms,
          cost_usd: 0,
        };
      }
      return { image_url: img.image_url, error: "Classification failed" };
    })
  );

  return json({
    results,
    count: results.length,
    errors: results.filter((r: any) => "error" in r).length,
    cost_usd: 0,
    elapsed_ms: Date.now() - t0,
  });
}

// ── YONO sidecar helpers ─────────────────────────────────────────────────

interface ClassifyResult {
  make: string;
  family: string | null;
  family_confidence: number | null;
  confidence: number;
  top5: Array<[string, number]>;
  is_vehicle: boolean;
  ms: number;
  source: string;
}

async function callYonoClassify(
  imageUrl: string,
  topK: number = 5
): Promise<ClassifyResult | null> {
  try {
    const resp = await fetch(`${SIDECAR_URL}/classify`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({ image_url: imageUrl, top_k: topK }),
      signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.make && !data.family) return null;
    return data;
  } catch {
    return null;
  }
}

interface AnalyzeResult {
  vehicle_zone: string;
  zone_confidence: number | null;
  zone_source: string | null;
  surface_coord_u: number | null;
  surface_coord_v: number | null;
  condition_score: number;
  damage_flags: string[];
  modification_flags: string[];
  interior_quality: number | null;
  photo_quality: number;
  photo_type: string;
  model: string;
  ms: number;
}

async function callYonoAnalyze(
  imageUrl: string
): Promise<AnalyzeResult | null> {
  try {
    const resp = await fetch(`${SIDECAR_URL}/analyze`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({ image_url: imageUrl }),
      signal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Comps helper ─────────────────────────────────────────────────────────

async function fetchComps(
  make: string,
  _supabase: any
): Promise<unknown[] | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/api-v1-comps`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ make, limit: 5 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.comps ?? data.results ?? null;
  } catch {
    return null;
  }
}

// authenticateRequest imported from _shared/apiKeyAuth.ts

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
