import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * feed-query — Server-side feed endpoint.
 *
 * Queries the `vehicle_valuation_feed` materialized view with server-side
 * filtering, keyset pagination, pre-resolved thumbnails, and auction state.
 *
 * Default sort (feed_rank) now boosts for-sale listings +50 points,
 * putting live inventory at the top of the feed.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedRequest {
  q?: string;
  year_min?: number;
  year_max?: number;
  makes?: string[];
  models?: string[];
  body_styles?: string[];
  price_min?: number;
  price_max?: number;
  is_4x4?: boolean;
  for_sale?: boolean;
  sold_only?: boolean;
  hide_sold?: boolean;
  has_images?: boolean;
  excluded_sources?: string[];
  sort?: string;
  direction?: "asc" | "desc";
  cursor?: string;
  limit?: number;
  zip?: string;
  radius_miles?: number;
  user_state?: string;
  // Quality controls — default ON, user can opt out
  include_non_auto?: boolean;   // false = hide boats/RVs/trailers/motorcycles
  include_no_photos?: boolean;  // false = hide items without photos
  include_dealers?: boolean;    // false = hide dealer listings (default false when no search)
  min_price?: number;           // quality floor (default 500)
}

// Valid sort fields mapped to MV columns
const SORT_MAP: Record<string, { column: string; defaultDir: "asc" | "desc" }> = {
  newest:     { column: "created_at",  defaultDir: "desc" },
  oldest:     { column: "created_at",  defaultDir: "asc" },
  updated:    { column: "updated_at",  defaultDir: "desc" },
  deal_score: { column: "deal_score",  defaultDir: "desc" },
  heat_score: { column: "heat_score",  defaultDir: "desc" },
  price_high: { column: "display_price", defaultDir: "desc" },
  price_low:  { column: "display_price", defaultDir: "asc" },
  year:       { column: "year",        defaultDir: "desc" },
  make:       { column: "make",        defaultDir: "asc" },
  mileage:    { column: "mileage",     defaultDir: "asc" },
  feed_rank:  { column: "feed_rank_score", defaultDir: "desc" },
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body: FeedRequest =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
    // Default to feed_rank (which now boosts for-sale listings)
    const sortKey = body.sort && SORT_MAP[body.sort] ? body.sort : "feed_rank";
    const sortDef = SORT_MAP[sortKey];
    const direction = body.direction === "asc" || body.direction === "desc"
      ? body.direction
      : sortDef.defaultDir;
    const ascending = direction === "asc";

    // ----- Build the query on vehicle_valuation_feed -----
    let query = supabase
      .from("vehicle_valuation_feed")
      .select(`
        vehicle_id,
        year, make, model, series, trim,
        transmission, drivetrain, body_style, canonical_body_style,
        mileage, vin,
        is_for_sale, sale_status, sale_date,
        created_at, updated_at,
        discovery_url, discovery_source, profile_origin, origin_organization_id,
        city, state, listing_location,
        canonical_vehicle_type, has_photos,
        display_price, price_source, is_sold,
        asking_price, sale_price, current_value,
        nuke_estimate, nuke_estimate_low, nuke_estimate_high, nuke_estimate_confidence,
        price_tier,
        deal_score, deal_score_label,
        heat_score, heat_score_label,
        is_record_price, segment_record_price,
        feed_rank_score
      `)
      .order(sortDef.column, { ascending })
      // Secondary sort by vehicle_id for stable keyset pagination
      .order("vehicle_id", { ascending: true });

    // ----- QUALITY GATES (default ON — curated experience) -----

    const isSearching = !!(body.q && body.q.trim());

    // Exclude non-automobile vehicle types unless explicitly requested
    if (body.include_non_auto !== true) {
      // Only show CAR, TRUCK, SUV, VAN, MINIVAN, or unclassified (null)
      query = query.or(
        "canonical_vehicle_type.in.(CAR,TRUCK,SUV,VAN,MINIVAN)," +
        "canonical_vehicle_type.is.null"
      );
    }

    // Block known non-auto makes (case-insensitive via RPC)
    // This catches null-type vehicles that slipped past classification.
    // When user is searching, we still block — if they want motorcycles
    // they can use include_non_auto=true.
    if (body.include_non_auto !== true) {
      // PostgREST .not().in() is case-sensitive, so we use uppercased make
      // column (MV uses COALESCE(canonical_name, make) which may be mixed case).
      // Block all known case variants:
      const NON_AUTO_MAKES = [
        // Motorcycles
        "YAMAHA", "HARLEY-DAVIDSON", "KAWASAKI", "SUZUKI", "DUCATI", "KTM",
        "TRIUMPH", "INDIAN", "HUSQVARNA", "APRILIA", "MOTO GUZZI", "MV AGUSTA",
        "NORTON", "BSA", "ROYAL ENFIELD", "BUELL", "ZERO MOTORCYCLES",
        // Motorcycles — mixed case variants in DB
        "Yamaha", "Harley-Davidson", "Harley-Davidson–Branded", "Harley",
        "Kawasaki", "Suzuki", "Ducati", "KTm", "Triumph", "Indian",
        "Husqvarna", "Aprilia", "Norton", "Buell",
        "yamaha", "harley-davidson", "kawasaki", "suzuki", "ducati",
        "triumph", "indian",
        // Off-road / ATV / UTV
        "POLARIS", "ARCTIC CAT", "CAN-AM", "ARCTIC",
        "Polaris", "Arctic Cat", "Can-Am", "Arctic",
        // Marine / Boats
        "SEA-DOO", "SEA RAY", "BAYLINER", "BOSTON WHALER", "GRUMMAN",
        "GLASTRON", "SKEETER", "TRACKER", "LUND", "RANGER BOATS",
        "MASTERCRAFT", "MALIBU BOATS", "CORRECT CRAFT", "CHAPARRAL",
        "Sea-Doo", "Sea Ray", "Bayliner", "Boston Whaler", "Grumman",
        "Glastron", "Skeeter", "Tracker", "Seadoo", "Sea",
        // RVs / Campers / Trailers
        "FLEETWOOD", "WINNEBAGO", "AIRSTREAM", "COACHMEN", "JAYCO",
        "KEYSTONE", "FOREST RIVER", "THOR", "NEWMAR", "TIFFIN",
        "HOLIDAY RAMBLER", "MONACO", "FLAGSTAFF", "COLEMAN", "STARCRAFT",
        "FEATHERLITE", "SUNDOWNER",
        "Fleetwood", "Winnebago", "Airstream", "Coachmen", "Jayco",
        "Keystone", "Forest River", "Thor", "Newmar", "Tiffin",
        "Flagstaff", "Coleman", "Starcraft", "Featherlite",
        // Farm equipment / Heavy equipment
        "JOHN DEERE", "KUBOTA", "CATERPILLAR", "BOBCAT", "CASE IH",
        "NEW HOLLAND", "MASSEY FERGUSON", "FARMALL", "ALLIS-CHALMERS",
        "OLIVER", "MINNEAPOLIS-MOLINE",
        "John Deere", "Kubota", "Caterpillar", "Bobcat", "Farmall",
        "Allis-Chalmers", "Oliver",
        // Medium & heavy duty trucks
        "FREIGHTLINER", "PETERBILT", "KENWORTH", "MACK", "HINO",
        "WESTERN STAR", "AUTOCAR", "CRANE CARRIER",
        "Freightliner", "Peterbilt", "Kenworth", "Mack", "Hino",
        "Western Star",
        // Aircraft
        "CESSNA", "PIPER", "BEECHCRAFT", "MOONEY", "CIRRUS",
        "Cessna", "Piper", "Beechcraft", "Mooney", "Cirrus",
        // Golf carts / utility
        "EZGO", "CLUB CAR", "CUSHMAN", "GEM",
        "Ezgo", "Club Car", "Cushman", "Club",
        // Snowmobiles
        "SKI-DOO", "Ski-Doo", "Skidoo",
      ];
      query = query.not("make", "in", `(${NON_AUTO_MAKES.join(",")})`);
    }

    // Dealer penalty: hide actual dealer listings from default feed.
    // Auction houses (BaT, Mecum, etc.) and marketplaces are NOT dealers.
    // When user is actively searching or sets include_dealers=true, show all.
    const showDealers = body.include_dealers === true || isSearching;
    if (!showDealers) {
      // Fetch actual dealer org IDs (business_type = 'dealer'), then exclude them
      const { data: dealerOrgs } = await supabase
        .from("organizations")
        .select("id")
        .eq("business_type", "dealer");
      const dealerIds = (dealerOrgs ?? []).map((o: any) => o.id);
      if (dealerIds.length > 0) {
        query = query.not(
          "origin_organization_id",
          "in",
          `(${dealerIds.join(",")})`,
        );
      }
    }

    // Quality floor: skip scam-price listings (default $500 minimum)
    const qualityMinPrice = body.min_price ?? 500;
    if (qualityMinPrice > 0 && body.price_min === undefined) {
      query = query.or(`display_price.gte.${qualityMinPrice},display_price.is.null`);
    }

    // ----- User Filters -----

    // Year range
    if (typeof body.year_min === "number" && Number.isFinite(body.year_min)) {
      query = query.gte("year", body.year_min);
    }
    if (typeof body.year_max === "number" && Number.isFinite(body.year_max)) {
      query = query.lte("year", body.year_max);
    }

    // Make filter — MV has mixed case (PONTIAC + Pontiac), so match both variants
    if (body.makes && body.makes.length > 0 && body.makes.length <= 20) {
      const toTitle = (s: string) =>
        s.toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase());
      const variants = body.makes.flatMap((m) => {
        const safe = m.replace(/[%_'"\\]/g, "");
        const upper = safe.toUpperCase();
        const title = toTitle(safe);
        return upper === title ? [upper] : [upper, title];
      });
      query = query.in("make", [...new Set(variants)]);
    }

    // Model (ilike substring for flexibility)
    if (body.models && body.models.length > 0 && body.models.length <= 10) {
      const modelFilters = body.models
        .map((m) => `model.ilike.%${m.replace(/[%_]/g, "")}%`)
        .join(",");
      query = query.or(modelFilters);
    }

    // Body style
    if (body.body_styles && body.body_styles.length > 0) {
      query = query.in("canonical_body_style", body.body_styles);
    }

    // Price range
    if (typeof body.price_min === "number" && Number.isFinite(body.price_min)) {
      query = query.gte("display_price", body.price_min);
    }
    if (typeof body.price_max === "number" && Number.isFinite(body.price_max)) {
      query = query.lte("display_price", body.price_max);
    }

    // 4x4 / AWD
    if (body.is_4x4 === true) {
      query = query.or(
        "drivetrain.ilike.%4wd%,drivetrain.ilike.%4x4%,drivetrain.ilike.%awd%",
      );
    }

    // For sale
    if (body.for_sale === true) {
      query = query.eq("is_for_sale", true);
    }

    // Sold only
    if (body.sold_only === true) {
      query = query.eq("is_sold", true);
    }

    // Hide sold
    if (body.hide_sold === true) {
      query = query.or("is_sold.is.null,is_sold.eq.false");
    }

    // Has images — default to only showing vehicles with photos in feed
    // Pass has_images=false explicitly to include vehicles without photos (e.g. search results)
    if (body.has_images !== false) {
      query = query.eq("has_photos", true);
    }

    // Excluded sources
    if (body.excluded_sources && body.excluded_sources.length > 0) {
      for (const src of body.excluded_sources) {
        const safe = src.replace(/[%_'"\\]/g, "");
        if (safe) {
          query = query.neq("discovery_source", safe === "dealer_sites" ? "dealer_site" : safe === "dealer_listings" ? "dealer_listing" : safe);
        }
      }
    }

    // ----- Full-text search -----
    if (body.q && body.q.trim()) {
      const terms = body.q.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        const safe = term.replace(/[%_'"\\]/g, "");
        if (!safe) continue;
        query = query.or(
          `make.ilike.%${safe}%,model.ilike.%${safe}%,series.ilike.%${safe}%,vin.ilike.%${safe}%`,
        );
      }
    }

    // ----- Keyset pagination -----
    if (body.cursor) {
      const [cursorVal, cursorId] = body.cursor.split("::");
      if (cursorVal && cursorId) {
        if (ascending) {
          query = query.or(
            `${sortDef.column}.gt.${cursorVal},and(${sortDef.column}.eq.${cursorVal},vehicle_id.gt.${cursorId})`,
          );
        } else {
          query = query.or(
            `${sortDef.column}.lt.${cursorVal},and(${sortDef.column}.eq.${cursorVal},vehicle_id.gt.${cursorId})`,
          );
        }
      }
    }

    // Limit + 1 to detect hasMore
    query = query.limit(limit + 1);

    // ----- Execute main query -----
    const { data: rawRows, error: queryError } = await query;

    if (queryError) {
      console.error("[feed-query] Query error:", queryError);
      return json({ error: queryError.message }, 500);
    }

    const rows = rawRows ?? [];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // ----- Enrich: thumbnails + auction state (parallel) -----
    const vehicleIds = items.map((r: any) => r.vehicle_id);

    const [thumbResult, auctionResult] = await Promise.all([
      vehicleIds.length > 0
        ? supabase
            .from("vehicle_images")
            .select("vehicle_id, image_url, thumbnail_url, medium_url, variants")
            .in("vehicle_id", vehicleIds)
            .eq("is_primary", true)
            .limit(vehicleIds.length)
        : { data: [], error: null },
      vehicleIds.length > 0
        ? supabase
            .from("vehicle_events")
            .select(
              "vehicle_id, current_price, bid_count, event_status, ended_at, source_url",
            )
            .in("vehicle_id", vehicleIds)
            .gt("ended_at", new Date().toISOString())
            .order("updated_at", { ascending: false })
            .limit(vehicleIds.length * 2)
        : { data: [], error: null },
    ]);

    const thumbMap = new Map<string, any>();
    for (const img of thumbResult.data ?? []) {
      if (!thumbMap.has(img.vehicle_id)) {
        thumbMap.set(img.vehicle_id, img);
      }
    }

    // Pass 2: For vehicles missing a primary image, fall back to first usable image
    const missingThumbIds = vehicleIds.filter((id: string) => !thumbMap.has(id));
    if (missingThumbIds.length > 0) {
      const { data: fallbackImages } = await supabase
        .rpc("get_first_images_for_vehicles", { vehicle_ids: missingThumbIds });
      for (const img of fallbackImages ?? []) {
        if (!thumbMap.has(img.vehicle_id)) {
          thumbMap.set(img.vehicle_id, img);
        }
      }
    }

    // Pass 3: For vehicles STILL missing, use vehicles.primary_image_url
    const stillMissingIds = vehicleIds.filter((id: string) => !thumbMap.has(id));
    if (stillMissingIds.length > 0) {
      const { data: vehicleRows } = await supabase
        .from("vehicles")
        .select("id, primary_image_url")
        .in("id", stillMissingIds)
        .not("primary_image_url", "is", null);
      for (const v of vehicleRows ?? []) {
        if (v.primary_image_url) {
          thumbMap.set(v.id, { vehicle_id: v.id, image_url: v.primary_image_url });
        }
      }
    }

    const auctionMap = new Map<string, any>();
    for (const listing of auctionResult.data ?? []) {
      if (!auctionMap.has(listing.vehicle_id)) {
        auctionMap.set(listing.vehicle_id, listing);
      }
    }

    // ----- Transform to response shape -----
    const feedItems = items.map((row: any) => {
      const thumb = thumbMap.get(row.vehicle_id);
      const auction = auctionMap.get(row.vehicle_id);

      let thumbnail_url: string | null = null;
      if (thumb) {
        thumbnail_url =
          thumb.thumbnail_url ||
          thumb.medium_url ||
          thumb.variants?.thumbnail ||
          thumb.variants?.medium ||
          thumb.image_url ||
          null;
      }

      // Build location string
      let location: string | null = null;
      if (row.city && row.state) {
        location = `${row.city}, ${row.state}`;
      } else if (row.state) {
        location = row.state;
      } else if (row.listing_location) {
        location = row.listing_location;
      }

      return {
        id: row.vehicle_id,
        year: row.year,
        make: row.make,
        model: row.model,
        series: row.series,
        trim: row.trim,
        vin: row.vin,
        mileage: row.mileage,
        body_style: row.body_style,
        canonical_body_style: row.canonical_body_style,
        transmission: row.transmission,
        drivetrain: row.drivetrain,

        display_price: row.display_price,
        price_source: row.price_source ?? "none",
        sale_price: row.sale_price,
        asking_price: row.asking_price,
        current_value: row.current_value,
        sale_date: row.sale_date,
        sale_status: row.sale_status,
        is_for_sale: row.is_for_sale ?? false,

        nuke_estimate: row.nuke_estimate,
        nuke_estimate_confidence: row.nuke_estimate_confidence,
        deal_score: row.deal_score,
        deal_score_label: row.deal_score_label,
        heat_score: row.heat_score,
        heat_score_label: row.heat_score_label,
        is_record_price: row.is_record_price ?? false,
        feed_rank_score: row.feed_rank_score,

        thumbnail_url,
        discovery_url: row.discovery_url,
        discovery_source: row.discovery_source,
        profile_origin: row.profile_origin,
        origin_organization_id: row.origin_organization_id,

        // Location
        location,
        city: row.city,
        state: row.state,

        // Auction state (from vehicle_events)
        auction_end_date: auction?.ended_at ?? null,
        current_bid: auction?.current_price ?? null,
        bid_count: auction?.bid_count ?? null,
        listing_status: auction?.event_status ?? null,
        listing_url: auction?.source_url ?? null,

        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    // No longer filtering out vehicles without thumbnails — the two-pass
    // image resolution (primary + fallback RPC) handles missing primaries,
    // and CardImage.tsx renders "NO PHOTO" gracefully for any remaining edge cases.
    const filteredFeedItems = feedItems;

    // ----- Build cursor for next page -----
    let next_cursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1] as any;
      const sortVal = lastItem[sortDef.column] ?? "";
      next_cursor = `${sortVal}::${lastItem.vehicle_id}`;
    }

    // ----- Stats -----
    let stats = {
      total_vehicles: filteredFeedItems.length,
      total_value: 0,
      for_sale_count: 0,
      active_auctions: 0,
      avg_price: 0,
      vehicles_added_today: 0,
      sales_count_today: 0,
      sales_volume_today: 0,
    };

    try {
      const { data: cacheRow } = await supabase
        .from("portfolio_stats_cache")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (cacheRow) {
        const totalVehicles = cacheRow.total_vehicles ?? 0;
        const totalValue = cacheRow.total_value ?? 0;
        // avg_value is often 0/null in the cache — compute from totals when needed
        const avgPrice = (cacheRow.avg_value && cacheRow.avg_value > 0)
          ? cacheRow.avg_value
          : (totalVehicles > 0 ? Math.round(totalValue / totalVehicles) : 0);
        stats = {
          total_vehicles: totalVehicles,
          total_value: totalValue,
          for_sale_count: cacheRow.for_sale_count ?? 0,
          active_auctions: cacheRow.active_auctions ?? 0,
          avg_price: avgPrice,
          vehicles_added_today: cacheRow.vehicles_added_today ?? 0,
          sales_count_today: cacheRow.sales_count_today ?? 0,
          sales_volume_today: cacheRow.sales_volume_today ?? 0,
        };
      }
    } catch {
      // Stats are best-effort
    }

    return json({
      items: filteredFeedItems,
      next_cursor,
      total_estimate: stats.total_vehicles,
      stats,
    });
  } catch (e: any) {
    console.error("[feed-query] Unhandled error:", e);
    return json({ error: e.message }, 500);
  }
});
