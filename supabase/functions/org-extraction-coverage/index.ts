/**
 * Org Extraction Coverage – extracted count, queue pending, target.
 * Single org: GET ?org_id=...
 * All sources (for org cards + platform strip): GET ?all=1
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SourceKey = "bat" | "cab" | "craigslist" | "classic" | "pcarmarket";

const SOURCES: Record<
  SourceKey,
  { org_id: string; label: string; url_pattern: string; target: number | null }
> = {
  bat: {
    org_id: "d2bd6370-11d1-4af0-8dd2-3de2c3899166",
    label: "Bring a Trailer",
    url_pattern: "%bringatrailer%",
    target: 222_000,
  },
  cab: {
    org_id: "48fc29e4-e0f2-47dd-9b82-530a79e05797",
    label: "Cars & Bids",
    url_pattern: "%carsandbids%",
    target: null,
  },
  craigslist: {
    org_id: "624b7f80-c4c7-455d-8f0a-f7ae7ff67a42",
    label: "Craigslist",
    url_pattern: "%craigslist%",
    target: null,
  },
  classic: {
    org_id: "5bfda429-132d-4387-b812-c48945541c68",
    label: "Classic.com",
    url_pattern: "%classic.com%",
    target: null,
  },
  pcarmarket: {
    org_id: "f7c80592-6725-448d-9b32-2abf3e011cf8",
    label: "PCarMarket",
    url_pattern: "%pcarmarket%",
    target: null,
  },
};

const METRICS_NOTE =
  "We calculate turnover, GMV, and client-facing metrics as we complete extraction.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const orgId = url.searchParams.get("org_id") || "";
    const all = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (all) {
      const entries = Object.entries(SOURCES) as [SourceKey, (typeof SOURCES)[SourceKey]][];
      const results = await Promise.all(
        entries.map(async ([key, config]) => {
          if (key === "bat") {
            const [extractedRes, pendingRes] = await Promise.all([
              supabase.from("vehicle_events").select("id", { count: "exact", head: true }).eq("source_platform", "bat"),
              supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", config.url_pattern).eq("status", "pending"),
            ]);
            return {
              org_id: config.org_id,
              source: key,
              label: config.label,
              extracted: extractedRes.count ?? 0,
              queue_pending: pendingRes.count ?? 0,
              target: config.target,
              metrics_note: METRICS_NOTE,
            };
          }
          const [completeRes, pendingRes] = await Promise.all([
            supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", config.url_pattern).eq("status", "complete"),
            supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", config.url_pattern).eq("status", "pending"),
          ]);
          return {
            org_id: config.org_id,
            source: key,
            label: config.label,
            extracted: completeRes.count ?? 0,
            queue_pending: pendingRes.count ?? 0,
            target: config.target,
            metrics_note: METRICS_NOTE,
          };
        })
      );
      return new Response(JSON.stringify({ sources: results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: "org_id required, or use ?all=1 for all sources" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const entry = Object.entries(SOURCES).find(([, c]) => c.org_id === orgId) as [SourceKey, (typeof SOURCES)[SourceKey]] | undefined;
    if (!entry) {
      return new Response(
        JSON.stringify({ org_id: orgId, extracted: null, queue_pending: null, target: null, label: null }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [key, config] = entry;
    if (key === "bat") {
      const [batListingsRes, queueRes] = await Promise.all([
        supabase.from("vehicle_events").select("id", { count: "exact", head: true }).eq("source_platform", "bat"),
        supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", config.url_pattern).eq("status", "pending"),
      ]);
      return new Response(
        JSON.stringify({
          org_id: config.org_id,
          source: key,
          label: config.label,
          extracted: batListingsRes.count ?? 0,
          queue_pending: queueRes.count ?? 0,
          target: config.target,
          metrics_note: METRICS_NOTE,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [completeRes, pendingRes] = await Promise.all([
      supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", config.url_pattern).eq("status", "complete"),
      supabase.from("import_queue").select("id", { count: "exact", head: true }).ilike("listing_url", config.url_pattern).eq("status", "pending"),
    ]);
    return new Response(
      JSON.stringify({
        org_id: config.org_id,
        source: key,
        label: config.label,
        extracted: completeRes.count ?? 0,
        queue_pending: pendingRes.count ?? 0,
        target: config.target,
        metrics_note: METRICS_NOTE,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
