import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * feed-query — Server-side feed endpoint.
 *
 * Queries the `vehicle_valuation_feed` materialized view with server-side
 * filtering, keyset pagination, pre-resolved thumbnails, and auction state.
 *
 * Replaces the client-side filter-everything approach in CursorHomepage.tsx.
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
}

// Valid sort fields mapped to MV columns
const SORT_MAP: Record<string, { column: string; defaultDir: "asc" | "desc" }> = {
  newest:     { column: "created_at",  defaultDir: "desc" },
  oldest:     { column: "created_at",  defaultDir: "asc" },
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

serve(async (req) => {
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
    const sortKey = body.sort && SORT_MAP[body.sort] ? body.sort : "newest";
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

    // ----- Filters -----

    // Year range
    if (typeof body.year_min === "number" && Number.isFinite(body.year_min)) {
      query = query.gte("year", body.year_min);
    }
    if (typeof body.year_max === "number" && Number.isFinite(body.year_max)) {
      query = query.lte("year", body.year_max);
    }

    // Make (case-insensitive)
    if (body.makes && body.makes.length > 0 && body.makes.length <= 20) {
      // Upper-case the input to match MV convention (PORSCHE, BMW, etc.)
      const uppercased = body.makes.map((m) => m.toUpperCase().replace(/[%_'"\\]/g, ""));
      query = query.in("make", uppercased);
    }

    // Model (ilike substring for flexibility)
    if (body.models && body.models.length > 0 && body.models.length <= 10) {
      // Use OR filter for multiple models
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

    // ----- Full-text search -----
    if (body.q && body.q.trim()) {
      // Split into terms and require all to match (AND logic)
      const terms = body.q.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        const safe = term.replace(/[%_'"\\]/g, "");
        if (!safe) continue;
        // Search across make, model, series, vin
        query = query.or(
          `make.ilike.%${safe}%,model.ilike.%${safe}%,series.ilike.%${safe}%,vin.ilike.%${safe}%`,
        );
      }
    }

    // ----- Keyset pagination -----
    // Cursor format: "sortValue::vehicleId"
    if (body.cursor) {
      const [cursorVal, cursorId] = body.cursor.split("::");
      if (cursorVal && cursorId) {
        // For descending: get rows where sort < cursor OR (sort = cursor AND id > cursorId)
        // For ascending: get rows where sort > cursor OR (sort = cursor AND id > cursorId)
        // PostgREST doesn't support compound keyset natively, so we use a range filter
        // as an approximation and rely on the secondary sort for determinism.
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
      // Thumbnails: primary image per vehicle
      vehicleIds.length > 0
        ? supabase
            .from("vehicle_images")
            .select("vehicle_id, image_url, thumbnail_url, medium_url, variants")
            .in("vehicle_id", vehicleIds)
            .eq("is_primary", true)
            .limit(vehicleIds.length)
        : { data: [], error: null },
      // Live auction state from external_listings
      vehicleIds.length > 0
        ? supabase
            .from("external_listings")
            .select(
              "vehicle_id, current_bid, bid_count, listing_status, end_date, listing_url",
            )
            .in("vehicle_id", vehicleIds)
            .gt("end_date", new Date().toISOString())
            .order("updated_at", { ascending: false })
            .limit(vehicleIds.length * 2)
        : { data: [], error: null },
    ]);

    // Build lookup maps
    const thumbMap = new Map<string, any>();
    for (const img of thumbResult.data ?? []) {
      if (!thumbMap.has(img.vehicle_id)) {
        thumbMap.set(img.vehicle_id, img);
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

      // Resolve thumbnail URL (priority: thumbnail > medium > variants > image_url)
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

        // Auction state (from external_listings)
        auction_end_date: auction?.end_date ?? null,
        current_bid: auction?.current_bid ?? null,
        bid_count: auction?.bid_count ?? null,
        listing_status: auction?.listing_status ?? null,
        listing_url: auction?.listing_url ?? null,

        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    // ----- Build cursor for next page -----
    let next_cursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1] as any;
      const sortVal = lastItem[sortDef.column] ?? "";
      next_cursor = `${sortVal}::${lastItem.vehicle_id}`;
    }

    // ----- Stats (approximate for speed) -----
    // Use portfolio_stats_cache for unfiltered, or estimate for filtered
    let stats = {
      total_vehicles: feedItems.length,
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
        stats = {
          total_vehicles: cacheRow.total_vehicles ?? 0,
          total_value: cacheRow.total_value ?? 0,
          for_sale_count: cacheRow.for_sale_count ?? 0,
          active_auctions: cacheRow.active_auctions ?? 0,
          avg_price: cacheRow.avg_value ?? 0,
          vehicles_added_today: cacheRow.vehicles_added_today ?? 0,
          sales_count_today: cacheRow.sales_count_today ?? 0,
          sales_volume_today: cacheRow.sales_volume_today ?? 0,
        };
      }
    } catch {
      // Stats are best-effort
    }

    return json({
      items: feedItems,
      next_cursor,
      total_estimate: stats.total_vehicles,
      stats,
    });
  } catch (e: any) {
    console.error("[feed-query] Unhandled error:", e);
    return json({ error: e.message }, 500);
  }
});
