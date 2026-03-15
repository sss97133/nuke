/**
 * bat-price-propagation
 *
 * Propagates validated prices from bat_listings → vehicles table via Tetris write layer.
 * Cross-validates bat_listings.sale_price against snapshot HTML before propagating.
 *
 * Actions:
 *   audit      — Dry run: show what would be propagated without writing
 *   propagate  — Actually propagate validated prices (batched)
 *   outliers   — List price outliers for manual review
 *
 * Deploy: supabase functions deploy bat-price-propagation --no-verify-jwt
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  extractEssentials,
  parseBaTHTML,
  canonicalUrl,
} from "../_shared/batParser.ts";
import {
  batchUpsertWithProvenance,
  quarantineRecord,
  type ProvenanceMetadata,
} from "../_shared/batUpsertWithProvenance.ts";

const PROPAGATION_VERSION = "bat-price-propagation:1.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "audit";
    const batchSize = Math.min(Number(body.batch_size) || 500, 1000);
    const offset = Number(body.offset) || 0;

    if (action === "outliers") {
      // Find price outliers from bat_listings
      const { data: lowOutliers } = await supabase
        .from("bat_listings")
        .select("bat_listing_url, bat_listing_title, sale_price, listing_status, final_bid")
        .not("sale_price", "is", null)
        .lt("sale_price", 100)
        .gt("sale_price", 0)
        .order("sale_price", { ascending: true })
        .limit(50);

      const { data: highOutliers } = await supabase
        .from("bat_listings")
        .select("bat_listing_url, bat_listing_title, sale_price, listing_status, final_bid")
        .not("sale_price", "is", null)
        .gt("sale_price", 10000000)
        .order("sale_price", { ascending: false })
        .limit(50);

      return new Response(JSON.stringify({
        action: "outliers",
        low_count: (lowOutliers || []).length,
        high_count: (highOutliers || []).length,
        low_outliers: lowOutliers || [],
        high_outliers: highOutliers || [],
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get bat_listings with valid prices
    const { data: listings, error: listErr } = await supabase
      .from("bat_listings")
      .select("id, bat_listing_url, sale_price, final_bid, listing_status, sale_date")
      .not("sale_price", "is", null)
      .gt("sale_price", 100)
      .lt("sale_price", 10000000)
      .order("sale_price", { ascending: false })
      .range(offset, offset + batchSize - 1);

    if (listErr) throw new Error(`Listings query failed: ${listErr.message}`);

    // Match to vehicles that need price propagation
    const candidates: any[] = [];
    for (const bl of (listings || [])) {
      const urlCandidates = [bl.bat_listing_url];
      const canon = canonicalUrl(bl.bat_listing_url);
      if (canon !== bl.bat_listing_url) urlCandidates.push(canon);

      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, sale_price, high_bid, reserve_status, auction_end_date, bat_sold_price, bat_sale_date, year, make, model")
        .eq("status", "active")
        .or(`bat_auction_url.in.(${urlCandidates.map(u => `"${u}"`).join(",")}),discovery_url.in.(${urlCandidates.map(u => `"${u}"`).join(",")})`)
        .limit(1)
        .maybeSingle();

      if (vehicle && (vehicle.sale_price == null || vehicle.bat_sold_price == null)) {
        candidates.push({
          listing_id: bl.id,
          bat_listing_url: bl.bat_listing_url,
          listing_sale_price: bl.sale_price,
          final_bid: bl.final_bid,
          listing_status: bl.listing_status,
          listing_sale_date: bl.sale_date,
          vehicle_id: vehicle.id,
          vehicle_sale_price: vehicle.sale_price,
          vehicle_high_bid: vehicle.high_bid,
          vehicle_reserve_status: vehicle.reserve_status,
          vehicle_auction_end_date: vehicle.auction_end_date,
          vehicle_bat_sold_price: vehicle.bat_sold_price,
          vehicle_bat_sale_date: vehicle.bat_sale_date,
        });
      }

      if (candidates.length >= batchSize) break;
    }

    const items = Array.isArray(candidates) ? candidates : [];
    if (!items.length) {
      return new Response(JSON.stringify({
        action,
        message: "No candidates for price propagation",
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Process each candidate
    const results = {
      total: items.length,
      validated: 0,
      propagated: 0,
      quarantined: 0,
      confirmed: 0,
      skipped: 0,
      snapshot_checked: 0,
      details: [] as any[],
    };

    const CONCURRENCY = 5;

    async function processCandidate(item: any) {
      const {
        listing_id, bat_listing_url, listing_sale_price, final_bid,
        listing_status, listing_sale_date,
        vehicle_id, vehicle_sale_price, vehicle_high_bid,
        vehicle_reserve_status, vehicle_bat_sold_price,
      } = item;

      let snapshotPrice: number | null = null;
      let snapshotValidated = false;

      // Try to cross-validate against snapshot HTML
      try {
        const urlCandidates = [bat_listing_url];
        const canon = canonicalUrl(bat_listing_url);
        if (canon !== bat_listing_url) urlCandidates.push(canon);
        if (bat_listing_url.endsWith("/")) urlCandidates.push(bat_listing_url.slice(0, -1));
        else urlCandidates.push(bat_listing_url + "/");

        // Find snapshot — HTML may be in storage, not DB column
        let snapRow: any = null;
        for (const u of urlCandidates) {
          const { data: s } = await supabase
            .from("listing_page_snapshots")
            .select("html, html_storage_path")
            .eq("platform", "bat")
            .eq("success", true)
            .eq("listing_url", u)
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (s) { snapRow = s; break; }
        }

        if (snapRow) {
          let html = snapRow.html ?? null;
          if (!html && snapRow.html_storage_path) {
            try {
              const { data: blob } = await supabase.storage
                .from("listing-snapshots")
                .download(snapRow.html_storage_path);
              if (blob) html = await blob.text();
            } catch (_) { /* storage read failed */ }
          }

          if (html && html.length > 1000) {
            results.snapshot_checked++;
            const essentials = extractEssentials(html);
            snapshotPrice = essentials.sale_price;
            snapshotValidated = true;
          }
        }
      } catch {
        // Snapshot check is best-effort
      }

      // Determine if price is validated
      let validated = false;
      let priceToPropagate = listing_sale_price;
      const issues: string[] = [];

      if (snapshotValidated && snapshotPrice !== null) {
        if (snapshotPrice === listing_sale_price) {
          validated = true; // Both sources agree
        } else if (Math.abs(snapshotPrice - listing_sale_price) / listing_sale_price < 0.01) {
          validated = true; // Within 1% (rounding differences)
          priceToPropagate = snapshotPrice; // Prefer snapshot (directly parsed)
        } else {
          issues.push(`price_mismatch: bat_listings=$${listing_sale_price}, snapshot=$${snapshotPrice}`);
        }
      } else {
        // No snapshot to cross-validate, trust bat_listings if price looks reasonable
        validated = listing_sale_price > 100 && listing_sale_price < 10_000_000;
        if (validated) issues.push("unverified_no_snapshot");
      }

      // Handle "ended" listings with no sale
      if (listing_status === "ended" && listing_sale_price === 0 && final_bid > 0) {
        // Reserve not met — store high_bid only
        priceToPropagate = null;
        issues.push("ended_rnm: storing high_bid only");
      }

      const detail: any = {
        vehicle_id,
        url: bat_listing_url,
        listing_price: listing_sale_price,
        snapshot_price: snapshotPrice,
        validated,
        issues,
      };

      if (action === "audit") {
        detail.would_propagate = validated && priceToPropagate;
        results.details.push(detail);
        if (validated) results.validated++;
        return;
      }

      // === PROPAGATE mode ===
      if (!validated || !priceToPropagate) {
        if (issues.length > 0 && !issues.every(i => i.includes("unverified"))) {
          await quarantineRecord(
            supabase, vehicle_id, bat_listing_url,
            PROPAGATION_VERSION, 0.5, issues,
          );
          results.quarantined++;
        } else {
          results.skipped++;
        }
        results.details.push(detail);
        return;
      }

      results.validated++;

      // Use Tetris write layer
      const defaultMetadata: ProvenanceMetadata = {
        extraction_version: PROPAGATION_VERSION,
        extraction_method: "bat_listings_cross_validate",
        source_url: bat_listing_url,
        confidence_score: snapshotValidated ? 0.95 : 0.75,
        source_signal: snapshotValidated ? "bat_listings+snapshot" : "bat_listings_only",
      };

      const proposedFields: Record<string, any> = {
        sale_price: priceToPropagate,
        bat_sold_price: priceToPropagate,
      };

      if (final_bid && final_bid > 0) {
        proposedFields.high_bid = final_bid;
      }

      if (listing_sale_date) {
        proposedFields.bat_sale_date = listing_sale_date;
        proposedFields.sale_date = listing_sale_date;
      }

      const existingVehicle = {
        sale_price: vehicle_sale_price,
        bat_sold_price: vehicle_bat_sold_price,
        high_bid: vehicle_high_bid,
        bat_sale_date: item.vehicle_bat_sale_date,
        sale_date: item.vehicle_auction_end_date,
      };

      const { updatePayload, stats } = await batchUpsertWithProvenance(
        supabase, vehicle_id, bat_listing_url,
        PROPAGATION_VERSION, existingVehicle, proposedFields, {}, defaultMetadata,
      );

      if (Object.keys(updatePayload).length > 0) {
        updatePayload.updated_at = new Date().toISOString();
        const { error: updateErr } = await supabase
          .from("vehicles")
          .update(updatePayload)
          .eq("id", vehicle_id);

        if (!updateErr) {
          results.propagated += stats.gap_fills;
          results.confirmed += stats.confirmations;
        }
      } else {
        results.confirmed += stats.confirmations;
      }

      if (stats.conflicts > 0) results.quarantined += stats.conflicts;

      detail.propagated = stats.gap_fills > 0;
      detail.confirmed = stats.confirmations > 0;
      results.details.push(detail);
    }

    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processCandidate));
    }

    // Trim details for response size
    if (results.details.length > 50) {
      results.details = results.details.slice(0, 50);
      (results as any).details_truncated = true;
    }

    return new Response(JSON.stringify({
      success: true,
      action,
      version: PROPAGATION_VERSION,
      ...results,
      duration_ms: Date.now() - startTime,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      error: String(err?.message || err),
      duration_ms: Date.now() - startTime,
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
