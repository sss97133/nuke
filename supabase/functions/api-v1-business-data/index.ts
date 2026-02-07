/**
 * Business Data API - For restoration companies to pull their data
 *
 * Endpoints:
 * GET /submissions - List photo submissions for the business
 * GET /vehicles - List vehicles in service
 * GET /technicians - List technicians connected to the business
 * GET /summary - Dashboard summary stats
 *
 * Authentication: API Key in header (X-API-Key: nk_live_xxx)
 * Or Bearer token (Authorization: Bearer xxx)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Authenticate via API key or Bearer token
async function authenticateRequest(req: Request): Promise<{
  userId: string | null;
  businessId: string | null;
  error: string | null;
}> {
  // Try API key first
  const apiKey = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
  if (apiKey) {
    // Remove prefix if present
    const rawKey = apiKey.replace(/^nk_live_/, "");

    // Hash and lookup
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = "sha256_" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: keyData } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, expires_at")
      .eq("key_hash", keyHash)
      .single();

    if (!keyData) {
      return { userId: null, businessId: null, error: "Invalid API key" };
    }

    if (!keyData.is_active) {
      return { userId: null, businessId: null, error: "API key is revoked" };
    }

    if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
      return { userId: null, businessId: null, error: "API key has expired" };
    }

    // Get user's business
    const { data: businessRole } = await supabase
      .from("organization_contributors")
      .select("organization_id")
      .eq("user_id", keyData.user_id)
      .eq("status", "active")
      .in("role", ["owner", "manager"])
      .single();

    // Update last used
    await supabase
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("key_hash", keyHash);

    return {
      userId: keyData.user_id,
      businessId: businessRole?.organization_id || null,
      error: null,
    };
  }

  // Try Bearer token
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return { userId: null, businessId: null, error: "Invalid authentication" };
    }

    // Get user's business
    const { data: businessRole } = await supabase
      .from("organization_contributors")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "manager"])
      .single();

    return {
      userId: user.id,
      businessId: businessRole?.organization_id || null,
      error: null,
    };
  }

  return { userId: null, businessId: null, error: "Authentication required" };
}

// GET /submissions - List photo submissions
async function getSubmissions(
  businessId: string,
  params: URLSearchParams
): Promise<{ data: any[]; total: number; pagination: any }> {
  const limit = Math.min(parseInt(params.get("limit") || "50"), 100);
  const offset = parseInt(params.get("offset") || "0");
  const since = params.get("since"); // ISO date
  const until = params.get("until"); // ISO date
  const vehicleId = params.get("vehicle_id");
  const technicianId = params.get("technician_id");
  const status = params.get("status");

  let query = supabase
    .from("telegram_work_submissions")
    .select(
      `
      id,
      message_text,
      photo_urls,
      storage_paths,
      received_at,
      processing_status,
      detected_work_type,
      detected_description,
      confidence_score,
      detected_vehicle_id,
      telegram_technician_id,
      vehicles:detected_vehicle_id (
        id, year, make, model, vin
      ),
      telegram_technicians:telegram_technician_id (
        id, display_name, telegram_username
      )
    `,
      { count: "exact" }
    )
    .eq("business_id", businessId)
    .order("received_at", { ascending: false });

  if (since) {
    query = query.gte("received_at", since);
  }
  if (until) {
    query = query.lte("received_at", until);
  }
  if (vehicleId) {
    query = query.eq("detected_vehicle_id", vehicleId);
  }
  if (technicianId) {
    query = query.eq("telegram_technician_id", technicianId);
  }
  if (status) {
    query = query.eq("processing_status", status);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error("getSubmissions error:", error);
    throw error;
  }

  return {
    data: data || [],
    total: count || 0,
    pagination: {
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    },
  };
}

// GET /vehicles - List vehicles in service
async function getVehicles(
  businessId: string,
  params: URLSearchParams
): Promise<{ data: any[]; total: number }> {
  const status = params.get("status") || "active";
  const serviceStatus = params.get("service_status");

  let query = supabase
    .from("organization_vehicles")
    .select(
      `
      id,
      relationship_type,
      status,
      service_status,
      start_date,
      notes,
      created_at,
      vehicles:vehicle_id (
        id, year, make, model, vin, color
      )
    `,
      { count: "exact" }
    )
    .eq("organization_id", businessId);

  if (status !== "all") {
    query = query.eq("status", status);
  }
  if (serviceStatus) {
    query = query.eq("service_status", serviceStatus);
  }

  const { data, count, error } = await query;

  if (error) {
    console.error("getVehicles error:", error);
    throw error;
  }

  return {
    data: data || [],
    total: count || 0,
  };
}

// GET /technicians - List connected technicians
async function getTechnicians(
  businessId: string
): Promise<{ data: any[]; total: number }> {
  const { data, count, error } = await supabase
    .from("telegram_technicians")
    .select(
      `
      id,
      telegram_username,
      display_name,
      status,
      active_vehicle_id,
      onboarded_at,
      last_active_at,
      vehicles:active_vehicle_id (
        id, year, make, model
      )
    `,
      { count: "exact" }
    )
    .eq("business_id", businessId)
    .order("last_active_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("getTechnicians error:", error);
    throw error;
  }

  return {
    data: data || [],
    total: count || 0,
  };
}

// GET /summary - Dashboard stats
async function getSummary(businessId: string): Promise<any> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get counts in parallel
  const [
    submissionsToday,
    submissionsWeek,
    submissionsMonth,
    techniciansActive,
    vehiclesInService,
  ] = await Promise.all([
    supabase
      .from("telegram_work_submissions")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("received_at", today.toISOString()),

    supabase
      .from("telegram_work_submissions")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("received_at", thisWeek.toISOString()),

    supabase
      .from("telegram_work_submissions")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("received_at", thisMonth.toISOString()),

    supabase
      .from("telegram_technicians")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "active"),

    supabase
      .from("organization_vehicles")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", businessId)
      .eq("service_status", "currently_in_service"),
  ]);

  // Get recent activity
  const { data: recentSubmissions } = await supabase
    .from("telegram_work_submissions")
    .select(
      `
      id,
      received_at,
      detected_work_type,
      detected_description,
      telegram_technicians:telegram_technician_id (display_name),
      vehicles:detected_vehicle_id (year, make, model)
    `
    )
    .eq("business_id", businessId)
    .order("received_at", { ascending: false })
    .limit(5);

  // Get work type breakdown for the month
  const { data: workBreakdown } = await supabase
    .from("telegram_work_submissions")
    .select("detected_work_type")
    .eq("business_id", businessId)
    .gte("received_at", thisMonth.toISOString());

  const workTypeCounts: Record<string, number> = {};
  for (const sub of workBreakdown || []) {
    const type = sub.detected_work_type || "other";
    workTypeCounts[type] = (workTypeCounts[type] || 0) + 1;
  }

  return {
    submissions: {
      today: submissionsToday.count || 0,
      this_week: submissionsWeek.count || 0,
      this_month: submissionsMonth.count || 0,
    },
    technicians_active: techniciansActive.count || 0,
    vehicles_in_service: vehiclesInService.count || 0,
    work_type_breakdown: workTypeCounts,
    recent_activity: (recentSubmissions || []).map((s: any) => ({
      id: s.id,
      timestamp: s.received_at,
      work_type: s.detected_work_type,
      description: s.detected_description,
      technician: s.telegram_technicians?.display_name,
      vehicle: s.vehicles
        ? `${s.vehicles.year} ${s.vehicles.make} ${s.vehicles.model}`
        : null,
    })),
  };
}

// Main handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Authenticate
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!auth.businessId) {
      return new Response(
        JSON.stringify({
          error: "No business found for this user",
          hint: "Make sure you have an owner or manager role for a business",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const params = url.searchParams;

    // Parse endpoint from path
    const pathParts = url.pathname.split("/").filter(Boolean);
    // Expected: /functions/v1/api-v1-business-data/submissions
    const endpoint = pathParts[pathParts.length - 1];

    let result: any;

    switch (endpoint) {
      case "submissions":
        result = await getSubmissions(auth.businessId, params);
        break;

      case "vehicles":
        result = await getVehicles(auth.businessId, params);
        break;

      case "technicians":
        result = await getTechnicians(auth.businessId);
        break;

      case "summary":
        result = await getSummary(auth.businessId);
        break;

      case "api-v1-business-data":
        // Root endpoint - return API info
        result = {
          api_version: "1.0",
          endpoints: {
            submissions: "GET /submissions - List photo submissions",
            vehicles: "GET /vehicles - List vehicles in service",
            technicians: "GET /technicians - List connected technicians",
            summary: "GET /summary - Dashboard summary stats",
          },
          authentication: "X-API-Key header or Bearer token",
          business_id: auth.businessId,
        };
        break;

      default:
        return new Response(
          JSON.stringify({
            error: "Unknown endpoint",
            available: ["submissions", "vehicles", "technicians", "summary"],
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Business API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
