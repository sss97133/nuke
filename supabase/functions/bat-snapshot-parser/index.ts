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

interface ParsedListing {
  chassis: string | null;
  vin_valid: boolean; // true if chassis is a valid 17-char VIN
  mileage: number | null;
  mileage_unit: string | null; // "miles" | "kilometers" | "TMU"
  engine: string | null;
  transmission: string | null;
  exterior_color: string | null;
  interior: string | null;
  location_raw: string | null;
  location_city: string | null;
  location_state: string | null;
  location_zip: string | null;
  party_type: string | null; // "Private Party" | "Dealer"
  lot_number: string | null;
  views: number | null;
  watchers: number | null;
  comment_count: number | null;
  sale_price: number | null;
  sale_currency: string | null;
  sale_date: string | null;
  sale_status: string | null; // "sold" | "bid_to" | "unsold"
  no_reserve: boolean;
  features: string[];
  item_title: string | null;
}

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

function parseBaTHTML(html: string): ParsedListing {
  const result: ParsedListing = {
    chassis: null, vin_valid: false,
    mileage: null, mileage_unit: null,
    engine: null, transmission: null,
    exterior_color: null, interior: null,
    location_raw: null, location_city: null, location_state: null, location_zip: null,
    party_type: null, lot_number: null,
    views: null, watchers: null, comment_count: null,
    sale_price: null, sale_currency: null, sale_date: null, sale_status: null,
    no_reserve: false, features: [], item_title: null,
  };

  // --- Chassis/VIN ---
  const chassisMatch = html.match(/Chassis:?\s*(?:<[^>]*>)*\s*([A-Za-z0-9*-]+(?:\s[A-Za-z0-9*-]+)*)/i);
  if (chassisMatch) {
    result.chassis = chassisMatch[1].trim().replace(/\s+/g, "");
    result.vin_valid = VIN_REGEX.test(result.chassis);
  }

  // --- Listing Details section (structured <li> items) ---
  const detailsMatch = html.match(/Listing Details<\/strong>\s*<ul>(.*?)<\/ul>/s);
  if (detailsMatch) {
    const items = detailsMatch[1].match(/<li>(.*?)<\/li>/gs) || [];
    for (const item of items) {
      const text = item.replace(/<[^>]+>/g, "").trim();

      // Chassis (already handled above but catch it here too)
      if (text.startsWith("Chassis:") && !result.chassis) {
        result.chassis = text.replace("Chassis:", "").trim();
        result.vin_valid = VIN_REGEX.test(result.chassis);
        continue;
      }

      // Mileage patterns
      const mileMatch = text.match(/([\d,]+)k?\s*(Miles?\s*(?:Shown|Indicated)?|Kilometers?|TMU)/i);
      if (mileMatch) {
        let miles = parseInt(mileMatch[1].replace(/,/g, ""));
        if (text.includes("k ") || text.includes("k\u00a0")) miles *= 1000;
        result.mileage = miles;
        result.mileage_unit = mileMatch[2].toLowerCase().includes("kilometer") ? "kilometers" :
                              mileMatch[2].toLowerCase().includes("tmu") ? "TMU" : "miles";
        continue;
      }

      // Exterior color — check BEFORE engine/interior to avoid false matches
      if (/exterior/i.test(text)) {
        result.exterior_color = text.replace(/exterior/i, "").trim();
        continue;
      }

      // Interior — check BEFORE engine to avoid leather/upholstery matching engine patterns
      if (/(?:interior|upholster)/i.test(text) && !result.interior) {
        result.interior = text;
        continue;
      }

      // Leather/cloth without "interior" keyword — still interior
      if (/(?:leather|cloth|alcantara|vinyl|suede)\s/i.test(text) && !result.interior && !/(?:liter|ci|cc|V\d)/i.test(text)) {
        result.interior = text;
        continue;
      }

      // Engine — require at least one strong engine indicator
      if (/(?:\d+[\.\d]*[-\s]*(?:liter|L\b)|(?:\d+)ci\b|\d+cc\b|(?:inline|flat|V)[-\s]*\d|turbo|supercharg)/i.test(text) && !result.engine) {
        result.engine = text;
        continue;
      }

      // Transmission
      if (/(?:manual|automatic|speed|CVT|DCT|PDK|tiptronic|sequential|gearbox|transmission)/i.test(text) && !result.transmission) {
        result.transmission = text;
        continue;
      }

      // No Reserve
      if (/no reserve/i.test(text)) {
        result.no_reserve = true;
        continue;
      }

      // Everything else is a feature
      result.features.push(text);
    }
  }

  // --- Location ---
  const locMatch = html.match(/Location:\s*<a[^>]*>([^<]+)<\/a>/i);
  if (locMatch) {
    result.location_raw = locMatch[1].trim();
    const locParts = result.location_raw.match(/^(.+?),\s*(\w[\w\s]*?)\s*(\d{5})?$/);
    if (locParts) {
      result.location_city = locParts[1].trim();
      result.location_state = locParts[2].trim();
      result.location_zip = locParts[3] || null;
    }
  }

  // --- Private Party or Dealer ---
  const partyMatch = html.match(/Private Party or Dealer:\s*(.*?)(?:<|$)/i);
  if (partyMatch) {
    result.party_type = partyMatch[1].replace(/<[^>]+>/g, "").trim();
  }

  // --- Lot number ---
  const lotMatch = html.match(/Lot<\/strong>\s*#?(\d+)/i);
  if (lotMatch) {
    result.lot_number = lotMatch[1];
  }

  // --- Views and watchers ---
  const viewsMatch = html.match(/data-stats-item="views"[^>]*>([\d,]+)\s*views/i);
  if (viewsMatch) result.views = parseInt(viewsMatch[1].replace(/,/g, ""));

  const watchMatch = html.match(/data-stats-item="watchers"[^>]*>([\d,]+)\s*watchers/i);
  if (watchMatch) result.watchers = parseInt(watchMatch[1].replace(/,/g, ""));

  // --- Comment count ---
  const commentMatch = html.match(/comments_header_html[^>]*>.*?class="info-value"[^>]*>(\d+)/s);
  if (commentMatch) result.comment_count = parseInt(commentMatch[1]);

  // --- Sale info ---
  const soldMatch = html.match(/Sold\s+for\s+<strong>(\w+)\s*\$?([\d,]+)<\/strong>\s*<span[^>]*>on\s+(\d+\/\d+\/\d+)/i);
  if (soldMatch) {
    result.sale_currency = soldMatch[1];
    result.sale_price = parseInt(soldMatch[2].replace(/,/g, ""));
    result.sale_date = soldMatch[3];
    result.sale_status = "sold";
  } else {
    const bidMatch = html.match(/Bid\s+to\s+<strong>(\w+)\s*\$?([\d,]+)<\/strong>\s*<span[^>]*>on\s+(\d+\/\d+\/\d+)/i);
    if (bidMatch) {
      result.sale_currency = bidMatch[1];
      result.sale_price = parseInt(bidMatch[2].replace(/,/g, ""));
      result.sale_date = bidMatch[3];
      result.sale_status = "bid_to";
    }
  }

  // Check for unsold status
  if (html.includes("status-unsold") || html.includes("Reserve Not Met")) {
    result.sale_status = result.sale_status || "unsold";
  }

  // --- Item title ---
  const titleMatch = html.match(/data-item-title="([^"]+)"/);
  if (titleMatch) result.item_title = titleMatch[1];

  return result;
}

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

    async function processItem(item: { snap: any; parsed: ParsedListing }) {
      const { snap, parsed } = item;
      const vehicle = vehicleMap.get(snap.listing_url);

      if (vehicle && !dryRun) {
        const updates: Record<string, any> = {};
        let fieldsUpdated = 0;

        if (parsed.vin_valid && parsed.chassis && !vehicle.vin) {
          updates.vin = parsed.chassis.toUpperCase();
          fieldsUpdated++;
        }
        if (parsed.mileage && !vehicle.mileage) {
          updates.mileage = parsed.mileage_unit === "kilometers"
            ? Math.round(parsed.mileage * 0.621371)
            : parsed.mileage;
          fieldsUpdated++;
        }
        if (parsed.engine && !vehicle.engine_type) {
          updates.engine_type = parsed.engine;
          fieldsUpdated++;
        }
        if (parsed.transmission && !vehicle.transmission) {
          updates.transmission = parsed.transmission;
          fieldsUpdated++;
        }
        if (parsed.exterior_color && !vehicle.color) {
          updates.color = parsed.exterior_color;
          fieldsUpdated++;
        }
        if (parsed.interior && !vehicle.interior_color) {
          updates.interior_color = parsed.interior;
          fieldsUpdated++;
        }
        if (parsed.sale_price && parsed.sale_status === "sold" && !vehicle.sale_price) {
          updates.sale_price = parsed.sale_price;
          fieldsUpdated++;
        }

        // Always store full parsed data in origin_metadata
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
        updates.origin_metadata = meta;

        const { error: updateErr } = await supabase
          .from("vehicles")
          .update(updates)
          .eq("id", vehicle.vehicle_id);
        if (!updateErr && fieldsUpdated > 0) {
          vehiclesUpdated++;
          fieldsEnriched += fieldsUpdated;
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
      total: snapshots.length,
      parsed: parsedItems.length,
      vins_found: vinsFound,
      vins_valid_17: vinsValid,
      vehicles_matched: vehicleMap.size,
      vehicles_updated: vehiclesUpdated,
      fields_enriched: fieldsEnriched,
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
