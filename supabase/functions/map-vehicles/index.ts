import { Pool } from "https://deno.land/x/postgres@v0.19.3/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  checkRateLimit,
  getClientIp,
  rateLimitHeaders,
  rateLimitResponse,
} from "../_shared/rateLimit.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RATE_LIMIT_CONFIG = {
  namespace: "map-vehicles",
  windowSeconds: 60,
  maxRequests: 120,
};

/**
 * map-vehicles — Event-centric map API
 *
 * Queries vehicle_location_observations (VLO) instead of vehicles table.
 * Each observation is a location event (listing, sighting, auction, sale) at a point in time.
 *
 * ── MODES ──────────────────────────────────────────────────────────────────────
 *
 * mode=state | mode=county
 *   Choropleth aggregates (existing mat views).
 *
 * mode=histogram
 *   Monthly event counts for timeline control.
 *   Params: bbox, min_confidence, time_start, time_end
 *   Returns: { buckets: [{ month: "2024-01", count: 1234 }, ...] }
 *
 * mode=points (default when bbox present)
 *   GeoJSON FeatureCollection from VLO joined to vehicles.
 *   zoom <= 8: server-side grid clusters
 *   zoom > 8:  individual event points
 *
 * ── PARAMS ─────────────────────────────────────────────────────────────────────
 *   bbox            "west,south,east,north"     default: continental US
 *   zoom            1-20                        default: 5
 *   min_confidence  0.0-1.0                     default: 0.70
 *   time_start      ISO timestamp               events after this
 *   time_end        ISO timestamp               events before this
 *   source          "bat,carsandbids"           comma-separated source_platform
 *   event_type      "listing,sighting,auction"  comma-separated
 *   make            "ford,chevrolet"            comma-separated
 *   year_min        integer
 *   year_max        integer
 *   price_min       integer (USD)
 *   price_max       integer (USD)
 *   limit           max features                default 5000, max 10000
 */

function clusterPrecision(zoom: number): number | null {
  if (zoom <= 4) return 0;
  if (zoom <= 6) return 1;
  if (zoom <= 8) return 2;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Rate limiting
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

    const url = new URL(req.url);
    // deno-lint-ignore no-explicit-any
    const params: Record<string, any> = {};
    url.searchParams.forEach((v, k) => { params[k] = v; });
    if (req.method === "POST") {
      try { Object.assign(params, await req.json()); } catch { /* no body */ }
    }

    const mode = params.mode ?? (params.bbox ? "points" : "state");

    // ── CHOROPLETH ──────────────────────────────────────────────────────────
    if (mode === "state" || mode === "county") {
      const { data, error } = await rlSupabase.rpc("get_vehicle_map_data", {
        p_level: mode,
      });
      if (error) throw error;
      return json(data, rlHdrs);
    }

    // ── Parse shared params ─────────────────────────────────────────────────
    const bboxStr = params.bbox ?? "-130,24,-66,50";
    const [west, south, east, north] = String(bboxStr).split(",").map(Number);
    if ([west, south, east, north].some(isNaN)) {
      return jsonError("Invalid bbox — expected 'west,south,east,north'", 400);
    }

    const minConfidence = Math.max(0, Math.min(1, parseFloat(params.min_confidence ?? "0.70")));
    const timeStart = params.time_start ?? null;
    const timeEnd = params.time_end ?? null;

    // Build shared WHERE conditions for VLO
    const conditions: string[] = [
      "vlo.latitude IS NOT NULL",
      "vlo.longitude IS NOT NULL",
    ];
    const args: unknown[] = [];
    let p = 1;

    conditions.push(`vlo.latitude  BETWEEN $${p++} AND $${p++}`); args.push(south, north);
    conditions.push(`vlo.longitude BETWEEN $${p++} AND $${p++}`); args.push(west, east);
    conditions.push(`vlo.confidence >= $${p++}`); args.push(minConfidence);

    if (timeStart) { conditions.push(`vlo.observed_at >= $${p++}`); args.push(timeStart); }
    if (timeEnd)   { conditions.push(`vlo.observed_at <= $${p++}`); args.push(timeEnd); }

    if (params.source) {
      const sources = String(params.source).split(",").map((s: string) => s.trim()).filter(Boolean);
      conditions.push(`vlo.source_platform = ANY($${p++})`);
      args.push(sources);
    }
    if (params.event_type) {
      const types = String(params.event_type).split(",").map((s: string) => s.trim()).filter(Boolean);
      conditions.push(`vlo.source_type = ANY($${p++})`);
      args.push(types);
    }

    const where = conditions.join(" AND ");

    const dbUrl = (Deno.env.get("NUKE_DB_POOL_URL") || Deno.env.get("SUPABASE_DB_URL"))!;
    const pool = new Pool(dbUrl, 1, true);
    const conn = await pool.connect();

    try {
      // ── HISTOGRAM MODE ──────────────────────────────────────────────────
      if (mode === "histogram") {
        const sql = `
          SELECT
            to_char(date_trunc('month', vlo.observed_at), 'YYYY-MM') AS month,
            COUNT(*)::int AS count
          FROM vehicle_location_observations vlo
          WHERE ${where}
          GROUP BY 1
          ORDER BY 1
        `;
        const { rows } = await conn.queryObject<{ month: string; count: number }>({
          text: sql, args,
        });

        return json({
          buckets: rows,
          meta: { min_confidence: minConfidence, bbox: [west, south, east, north] },
        }, rlHdrs);
      }

      // ── POINT / CLUSTER MODE ────────────────────────────────────────────
      const zoom = Math.max(1, Math.min(20, parseInt(params.zoom ?? "5", 10)));
      const precision = clusterPrecision(zoom);
      const clustered = precision !== null;
      const limit = Math.min(10000, parseInt(params.limit ?? "5000", 10));

      // Vehicle-level filters (applied via JOIN)
      const vConditions: string[] = [];
      const vArgs = [...args];
      let vp = p;

      if (params.make) {
        const makes = String(params.make).split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
        vConditions.push(`LOWER(v.make) = ANY($${vp++})`);
        vArgs.push(makes);
      }
      if (params.year_min) { vConditions.push(`v.year >= $${vp++}`); vArgs.push(parseInt(params.year_min)); }
      if (params.year_max) { vConditions.push(`v.year <= $${vp++}`); vArgs.push(parseInt(params.year_max)); }
      if (params.price_min) { vConditions.push(`v.sale_price >= $${vp++}`); vArgs.push(parseInt(params.price_min)); }
      if (params.price_max) { vConditions.push(`v.sale_price <= $${vp++}`); vArgs.push(parseInt(params.price_max)); }

      const vehicleJoin = vConditions.length > 0
        ? `JOIN vehicles v ON v.id = vlo.vehicle_id AND ${vConditions.join(" AND ")}`
        : `JOIN vehicles v ON v.id = vlo.vehicle_id`;

      // deno-lint-ignore no-explicit-any
      let features: any[] = [];
      let totalMatched = 0;

      if (clustered) {
        const sql = `
          SELECT
            ROUND(vlo.longitude::numeric, ${precision})::float8 AS lng,
            ROUND(vlo.latitude::numeric,  ${precision})::float8 AS lat,
            COUNT(*)::int AS count,
            array_agg(DISTINCT vlo.source_platform ORDER BY vlo.source_platform)
              FILTER (WHERE vlo.source_platform IS NOT NULL) AS sources,
            array_agg(DISTINCT vlo.source_type ORDER BY vlo.source_type) AS event_types,
            AVG(vlo.confidence)::float4 AS avg_confidence
          FROM vehicle_location_observations vlo
          ${vehicleJoin}
          WHERE ${where}
          GROUP BY 1, 2
          ORDER BY count DESC
          LIMIT $${vp}
        `;
        vArgs.push(limit);
        const { rows } = await conn.queryObject<{
          lng: number; lat: number; count: number;
          sources: string[] | null; event_types: string[] | null;
          avg_confidence: number;
        }>({ text: sql, args: vArgs });

        totalMatched = rows.reduce((s, r) => s + r.count, 0);
        features = rows.map(r => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
          properties: {
            cluster: true,
            count: r.count,
            sources: r.sources ?? [],
            event_types: r.event_types ?? [],
            avg_confidence: r.avg_confidence,
          },
        }));

      } else {
        const sql = `
          SELECT
            vlo.id::text               AS observation_id,
            vlo.vehicle_id::text       AS vehicle_id,
            vlo.longitude::float8      AS lng,
            vlo.latitude::float8       AS lat,
            vlo.source_type            AS event_type,
            vlo.source_platform        AS source,
            vlo.confidence             AS confidence,
            vlo.precision              AS loc_precision,
            vlo.observed_at            AS observed_at,
            vlo.location_text_raw      AS location,
            vlo.metadata               AS metadata,
            v.year, v.make, v.model,
            v.sale_price               AS price,
            v.primary_image_url        AS thumbnail,
            v.status                   AS vehicle_status
          FROM vehicle_location_observations vlo
          ${vehicleJoin}
          WHERE ${where}
          ORDER BY vlo.observed_at DESC NULLS LAST
          LIMIT $${vp}
        `;
        vArgs.push(limit);
        // deno-lint-ignore no-explicit-any
        const { rows } = await conn.queryObject<any>({ text: sql, args: vArgs });

        totalMatched = rows.length;
        features = rows.map((r: any) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
          properties: {
            observation_id: r.observation_id,
            vehicle_id: r.vehicle_id,
            event_type: r.event_type,
            source: r.source,
            confidence: r.confidence,
            precision: r.loc_precision,
            observed_at: r.observed_at,
            location: r.location,
            event_label: r.metadata?.event_type ?? r.event_type,
            year: r.year, make: r.make, model: r.model,
            price: r.price,
            thumbnail: r.thumbnail,
            vehicle_status: r.vehicle_status,
          },
        }));
      }

      return json({
        type: "FeatureCollection",
        features,
        meta: {
          total_matched: totalMatched,
          returned: features.length,
          zoom,
          clustered,
          min_confidence: minConfidence,
          bbox: [west, south, east, north],
        },
      }, rlHdrs);

    } finally {
      conn.release();
      await pool.end();
    }

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
