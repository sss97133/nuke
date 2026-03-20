/**
 * API v1 - Observations Endpoint
 *
 * Ingest observations (data points) for vehicles.
 * Observations are immutable events with full provenance.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

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

Deno.serve(async (req) => {
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

    // Detect agent staging: any agent with stage_write scope goes through staging.
    // This is identity-based (agentId present) + scope-based (stage_write), so even if
    // an agent somehow gets write scope added, they still stage if stage_write is present.
    const agentId = auth.agentId;
    const isStageOnly = agentId ? auth.scopes?.includes('stage_write') : false;

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

      // Resolve VIN to vehicle_id (vin column doesn't exist on vehicle_observations)
      let resolvedVehicleId = vehicleId;
      if (!resolvedVehicleId && vin) {
        const { data: vehicle } = await supabase
          .from("vehicles")
          .select("id")
          .eq("vin", vin.trim().toUpperCase())
          .maybeSingle();

        if (!vehicle) {
          return new Response(
            JSON.stringify({ error: "No vehicle found for VIN", vin }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        resolvedVehicleId = vehicle.id;
      }

      let query = supabase
        .from("vehicle_observations")
        .select(`
          id, vehicle_id, source_id, kind,
          observed_at, structured_data, confidence_score,
          created_at
        `, { count: "estimated" });

      if (resolvedVehicleId) {
        query = query.eq("vehicle_id", resolvedVehicleId);
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

      // Validate source_id exists in observation_sources
      const { data: sourceRow } = await supabase
        .from("observation_sources")
        .select("id")
        .eq("id", body.source_id)
        .maybeSingle();

      if (!sourceRow) {
        return new Response(
          JSON.stringify({ error: "Invalid source_id: not found in observation_sources", field: "source_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate kind is a valid observation type
      const validKinds = [
        'listing', 'sale_result', 'comment', 'bid', 'sighting', 'work_record',
        'ownership', 'specification', 'provenance', 'valuation', 'condition',
        'media', 'social_mention', 'expert_opinion',
      ];
      if (!validKinds.includes(body.kind)) {
        return new Response(
          JSON.stringify({ error: `Invalid kind: '${body.kind}'. Must be one of: ${validKinds.join(', ')}`, field: "kind" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate structured_data is non-empty
      if (typeof body.structured_data !== 'object' || Object.keys(body.structured_data).length === 0) {
        return new Response(
          JSON.stringify({ error: "structured_data must be a non-empty object", field: "structured_data" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate confidence if provided (0-1 numeric)
      if (body.confidence !== undefined) {
        const c = Number(body.confidence);
        if (isNaN(c) || c < 0 || c > 1) {
          return new Response(
            JSON.stringify({ error: "confidence must be a number between 0 and 1", field: "confidence" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // --- Agent staging path: write to staging table instead ---
      if (isStageOnly && agentId) {
        // Compute content hash for dedup
        const hashInput = JSON.stringify(body.structured_data) + (body.kind || '');
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput));
        const contentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        const { data: staged, error: stageError } = await supabase
          .from("agent_submissions_staging")
          .insert({
            vehicle_id: body.vehicle_id || null,
            vehicle_hints: body.vin ? { vin: body.vin } : (body as any).vehicle_hints || {},
            source_id: body.source_id,
            kind: body.kind,
            observed_at: body.observed_at || new Date().toISOString(),
            content_text: (body as any).content_text || null,
            content_hash: contentHash,
            structured_data: body.structured_data,
            confidence_score: body.confidence ?? 0.8,
            extraction_metadata: {
              ...body.provenance,
              ingested_by: agentId,
              ingested_via: "api-v1",
            },
            source_url: body.provenance?.url || null,
            agent_id: agentId,
          })
          .select("id")
          .single();

        if (stageError) throw stageError;

        // Record submission metric
        await supabase.rpc('record_agent_submission', {
          p_agent_id: agentId,
          p_outcome: 'pending',
          p_kind: body.kind,
        });

        await logApiUsage(supabase, userId, "observations", "stage", staged?.id);

        return new Response(
          JSON.stringify({
            staged: true,
            staging_id: staged?.id,
            message: "Observation staged for review. Tier 1 agents have submissions reviewed before promotion to production.",
          }),
          { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json", ...auth.headers } }
        );
      }

      // --- Direct write path (Tier 2+ or non-agent) ---

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

      // Record agent metric if this is a Tier 2+ agent
      if (agentId) {
        await supabase.rpc('record_agent_submission', {
          p_agent_id: agentId,
          p_outcome: 'accepted',
          p_kind: body.kind,
        });
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
