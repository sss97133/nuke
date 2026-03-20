/**
 * API v1 - Batch Ingest Endpoint
 *
 * Bulk import vehicles and observations in a single request.
 * Useful for desktop app sync, spreadsheet imports, etc.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { authenticateRequest, logApiUsage } from "../_shared/apiKeyAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface BatchVehicle {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  color?: string;
  interior_color?: string;
  transmission?: string;
  engine_type?: string;
  drivetrain?: string;
  body_style?: string;
  sale_price?: number;
  description?: string;
  observations?: BatchObservation[];
}

interface BatchObservation {
  source_id: string;
  kind: string;
  observed_at?: string;
  structured_data: Record<string, any>;
  confidence_score?: number;
}

interface BatchRequest {
  vehicles: BatchVehicle[];
  options?: {
    skip_duplicates?: boolean;
    match_by?: 'vin' | 'year_make_model' | 'none';
    update_existing?: boolean;
  };
}

interface BatchResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  vehicles: Array<{
    index: number;
    id?: string;
    status: 'created' | 'updated' | 'skipped' | 'failed';
    error?: string;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const auth = await authenticateRequest(req, supabase, { endpoint: 'batch' });
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error || "Authentication required" }),
        { status: auth.status || 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = auth.userId;

    // Detect agent staging: agent identity + stage_write scope = must go through staging
    const agentId = auth.agentId;
    const isStageOnly = agentId ? auth.scopes?.includes('stage_write') : false;

    let body: BatchRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.vehicles || !Array.isArray(body.vehicles)) {
      return new Response(
        JSON.stringify({ error: "vehicles array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Limit batch size
    if (body.vehicles.length > 1000) {
      return new Response(
        JSON.stringify({ error: "Maximum batch size is 1000 vehicles" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Tier 1 agent batch cap: 10 vehicles
    if (isStageOnly && body.vehicles.length > 10) {
      return new Response(
        JSON.stringify({ error: "Tier 1 agents are limited to 10 vehicles per batch. Submit more observations to earn Tier 2." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap observations per vehicle and total to prevent abuse
    let totalObs = 0;
    for (const v of body.vehicles) {
      if (v.observations && v.observations.length > 50) {
        v.observations = v.observations.slice(0, 50);
      }
      totalObs += v.observations?.length || 0;
    }
    if (totalObs > 5000) {
      return new Response(
        JSON.stringify({ error: "Maximum 5000 total observations per batch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const options = body.options || {};
    const matchBy = options.match_by || 'vin';
    const skipDuplicates = options.skip_duplicates ?? true;
    const updateExisting = options.update_existing ?? false;

    const result: BatchResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      vehicles: [],
    };

    // Process vehicles
    for (let i = 0; i < body.vehicles.length; i++) {
      const vehicle = body.vehicles[i];

      try {
        // Check for existing vehicle
        let existingVehicle = null;
        if (matchBy === 'vin' && vehicle.vin) {
          const { data } = await supabase
            .from("vehicles")
            .select("id, owner_id")
            .eq("vin", vehicle.vin)
            .maybeSingle();
          existingVehicle = data;
        } else if (matchBy === 'year_make_model' && vehicle.year && vehicle.make && vehicle.model) {
          const { data } = await supabase
            .from("vehicles")
            .select("id, owner_id")
            .eq("year", vehicle.year)
            .eq("make", vehicle.make)
            .eq("model", vehicle.model)
            .eq("owner_id", userId)
            .maybeSingle();
          existingVehicle = data;
        }

        if (existingVehicle) {
          if (skipDuplicates && !updateExisting) {
            result.skipped++;
            result.vehicles.push({ index: i, id: existingVehicle.id, status: 'skipped' });
            continue;
          }

          if (updateExisting && existingVehicle.owner_id === userId) {
            // Update existing vehicle
            const updateData: any = {};
            if (vehicle.year) updateData.year = vehicle.year;
            if (vehicle.make) updateData.make = vehicle.make;
            if (vehicle.model) updateData.model = vehicle.model;
            if (vehicle.mileage) updateData.mileage = vehicle.mileage;
            if (vehicle.color) updateData.color = vehicle.color;
            if (vehicle.interior_color) updateData.interior_color = vehicle.interior_color;
            if (vehicle.transmission) updateData.transmission = vehicle.transmission;
            if (vehicle.engine_type) updateData.engine_type = vehicle.engine_type;
            if (vehicle.drivetrain) updateData.drivetrain = vehicle.drivetrain;
            if (vehicle.body_style) updateData.body_style = vehicle.body_style;
            if (vehicle.sale_price) updateData.sale_price = vehicle.sale_price;
            if (vehicle.description) updateData.description = vehicle.description;

            await supabase
              .from("vehicles")
              .update(updateData)
              .eq("id", existingVehicle.id);

            // Process observations for existing vehicle
            if (vehicle.observations?.length) {
              if (isStageOnly && agentId) {
                await insertStagedObservations(supabase, existingVehicle.id, vehicle, vehicle.observations, agentId);
              } else {
                await insertObservations(supabase, existingVehicle.id, vehicle.vin, vehicle.observations, userId, agentId);
              }
            }

            result.updated++;
            result.vehicles.push({ index: i, id: existingVehicle.id, status: 'updated' });
            continue;
          }
        }

        // Create new vehicle
        const { data: newVehicle, error: createError } = await supabase
          .from("vehicles")
          .insert({
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            vin: vehicle.vin,
            mileage: vehicle.mileage,
            color: vehicle.color,
            interior_color: vehicle.interior_color,
            transmission: vehicle.transmission,
            engine_type: vehicle.engine_type,
            drivetrain: vehicle.drivetrain,
            body_style: vehicle.body_style,
            sale_price: vehicle.sale_price,
            description: vehicle.description,
            owner_id: userId,
            is_public: false,
          })
          .select()
          .maybeSingle();

        if (createError) {
          throw createError;
        }

        // Process observations for new vehicle
        if (vehicle.observations?.length) {
          if (isStageOnly && agentId) {
            await insertStagedObservations(supabase, newVehicle.id, vehicle, vehicle.observations, agentId);
          } else {
            await insertObservations(supabase, newVehicle.id, vehicle.vin, vehicle.observations, userId, agentId);
          }
        }

        result.created++;
        result.vehicles.push({ index: i, id: newVehicle.id, status: 'created' });

      } catch (error: any) {
        result.failed++;
        result.vehicles.push({
          index: i,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Log batch operation
    await logApiUsage(supabase, userId, "batch", "ingest", `${result.created}/${result.vehicles.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        result,
        summary: `Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}, Failed: ${result.failed}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Batch API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function insertObservations(
  supabase: any,
  vehicleId: string,
  _vin: string | undefined,
  observations: BatchObservation[],
  userId: string,
  agentId?: string | null
) {
  const obsRecords = observations.map(obs => ({
    vehicle_id: vehicleId,
    source_id: obs.source_id,
    kind: obs.kind,
    observed_at: obs.observed_at || new Date().toISOString(),
    structured_data: obs.structured_data,
    confidence_score: obs.confidence_score ?? 0.8,
    extraction_metadata: {
      ingested_by: userId,
      ingested_via: "api-v1-batch",
    },
  }));

  const { error } = await supabase.from("vehicle_observations").insert(obsRecords);
  if (error) {
    console.error(`[batch] Failed to insert observations:`, error instanceof Error ? error.message : String(error));
  }

  // Record agent metrics for Tier 2+ agents
  if (agentId) {
    for (const obs of observations) {
      await supabase.rpc('record_agent_submission', {
        p_agent_id: agentId,
        p_outcome: 'accepted',
        p_kind: obs.kind,
      });
    }
  }
}

async function insertStagedObservations(
  supabase: any,
  vehicleId: string,
  vehicle: BatchVehicle,
  observations: BatchObservation[],
  agentId: string
) {
  const stagingRecords = observations.map(obs => {
    const hashInput = JSON.stringify(obs.structured_data) + (obs.kind || '');
    return {
      vehicle_id: vehicleId,
      vehicle_hints: vehicle.vin ? { vin: vehicle.vin, year: vehicle.year, make: vehicle.make, model: vehicle.model } : { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      source_id: obs.source_id,
      kind: obs.kind,
      observed_at: obs.observed_at || new Date().toISOString(),
      structured_data: obs.structured_data,
      confidence_score: obs.confidence_score ?? 0.8,
      extraction_metadata: {
        ingested_by: agentId,
        ingested_via: "api-v1-batch",
      },
      agent_id: agentId,
    };
  });

  const { error } = await supabase.from("agent_submissions_staging").insert(stagingRecords);
  if (error) {
    console.error(`[batch] Failed to insert staged observations:`, error instanceof Error ? error.message : String(error));
  }

  // Record each submission
  for (const obs of observations) {
    await supabase.rpc('record_agent_submission', {
      p_agent_id: agentId,
      p_outcome: 'pending',
      p_kind: obs.kind,
    });
  }
}

// authenticateRequest and logApiUsage imported from _shared/apiKeyAuth.ts
