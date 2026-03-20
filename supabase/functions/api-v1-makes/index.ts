/**
 * API v1 - Makes & Models
 *
 * Dynamic vehicle taxonomy from 942K+ vehicles.
 * GET /v1/makes                 → all makes with counts (50+ vehicles)
 * GET /v1/makes?make=Porsche    → all models for a make with counts
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const t0 = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const auth = await authenticateRequest(req, supabase, { endpoint: 'makes' });
    if (auth.error || !auth.userId) {
      return jsonResponse({ error: auth.error || "Authentication required" }, auth.status || 401);
    }
    const userId = auth.userId;

    const url = new URL(req.url);
    const make = url.searchParams.get("make");

    if (make) {
      // Models for a make
      const { data, error } = await supabase.rpc("get_models_for_make", { p_make: make });
      if (error) {
        const details = typeof error === "object" ? JSON.stringify(error) : String(error);
        throw new Error(details);
      }

      const models = (data || []).map((r: any) => ({ model: r.model, count: r.vehicle_count }));
      return jsonResponse({
        make,
        models,
        total_models: models.length,
        total_vehicles: models.reduce((s: number, m: any) => s + m.count, 0),
        response_time_ms: Date.now() - t0,
      });
    }

    // All makes
    const { data, error } = await supabase.rpc("get_makes_with_counts");
    if (error) {
      const details = typeof error === "object" ? JSON.stringify(error) : String(error);
      throw new Error(details);
    }

    const makes = (data || []).map((r: any) => ({ make: r.make, count: r.vehicle_count }));
    return jsonResponse({
      makes,
      total_makes: makes.length,
      total_vehicles: makes.reduce((s: number, m: any) => s + m.count, 0),
      response_time_ms: Date.now() - t0,
    });

  } catch (error: any) {
    console.error("API error:", error);
    const details = error instanceof Error ? error.message : (typeof error === "object" ? JSON.stringify(error) : String(error));
    return jsonResponse({ error: "Internal server error", details }, 500);
  }
});

// authenticateRequest imported from _shared/apiKeyAuth.ts
