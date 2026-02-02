/**
 * API v1 - Vehicles Endpoint
 *
 * RESTful vehicle management API for external integrations.
 * Supports: GET (list/show), POST (create), PATCH (update)
 *
 * Authentication: Bearer token (Supabase JWT) or API key
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

interface VehicleInput {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  color?: string;
  interior_color?: string;
  transmission?: string;
  engine?: string;
  drivetrain?: string;
  body_style?: string;
  purchase_price?: number;
  description?: string;
  is_public?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate user (JWT or API key)
    const { userId, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: authError || "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const vehicleId = pathParts[pathParts.length - 1];
    const isSpecificVehicle = vehicleId && vehicleId !== 'api-v1-vehicles';

    // GET /api/v1/vehicles - List vehicles
    // GET /api/v1/vehicles/:id - Get single vehicle
    if (req.method === "GET") {
      if (isSpecificVehicle) {
        // Get single vehicle
        const { data, error } = await supabase
          .from("vehicles")
          .select(`
            id, year, make, model, vin, mileage,
            color, interior_color, transmission, engine, drivetrain, body_style,
            purchase_price, description, is_public, created_at, updated_at,
            owner_id
          `)
          .eq("id", vehicleId)
          .single();

        if (error || !data) {
          return new Response(
            JSON.stringify({ error: "Vehicle not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check access (owner or public)
        if (data.owner_id !== userId && !data.is_public) {
          return new Response(
            JSON.stringify({ error: "Access denied" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ data }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // List vehicles
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
        const offset = (page - 1) * limit;
        const mine = url.searchParams.get("mine") === "true";

        let query = supabase
          .from("vehicles")
          .select(`
            id, year, make, model, vin, mileage,
            color, transmission, body_style,
            purchase_price, is_public, created_at, owner_id
          `, { count: "exact" });

        if (mine) {
          query = query.eq("owner_id", userId);
        } else {
          query = query.or(`owner_id.eq.${userId},is_public.eq.true`);
        }

        const { data, error, count } = await query
          .order("created_at", { ascending: false })
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
    }

    // POST /api/v1/vehicles - Create vehicle
    if (req.method === "POST") {
      const body: VehicleInput = await req.json();

      // Validate required fields
      if (!body.year && !body.make && !body.model && !body.vin) {
        return new Response(
          JSON.stringify({ error: "At least one of year, make, model, or vin is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase
        .from("vehicles")
        .insert({
          year: body.year,
          make: body.make,
          model: body.model,
          vin: body.vin,
          mileage: body.mileage,
          color: body.color,
          interior_color: body.interior_color,
          transmission: body.transmission,
          engine: body.engine,
          drivetrain: body.drivetrain,
          body_style: body.body_style,
          purchase_price: body.purchase_price,
          description: body.description,
          is_public: body.is_public ?? false,
          owner_id: userId,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Log API usage
      await logApiUsage(supabase, userId, "vehicles", "create", data.id);

      return new Response(
        JSON.stringify({ data, message: "Vehicle created successfully" }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PATCH /api/v1/vehicles/:id - Update vehicle
    if (req.method === "PATCH" && isSpecificVehicle) {
      const body: VehicleInput = await req.json();

      // Check ownership
      const { data: existing } = await supabase
        .from("vehicles")
        .select("owner_id")
        .eq("id", vehicleId)
        .single();

      if (!existing || existing.owner_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Vehicle not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const updateData: any = {};
      if (body.year !== undefined) updateData.year = body.year;
      if (body.make !== undefined) updateData.make = body.make;
      if (body.model !== undefined) updateData.model = body.model;
      if (body.vin !== undefined) updateData.vin = body.vin;
      if (body.mileage !== undefined) updateData.mileage = body.mileage;
      if (body.color !== undefined) updateData.color = body.color;
      if (body.interior_color !== undefined) updateData.interior_color = body.interior_color;
      if (body.transmission !== undefined) updateData.transmission = body.transmission;
      if (body.engine !== undefined) updateData.engine = body.engine;
      if (body.drivetrain !== undefined) updateData.drivetrain = body.drivetrain;
      if (body.body_style !== undefined) updateData.body_style = body.body_style;
      if (body.purchase_price !== undefined) updateData.purchase_price = body.purchase_price;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.is_public !== undefined) updateData.is_public = body.is_public;

      const { data, error } = await supabase
        .from("vehicles")
        .update(updateData)
        .eq("id", vehicleId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      await logApiUsage(supabase, userId, "vehicles", "update", vehicleId);

      return new Response(
        JSON.stringify({ data, message: "Vehicle updated successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE /api/v1/vehicles/:id - Delete (archive) vehicle
    if (req.method === "DELETE" && isSpecificVehicle) {
      // Check ownership
      const { data: existing } = await supabase
        .from("vehicles")
        .select("owner_id")
        .eq("id", vehicleId)
        .single();

      if (!existing || existing.owner_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Vehicle not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Soft delete by marking as archived
      const { error } = await supabase
        .from("vehicles")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", vehicleId);

      if (error) {
        throw error;
      }

      await logApiUsage(supabase, userId, "vehicles", "delete", vehicleId);

      return new Response(
        JSON.stringify({ message: "Vehicle archived successfully" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

/**
 * Authenticate request via JWT or API key
 */
async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  // Try JWT first
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      return { userId: user.id };
    }
  }

  // Try API key
  if (apiKey) {
    // Strip prefix if present
    const rawKey = apiKey.startsWith('nk_live_') ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);

    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, rate_limit_remaining")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .single();

    if (keyData && !error) {
      // Check rate limit
      if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
        return { userId: null, error: "Rate limit exceeded" };
      }

      // Decrement rate limit
      await supabase
        .from("api_keys")
        .update({
          rate_limit_remaining: keyData.rate_limit_remaining ? keyData.rate_limit_remaining - 1 : null,
          last_used_at: new Date().toISOString(),
        })
        .eq("key_hash", keyHash);

      return { userId: keyData.user_id };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

/**
 * Hash API key using SHA-256
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return 'sha256_' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Log API usage for analytics
 */
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
