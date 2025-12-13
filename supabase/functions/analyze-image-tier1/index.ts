/**
 * DEPRECATED: analyze-image-tier1
 *
 * This endpoint is kept for backward compatibility only.
 * It forwards requests to the vision pipeline `analyze-image`.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const config = {
  verifyJwt: false,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  const image_url = body?.image_url;
  const image_id = body?.image_id ?? null;
  const vehicle_id = body?.vehicle_id ?? null;
  const user_id = body?.user_id ?? null;
  const timeline_event_id = body?.timeline_event_id ?? null;

  if (!image_url) {
    return new Response(JSON.stringify({ success: false, error: "Missing image_url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL") ??
    Deno.env.get("PROJECT_URL") ??
    Deno.env.get("URL") ??
    "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Missing SUPABASE_URL or service role key" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Best-effort: mark as processing early
  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, detectSessionInUrl: false },
    });
    if (image_id) {
      await supabase
        .from("vehicle_images")
        .update({ ai_processing_status: "processing", ai_processing_started_at: new Date().toISOString() })
        .eq("id", image_id);
    }
  } catch {
    // non-blocking
  }

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/analyze-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        image_url,
        image_id,
        vehicle_id,
        user_id,
        timeline_event_id,
      }),
    });

    const txt = await resp.text();
    const parsed = (() => {
      try {
        return JSON.parse(txt);
      } catch {
        return { raw: txt };
      }
    })();

    if (!resp.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          deprecated: true,
          routed_to: "analyze-image",
          status: resp.status,
          error: parsed?.error || "Vision analysis failed",
          result: parsed,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        deprecated: true,
        routed_to: "analyze-image",
        result: parsed,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        deprecated: true,
        routed_to: "analyze-image",
        error: error?.message || "Internal error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});


