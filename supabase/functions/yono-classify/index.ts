/**
 * yono-classify — YONO inference edge function
 *
 * Proxies to the local YONO Python sidecar (port 8472).
 * Used by analyze-image as a zero-cost tier-0 gate before Gemini/GPT.
 *
 * Request:
 *   POST /yono-classify
 *   { image_url: string, top_k?: number }
 *
 * Response (sidecar up):
 *   {
 *     available: true,
 *     make: string,           // top predicted make
 *     confidence: number,     // 0–1
 *     family: string|null,    // "german"|"american"|etc — only set when Tier 2 was used
 *     family_confidence: number|null,
 *     top5: [string, number][],
 *     is_vehicle: boolean,
 *     ms: number,
 *     source: "yono",
 *     yono_source: "hierarchical"|"flat_fallback"|"flat"  // which model path was used
 *   }
 *   or { available: false, reason: "..." } if sidecar is down
 */


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";
const SIDECAR_TIMEOUT_MS = 60_000; // 60s — Modal network from Supabase can take 30-40s
const HEALTH_TIMEOUT_MS = 45_000;  // 45s — matches yono-vision-worker
const SIDECAR_TOKEN = Deno.env.get("MODAL_SIDECAR_TOKEN") || "";

function sidecarHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(SIDECAR_TOKEN ? { "Authorization": `Bearer ${SIDECAR_TOKEN}` } : {}),
    ...extra,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { image_url, top_k = 5 } = body;

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "Missing image_url" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Ping sidecar health first.
    // Timeout must cover Modal cold start (10-15s for Florence-2).
    // min_containers=1 keeps sidecar warm but container restarts still happen ~once/day.
    let sidecarAvailable = false;
    try {
      const healthResp = await fetch(`${SIDECAR_URL}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      sidecarAvailable = healthResp.ok;
    } catch {
      // Sidecar not running — that's OK, caller handles fallback
    }

    if (!sidecarAvailable) {
      return new Response(
        JSON.stringify({
          available: false,
          reason: "YONO sidecar not running",
          sidecar_url: SIDECAR_URL,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Call classify endpoint
    const classifyResp = await fetch(`${SIDECAR_URL}/classify`, {
      method: "POST",
      headers: sidecarHeaders(),
      body: JSON.stringify({ image_url, top_k }),
      signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
    });

    if (!classifyResp.ok) {
      const errText = await classifyResp.text();
      return new Response(
        JSON.stringify({
          available: true,
          error: `Sidecar classify failed: ${classifyResp.status}`,
          detail: errText,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const result = await classifyResp.json();
    // Preserve the sidecar's inference path (hierarchical/flat_fallback/flat)
    // as yono_source, while source="yono" marks the origin system.
    const { source: yono_source, ...rest } = result;
    return new Response(
      JSON.stringify({ ...rest, source: "yono", yono_source: yono_source ?? "flat", available: true }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout") || msg.includes("timed out");
    return new Response(
      JSON.stringify({
        available: false,
        reason: isTimeout ? "YONO sidecar timeout" : `Error: ${msg}`,
      }),
      {
        status: 200, // always 200 — caller decides whether to fallback
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
