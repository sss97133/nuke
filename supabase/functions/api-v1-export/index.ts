/**
 * API v1 - Bulk Export Endpoint
 *
 * Exports vehicle data in CSV, JSON, or NDJSON format.
 * Designed for data scientists, ML pipelines, and enterprise customers.
 *
 * Usage:
 *   GET /api-v1-export?format=csv&make=Porsche&year_min=1970&limit=5000
 *   GET /api-v1-export?format=ndjson&cursor=<last_id>&limit=10000
 *   GET /api-v1-export?format=json&fields=id,year,make,model,vin,sale_price
 *
 * Authentication: Bearer JWT, service role key, or X-API-Key header
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// All exportable fields from vehicles table
const ALLOWED_FIELDS = [
  "id",
  "year",
  "make",
  "model",
  "trim",
  "series",
  "vin",
  "mileage",
  "color",
  "interior_color",
  "transmission",
  "engine_type",
  "engine_displacement",
  "drivetrain",
  "body_style",
  "sale_price",
  "purchase_price",
  "is_public",
  "created_at",
  "updated_at",
  "primary_image_url",
  "discovery_url",
  "data_quality_score",
  "description",
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

const DEFAULT_FIELDS: AllowedField[] = [
  "id",
  "year",
  "make",
  "model",
  "trim",
  "vin",
  "mileage",
  "color",
  "transmission",
  "engine_type",
  "drivetrain",
  "body_style",
  "sale_price",
  "created_at",
  "primary_image_url",
  "discovery_url",
  "data_quality_score",
];

// Max rows per request
const MAX_LIMIT_SERVICE_ROLE = 100_000;
const MAX_LIMIT_API_KEY = 10_000;
const MAX_LIMIT_USER = 5_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Only GET requests are supported" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const { userId, isServiceRole, isApiKey, error: authError } = await authenticateRequest(req, supabase);
    if (authError || !userId) {
      return new Response(
        JSON.stringify({ error: authError || "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const params = url.searchParams;

    // -- Format ---
    const format = (params.get("format") || "json").toLowerCase();
    if (!["csv", "json", "ndjson", "parquet"].includes(format)) {
      return new Response(
        JSON.stringify({
          error: "Invalid format. Supported: csv, json, ndjson",
          note: "parquet is not supported natively; export as ndjson and convert with pandas: pd.read_json('data.ndjson', lines=True).to_parquet('data.parquet')",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (format === "parquet") {
      return new Response(
        JSON.stringify({
          error: "Parquet format is not supported in the edge function runtime.",
          hint: "Use format=ndjson and convert locally: pd.read_json('data.ndjson', lines=True).to_parquet('data.parquet')",
          alternatives: ["csv", "json", "ndjson"],
        }),
        {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // -- Limit ---
    const maxLimit = isServiceRole
      ? MAX_LIMIT_SERVICE_ROLE
      : isApiKey
      ? MAX_LIMIT_API_KEY
      : MAX_LIMIT_USER;
    const rawLimit = parseInt(params.get("limit") || "1000", 10);
    const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 1000 : rawLimit, maxLimit));

    // -- Cursor (UUID of last seen vehicle id for keyset pagination) ---
    const cursor = params.get("cursor") || null;

    // -- Fields ---
    let fields: AllowedField[] = DEFAULT_FIELDS;
    const rawFields = params.get("fields");
    if (rawFields) {
      const requested = rawFields.split(",").map((f) => f.trim()) as AllowedField[];
      const valid = requested.filter((f) => (ALLOWED_FIELDS as readonly string[]).includes(f));
      if (valid.length > 0) fields = valid as AllowedField[];
    }

    // -- Filters ---
    const makeFilter = params.get("make");
    const modelFilter = params.get("model");
    const yearFilter = params.get("year");
    const yearMinFilter = params.get("year_min");
    const yearMaxFilter = params.get("year_max");
    const vinFilter = params.get("vin");
    const priceMinFilter = params.get("price_min");
    const priceMaxFilter = params.get("price_max");
    const transmissionFilter = params.get("transmission");
    const mileageMaxFilter = params.get("mileage_max");
    const drivetrainFilter = params.get("drivetrain");
    const bodyStyleFilter = params.get("body_style");
    const qualityMinFilter = params.get("quality_min");

    // -- Build query ---
    let query = supabase
      .from("vehicles")
      .select(fields.join(", "))
      .order("id", { ascending: true })
      .limit(limit);

    // Access control
    if (isServiceRole) {
      // Service role sees all public vehicles
      query = query.eq("is_public", true);
    } else {
      // Regular users see their own + public
      const safeUserId = String(userId).replace(/[",().\\]/g, "");
      query = query.or(`owner_id.eq."${safeUserId}",is_public.eq.true`);
    }

    // Cursor pagination (keyset — much faster than OFFSET for large datasets)
    if (cursor) {
      query = query.gt("id", cursor);
    }

    // Filters
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
    if (drivetrainFilter) query = query.ilike("drivetrain", `%${drivetrainFilter}%`);
    if (bodyStyleFilter) query = query.ilike("body_style", `%${bodyStyleFilter}%`);
    if (qualityMinFilter) {
      const qualityMin = parseInt(qualityMinFilter, 10);
      if (!isNaN(qualityMin)) query = query.gte("data_quality_score", qualityMin);
    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = data || [];
    const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id : null;

    // Log usage
    await logApiUsage(supabase, userId, "export", format, rows.length);

    // -- Format response ---
    if (format === "csv") {
      const csv = toCSV(rows, fields);
      const filename = `nuke-vehicles-export-${Date.now()}.csv`;
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Total-Rows": String(rows.length),
          "X-Next-Cursor": nextCursor || "",
          "X-Fields": fields.join(","),
        },
      });
    }

    if (format === "ndjson") {
      const ndjson = rows.map((row) => JSON.stringify(row)).join("\n");
      const filename = `nuke-vehicles-export-${Date.now()}.ndjson`;
      return new Response(ndjson, {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/x-ndjson",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "X-Total-Rows": String(rows.length),
          "X-Next-Cursor": nextCursor || "",
          "X-Fields": fields.join(","),
        },
      });
    }

    // Default: JSON
    return new Response(
      JSON.stringify({
        data: rows,
        meta: {
          count: rows.length,
          limit,
          fields,
          next_cursor: nextCursor,
          has_more: nextCursor !== null,
          format: "json",
          // Instructions for paginating through all records
          pagination_example: nextCursor
            ? `${url.origin}${url.pathname}?${buildNextParams(params, nextCursor)}`
            : null,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-Total-Rows": String(rows.length),
          "X-Next-Cursor": nextCursor || "",
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Export error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---- Helpers ----

function toCSV(rows: Record<string, unknown>[], fields: AllowedField[]): string {
  if (rows.length === 0) return fields.join(",") + "\n";

  const header = fields.join(",");
  const body = rows.map((row) =>
    fields.map((f) => csvCell(row[f])).join(",")
  );

  return [header, ...body].join("\n") + "\n";
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Escape if contains comma, quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function buildNextParams(params: URLSearchParams, cursor: string): string {
  const next = new URLSearchParams(params);
  next.set("cursor", cursor);
  return next.toString();
}

async function authenticateRequest(
  req: Request,
  supabase: ReturnType<typeof createClient>
): Promise<{
  userId: string | null;
  isServiceRole?: boolean;
  isApiKey?: boolean;
  error?: string;
}> {
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const altServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (
      (serviceRoleKey && token === serviceRoleKey) ||
      (altServiceRoleKey && token === altServiceRoleKey)
    ) {
      return { userId: "service-role", isServiceRole: true };
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (user && !error) {
      return { userId: user.id };
    }
  }

  if (apiKey) {
    const rawKey = apiKey.startsWith("nk_live_") ? apiKey.slice(8) : apiKey;
    const keyHash = await hashApiKey(rawKey);

    const { data: keyData, error } = await supabase
      .from("api_keys")
      .select("user_id, scopes, is_active, rate_limit_remaining, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (keyData && !error) {
      if (keyData.expires_at && new Date(keyData.expires_at) < new Date()) {
        return { userId: null, error: "API key has expired" };
      }
      if (keyData.rate_limit_remaining !== null && keyData.rate_limit_remaining <= 0) {
        return { userId: null, error: "Rate limit exceeded" };
      }

      // Deduct more for bulk export (10 credits per export call)
      const deduct = Math.min(10, keyData.rate_limit_remaining ?? 10);
      await supabase
        .from("api_keys")
        .update({
          rate_limit_remaining:
            keyData.rate_limit_remaining !== null
              ? keyData.rate_limit_remaining - deduct
              : null,
          last_used_at: new Date().toISOString(),
        })
        .eq("key_hash", keyHash);

      return { userId: keyData.user_id, isApiKey: true };
    }
  }

  return { userId: null, error: "Invalid or missing authentication" };
}

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return "sha256_" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logApiUsage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  resource: string,
  action: string,
  rowCount: number
) {
  try {
    await supabase.from("api_usage_logs").insert({
      user_id: userId,
      resource,
      action,
      resource_id: String(rowCount),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log API usage:", e);
  }
}
