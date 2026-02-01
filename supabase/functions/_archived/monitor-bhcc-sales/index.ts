import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function extractBhccStockNoFromHtml(html: string): number | null {
  const m = html.match(/Stock\s*#\s*(\d{1,10})/i);
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function extractBhccListingUrlsFromIsapiResponse(body: string): Set<string> {
  // isapi_xml.php returns HTML + scripts. Extract absolute listing URLs.
  const urls = new Set<string>();
  const re = /https:\/\/www\.beverlyhillscarclub\.com\/[^\s"'<>]+\.htm/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    urls.add(m[0]);
  }
  return urls;
}

function safeGetBhccStockNoFromOriginMetadata(originMetadata: any): number | null {
  if (!originMetadata || typeof originMetadata !== "object") return null;
  const bhcc = (originMetadata as any).bhcc;
  const n = bhcc?.stockno ?? (originMetadata as any).bhcc_stockno ?? (originMetadata as any).stockno;
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && /^\d{1,10}$/.test(n)) return parseInt(n, 10);
  return null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing Supabase env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = (await req.json().catch(() => ({}))) as {
      dealer_id?: string;
      limit?: number;
      dry_run?: boolean;
      include_statuses?: string[];
    };

    const dealerId = body.dealer_id ?? null;
    const limit = Math.min(Math.max(body.limit ?? 50, 1), 250);
    const dryRun = body.dry_run === true;
    const includeStatuses = Array.isArray(body.include_statuses) && body.include_statuses.length
      ? body.include_statuses
      : ["in_stock", "pending_sale", "reserved"];

    let invQuery = supabase
      .from("dealer_inventory")
      .select("id,dealer_id,vehicle_id,status,asking_price,sale_date")
      .in("status", includeStatuses)
      .limit(limit);

    if (dealerId) invQuery = invQuery.eq("dealer_id", dealerId);

    const { data: invRows, error: invErr } = await invQuery;
    if (invErr) throw new Error(`dealer_inventory query failed: ${invErr.message}`);

    const inventory = Array.isArray(invRows) ? invRows : [];
    const vehicleIds = Array.from(new Set(inventory.map((r: any) => r.vehicle_id).filter(Boolean)));

    // vehicles table uses discovery_url as the canonical listing URL for scraped listings.
    const vehiclesById = new Map<string, { id: string; discovery_url: string | null; origin_metadata: any }>();
    if (vehicleIds.length) {
      const { data: vRows, error: vErr } = await supabase
        .from("vehicles")
        .select("id,discovery_url,origin_metadata")
        .in("id", vehicleIds);
      if (vErr) throw new Error(`vehicles query failed: ${vErr.message}`);
      for (const v of (vRows ?? []) as any[]) {
        vehiclesById.set(v.id, { id: v.id, discovery_url: v.discovery_url ?? null, origin_metadata: v.origin_metadata ?? null });
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const results = {
      scanned: 0,
      skipped_non_bhcc: 0,
      missing_listing_url: 0,
      missing_stockno: 0,
      detected_sold: 0,
      updated_dealer_inventory: 0,
      updated_org_links: 0,
      dry_run: dryRun,
      sample: [] as any[],
    };

    for (const row of inventory as any[]) {
      results.scanned++;

      const v = vehiclesById.get(row.vehicle_id);
      const listingUrl = v?.discovery_url ?? null;
      if (!listingUrl) {
        results.missing_listing_url++;
        continue;
      }

      if (!listingUrl.includes("beverlyhillscarclub.com/")) {
        results.skipped_non_bhcc++;
        continue;
      }

      let stockno = safeGetBhccStockNoFromOriginMetadata(v?.origin_metadata);

      // If missing, fetch the listing page once and extract Stock # from meta description, then persist it.
      if (!stockno) {
        const html = await fetch(listingUrl, {
          headers: {
            "User-Agent": "NukeInventoryMonitor/1.0",
            "Accept": "text/html,application/xhtml+xml",
          },
        }).then((r) => r.ok ? r.text() : "").catch(() => "");
        stockno = html ? extractBhccStockNoFromHtml(html) : null;

        if (stockno && !dryRun) {
          try {
            const om = (v?.origin_metadata && typeof v.origin_metadata === "object") ? v.origin_metadata : {};
            const nextOm = {
              ...om,
              bhcc: {
                ...(om as any)?.bhcc,
                stockno,
              },
            };
            await supabase
              .from("vehicles")
              .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
              .eq("id", row.vehicle_id);
          } catch {
            // ignore
          }
        }
      }

      if (!stockno) {
        results.missing_stockno++;
        continue;
      }

      const soldUrl = `https://www.beverlyhillscarclub.com/isapi_xml.php?module=inventory&sold=Sold&stockno=${encodeURIComponent(String(stockno))}&limit=50&offset=0`;
      const soldBody = await fetch(soldUrl, {
        headers: { "User-Agent": "NukeInventoryMonitor/1.0", "Accept": "text/html,*/*" },
      }).then((r) => r.ok ? r.text() : "").catch(() => "");

      const soldUrls = soldBody ? extractBhccListingUrlsFromIsapiResponse(soldBody) : new Set<string>();
      const isSold = soldUrls.has(listingUrl);

      if (results.sample.length < 10) {
        results.sample.push({ vehicle_id: row.vehicle_id, listing_url: listingUrl, stockno, is_sold: isSold });
      }

      if (!isSold) {
        // Best-effort: update last check timestamp in origin_metadata.
        if (!dryRun) {
          try {
            const om = (v?.origin_metadata && typeof v.origin_metadata === "object") ? v.origin_metadata : {};
            const nextOm = {
              ...om,
              bhcc: {
                ...(om as any)?.bhcc,
                last_sold_check_at: new Date().toISOString(),
              },
            };
            await supabase
              .from("vehicles")
              .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
              .eq("id", row.vehicle_id);
          } catch {
            // ignore
          }
        }
        continue;
      }

      results.detected_sold++;

      if (dryRun) continue;

      // Update dealer_inventory (no proof constraint here).
      const { error: updInvErr } = await supabase
        .from("dealer_inventory")
        .update({
          status: "sold",
          sale_date: row.sale_date ?? today,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", row.id);
      if (!updInvErr) results.updated_dealer_inventory++;

      // Update organization_vehicles link listing_status only (do NOT set status='sold' here; proof system enforces that).
      const { error: updOvErr } = await supabase
        .from("organization_vehicles")
        .update({
          listing_status: "sold",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("organization_id", row.dealer_id)
        .eq("vehicle_id", row.vehicle_id);
      if (!updOvErr) results.updated_org_links++;

      // Record detection in origin_metadata for audit/backfill.
      try {
        const om = (v?.origin_metadata && typeof v.origin_metadata === "object") ? v.origin_metadata : {};
        const nextOm = {
          ...om,
          bhcc: {
            ...(om as any)?.bhcc,
            stockno,
            detected_sold_at: (om as any)?.bhcc?.detected_sold_at ?? new Date().toISOString(),
            last_sold_check_at: new Date().toISOString(),
          },
        };
        await supabase
          .from("vehicles")
          .update({ origin_metadata: nextOm, updated_at: new Date().toISOString() } as any)
          .eq("id", row.vehicle_id);
      } catch {
        // ignore
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as any)?.message ?? String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


