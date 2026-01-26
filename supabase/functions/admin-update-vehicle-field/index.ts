import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";

type ReqBody = {
  vehicle_id: string;
  field_name: string;
  field_value: string | number | null;
  source_type?: string | null;
  source_url?: string | null;
  source_image_id?: string | null;
  note?: string | null;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function normalizeFieldName(name: string) {
  return String(name || "").trim().toLowerCase();
}

function normalizeValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Supabase env vars not configured" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { ok: false, error: "Unauthorized" });

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user?.id) return json(401, { ok: false, error: "Unauthorized" });

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: adminRow, error: adminErr } = await service
      .from("admin_users")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (adminErr) throw adminErr;
    if (!adminRow) return json(403, { ok: false, error: "Forbidden" });

    const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;
    const vehicleId = String(body.vehicle_id || "").trim();
    const fieldNameRaw = String(body.field_name || "").trim();
    const fieldName = normalizeFieldName(fieldNameRaw);
    const fieldValue = normalizeValue(body.field_value);

    if (!vehicleId) return json(400, { ok: false, error: "Missing vehicle_id" });
    if (!fieldName) return json(400, { ok: false, error: "Missing field_name" });

    const blockedFields = new Set([
      "id",
      "created_at",
      "updated_at",
      "uploaded_by",
      "user_id",
      "owner_id",
      "listing_url",
      "listing_source",
      "discovery_url",
      "discovery_source",
      "origin_metadata",
      "profile_origin",
      "bat_auction_url",
      "primary_image_url",
    ]);
    if (blockedFields.has(fieldName)) {
      return json(400, { ok: false, error: `Field not allowed: ${fieldName}` });
    }

    const allowedFields = new Set([
      "vin",
      "year",
      "make",
      "model",
      "series",
      "trim",
      "color",
      "engine",
      "engine_size",
      "transmission",
      "mileage",
      "fuel_type",
      "drivetrain",
      "body_style",
      "doors",
      "seats",
      "horsepower",
      "torque",
      "weight_lbs",
      "wheelbase_inches",
      "length_inches",
      "width_inches",
      "height_inches",
      "mpg_city",
      "mpg_highway",
      "mpg_combined",
    ]);
    if (!allowedFields.has(fieldName)) {
      return json(400, { ok: false, error: `Field not supported: ${fieldName}` });
    }

    const updatePayload: Record<string, unknown> = { [fieldName]: fieldValue };
    const { error: updateErr } = await service
      .from("vehicles")
      .update(updatePayload)
      .eq("id", vehicleId);
    if (updateErr) {
      return json(500, { ok: false, error: updateErr.message || "Update failed" });
    }

    const sourceType = String(body.source_type || "user_input").trim() || "user_input";
    const sourceUrl = body.source_url ? String(body.source_url).trim() : null;
    const sourceImageId = body.source_image_id ? String(body.source_image_id).trim() : null;
    const note = body.note ? String(body.note).trim() : null;

    try {
      const sourceRow: Record<string, unknown> = {
        vehicle_id: vehicleId,
        field_name: fieldName,
        field_value: fieldValue === null ? "" : String(fieldValue),
        source_type: sourceType,
        source_url: sourceUrl,
        confidence_score: 100,
        user_id: userData.user.id,
        verified_by: userData.user.id,
        verified_at: new Date().toISOString(),
      };
      if (sourceImageId) sourceRow.source_image_id = sourceImageId;
      if (note) sourceRow.metadata = { note };

      await service.from("vehicle_field_sources").insert(sourceRow);
    } catch (err) {
      console.warn("[admin-update-vehicle-field] Source insert skipped:", err);
    }

    try {
      await service.from("timeline_events").insert({
        vehicle_id: vehicleId,
        user_id: userData.user.id,
        event_type: "manual_edit",
        event_date: new Date().toISOString(),
        title: `Admin update: ${fieldName}`,
        description: `Updated ${fieldName} to ${fieldValue ?? "null"}`,
        source: "admin_override",
        source_type: "user_input",
        metadata: {
          field_name: fieldName,
          field_value: fieldValue,
          source_url: sourceUrl,
        },
      });
    } catch (err) {
      console.warn("[admin-update-vehicle-field] Timeline insert skipped:", err);
    }

    return json(200, {
      ok: true,
      vehicle_id: vehicleId,
      field_name: fieldName,
      field_value: fieldValue,
    });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
});
