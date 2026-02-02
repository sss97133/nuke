/**
 * API v1 - Observations Endpoint
 *
 * Ingest observations (data points) for vehicles.
 * Observations are immutable events with full provenance.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface ObservationInput {
  vehicle_id?: string;
  vin?: string;
  source_id: string;
  kind: string;
  observed_at?: string;
  structured_data: Record<string, any>;
  confidence?: number;
  provenance?: {
    url?: string;
    document_id?: string;
    extracted_by?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: authError || "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // GET /api/v1/observations?vehicle_id=xxx - List observations
    if (req.method === "GET") {
      const vehicleId = url.searchParams.get("vehicle_id");
      const vin = url.searchParams.get("vin");
      const kind = url.searchParams.get("kind");
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = (page - 1) * limit;

      if (!vehicleId && !vin) {
        return new Response(
          JSON.stringify({ error: "vehicle_id or vin parameter required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let query = supabase
        .from("vehicle_observations")
        .select(`
          id, vehicle_id, source_id, kind,
          observed_at, structured_data, confidence,
          created_at
        `, { count: "exact" });

      if (vehicleId) {
        query = query.eq("vehicle_id", vehicleId);
      }
      if (vin) {
        query = query.eq("vin", vin);
      }
      if (kind) {
        query = query.eq("kind", kind);
      }

      const { data, error, count } = await query
        .order("observed_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        throw error;
      }

      return new Response(
        JSON.stringify({
          data,
          pagination: {
            page,
            limit,
            total: count,
            pages: Math.ceil((count || 0) / limit),
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /api/v1/observations - Create observation
    if (req.method === "POST") {
      const body: ObservationInput = await req.json();

      // Validate required fields
      if (!body.vehicle_id && !body.vin) {
        return new Response(
          JSON.stringify({ error: "vehicle_id or vin is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!body.source_id || !body.kind || !body.structured_data) {
        return new Response(
          JSON.stringify({ error: "source_id, kind, and structured_data are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If VIN provided but not vehicle_id, try to find or create vehicle
      let vehicleId = body.vehicle_id;
      if (!vehicleId && body.vin) {
        const { data: existingVehicle } = await supabase
          .from("vehicles")
          .select("id")
          .eq("vin", body.vin)
          .single();

        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        } else {
          // Create a placeholder vehicle
          const { data: newVehicle, error: createError } = await supabase
            .from("vehicles")
            .insert({
              vin: body.vin,
              owner_id: userId,
              is_public: false,
            })
            .select()
            .single();

          if (createError) {
            throw createError;
          }
          vehicleId = newVehicle.id;
        }
      }

      // Insert observation
      const { data, error } = await supabase
        .from("vehicle_observations")
        .insert({
          vehicle_id: vehicleId,
          source_id: body.source_id,
          observed_at: body.observed_at || new Date().toISOString(),
          kind: body.kind,
          structured_data: body.structured_data,
          confidence_score: body.confidence ?? 0.8,
          extraction_metadata: {
            ...body.provenance,
            ingested_by: userId,
            ingested_via: "api-v1",
          },
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Log API usage
      await logApiUsage(supabase, userId, "observations", "create", data.id);

      return new Response(
        JSON.stringify({ data, message: "Observation recorded successfully" }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
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
      .select("user_id, is_active")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (keyData && !error) {
      await supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
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
    await supabase
      .from("api_usage_logs")
      .insert({
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
