/**
 * BaT Snapshot Parser — Bulk extract structured data from archived HTML
 *
 * Parses listing_page_snapshots for BaT listings and extracts:
 * - VIN/chassis number
 * - Mileage
 * - Engine, transmission, drivetrain
 * - Exterior/interior colors
 * - Seller location (city, state, zip)
 * - Private party or dealer
 * - Lot number
 * - Views, watchers, comments
 * - Sale price, sale date, sold/unsold status
 * - Feature list (from Listing Details)
 *
 * Modes:
 *   process  — Parse unprocessed snapshots (default)
 *   stats    — Show parsing stats without processing
 *   single   — Parse one snapshot by ID
 *
 * Deploy: supabase functions deploy bat-snapshot-parser --no-verify-jwt
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  parseBaTHTML,
  extractTitleIdentity,
  extractEssentials,
  extractDescription,
  inferBodyStyleFromTitle,
  inferColorsFromDescription,
  type ParsedListing,
  BAT_PARSER_VERSION,
} from "../_shared/batParser.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import {
  batchUpsertWithProvenance,
  quarantineRecord,
  type ProvenanceMetadata,
} from "../_shared/batUpsertWithProvenance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "process";
    const limit = Math.min(Number(body.limit) || 50, 500);
    const snapshotId = body.snapshot_id || null;
    const dryRun = body.dry_run || false;

    // --- Stats mode ---
    if (mode === "stats") {
      const { data: stats } = await supabase.rpc("exec_sql", {
        query: `
          SELECT
            count(*) FILTER (WHERE platform = 'bat' AND success = true) as total_bat_snapshots,
            count(*) FILTER (WHERE platform = 'bat' AND success = true AND metadata->>'parsed_at' IS NOT NULL) as already_parsed,
            count(*) FILTER (WHERE platform = 'bat' AND success = true AND metadata->>'parsed_at' IS NULL) as unparsed
          FROM listing_page_snapshots
        `,
      });
      return new Response(JSON.stringify({ mode: "stats", stats, duration_ms: Date.now() - startTime }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Get snapshots to process ---
    let snapshots: any[] = [];

    if (mode === "single" && snapshotId) {
      const { data, error } = await supabase
        .from("listing_page_snapshots")
        .select("id, listing_url, html, metadata")
        .eq("id", snapshotId)
        .single();
      if (error) throw new Error(`Snapshot not found: ${error.message}`);
      snapshots = [data];
    } else {
      // Get IDs of unparsed BaT snapshots first (fast, no HTML)
      const { data: ids, error } = await supabase
        .from("listing_page_snapshots")
        .select("id")
        .eq("platform", "bat")
        .eq("success", true)
        .filter("metadata->>parsed_at", "is", "null")
        .order("fetched_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(`Query error: ${error.message}`);

      // Fetch HTML in sub-batches of 10 to avoid statement timeout
      const SUB_BATCH = 10;
      const allIds = (ids || []).map((r: any) => r.id);
      for (let i = 0; i < allIds.length; i += SUB_BATCH) {
        const chunk = allIds.slice(i, i + SUB_BATCH);
        const { data: rows, error: fetchErr } = await supabase
          .from("listing_page_snapshots")
          .select("id, listing_url, html, metadata")
          .in("id", chunk);
        if (fetchErr) {
          console.error(`[bat-parser] HTML fetch error batch ${i}:`, fetchErr.message);
          continue;
        }
        snapshots.push(...(rows || []));
      }
    }

    if (!snapshots.length) {
      return new Response(
        JSON.stringify({ mode, total: 0, message: "No unparsed BaT snapshots found", duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Parse all HTML ---
    const parsedItems: Array<{ snap: any; parsed: ParsedListing }> = [];
    let parseErrors = 0;
    let vinsFound = 0;
    let vinsValid = 0;

    for (const snap of snapshots) {
      if (!snap.html) { parseErrors++; continue; }
      const parsed = parseBaTHTML(snap.html);
      if (parsed.chassis) vinsFound++;
      if (parsed.vin_valid) vinsValid++;
      parsedItems.push({ snap, parsed });
    }

    // --- Batch match URLs to vehicles (lightweight SELECT-only RPC) ---
    const urls = parsedItems.map(p => p.snap.listing_url);
    const { data: matchedVehicles, error: matchErr } = await supabase.rpc("match_vehicles_by_urls", { urls });
    if (matchErr) console.error("[bat-parser] URL match RPC error:", matchErr.message);

    const vehicleMap = new Map<string, any>();
    for (const v of (matchedVehicles || [])) {
      vehicleMap.set(v.listing_url, v);
    }

    // --- Update vehicles and mark snapshots (parallel, 5 concurrent) ---
    let vehiclesUpdated = 0;
    let fieldsEnriched = 0;
    const CONCURRENCY = 5;
    const allDetails: any[] = [];

    // Tetris write stats
    let tetrisGapFills = 0;
    let tetrisConfirmations = 0;
    let tetrisConflicts = 0;
    let qualityRejections = 0;

    async function processItem(item: { snap: any; parsed: ParsedListing }) {
      const { snap, parsed } = item;
      const vehicle = vehicleMap.get(snap.listing_url);

      if (vehicle && !dryRun) {
        // Also run the full extractEssentials parser for richer extraction
        const identity = extractTitleIdentity(snap.html, snap.listing_url);
        const essentials = extractEssentials(snap.html);
        const desc = extractDescription(snap.html);
        const bodyStyle = essentials.body_style || inferBodyStyleFromTitle(identity.title);
        const inferredColors = inferColorsFromDescription(desc);

        // Build proposed fields from BOTH parsers (core parser is higher quality)
        const mileage = essentials.mileage || (parsed.mileage_unit === "kilometers" && parsed.mileage
          ? Math.round(parsed.mileage * 0.621371)
          : parsed.mileage);

        const proposedFields: Record<string, any> = {
          vin: essentials.vin || (parsed.vin_valid ? parsed.chassis?.toUpperCase() : null),
          mileage,
          engine_size: essentials.engine || parsed.engine,
          transmission: essentials.transmission || parsed.transmission,
          color: essentials.exterior_color || inferredColors.exterior_color || parsed.exterior_color,
          interior_color: essentials.interior_color || inferredColors.interior_color || parsed.interior,
          body_style: bodyStyle,
          drivetrain: essentials.drivetrain,
          sale_price: essentials.sale_price || (parsed.sale_status === "sold" ? parsed.sale_price : null),
          high_bid: essentials.high_bid || (parsed.sale_status === "bid_to" ? parsed.sale_price : null),
          reserve_status: essentials.reserve_status || (parsed.no_reserve ? "no_reserve" : null),
        };

        // Run quality gate on proposed data
        const gateInput = {
          year: identity.year || vehicle.year,
          make: identity.make || vehicle.make,
          model: identity.model || vehicle.model,
          ...proposedFields,
        };

        const gateResult = qualityGate(gateInput, { source: "bat", sourceType: "auction" });

        if (gateResult.action === "reject") {
          qualityRejections++;
          await quarantineRecord(
            supabase, vehicle.vehicle_id, snap.listing_url,
            BAT_PARSER_VERSION, gateResult.score, gateResult.issues,
          );
        } else {
          // Use Tetris write layer for gap-fill/confirm/conflict
          const defaultMetadata: ProvenanceMetadata = {
            extraction_version: BAT_PARSER_VERSION,
            extraction_method: "html_parse",
            source_url: snap.listing_url,
            confidence_score: 0.8,
            source_signal: "snapshot_parse",
          };

          // Filter out null proposed values before Tetris layer
          const cleanProposed: Record<string, any> = {};
          for (const [k, v] of Object.entries(proposedFields)) {
            if (v !== null && v !== undefined) cleanProposed[k] = v;
          }

          const { updatePayload, stats } = await batchUpsertWithProvenance(
            supabase, vehicle.vehicle_id, snap.listing_url,
            BAT_PARSER_VERSION, vehicle, cleanProposed, {}, defaultMetadata,
          );

          tetrisGapFills += stats.gap_fills;
          tetrisConfirmations += stats.confirmations;
          tetrisConflicts += stats.conflicts;

          // Also store full parsed data in origin_metadata
          const meta = vehicle.origin_metadata || {};
          meta.bat_snapshot_parsed = {
            chassis: parsed.chassis, vin_valid: parsed.vin_valid,
            mileage: parsed.mileage, mileage_unit: parsed.mileage_unit,
            engine: parsed.engine, transmission: parsed.transmission,
            exterior_color: parsed.exterior_color, interior: parsed.interior,
            location: parsed.location_raw, location_city: parsed.location_city,
            location_state: parsed.location_state, location_zip: parsed.location_zip,
            party_type: parsed.party_type, lot_number: parsed.lot_number,
            views: parsed.views, watchers: parsed.watchers,
            comment_count: parsed.comment_count, sale_price: parsed.sale_price,
            sale_currency: parsed.sale_currency, sale_date: parsed.sale_date,
            sale_status: parsed.sale_status, no_reserve: parsed.no_reserve,
            features: parsed.features, item_title: parsed.item_title,
            parsed_at: new Date().toISOString(), snapshot_id: snap.id,
          };
          updatePayload.origin_metadata = meta;

          if (Object.keys(updatePayload).length > 0) {
            const { error: updateErr } = await supabase
              .from("vehicles")
              .update(updatePayload)
              .eq("id", vehicle.vehicle_id);
            if (!updateErr && stats.gap_fills > 0) {
              vehiclesUpdated++;
              fieldsEnriched += stats.gap_fills;
            }
          }
        }
      }

      // Mark snapshot as parsed
      if (!dryRun) {
        await supabase
          .from("listing_page_snapshots")
          .update({
            metadata: {
              ...(snap.metadata || {}),
              parsed_at: new Date().toISOString(),
              parser_version: BAT_PARSER_VERSION,
              chassis: parsed.chassis,
              vin_valid: parsed.vin_valid,
              vehicle_matched: !!vehicle,
              vehicle_id: vehicle?.vehicle_id || null,
            },
          })
          .eq("id", snap.id);
      }

      allDetails.push({
        snapshot_id: snap.id, url: snap.listing_url,
        chassis: parsed.chassis, vin_valid: parsed.vin_valid,
        mileage: parsed.mileage,
        engine: parsed.engine?.substring(0, 40),
        sale: parsed.sale_status ? `${parsed.sale_status} $${parsed.sale_price}` : null,
        location: parsed.location_raw,
        vehicle_matched: !!vehicle,
        vehicle_id: vehicle?.vehicle_id,
      });
    }

    // Process with concurrency control
    for (let i = 0; i < parsedItems.length; i += CONCURRENCY) {
      const batch = parsedItems.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processItem));
    }

    const results = {
      mode,
      parser_version: BAT_PARSER_VERSION,
      total: snapshots.length,
      parsed: parsedItems.length,
      vins_found: vinsFound,
      vins_valid_17: vinsValid,
      vehicles_matched: vehicleMap.size,
      vehicles_updated: vehiclesUpdated,
      fields_enriched: fieldsEnriched,
      tetris: {
        gap_fills: tetrisGapFills,
        confirmations: tetrisConfirmations,
        conflicts: tetrisConflicts,
        quality_rejections: qualityRejections,
      },
      errors: parseErrors,
      details: allDetails.length <= 100 ? allDetails : allDetails.slice(0, 20).concat([{ note: `... and ${allDetails.length - 20} more` }]),
    };

    return new Response(
      JSON.stringify({ success: true, ...results, duration_ms: Date.now() - startTime }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err), duration_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
