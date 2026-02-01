import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Normalize organization_vehicles relationship types for common misclassification patterns.
 *
 * Current rules:
 * - Service shops (restoration/repair/service/garage/workshop/detail) + project/portfolio URLs -> service_provider + archived
 *
 * This function is intended for admin/maintenance runs. It does NOT delete rows; it updates in-place
 * only when a service_provider link does not already exist for the same org+vehicle.
 */

interface Deno {
  serve: (handler: (req: Request) => Promise<Response>) => void;
}

type Json = Record<string, unknown>;

const json = (body: Json, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const payload = (await req.json().catch(() => ({}))) as any;
    const organizationId = payload?.organizationId ? String(payload.organizationId) : null;

    const { data, error } = await supabase.rpc("normalize_org_vehicle_relationships", {
      p_organization_id: organizationId,
    });

    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    return json({ success: true, updated: rows.length, rows });
  } catch (e: any) {
    return json({ success: false, error: e?.message || String(e) }, 500);
  }
});


