import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Payload = {
  limit?: number;
  dryRun?: boolean;
  onlyMissing?: boolean; // default true: only touch rows missing canonical columns
};

function coalesceString(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function safeIso(v: any): string | null {
  if (!v) return null;
  try {
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload: Payload = await req.json().catch(() => ({} as any));
    const limit = Math.max(1, Math.min(500, Number(payload?.limit || 50)));
    const dryRun = payload?.dryRun === true;
    const onlyMissing = payload?.onlyMissing !== false;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Pull candidates.
    // We can’t do a perfect “missing column” filter without assuming columns exist in all envs,
    // so we fetch listing_url + origin_metadata and do the decision in code.
    const { data: vehicles, error } = await supabase
      .from("vehicles")
      .select("id, listing_url, listing_source, listing_title, listing_location, listing_posted_at, listing_updated_at, origin_metadata")
      .not("listing_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const results: any[] = [];
    let updated = 0;
    let queued = 0;

    for (const v of vehicles || []) {
      const om = (v as any)?.origin_metadata || {};
      const listingUrl = coalesceString((v as any)?.listing_url, (om as any)?.listing_url);
      if (!listingUrl) continue;

      const next = {
        listing_source: coalesceString((v as any)?.listing_source, (om as any)?.listing_source, (om as any)?.source, "classified"),
        listing_url: listingUrl,
        listing_title: coalesceString((v as any)?.listing_title, (om as any)?.listing_title, (om as any)?.title),
        listing_location: coalesceString((v as any)?.listing_location, (om as any)?.listing_location, (om as any)?.location),
        listing_posted_at: safeIso((v as any)?.listing_posted_at || (om as any)?.listing_posted_at || (om as any)?.posted_date),
        listing_updated_at: safeIso((v as any)?.listing_updated_at || (om as any)?.listing_updated_at || (om as any)?.updated_date),
      };

      const missingAny =
        !(v as any)?.listing_title ||
        !(v as any)?.listing_location ||
        !(v as any)?.listing_posted_at;

      const wouldUpdate = !onlyMissing || missingAny;
      const hasAnyBackfillValue = !!(next.listing_title || next.listing_location || next.listing_posted_at || next.listing_updated_at);

      // Backfill extraction_metadata for raw listing description if origin_metadata has it.
      const rawDesc = coalesceString((om as any)?.raw_description, (om as any)?.description);
      let wouldInsertRawDesc = false;
      if (rawDesc) {
        const { data: existingRaw } = await supabase
          .from("extraction_metadata")
          .select("id")
          .eq("vehicle_id", (v as any).id)
          .eq("field_name", "raw_listing_description")
          .limit(1)
          .maybeSingle();
        wouldInsertRawDesc = !existingRaw?.id;
      }

      if (!wouldUpdate && !wouldInsertRawDesc) continue;

      if (!dryRun) {
        if (wouldUpdate && hasAnyBackfillValue) {
          const { error: upErr } = await supabase
            .from("vehicles")
            .update({ ...next, updated_at: new Date().toISOString() } as any)
            .eq("id", (v as any).id);
          if (!upErr) updated++;
        }

        if (wouldInsertRawDesc && rawDesc) {
          await supabase.from("extraction_metadata").insert({
            vehicle_id: (v as any).id,
            field_name: "raw_listing_description",
            field_value: rawDesc,
            extraction_method: "backfill_from_origin_metadata",
            scraper_version: "v1",
            source_url: listingUrl,
            confidence_score: 0.6,
            raw_extraction_data: om,
          } as any);
        }
      }

      // If we still have no posted_at and no raw description, we likely need a recrawl.
      const needsRecrawl = !next.listing_posted_at && !rawDesc;
      if (needsRecrawl && !dryRun) {
        try {
          await supabase.from("backfill_queue").insert({
            vehicle_id: (v as any).id,
            field_names: ["listing_posted_at", "listing_location", "vin", "mileage", "raw_listing_description"],
            reason: "manual_audit",
            priority: 5,
            source_url: listingUrl,
            triggered_by: "manual",
          } as any);
          queued++;
        } catch {
          // non-fatal
        }
      }

      results.push({
        vehicle_id: (v as any).id,
        listing_url: listingUrl,
        would_update: wouldUpdate && hasAnyBackfillValue,
        would_insert_raw_description: wouldInsertRawDesc,
        needs_recrawl: needsRecrawl,
        next,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        scanned: (vehicles || []).length,
        updated,
        queued,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("backfill-listing-metadata error:", error);
    return new Response(JSON.stringify({ success: false, error: error?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


