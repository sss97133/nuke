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
 *   Choropleth aggregates. Without time_start/time_end uses fast mat views.
 *   With time bounds, queries VLO directly using county_fips for temporal filtering.
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
      const choroplethTimeStart = params.time_start ?? null;
      const choroplethTimeEnd = params.time_end ?? null;

      // No time filter → fast materialized view path
      if (!choroplethTimeStart && !choroplethTimeEnd) {
        const { data, error } = await rlSupabase.rpc("get_vehicle_map_data", {
          p_level: mode,
        });
        if (error) throw error;
        return json(data, rlHdrs);
      }

      // Temporal query: aggregate VLO directly with time bounds
      const dbUrl = (Deno.env.get("NUKE_DB_POOL_URL") || Deno.env.get("SUPABASE_DB_URL"))!;
      const temporalPool = new Pool(dbUrl, 1, true);
      const temporalConn = await temporalPool.connect();
      try {
        await temporalConn.queryObject("SET LOCAL statement_timeout = '15s'");

        const tConditions: string[] = [
          "vlo.county_fips IS NOT NULL",
          "vlo.latitude IS NOT NULL",
          "vlo.longitude IS NOT NULL",
        ];
        const tArgs: unknown[] = [];
        let tp = 1;

        if (choroplethTimeStart) {
          tConditions.push(`vlo.observed_at >= $${tp++}`);
          tArgs.push(choroplethTimeStart);
        }
        if (choroplethTimeEnd) {
          tConditions.push(`vlo.observed_at <= $${tp++}`);
          tArgs.push(choroplethTimeEnd);
        }

        const tWhere = tConditions.join(" AND ");

        if (mode === "county") {
          // County temporal: aggregate by county_fips from VLO, DISTINCT ON vehicle_id
          const sql = `
            WITH vlo_county AS (
              SELECT DISTINCT ON (vlo.vehicle_id)
                vlo.vehicle_id,
                vlo.county_fips AS fips
              FROM vehicle_location_observations vlo
              WHERE ${tWhere}
              ORDER BY vlo.vehicle_id, vlo.confidence DESC, vlo.observed_at DESC
            )
            SELECT
              vc.fips,
              COUNT(*)::int AS count,
              SUM(COALESCE(v.sale_price, v.sold_price, 0)) AS value,
              ROUND(AVG(NULLIF(COALESCE(v.sale_price, v.sold_price, 0), 0)))::bigint AS avg
            FROM vlo_county vc
            JOIN vehicles v ON v.id = vc.vehicle_id AND v.deleted_at IS NULL
            GROUP BY vc.fips
          `;
          const { rows } = await temporalConn.queryObject<{
            fips: string; count: number; value: number; avg: number;
          }>({ text: sql, args: tArgs });

          const totalCount = rows.reduce((s, r) => s + r.count, 0);
          const totalValue = rows.reduce((s, r) => s + Number(r.value), 0);

          return json({
            level: "county",
            counties: rows.map(r => ({
              fips: r.fips, count: r.count, value: Number(r.value), avg: Number(r.avg),
            })),
            stats: { totalCount, totalValue, countyCount: rows.length },
            generated_at: new Date().toISOString(),
            temporal: true,
            time_start: choroplethTimeStart,
            time_end: choroplethTimeEnd,
          }, rlHdrs);

        } else {
          // State temporal: aggregate by state_fips (first 2 chars of county_fips)
          const sql = `
            WITH vlo_state AS (
              SELECT DISTINCT ON (vlo.vehicle_id)
                vlo.vehicle_id,
                LEFT(vlo.county_fips, 2) AS state_fips
              FROM vehicle_location_observations vlo
              WHERE ${tWhere}
              ORDER BY vlo.vehicle_id, vlo.confidence DESC, vlo.observed_at DESC
            )
            SELECT
              CASE vs.state_fips
                WHEN '01' THEN 'AL' WHEN '02' THEN 'AK' WHEN '04' THEN 'AZ'
                WHEN '05' THEN 'AR' WHEN '06' THEN 'CA' WHEN '08' THEN 'CO'
                WHEN '09' THEN 'CT' WHEN '10' THEN 'DE' WHEN '11' THEN 'DC'
                WHEN '12' THEN 'FL' WHEN '13' THEN 'GA' WHEN '15' THEN 'HI'
                WHEN '16' THEN 'ID' WHEN '17' THEN 'IL' WHEN '18' THEN 'IN'
                WHEN '19' THEN 'IA' WHEN '20' THEN 'KS' WHEN '21' THEN 'KY'
                WHEN '22' THEN 'LA' WHEN '23' THEN 'ME' WHEN '24' THEN 'MD'
                WHEN '25' THEN 'MA' WHEN '26' THEN 'MI' WHEN '27' THEN 'MN'
                WHEN '28' THEN 'MS' WHEN '29' THEN 'MO' WHEN '30' THEN 'MT'
                WHEN '31' THEN 'NE' WHEN '32' THEN 'NV' WHEN '33' THEN 'NH'
                WHEN '34' THEN 'NJ' WHEN '35' THEN 'NM' WHEN '36' THEN 'NY'
                WHEN '37' THEN 'NC' WHEN '38' THEN 'ND' WHEN '39' THEN 'OH'
                WHEN '40' THEN 'OK' WHEN '41' THEN 'OR' WHEN '42' THEN 'PA'
                WHEN '44' THEN 'RI' WHEN '45' THEN 'SC' WHEN '46' THEN 'SD'
                WHEN '47' THEN 'TN' WHEN '48' THEN 'TX' WHEN '49' THEN 'UT'
                WHEN '50' THEN 'VT' WHEN '51' THEN 'VA' WHEN '53' THEN 'WA'
                WHEN '54' THEN 'WV' WHEN '55' THEN 'WI' WHEN '56' THEN 'WY'
                ELSE vs.state_fips
              END AS code,
              COUNT(*)::int AS count,
              SUM(COALESCE(v.sale_price, v.sold_price, 0)) AS value,
              ROUND(AVG(NULLIF(COALESCE(v.sale_price, v.sold_price, 0), 0)))::bigint AS avg
            FROM vlo_state vs
            JOIN vehicles v ON v.id = vs.vehicle_id AND v.deleted_at IS NULL
            GROUP BY vs.state_fips
          `;
          const { rows } = await temporalConn.queryObject<{
            code: string; count: number; value: number; avg: number;
          }>({ text: sql, args: tArgs });

          const totalCount = rows.reduce((s, r) => s + r.count, 0);
          const totalValue = rows.reduce((s, r) => s + Number(r.value), 0);

          return json({
            level: "state",
            states: rows.map(r => ({
              code: r.code, count: r.count, value: Number(r.value), avg: Number(r.avg),
            })),
            stats: { totalCount, totalValue },
            generated_at: new Date().toISOString(),
            temporal: true,
            time_start: choroplethTimeStart,
            time_end: choroplethTimeEnd,
          }, rlHdrs);
        }
      } finally {
        temporalConn.release();
        await temporalPool.end();
      }
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
      await conn.queryObject("SET LOCAL statement_timeout = '15s'");

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
        const { rows } = await conn.queryObject<{
          observation_id: string; vehicle_id: string;
          lng: number; lat: number;
          event_type: string; source: string | null;
          confidence: number; loc_precision: string | null;
          observed_at: string; location: string | null;
          metadata: Record<string, unknown>;
          year: number | null; make: string | null; model: string | null;
          price: number | null; thumbnail: string | null;
          vehicle_status: string | null;
        }>({ text: sql, args: vArgs });

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
            event_label: (r.metadata as Record<string, unknown>)?.event_type ?? r.event_type,
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
