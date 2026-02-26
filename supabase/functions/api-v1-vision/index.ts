/**
 * API v1 - Vision Endpoint
 *
 * Developer-facing vehicle image classification API.
 * Backed by YONO (free, fast) with Gemini/GPT fallback for low-confidence.
 *
 * Routes:
 *   POST /api-v1-vision/classify   — image URL → make/confidence/top5
 *   POST /api-v1-vision/analyze    — image URL → full analysis (category, angle, condition)
 *   POST /api-v1-vision/batch      — array of URLs → array of results
 *
 * Authentication: Bearer JWT, service role key, or X-API-Key: nk_live_*
 *
 * Example:
 *   curl -X POST .../api-v1-vision/classify \
 *     -H "X-API-Key: nk_live_..." \
 *     -d '{"image_url": "https://..."}'
 *
 *   → {
 *       "make": "Porsche",
 *       "confidence": 0.91,
 *       "top5": [["Porsche", 0.91], ...],
 *       "source": "yono",
 *       "ms": 4.2,
 *       "cost_usd": 0
 *     }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { userId, error: authError } = await authenticateRequest(req, supabase);
  if (authError || !userId) {
    return json({ error: authError || "Authentication required" }, 401);
  }

  // ── Route ─────────────────────────────────────────────────────────────────
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api-v1-vision\/?/, "").replace(/^\//, "");

  // GET /api-v1-vision — info
  if (req.method === "GET" && (!path || path === "")) {
    return json({
      name: "YONO Vision API",
      version: "1.0",
      endpoints: {
        classify: "POST /api-v1-vision/classify — { image_url } → { make, confidence, top5, source, ms, cost_usd }",
        analyze:  "POST /api-v1-vision/analyze  — { image_url } → { make, confidence, category, angle, source, cost_usd }",
        batch:    "POST /api-v1-vision/batch    — { images: [{image_url},...] } → { results: [...] }",
      },
      cost: "YONO tier: $0.00/image | Full analysis tier: $0.0001–$0.004/image",
      model: "YONO phase5_final (EfficientNet-B0, 276 classes)",
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
      return json({ error: `Unknown endpoint: /${path}. See GET /api-v1-vision for routes.` }, 404);
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

  // Try YONO sidecar
  const yonoResult = await callYono(image_url, top_k);
  if (yonoResult) {
    return json({
      make: yonoResult.make,
      confidence: yonoResult.confidence,
      top5: yonoResult.top5,
      is_vehicle: yonoResult.is_vehicle,
      source: "yono",
      ms: yonoResult.ms,
      cost_usd: 0,
      elapsed_ms: Date.now() - t0,
    });
  }

  // Fallback: no sidecar or error
  return json({
    make: null,
    confidence: 0,
    top5: [],
    source: "unavailable",
    cost_usd: 0,
    error: "YONO sidecar not available. Start with: ./scripts/yono-server-start.sh",
    elapsed_ms: Date.now() - t0,
  });
}

// ── /analyze ──────────────────────────────────────────────────────────────

async function handleAnalyze(body: any, supabase: any, t0: number): Promise<Response> {
  const { image_url, vehicle_id } = body;
  if (!image_url) return json({ error: "Missing image_url" }, 400);

  // YONO classification (always free)
  const yonoResult = await callYono(image_url, 5);

  // Full cloud analysis via analyze-image function
  let cloudResult: any = null;
  let cloudCost = 0;

  try {
    const analyzeResp = await fetch(
      `${SUPABASE_URL}/functions/v1/analyze-image`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ image_url, vehicle_id, force_reprocess: false }),
        signal: AbortSignal.timeout(90000),
      }
    );
    if (analyzeResp.ok) {
      const analyzeJson = await analyzeResp.json();
      cloudResult = analyzeJson.ai_scan_metadata?.appraiser || null;
      cloudCost = analyzeJson.total_processing_cost || 0;
    }
  } catch (e) {
    console.warn("[api-v1-vision/analyze] Cloud analysis failed:", e);
  }

  return json({
    make: yonoResult?.make ?? cloudResult?.make ?? null,
    confidence: yonoResult?.confidence ?? 0,
    top5: yonoResult?.top5 ?? [],
    category: cloudResult?.category ?? null,
    subject: cloudResult?.subject ?? null,
    description: cloudResult?.description ?? null,
    condition_notes: cloudResult?.condition_notes ?? null,
    visible_damage: cloudResult?.visible_damage ?? null,
    camera_position: cloudResult?.camera_position ?? null,
    yono: yonoResult
      ? { make: yonoResult.make, confidence: yonoResult.confidence, ms: yonoResult.ms }
      : null,
    source: cloudResult ? "yono+cloud" : yonoResult ? "yono" : "unavailable",
    cost_usd: cloudCost,
    elapsed_ms: Date.now() - t0,
  });
}

// ── /batch ────────────────────────────────────────────────────────────────

async function handleBatch(body: any, t0: number): Promise<Response> {
  const images: Array<{ image_url: string; top_k?: number }> = body.images ?? [];
  if (!Array.isArray(images) || images.length === 0) {
    return json({ error: "Missing images array" }, 400);
  }
  if (images.length > 100) {
    return json({ error: "Max 100 images per batch" }, 400);
  }

  // Classify all concurrently
  const results = await Promise.all(
    images.map(async (img) => {
      if (!img.image_url) {
        return { image_url: img.image_url, error: "Missing image_url" };
      }
      const yonoResult = await callYono(img.image_url, img.top_k ?? 5);
      if (yonoResult) {
        return {
          image_url: img.image_url,
          make: yonoResult.make,
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
    errors: results.filter((r) => "error" in r).length,
    cost_usd: 0,
    elapsed_ms: Date.now() - t0,
  });
}

// ── YONO sidecar helper ───────────────────────────────────────────────────

async function callYono(
  imageUrl: string,
  topK: number = 5
): Promise<{
  make: string;
  confidence: number;
  top5: Array<[string, number]>;
  is_vehicle: boolean;
  ms: number;
} | null> {
  try {
    const resp = await fetch(`${SIDECAR_URL}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, top_k: topK }),
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.make) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Auth (matches api-v1-vehicles pattern) ───────────────────────────────

async function authenticateRequest(
  req: Request,
  supabase: any
): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKeyHeader = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === SERVICE_ROLE_KEY || token === Deno.env.get("SERVICE_ROLE_KEY")) {
      return { userId: "service-role" };
    }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) return { userId: user.id };
  }

  if (apiKeyHeader) {
    const raw = apiKeyHeader.startsWith("nk_live_")
      ? apiKeyHeader.slice(8)
      : apiKeyHeader;
    const keyHash = await hashApiKey(raw);
    const { data: keyData } = await supabase
      .from("api_keys")
      .select("user_id, is_active, scopes")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();
    if (keyData) return { userId: keyData.user_id };
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

async function hashApiKey(key: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(key));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
