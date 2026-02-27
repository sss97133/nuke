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
  trim?: string;
  series?: string;
  vin?: string;
  mileage?: number;
  color?: string;
  interior_color?: string;
  transmission?: string;
  engine_type?: string;
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
    const { userId, isServiceRole, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: authError || "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1];
    const secondToLast = pathParts[pathParts.length - 2];

    // Detect /by-vin/:vin route
    const isByVinRoute = secondToLast === 'by-vin' || lastPart === 'by-vin';
    const vinParam = secondToLast === 'by-vin' ? lastPart : null;

    const vehicleId = lastPart && lastPart !== 'api-v1-vehicles' && lastPart !== 'by-vin' ? lastPart : null;
    const isSpecificVehicle = !!vehicleId && !isByVinRoute;

    // GET /api/v1/vehicles/by-vin/:vin - Look up vehicle(s) by VIN
    if (req.method === "GET" && isByVinRoute) {
      if (!vinParam) {
        return new Response(
          JSON.stringify({ error: "VIN is required. Use GET /api-v1-vehicles/by-vin/{vin}" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const vinClean = vinParam.trim().toUpperCase();

      // Support both exact 17-char VINs and partial VINs (at least 5 chars)
      if (vinClean.length < 5) {
        return new Response(
          JSON.stringify({ error: "VIN must be at least 5 characters" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const isExactVin = vinClean.length === 17;

      let data: any[] | null;
      let error: any;

      if (isExactVin) {
        // Exact 17-char VIN: btree index handles this fine
        const result = await supabase
          .from("vehicles")
          .select(`
            id, year, make, model, trim, series, vin, mileage,
            color, interior_color, transmission, engine_type,
            drivetrain, body_style, sale_price, is_public,
            created_at, updated_at, primary_image_url, discovery_url
          `)
          .eq("is_public", true)
          .ilike("vin", vinClean)
          .limit(10);
        data = result.data;
        error = result.error;
      } else {
        // Partial VIN: use RPC which writes lower(vin) LIKE lower('%...%')
        // This correctly uses the vehicles_vin_trgm_idx trigram index
        // (plain ILIKE causes the planner to pick btree → seq scan timeout)
        const result = await supabase.rpc("search_vehicles_by_partial_vin", {
          partial_vin: vinClean,
          row_limit: 10,
        });
        data = result.data;
        error = result.error;
      }

      if (error) throw error;

      if (!data || data.length === 0) {
        return new Response(
          JSON.stringify({ error: "No vehicles found for VIN", vin: vinClean, data: [] }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // For exact VIN hit, return enriched single result
      const single = isExactVin && data.length === 1;
      const response = single
        ? { data: data[0], vin: vinClean }
        : { data, vin: vinClean, count: data.length };

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET /api/v1/vehicles - List vehicles
    // GET /api/v1/vehicles/:id - Get single vehicle
    if (req.method === "GET") {
      if (isSpecificVehicle) {
        // Get single vehicle
        const { data, error } = await supabase
          .from("vehicles")
          .select(`
            id, year, make, model, trim, series, vin, mileage,
            color, interior_color, transmission, engine_type, engine_displacement,
            drivetrain, body_style, sale_price, purchase_price, description,
            is_public, created_at, updated_at, owner_id, primary_image_url
          `)
          .eq("id", vehicleId)
          .maybeSingle();

        if (error || !data) {
          return new Response(
            JSON.stringify({ error: "Vehicle not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check access (owner, public, or service role)
        if (!isServiceRole && data.owner_id !== userId && !data.is_public) {
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
        const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
        const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
        const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
        const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 20 : rawLimit, 100));
        const offset = (page - 1) * limit;
        const mine = url.searchParams.get("mine") === "true";

        // Filter parameters
        const makeFilter = url.searchParams.get("make");
        const modelFilter = url.searchParams.get("model");
        const yearFilter = url.searchParams.get("year");
        const yearMinFilter = url.searchParams.get("year_min");
        const yearMaxFilter = url.searchParams.get("year_max");
        const vinFilter = url.searchParams.get("vin");
        const priceMinFilter = url.searchParams.get("price_min");
        const priceMaxFilter = url.searchParams.get("price_max");
        const transmissionFilter = url.searchParams.get("transmission");
        const mileageMaxFilter = url.searchParams.get("mileage_max");
        const sortBy = url.searchParams.get("sort") || "created_at";
        const sortDir = url.searchParams.get("sort_dir") === "asc";
        const allowedSortFields = ["created_at", "year", "sale_price", "mileage", "updated_at"];
        const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : "created_at";

        let query = supabase
          .from("vehicles")
          .select(`
            id, year, make, model, trim, series, vin, mileage,
            color, transmission, body_style, sale_price,
            purchase_price, is_public, created_at, owner_id, primary_image_url
          `, { count: "estimated" })
          // Filter stub vehicles (no year/make/model) from inventory listings
          .not("year", "is", null)
          .not("make", "is", null)
          .not("model", "is", null);

        if (mine && !isServiceRole) {
          query = query.eq("owner_id", userId);
        } else if (isServiceRole) {
          // Service role: show all public vehicles (no owner filter)
          query = query.eq("is_public", true);
        } else {
          const safeUserId = String(userId || '').replace(/[",().\\]/g, '');
          query = query.or(`owner_id.eq."${safeUserId}",is_public.eq.true`);
        }

        // Apply filters — these were entirely missing (P0 bug: ?make=Porsche was ignored)
        if (makeFilter) query = query.ilike("make", `%${makeFilter}%`);
        if (modelFilter) query = query.ilike("model", `%${modelFilter}%`);
        if (yearFilter) {
          const year = parseInt(yearFilter, 10);
          if (!isNaN(year)) query = query.eq("year", year);
        }
        if (yearMinFilter) {
          const yearMin = parseInt(yearMinFilter, 10);
          if (!isNaN(yearMin)) query = query.gte("year", yearMin);
        }
        if (yearMaxFilter) {
          const yearMax = parseInt(yearMaxFilter, 10);
          if (!isNaN(yearMax)) query = query.lte("year", yearMax);
        }
        if (vinFilter) {
          const cleanVin = vinFilter.trim().toUpperCase();
          if (cleanVin.length === 17) {
            query = query.eq("vin", cleanVin);
          } else {
            query = query.ilike("vin", `%${cleanVin}%`);
          }
        }
        if (priceMinFilter) {
          const priceMin = parseFloat(priceMinFilter);
          if (!isNaN(priceMin)) query = query.gte("sale_price", priceMin);
        }
        if (priceMaxFilter) {
          const priceMax = parseFloat(priceMaxFilter);
          if (!isNaN(priceMax)) query = query.lte("sale_price", priceMax);
        }
        if (transmissionFilter) query = query.ilike("transmission", `%${transmissionFilter}%`);
        if (mileageMaxFilter) {
          const mileageMax = parseInt(mileageMaxFilter, 10);
          if (!isNaN(mileageMax)) query = query.lte("mileage", mileageMax);
        }

        const { data, error, count } = await query
          .order(safeSortBy, { ascending: sortDir })
          .range(offset, offset + limit - 1);

        if (error) {
          throw error;
        }

        return new Response(
          JSON.stringify({
            vehicles: data,
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
      if (isServiceRole) {
        return new Response(
          JSON.stringify({ error: "Service role keys are read-only. Use a user API key for write operations." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      let body: VehicleInput;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON in request body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
          engine_type: body.engine_type,
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
      let body: VehicleInput;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON in request body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check ownership
      const { data: existing } = await supabase
        .from("vehicles")
        .select("owner_id")
        .eq("id", vehicleId)
        .maybeSingle();

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
      if (body.engine_type !== undefined) updateData.engine_type = body.engine_type;
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
        .maybeSingle();

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
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Authenticate request via JWT or API key
 */
async function authenticateRequest(req: Request, supabase: any): Promise<{ userId: string | null; isServiceRole?: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  // Check for service role key or user JWT
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    // Check if token is the actual service role key (used by MCP servers and internal tools)
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if ((serviceRoleKey && token === serviceRoleKey) || (altServiceRoleKey && token === altServiceRoleKey)) {
      return { userId: "service-role", isServiceRole: true };
    }

    // Try user JWT (verified by Supabase auth)
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
      .select("user_id, scopes, is_active, rate_limit_remaining, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyData && !error) {
      // Check expiry
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        return { userId: null, error: "API key has expired" };
      }

      // Check rate limit
      if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
        return { userId: null, error: "Rate limit exceeded" };
      }

      // Decrement rate limit (fix: use !== null check instead of falsy check)
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
