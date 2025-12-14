import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ProcessRequest = {
  batch_size?: number;
  max_attempts?: number;
  max_results?: number;
  max_results_sold?: number;
};

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function inferOrgType(org: any): "dealer" | "auction_house" | "unknown" {
  const type = String(org?.type || "").toLowerCase();
  if (type === "dealer") return "dealer";
  if (type === "auction_house") return "auction_house";
  const metaType = String(org?.metadata?.business_type || org?.metadata?.type || "").toLowerCase();
  if (metaType === "dealer") return "dealer";
  if (metaType === "auction_house") return "auction_house";
  return "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

    const body: ProcessRequest = await req.json().catch(() => ({} as any));
    const batchSize = Math.max(1, Math.min(toInt(body.batch_size, 5), 25));
    const maxAttempts = Math.max(1, Math.min(toInt(body.max_attempts, 5), 20));
    const maxResults = Math.max(10, Math.min(toInt(body.max_results, 200), 500));
    const maxResultsSold = Math.max(10, Math.min(toInt(body.max_results_sold, 200), 500));

    const { data: items, error } = await supabase
      .from("organization_inventory_sync_queue")
      .select("id, organization_id, run_mode, status, attempts")
      .in("status", ["pending", "failed"] as any)
      .lt("attempts", maxAttempts)
      .order("next_run_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (error) throw new Error(`organization_inventory_sync_queue select failed: ${error.message}`);

    const out = {
      success: true,
      batch_size: batchSize,
      processed: 0,
      completed: 0,
      failed: 0,
      dealers_synced: 0,
      auctions_synced: 0,
      calls: [] as any[],
    };

    for (const item of items || []) {
      out.processed++;

      await supabase
        .from("organization_inventory_sync_queue")
        .update({
          status: "processing",
          attempts: (item.attempts || 0) + 1,
          last_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", item.id);

      try {
        const { data: org, error: orgErr } = await supabase
          .from("businesses")
          .select("id, website, type, business_type, metadata")
          .eq("id", item.organization_id)
          .maybeSingle();
        if (orgErr) throw new Error(`businesses lookup failed: ${orgErr.message}`);
        if (!org?.id) throw new Error("organization not found");

        const orgType = inferOrgType(org);
        const website = safeString(org.website);
        const origin = website ? normalizeOrigin(website) : null;
        const meta = (org.metadata && typeof org.metadata === "object") ? org.metadata : {};

        const classicProfileUrl = safeString((meta as any).classic_com_profile) || null;

        // Dealer-website URLs (only valid when we have a website origin)
        const inventoryUrl = origin ? (safeString((meta as any).inventory_url) || `${origin}/inventory`) : null;
        const soldInventoryUrl = origin ? (safeString((meta as any).sold_inventory_url) || null) : null;
        const auctionsUrl = origin ? (safeString((meta as any).auctions_url) || `${origin}/auctions`) : null;

        const runMode = String(item.run_mode || "both");

        if (orgType === "dealer") {
          // Classic.com seller inventory (in addition to dealer website inventory)
          if (classicProfileUrl && (runMode === "both" || runMode === "current")) {
            const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({
                source_url: classicProfileUrl,
                source_type: "dealer",
                organization_id: org.id,
                max_results: maxResults,
                use_llm_extraction: false,
                extract_dealer_info: false,
                include_sold: false,
              }),
              signal: AbortSignal.timeout(120000),
            });
            const data = await resp.json().catch(() => ({}));
            out.calls.push({ organization_id: org.id, kind: "classic_com_current", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
          }

          // Current inventory
          if (runMode === "both" || runMode === "current") {
            if (inventoryUrl) {
              const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
                body: JSON.stringify({
                  source_url: inventoryUrl,
                  source_type: "dealer_website",
                  organization_id: org.id,
                  max_results: maxResults,
                  use_llm_extraction: true,
                  extract_dealer_info: true,
                  // Many sites don't have deterministic sold feeds; keep false by default.
                  include_sold: false,
                  force_listing_status: "in_stock",
                }),
                signal: AbortSignal.timeout(120000),
              });
              const data = await resp.json().catch(() => ({}));
              out.calls.push({ organization_id: org.id, kind: "dealer_current", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
            } else {
              out.calls.push({ organization_id: org.id, kind: "dealer_current_skipped_no_website", ok: true, listings_queued: 0 });
            }
          }

          // Sold inventory (only if explicitly known; precision > guessing)
          if ((runMode === "both" || runMode === "sold") && soldInventoryUrl) {
            const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({
                source_url: soldInventoryUrl,
                source_type: "dealer_website",
                organization_id: org.id,
                max_results: maxResultsSold,
                use_llm_extraction: true,
                extract_dealer_info: false,
                include_sold: false,
                force_listing_status: "sold",
              }),
              signal: AbortSignal.timeout(120000),
            });
            const data = await resp.json().catch(() => ({}));
            out.calls.push({ organization_id: org.id, kind: "dealer_sold", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
          }

          out.dealers_synced++;
        } else if (orgType === "auction_house") {
          // Classic.com auction house pages (in addition to auction-house website)
          if (classicProfileUrl) {
            const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({
                source_url: classicProfileUrl,
                source_type: "auction_house",
                organization_id: org.id,
                max_results: maxResults,
                use_llm_extraction: false,
                extract_dealer_info: false,
              }),
              signal: AbortSignal.timeout(120000),
            });
            const data = await resp.json().catch(() => ({}));
            out.calls.push({ organization_id: org.id, kind: "classic_com_auction", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
          }

          if (auctionsUrl) {
            const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({
                source_url: auctionsUrl,
                source_type: "auction_house",
                organization_id: org.id,
                max_results: maxResults,
                use_llm_extraction: true,
                extract_dealer_info: true,
              }),
              signal: AbortSignal.timeout(120000),
            });
            const data = await resp.json().catch(() => ({}));
            out.calls.push({ organization_id: org.id, kind: "auction", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
          } else {
            out.calls.push({ organization_id: org.id, kind: "auction_skipped_no_website", ok: true, listings_queued: 0 });
          }
          out.auctions_synced++;
        } else {
          // Unknown type: still try dealer inventory (most sellers are dealers)
          if (classicProfileUrl && (runMode === "both" || runMode === "current")) {
            const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({
                source_url: classicProfileUrl,
                source_type: "dealer",
                organization_id: org.id,
                max_results: maxResults,
                use_llm_extraction: false,
                extract_dealer_info: false,
                include_sold: false,
              }),
              signal: AbortSignal.timeout(120000),
            });
            const data = await resp.json().catch(() => ({}));
            out.calls.push({ organization_id: org.id, kind: "classic_com_unknown_as_dealer", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
          }

          if (inventoryUrl) {
            const resp = await fetch(`${supabaseUrl}/functions/v1/scrape-multi-source`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseServiceKey}` },
              body: JSON.stringify({
                source_url: inventoryUrl,
                source_type: "dealer_website",
                organization_id: org.id,
                max_results: maxResults,
                use_llm_extraction: true,
                extract_dealer_info: true,
                include_sold: false,
                force_listing_status: "in_stock",
              }),
              signal: AbortSignal.timeout(120000),
            });
            const data = await resp.json().catch(() => ({}));
            out.calls.push({ organization_id: org.id, kind: "unknown_as_dealer", ok: resp.ok, listings_queued: data?.listings_queued || 0 });
          } else {
            out.calls.push({ organization_id: org.id, kind: "unknown_as_dealer_skipped_no_website", ok: true, listings_queued: 0 });
          }
          out.dealers_synced++;
        }

        // Success: schedule the next run (inventory changes frequently, but don't hammer).
        const next = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6 hours
        await supabase
          .from("organization_inventory_sync_queue")
          .update({ status: "completed", last_error: null, next_run_at: next, updated_at: new Date().toISOString() } as any)
          .eq("id", item.id);

        out.completed++;
      } catch (err: any) {
        const msg = err?.message || String(err);
        const next = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour backoff
        await supabase
          .from("organization_inventory_sync_queue")
          .update({ status: "failed", last_error: msg, next_run_at: next, updated_at: new Date().toISOString() } as any)
          .eq("id", item.id);
        out.failed++;
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


