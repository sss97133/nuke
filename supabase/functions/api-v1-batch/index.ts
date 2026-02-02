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
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: authError || "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: BatchRequest = await req.json();

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
            .single();
          existingVehicle = data;
        } else if (matchBy === 'year_make_model' && vehicle.year && vehicle.make && vehicle.model) {
          const { data } = await supabase
            .from("vehicles")
            .select("id, owner_id")
            .eq("year", vehicle.year)
            .eq("make", vehicle.make)
            .eq("model", vehicle.model)
            .eq("owner_id", userId)
            .single();
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
          .single();

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
          error: error.message,
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
      JSON.stringify({ error: "Internal server error", details: error.message }),
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

  await supabase.from("vehicle_observations").insert(obsRecords);
}

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
