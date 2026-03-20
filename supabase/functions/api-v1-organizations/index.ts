/**
 * API v1 - Organizations Endpoint
 *
 * Search and submit organizations (shops, dealers, builders, etc.)
 * for external agent integrations.
 *
 * GET  - Search/list organizations
 * POST - Submit a discovered organization
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

interface OrgInput {
  business_name: string;
  business_type?: string;
  entity_type?: string;
  city?: string;
  state?: string;
  address?: string;
  zip_code?: string;
  country?: string;
  website?: string;
  phone?: string;
  email?: string;
  specializations?: string[];
  services_offered?: string[];
  specialty_makes?: string[];
  specialty_eras?: string[];
  description?: string;
  source_url?: string;
  discovered_via?: string;
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
    const auth = await authenticateRequest(req, supabase, { endpoint: 'organizations' });
    if (auth.error || !auth.userId) {
      return new Response(
        JSON.stringify({ error: auth.error || "Authentication required" }),
        { status: auth.status || 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = auth.userId;

    const url = new URL(req.url);

    // GET /api-v1-organizations — Search/list organizations
    if (req.method === "GET") {
      const nameFilter = url.searchParams.get("name");
      const businessTypeFilter = url.searchParams.get("business_type");
      const entityTypeFilter = url.searchParams.get("entity_type");
      const cityFilter = url.searchParams.get("city");
      const stateFilter = url.searchParams.get("state");
      const specialtyMakesFilter = url.searchParams.get("specialty_makes");
      const statusFilter = url.searchParams.get("status");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
      const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 100));
      const offset = (page - 1) * limit;

      let query = supabase
        .from("organizations")
        .select(`
          id, business_name, slug, business_type, entity_type,
          city, state, specializations, services_offered,
          specialty_makes, specialty_eras,
          website, trust_score, is_verified, status,
          description, source_url, discovered_via,
          created_at
        `, { count: "estimated" })
        .eq("is_public", true);

      if (nameFilter) query = query.ilike("business_name", `%${nameFilter}%`);
      if (businessTypeFilter) query = query.eq("business_type", businessTypeFilter);
      if (entityTypeFilter) query = query.eq("entity_type", entityTypeFilter);
      if (cityFilter) query = query.ilike("city", `%${cityFilter}%`);
      if (stateFilter) query = query.ilike("state", `%${stateFilter}%`);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (specialtyMakesFilter) {
        query = query.contains("specialty_makes", [specialtyMakesFilter]);
      }

      const { data, error, count } = await query
        .order("trust_score", { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

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

    // POST /api-v1-organizations — Submit a discovered organization
    if (req.method === "POST") {
      let body: OrgInput;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!body.business_name || body.business_name.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: "business_name is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check for duplicate by business_name + city + state
      const dupeQuery = supabase
        .from("organizations")
        .select("id, business_name, city, state")
        .ilike("business_name", body.business_name.trim());

      if (body.city) dupeQuery.ilike("city", body.city.trim());
      if (body.state) dupeQuery.ilike("state", body.state.trim());

      const { data: existing } = await dupeQuery.maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({
            error: "Organization may already exist",
            existing_id: existing.id,
            existing_name: existing.business_name,
            existing_city: existing.city,
            existing_state: existing.state,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const insertData: Record<string, any> = {
        business_name: body.business_name.trim(),
        discovered_by: userId,
        is_public: true,
        status: "active",
      };

      // Optional fields
      if (body.business_type) insertData.business_type = body.business_type;
      if (body.entity_type) insertData.entity_type = body.entity_type;
      if (body.city) insertData.city = body.city;
      if (body.state) insertData.state = body.state;
      if (body.address) insertData.address = body.address;
      if (body.zip_code) insertData.zip_code = body.zip_code;
      if (body.country) insertData.country = body.country;
      if (body.website) insertData.website = body.website;
      if (body.phone) insertData.phone = body.phone;
      if (body.email) insertData.email = body.email;
      if (body.description) insertData.description = body.description;
      if (body.source_url) insertData.source_url = body.source_url;
      if (body.discovered_via) insertData.discovered_via = body.discovered_via;
      if (body.specializations) insertData.specializations = body.specializations;
      if (body.services_offered) insertData.services_offered = body.services_offered;
      if (body.specialty_makes) insertData.specialty_makes = body.specialty_makes;
      if (body.specialty_eras) insertData.specialty_eras = body.specialty_eras;

      const { data, error } = await supabase
        .from("organizations")
        .insert(insertData)
        .select("id, business_name, slug, business_type, entity_type, city, state, status")
        .maybeSingle();

      if (error) throw error;

      await logApiUsage(supabase, userId, "organizations", "create", data?.id);

      return new Response(
        JSON.stringify({ data, message: "Organization submitted successfully" }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Organizations API error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
