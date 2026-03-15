/**
 * bat-extraction-test-harness
 *
 * Ground truth testing for BaT extraction accuracy.
 * Samples vehicles across price buckets, compares:
 * 1. DB state (what's currently stored)
 * 2. Snapshot extraction (re-parsing stored HTML with shared parser)
 * 3. Field-by-field discrepancy analysis
 *
 * Actions:
 *   run     — Run a new test (default, samples 50 vehicles)
 *   report  — Get summary of a previous run
 *   list    — List recent runs
 *
 * Deploy: supabase functions deploy bat-extraction-test-harness --no-verify-jwt
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  extractTitleIdentity,
  extractEssentials,
  extractDescription,
  extractImages,
  inferBodyStyleFromTitle,
  inferColorsFromDescription,
  normalizeDescriptionSummary,
  parseBaTHTML,
  type BatIdentity,
  type BatEssentials,
  type ParsedListing,
} from "../_shared/batParser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Fields we compare between DB and extraction
const COMPARE_FIELDS = [
  "year", "make", "model", "vin", "mileage",
  "exterior_color", "interior_color", "transmission", "drivetrain", "engine",
  "body_style", "sale_price", "high_bid", "reserve_status",
  "auction_end_date", "seller_username", "buyer_username",
  "location", "lot_number", "bid_count", "comment_count",
  "view_count", "watcher_count",
] as const;

type CompareField = typeof COMPARE_FIELDS[number];

interface FieldComparison {
  db: string | number | null;
  snapshot_core: string | number | null; // extractEssentials result
  snapshot_simple: string | number | null; // parseBaTHTML result
  match_core: boolean;
  match_simple: boolean;
}

function normalize(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().toLowerCase();
}

function fieldMatch(a: any, b: any): boolean {
  return normalize(a) === normalize(b);
}

/** Map DB vehicle columns to a comparable object */
function dbToComparable(v: any): Record<CompareField, any> {
  return {
    year: v.year ?? null,
    make: v.make ?? null,
    model: v.model ?? null,
    vin: v.vin ?? null,
    mileage: v.mileage ?? null,
    exterior_color: v.color ?? null,
    interior_color: v.interior_color ?? null,
    transmission: v.transmission ?? null,
    drivetrain: v.drivetrain ?? null,
    engine: v.engine_size ?? null,
    body_style: v.body_style ?? null,
    sale_price: v.sale_price ?? null,
    high_bid: v.high_bid ?? null,
    reserve_status: v.reserve_status ?? null,
    auction_end_date: v.auction_end_date ?? null,
    seller_username: v.bat_seller ?? null,
    buyer_username: v.bat_buyer ?? null,
    location: v.bat_location ?? null,
    lot_number: v.bat_lot_number ?? null,
    bid_count: v.bat_bids ?? null,
    comment_count: v.bat_comments ?? null,
    view_count: v.bat_views ?? null,
    watcher_count: v.bat_watchers ?? null,
  };
}

/** Map extractEssentials + extractTitleIdentity output to comparable object */
function coreToComparable(
  identity: BatIdentity,
  essentials: BatEssentials,
  desc: string | null,
  bodyStyle: string | null,
): Record<CompareField, any> {
  return {
    year: identity.year ?? null,
    make: identity.make ?? null,
    model: identity.model ?? null,
    vin: essentials.vin ?? null,
    mileage: essentials.mileage ?? null,
    exterior_color: essentials.exterior_color ?? null,
    interior_color: essentials.interior_color ?? null,
    transmission: essentials.transmission ?? null,
    drivetrain: essentials.drivetrain ?? null,
    engine: essentials.engine ?? null,
    body_style: bodyStyle ?? null,
    sale_price: essentials.sale_price ?? null,
    high_bid: essentials.high_bid ?? null,
    reserve_status: essentials.reserve_status ?? null,
    auction_end_date: essentials.auction_end_date ?? null,
    seller_username: essentials.seller_username ?? null,
    buyer_username: essentials.buyer_username ?? null,
    location: essentials.location ?? null,
    lot_number: essentials.lot_number ?? null,
    bid_count: essentials.bid_count ?? null,
    comment_count: essentials.comment_count ?? null,
    view_count: essentials.view_count ?? null,
    watcher_count: essentials.watcher_count ?? null,
  };
}

/** Map parseBaTHTML output to comparable object */
function simpleToComparable(parsed: ParsedListing): Record<CompareField, any> {
  return {
    year: null, // parseBaTHTML doesn't extract year
    make: null,
    model: null,
    vin: parsed.chassis ?? null,
    mileage: parsed.mileage ?? null,
    exterior_color: parsed.exterior_color ?? null,
    interior_color: parsed.interior ?? null,
    transmission: parsed.transmission ?? null,
    drivetrain: null, // parseBaTHTML doesn't extract drivetrain
    engine: parsed.engine ?? null,
    body_style: null,
    sale_price: parsed.sale_status === "sold" ? (parsed.sale_price ?? null) : null,
    high_bid: parsed.sale_status === "bid_to" ? (parsed.sale_price ?? null) : null,
    reserve_status: parsed.no_reserve ? "no_reserve" :
      parsed.sale_status === "unsold" ? "reserve_not_met" :
        parsed.sale_status === "sold" ? "reserve_met" : null,
    auction_end_date: null,
    seller_username: null,
    buyer_username: null,
    location: parsed.location_raw ?? null,
    lot_number: parsed.lot_number ?? null,
    bid_count: null,
    comment_count: parsed.comment_count ?? null,
    view_count: parsed.views ?? null,
    watcher_count: parsed.watchers ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "run";
    const sampleSize = Math.min(Number(body.sample_size) || 50, 200);

    if (action === "list") {
      const { data } = await supabase
        .from("bat_test_results")
        .select("run_id, bucket, accuracy_score, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      // Group by run_id
      const runs = new Map<string, any>();
      for (const r of (data || [])) {
        if (!runs.has(r.run_id)) {
          runs.set(r.run_id, { run_id: r.run_id, created_at: r.created_at, count: 0, avg_accuracy: 0, total_accuracy: 0 });
        }
        const run = runs.get(r.run_id)!;
        run.count++;
        run.total_accuracy += Number(r.accuracy_score || 0);
        run.avg_accuracy = run.total_accuracy / run.count;
      }

      return new Response(JSON.stringify({
        action: "list",
        runs: Array.from(runs.values()).slice(0, 20),
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "report") {
      const runId = body.run_id;
      if (!runId) throw new Error("run_id required for report action");

      const { data: results } = await supabase
        .from("bat_test_results")
        .select("*")
        .eq("run_id", runId);

      if (!results?.length) throw new Error(`No results for run_id ${runId}`);

      // Per-field accuracy
      const fieldStats: Record<string, { total: number; matched: number; missing_db: number; missing_ext: number; conflicts: number }> = {};
      for (const f of COMPARE_FIELDS) {
        fieldStats[f] = { total: 0, matched: 0, missing_db: 0, missing_ext: 0, conflicts: 0 };
      }

      for (const r of results) {
        const disc = r.field_discrepancies || {};
        for (const f of COMPARE_FIELDS) {
          const fd = disc[f];
          if (!fd) continue;
          fieldStats[f].total++;
          if (fd.match_core) fieldStats[f].matched++;
          else if (!fd.db && fd.snapshot_core) fieldStats[f].missing_db++;
          else if (fd.db && !fd.snapshot_core) fieldStats[f].missing_ext++;
          else fieldStats[f].conflicts++;
        }
      }

      const fieldAccuracy: Record<string, any> = {};
      for (const [field, stats] of Object.entries(fieldStats)) {
        fieldAccuracy[field] = {
          accuracy: stats.total > 0 ? (stats.matched / stats.total).toFixed(4) : "N/A",
          ...stats,
        };
      }

      // Sort by accuracy ascending (worst first)
      const ranked = Object.entries(fieldAccuracy)
        .filter(([_, v]) => v.total > 0)
        .sort((a, b) => Number(a[1].accuracy) - Number(b[1].accuracy));

      return new Response(JSON.stringify({
        action: "report",
        run_id: runId,
        vehicle_count: results.length,
        overall_accuracy: (results.reduce((s, r) => s + Number(r.accuracy_score || 0), 0) / results.length).toFixed(4),
        field_accuracy_ranked: ranked.map(([f, v]) => ({ field: f, ...v })),
        bucket_breakdown: Object.entries(
          results.reduce((acc: Record<string, any>, r: any) => {
            const b = r.bucket || "unknown";
            if (!acc[b]) acc[b] = { count: 0, total_accuracy: 0 };
            acc[b].count++;
            acc[b].total_accuracy += Number(r.accuracy_score || 0);
            return acc;
          }, {})
        ).map(([b, v]: [string, any]) => ({ bucket: b, count: v.count, avg_accuracy: (v.total_accuracy / v.count).toFixed(4) })),
        duration_ms: Date.now() - startTime,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── RUN action ───────────────────────────────────────────────
    const runId = crypto.randomUUID();

    // Sample vehicles that have matching snapshots
    // Use simple random sampling since we can't do window functions via PostgREST
    const { data: sampled, error: sampleErr } = await supabase
      .from("vehicles")
      .select("id, discovery_url, bat_auction_url, sale_price, reserve_status")
      .eq("listing_source", "bat")
      .eq("status", "active")
      .not("bat_auction_url", "is", null)
      .limit(sampleSize * 3); // oversample, then filter

    if (sampleErr) throw new Error(`Sampling failed: ${sampleErr.message}`);

    // Shuffle and bucket
    const allCandidates = (sampled || []).sort(() => Math.random() - 0.5);
    const bucketMap = new Map<string, any[]>();

    for (const v of allCandidates) {
      const bucket = v.sale_price == null ? "no_price" :
        v.sale_price < 10000 ? "under_10k" :
        v.sale_price < 50000 ? "10k_50k" :
        v.sale_price < 100000 ? "50k_100k" :
        v.sale_price < 500000 ? "100k_500k" : "over_500k";

      if (!bucketMap.has(bucket)) bucketMap.set(bucket, []);
      const arr = bucketMap.get(bucket)!;
      if (arr.length < Math.ceil(sampleSize / Math.max(bucketMap.size, 1)) + 3) {
        arr.push({
          vehicle_id: v.id,
          listing_url: v.bat_auction_url || v.discovery_url,
          bucket,
        });
      }
    }

    // Flatten and limit to sampleSize
    const vehicles: any[] = [];
    for (const [_, items] of bucketMap) {
      vehicles.push(...items);
    }
    vehicles.splice(sampleSize);
    if (!vehicles.length) throw new Error("No vehicles found matching criteria");

    // Process each vehicle
    const results: any[] = [];
    const CONCURRENCY = 5;

    async function processVehicle(item: any) {
      try {
        const { vehicle_id, listing_url, bucket } = item;

        // 1. Get DB state
        const { data: vehicle } = await supabase
          .from("vehicles")
          .select("id, year, make, model, vin, mileage, color, interior_color, transmission, drivetrain, engine_size, body_style, sale_price, high_bid, reserve_status, auction_end_date, bat_seller, bat_buyer, bat_location, bat_lot_number, bat_bids, bat_comments, bat_views, bat_watchers, description, listing_title, discovery_url")
          .eq("id", vehicle_id)
          .single();

        if (!vehicle) return;

        const dbState = dbToComparable(vehicle);

        // 2. Get snapshot HTML — try multiple URL variants
        const urlCandidates = new Set([listing_url]);
        if (listing_url.endsWith("/")) urlCandidates.add(listing_url.slice(0, -1));
        else urlCandidates.add(listing_url + "/");
        // Also try discovery_url if different
        if (vehicle.discovery_url) {
          urlCandidates.add(vehicle.discovery_url);
          if (vehicle.discovery_url.endsWith("/")) urlCandidates.add(vehicle.discovery_url.slice(0, -1));
          else urlCandidates.add(vehicle.discovery_url + "/");
        }

        // Find snapshot — HTML may be in storage (html_storage_path), not in DB column
        let snapRow: any = null;
        for (const candidateUrl of urlCandidates) {
          const { data: s } = await supabase
            .from("listing_page_snapshots")
            .select("id, html, html_storage_path")
            .eq("platform", "bat")
            .eq("success", true)
            .eq("listing_url", candidateUrl)
            .order("fetched_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (s) { snapRow = s; break; }
        }

        if (!snapRow) return;

        // Get HTML from storage if not in DB column
        let snapshotHtml = snapRow.html ?? null;
        if (!snapshotHtml && snapRow.html_storage_path) {
          try {
            const { data: blob } = await supabase.storage
              .from("listing-snapshots")
              .download(snapRow.html_storage_path);
            if (blob) snapshotHtml = await blob.text();
          } catch (_) { /* storage read failed */ }
        }

        if (!snapshotHtml || snapshotHtml.length < 1000) return;
        const snap = { ...snapRow, html: snapshotHtml };

        // 3. Run BOTH parsers on the snapshot HTML
        const identity = extractTitleIdentity(snap.html, listing_url);
        const essentials = extractEssentials(snap.html);
        const desc = extractDescription(snap.html);
        const bodyStyle = essentials.body_style || inferBodyStyleFromTitle(identity.title);
        const inferredColors = inferColorsFromDescription(desc);
        const bestExterior = essentials.exterior_color || inferredColors.exterior_color;
        const bestInterior = essentials.interior_color || inferredColors.interior_color;

        const coreExtracted = coreToComparable(identity, { ...essentials, exterior_color: bestExterior, interior_color: bestInterior }, desc, bodyStyle);
        const simpleExtracted = simpleToComparable(parseBaTHTML(snap.html));

        // 4. Compare field by field
        const discrepancies: Record<string, FieldComparison> = {};
        let matchedFields = 0;
        let totalFields = 0;

        for (const field of COMPARE_FIELDS) {
          const dbVal = dbState[field];
          const coreVal = coreExtracted[field];
          const simpleVal = simpleExtracted[field];

          // Skip fields where both DB and extraction are null
          if (dbVal === null && coreVal === null && simpleVal === null) continue;

          totalFields++;
          const matchCore = fieldMatch(dbVal, coreVal);
          const matchSimple = fieldMatch(dbVal, simpleVal);

          if (matchCore) matchedFields++;

          discrepancies[field] = {
            db: dbVal,
            snapshot_core: coreVal,
            snapshot_simple: simpleVal,
            match_core: matchCore,
            match_simple: matchSimple,
          };
        }

        const accuracy = totalFields > 0 ? matchedFields / totalFields : 1;

        // 5. Store result
        await supabase.from("bat_test_results").insert({
          run_id: runId,
          vehicle_id,
          listing_url,
          bucket,
          db_state: dbState,
          snapshot_extracted: coreExtracted,
          live_extracted: simpleExtracted, // re-used for the simple parser output
          field_discrepancies: discrepancies,
          accuracy_score: accuracy,
        });

        results.push({
          vehicle_id,
          bucket,
          accuracy: accuracy.toFixed(4),
          fields_compared: totalFields,
          fields_matched: matchedFields,
          worst_fields: Object.entries(discrepancies)
            .filter(([_, v]) => !v.match_core && (v.db !== null || v.snapshot_core !== null))
            .map(([f, v]) => ({ field: f, db: v.db, extracted: v.snapshot_core }))
            .slice(0, 5),
        });
      } catch (e: any) {
        console.error(`Failed to process vehicle ${item.vehicle_id}:`, e?.message);
        results.push({ vehicle_id: item.vehicle_id, error: e?.message });
      }
    }

    // Process with concurrency control
    for (let i = 0; i < vehicles.length; i += CONCURRENCY) {
      const batch = vehicles.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processVehicle));
    }

    // Summary
    const successful = results.filter((r) => !r.error);
    const avgAccuracy = successful.length > 0
      ? successful.reduce((s, r) => s + Number(r.accuracy || 0), 0) / successful.length
      : 0;

    // Per-field summary across all vehicles
    const { data: runResults } = await supabase
      .from("bat_test_results")
      .select("field_discrepancies")
      .eq("run_id", runId);

    const fieldSummary: Record<string, { total: number; matched: number }> = {};
    for (const r of (runResults || [])) {
      const disc = r.field_discrepancies || {};
      for (const [f, v] of Object.entries(disc) as [string, any][]) {
        if (!fieldSummary[f]) fieldSummary[f] = { total: 0, matched: 0 };
        fieldSummary[f].total++;
        if (v.match_core) fieldSummary[f].matched++;
      }
    }

    const fieldAccuracyRanked = Object.entries(fieldSummary)
      .map(([f, v]) => ({
        field: f,
        accuracy: (v.matched / v.total).toFixed(4),
        matched: v.matched,
        total: v.total,
        mismatches: v.total - v.matched,
      }))
      .sort((a, b) => Number(a.accuracy) - Number(b.accuracy));

    return new Response(JSON.stringify({
      success: true,
      run_id: runId,
      vehicles_sampled: vehicles.length,
      vehicles_processed: successful.length,
      errors: results.filter((r) => r.error).length,
      overall_accuracy: avgAccuracy.toFixed(4),
      field_accuracy_ranked: fieldAccuracyRanked,
      hint: `Call with { "action": "report", "run_id": "${runId}" } for detailed breakdown`,
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
