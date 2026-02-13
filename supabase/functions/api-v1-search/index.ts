/**
 * API v1 - Search Endpoint
 *
 * Wraps universal-search with API key auth + consistent v1 response format.
 * GET /v1/search?q=porsche+911&types=vehicle&limit=20
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return jsonResponse({ error: authError || "Authentication required" }, 401);
    }

    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const types = url.searchParams.get("types");
    const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));

    if (!q) {
      return jsonResponse({ error: "Parameter 'q' (search query) is required" }, 400);
    }

    // Build request body for universal-search
    const searchBody: any = {
      query: q,
      limit,
    };

    if (types) {
      searchBody.types = types.split(',').map((t: string) => t.trim());
    }

    // Invoke universal-search internally
    const { data: searchResult, error: searchError } = await supabase.functions.invoke(
      "universal-search",
      {
        body: searchBody,
      }
    );

    if (searchError) {
      throw searchError;
    }

    // Normalize to v1 format
    const response = {
      data: searchResult?.results || [],
      query: {
        q,
        types: types ? types.split(',').map((t: string) => t.trim()) : null,
        limit,
      },
      total_count: searchResult?.total_count || 0,
      query_type: searchResult?.query_type || "text",
      search_time_ms: searchResult?.search_time_ms || null,
    };

    await logApiUsage(supabase, userId, "search", "query");

    return jsonResponse(response);

  } catch (error: any) {
    console.error("API error:", error);
    return jsonResponse(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      500
    );
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
    if (user && !error) {
      return { userId: user.id };
    }
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith('nk_live_') ? apiKey.slice(8) : apiKey;
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
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function logApiUsage(supabase: any, userId: string, resource: string, action: string, resourceId?: string) {
  try {
    await supabase.from("api_usage_logs").insert({
      user_id: userId,
      resource,
      action,
      resource_id: resourceId,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log API usage:", e);
  }
}
