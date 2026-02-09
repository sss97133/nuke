/**
 * Org Extraction Coverage – extracted count, queue pending, target.
 * So we can show "132k of 222k targeted · rest in queue" and that we're calculating turnover/client metrics.
 *
 * GET /functions/v1/org-extraction-coverage?org_id=...
 * Returns { extracted, queue_pending, target, label } for known orgs (e.g. BAT).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAT_ORG_ID = "d2bd6370-11d1-4af0-8dd2-3de2c3899166";
const BAT_TARGET = 222_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id") || "";
    if (!orgId) {
      return new Response(
        JSON.stringify({ error: "org_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (orgId === BAT_ORG_ID) {
      const [batListingsRes, queueRes] = await Promise.all([
        supabase.from("bat_listings").select("id", { count: "exact", head: true }),
        supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", "%bringatrailer%").eq("status", "pending"),
      ]);
      const extracted = batListingsRes.count ?? 0;
      const queue_pending = queueRes.count ?? 0;
      return new Response(
        JSON.stringify({
          org_id: BAT_ORG_ID,
          label: "Bring a Trailer",
          extracted,
          queue_pending,
          target: BAT_TARGET,
          metrics_note: "We calculate turnover, GMV, and client-facing metrics as we complete extraction.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ org_id: orgId, extracted: null, queue_pending: null, target: null, label: null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
