import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
  rateLimitResponse,
} from "../_shared/rateLimit.ts";

const RATE_LIMIT_CONFIG = {
  namespace: "map-vehicles",
  windowSeconds: 60,
  maxRequests: 120, // 120 map tile requests per minute per IP
};

/**
 * map-vehicles
 *
 * Two modes:
 *
 * ── CHOROPLETH MODE ──────────────────────────────────────────────────────────
 * GET /map-vehicles?mode=state
 * GET /map-vehicles?mode=county
 *   Returns { level, states|counties: [{ code|fips, count, value, avg }] }
 *   Backed by vehicle_map_state_data / vehicle_map_county_data mat views.
 *   Used for filled choropleth layers (join with TIGER boundary GeoJSON on frontend).
 *
 * ── POINT / CLUSTER MODE ─────────────────────────────────────────────────────
 * GET /map-vehicles?bbox=west,south,east,north&zoom=6[&source=bat,cl&status=sold&...]
 *   Returns GeoJSON FeatureCollection.
 *   zoom ≤ 8: server-side ROUND()-based grid clustering
 *             → { cluster:true, count, sources:[] }
 *   zoom > 8: individual vehicle points
 *             → { id, year, make, model, status, price, source, location,
 *                 thumbnail, type }
 *
 * Point mode filters:
 *   bbox        "west,south,east,north"   default: continental US
 *   zoom        1–20                      default: 5
 *   source      "bat,carsandbids,cl"      comma-separated listing_source
 *   status      "sold,active"             comma-separated
 *   year_min    integer
 *   year_max    integer
 *   make        "ford,chevrolet"          comma-separated, case-insensitive
 *   price_min   integer (USD)
 *   price_max   integer (USD)
 *   type        canonical_vehicle_type
 *   limit       max features              default 5000, max 10000
 */

// Decimal places for ROUND()-based clustering
function clusterPrecision(zoom: number): number | null {
  if (zoom <= 4) return 0;   // ~111 km grid
  if (zoom <= 6) return 1;   // ~11 km grid
  if (zoom <= 8) return 2;   // ~1.1 km grid
  return null;               // individual points
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Rate limiting ────────────────────────────────────────────────────────
    const rlSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const clientIp = getClientIp(req);
    const rl = await checkRateLimit(rlSupabase, clientIp, RATE_LIMIT_CONFIG);
    if (!rl.allowed) {
      return rateLimitResponse(rl, corsHeaders, RATE_LIMIT_CONFIG.maxRequests);
    }
    const rlHdrs = rateLimitHeaders(rl, RATE_LIMIT_CONFIG.maxRequests);
    // ────────────────────────────────────────────────────────────────────────

    const url = new URL(req.url);
    // deno-lint-ignore no-explicit-any
    const params: Record<string, any> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });
    if (req.method === "POST") {
      try { Object.assign(params, await req.json()); } catch { /* no body */ }
    }

    // Route to mode
    const mode = params.mode ?? (params.bbox ? "points" : "state");

    // ── CHOROPLETH MODE ──────────────────────────────────────────────────────
    if (mode === "state" || mode === "county") {
      const supabase = rlSupabase;
      const { data, error } = await supabase.rpc("get_vehicle_map_data", {
        p_level: mode,
      });
      if (error) throw error;
      return json(data, rlHdrs);
    }

    // ── POINT / CLUSTER MODE ─────────────────────────────────────────────────
    const bboxStr = params.bbox ?? "-130,24,-66,50";
    const [west, south, east, north] = String(bboxStr).split(",").map(Number);
    if ([west, south, east, north].some(isNaN)) {
      return jsonError("Invalid bbox — expected 'west,south,east,north'", 400);
    }

    const zoom = Math.max(1, Math.min(20, parseInt(params.zoom ?? "5", 10)));
    const precision = clusterPrecision(zoom);
    const clustered = precision !== null;
    const limit = Math.min(10000, parseInt(params.limit ?? "5000", 10));

    // Build WHERE clause with parameterized args
    const conditions: string[] = [
      "gps_latitude IS NOT NULL",
      "gps_longitude IS NOT NULL",
      "status NOT IN ('deleted', 'merged', 'rejected', 'duplicate')",
    ];
    const args: unknown[] = [];
    let p = 1;

    conditions.push(`gps_latitude  BETWEEN $${p++} AND $${p++}`); args.push(south, north);
    conditions.push(`gps_longitude BETWEEN $${p++} AND $${p++}`); args.push(west, east);

    if (params.source) {
      const sources = String(params.source).split(",").map(s => s.trim()).filter(Boolean);
      conditions.push(`listing_source = ANY($${p++})`);
      args.push(sources);
    }
    if (params.status) {
      const statuses = String(params.status).split(",").map(s => s.trim()).filter(Boolean);
      conditions.push(`status = ANY($${p++})`);
      args.push(statuses);
    }
    if (params.make) {
      const makes = String(params.make).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      conditions.push(`LOWER(make) = ANY($${p++})`);
      args.push(makes);
    }
    if (params.year_min) { conditions.push(`year >= $${p++}`);       args.push(parseInt(params.year_min)); }
    if (params.year_max) { conditions.push(`year <= $${p++}`);       args.push(parseInt(params.year_max)); }
    if (params.price_min) { conditions.push(`sale_price >= $${p++}`); args.push(parseInt(params.price_min)); }
    if (params.price_max) { conditions.push(`sale_price <= $${p++}`); args.push(parseInt(params.price_max)); }
    if (params.type) { conditions.push(`canonical_vehicle_type = $${p++}`); args.push(params.type); }

    const where = conditions.join(" AND ");

    const dbUrl = (Deno.env.get("NUKE_DB_POOL_URL") || Deno.env.get("SUPABASE_DB_URL"))!;
    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();

    // deno-lint-ignore no-explicit-any
    let features: any[] = [];
    let totalMatched = 0;

    try {
      if (clustered) {
        const sql = `
          SELECT
            ROUND(gps_longitude::numeric, ${precision})::float8  AS lng,
            ROUND(gps_latitude::numeric,  ${precision})::float8  AS lat,
            COUNT(*)::int                                         AS count,
            array_agg(DISTINCT listing_source ORDER BY listing_source)
              FILTER (WHERE listing_source IS NOT NULL)           AS sources
          FROM vehicles
          WHERE ${where}
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT $${p}
        `;
        args.push(limit);
        const { rows } = await conn.queryObject<{
          lng: number; lat: number; count: number; sources: string[] | null;
        }>({ text: sql, args });

        totalMatched = rows.reduce((s, r) => s + r.count, 0);
        features = rows.map(r => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
          properties: { cluster: true, count: r.count, sources: r.sources ?? [] },
        }));

      } else {
        const sql = `
          SELECT
            id::text               AS id,
            gps_longitude::float8  AS lng,
            gps_latitude::float8   AS lat,
            year, make, model, status,
            sale_price             AS price,
            listing_source         AS source,
            listing_location       AS location,
            primary_image_url      AS thumbnail,
            canonical_vehicle_type AS type
          FROM vehicles
          WHERE ${where}
          ORDER BY sale_price DESC NULLS LAST
          LIMIT $${p}
        `;
        args.push(limit);
        const { rows } = await conn.queryObject<{
          id: string; lng: number; lat: number;
          year: number | null; make: string | null; model: string | null;
          status: string | null; price: number | null; source: string | null;
          location: string | null; thumbnail: string | null; type: string | null;
        }>({ text: sql, args });

        totalMatched = rows.length;
        features = rows.map(r => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
          properties: {
            id: r.id, year: r.year, make: r.make, model: r.model,
            status: r.status, price: r.price, source: r.source,
            location: r.location, thumbnail: r.thumbnail, type: r.type,
          },
        }));
      }
    } finally {
      conn.release();
      await pool.end();
    }

    return json({
      type: "FeatureCollection",
      features,
      meta: {
        total_matched: totalMatched,
        returned: features.length,
        zoom,
        clustered,
        bbox: [west, south, east, north],
      },
    }, rlHdrs);

  } catch (e) {
    console.error("map-vehicles error:", e);
    return jsonError(e instanceof Error ? e.message : String(e), 500);
  }
});

// deno-lint-ignore no-explicit-any
function json(data: any, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, ...extraHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
