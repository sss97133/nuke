/**
 * COMPUTE ORG SELLER STATS — Organization-level seller analytics
 *
 * Folds source-attributed listing episodes, explicit-currency prices and native counters
 * for organizations that sell vehicles on auction platforms.
 *
 * POST /functions/v1/compute-org-seller-stats
 * Body: {
 *   "business_id": "uuid",            // Single org
 *   "business_ids": ["uuid", ...],    // Batch (max 50)
 *   "all": true,                      // Oldest 50 orgs with indexed listing evidence
 *   "force": false                    // Re-compute even if recent
 * }
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth } from "../_shared/writeGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function computeStatsForOrg(supabase: SupabaseClient, orgId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("compute_organization_listing_activity", { p_org_id: orgId });
  if (error) throw new Error(`Listing activity fold failed: ${error.message}`);
  if (data?.contract !== "listing_activity_v1" || data.organization_id !== orgId || data.population_complete !== true) {
    throw new Error("Invalid listing activity receipt");
  }
  return data;
}

Deno.serve(async (req: Request) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json().catch(() => ({}));
    const {
      business_id,
      business_ids,
      all: computeAll,
      force,
    } = body;

    let orgIds: string[] = [];

    if (business_id) {
      orgIds = [business_id];
    } else if (business_ids && Array.isArray(business_ids)) {
      orgIds = business_ids.slice(0, 50);
    } else if (computeAll) {
      const { data: orgs, error } = await supabase.rpc("organization_listing_activity_candidates", { p_limit: 50 });
      if (error) throw new Error(`Candidate reading failed: ${error.message}`);
      orgIds = (orgs || []).map((o: { organization_id: string }) => o.organization_id);
    } else {
      return new Response(
        JSON.stringify({
          error:
            'Provide business_id, business_ids[], or all:true',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let recentlySkipped = 0;
    // Skip only qualified recent caches unless force.
    if (!force) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("organization_seller_stats")
        .select("organization_id")
        .in("organization_id", orgIds)
        .eq("evidence_summary->>contract", "listing_activity_v1")
        .gte("calculated_at", oneHourAgo);

      const recentIds = new Set(
        (recent || []).map((r: any) => r.organization_id)
      );
      const skipped = orgIds.filter((id) => recentIds.has(id));
      recentlySkipped = skipped.length;
      orgIds = orgIds.filter((id) => !recentIds.has(id));

      if (skipped.length > 0) {
        console.log(
          `Skipping ${skipped.length} orgs computed within last hour`
        );
      }
    }

    const results: Array<Record<string, unknown>> = [];
    const errors: string[] = [];
    const deadline = Date.now() + 120_000;

    for (const orgId of orgIds) {
      if (Date.now() >= deadline) {
        errors.push("organization_batch_budget_exhausted");
        break;
      }
      try {
        const stats = await computeStatsForOrg(supabase, orgId);
        results.push(stats);
      } catch (err: any) {
        console.error(`Error computing stats for ${orgId}:`, err.message);
        errors.push(`${orgId}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        computed: results.length,
        skipped: recentlySkipped,
        errors: errors.length > 0 ? errors : undefined,
        results,
      }),
      {
        status: errors.length ? 500 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
