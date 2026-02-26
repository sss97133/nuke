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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SIDECAR_URL =
  Deno.env.get("YONO_SIDECAR_URL") || "http://127.0.0.1:8472";
const SIDECAR_TIMEOUT_MS = 10_000;

serve(async (req) => {
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

    // Ping sidecar health first (fast timeout)
    let sidecarAvailable = false;
    try {
      const healthResp = await fetch(`${SIDECAR_URL}/health`, {
        signal: AbortSignal.timeout(2000),
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
      headers: { "Content-Type": "application/json" },
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
    const isTimeout = msg.includes("timeout") || msg.includes("Timeout");
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
