/**
 * API v1 - Batch Ingest Endpoint
 *
 * Bulk import vehicles and observations in a single request.
 * Useful for desktop app sync, spreadsheet imports, etc.
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
  exterior_color?: string;
  interior_color?: string;
  transmission?: string;
  engine?: string;
  drivetrain?: string;
  body_style?: string;
  sale_price?: number;
  description?: string;
  observations?: BatchObservation[];
}

interface BatchObservation {
  source_type: string;
  observation_kind: string;
  observed_at?: string;
  data: Record<string, any>;
  confidence?: number;
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

serve(async (req) => {
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
            if (vehicle.exterior_color) updateData.exterior_color = vehicle.exterior_color;
            if (vehicle.interior_color) updateData.interior_color = vehicle.interior_color;
            if (vehicle.transmission) updateData.transmission = vehicle.transmission;
            if (vehicle.engine) updateData.engine = vehicle.engine;
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
              await insertObservations(supabase, existingVehicle.id, vehicle.vin, vehicle.observations, userId);
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
            exterior_color: vehicle.exterior_color,
            interior_color: vehicle.interior_color,
            transmission: vehicle.transmission,
            engine: vehicle.engine,
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
          await insertObservations(supabase, newVehicle.id, vehicle.vin, vehicle.observations, userId);
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
  vin: string | undefined,
  observations: BatchObservation[],
  userId: string
) {
  const obsRecords = observations.map(obs => ({
    vehicle_id: vehicleId,
    vin,
    source_type: obs.source_type,
    observation_kind: obs.observation_kind,
    observed_at: obs.observed_at || new Date().toISOString(),
    data: obs.data,
    confidence: obs.confidence ?? 0.8,
    provenance: {
      ingested_by: userId,
      ingested_via: "api-v1-batch",
    },
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("vehicle_observations").insert(obsRecords);
  if (error) {
    console.error(`[batch] Failed to insert observations:`, error instanceof Error ? error.message : String(error));
  }
}

// authenticateRequest and logApiUsage imported from _shared/apiKeyAuth.ts
