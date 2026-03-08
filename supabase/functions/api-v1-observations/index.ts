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
import { authenticateRequest, logApiUsage } from "../_shared/apiKeyAuth.ts";

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
    const auth = await authenticateRequest(req, supabase, { endpoint: 'observations' });
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error || "Authentication required" }),
        { status: auth.status || 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = auth.userId;

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // GET /api/v1/observations?vehicle_id=xxx - List observations
    if (req.method === "GET") {
      const vehicleId = url.searchParams.get("vehicle_id");
      const vin = url.searchParams.get("vin");
      const kind = url.searchParams.get("kind");
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
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
        `, { count: "estimated" });

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
      let body: ObservationInput;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
          .maybeSingle();

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
            .maybeSingle();

          if (createError) {
            throw createError;
          }
          vehicleId = newVehicle?.id;
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
        .maybeSingle();

      if (error) {
        throw error;
      }

      // Log API usage
      await logApiUsage(supabase, userId, "observations", "create", data?.id);

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
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// authenticateRequest and logApiUsage imported from _shared/apiKeyAuth.ts
