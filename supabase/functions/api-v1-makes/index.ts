/**
 * API v1 - Makes & Models
 *
 * Dynamic vehicle taxonomy from 942K+ vehicles.
 * GET /v1/makes                 → all makes with counts (50+ vehicles)
 * GET /v1/makes?make=Porsche    → all models for a make with counts
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

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

serve(async (req) => {
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

    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

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

async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; isServiceRole?: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if ((serviceRoleKey && token === serviceRoleKey) || (altServiceRoleKey && token === altServiceRoleKey)) {
      return { userId: "service-role", isServiceRole: true };
    }
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) return { userId: user.id };
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith("nk_live_") ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);
    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, rate_limit_remaining, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyData && !error) {
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        return { userId: null, error: "API key has expired" };
      }
      if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
        return { userId: null, error: "Rate limit exceeded" };
      }
      await supabase
        .from("api_keys")
        .update({
          rate_limit_remaining: keyData.rate_limit_remaining !== null ? keyData.rate_limit_remaining - 1 : null,
          last_used_at: new Date().toISOString(),
        })
        .eq("key_hash", keyHash);
      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "sha256_" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
