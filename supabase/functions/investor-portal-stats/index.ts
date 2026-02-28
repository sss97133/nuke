/**
 * INVESTOR PORTAL STATS
 *
 * Returns live metrics for the investor offering portal.
 * Called after access code entry -- returns all template variables
 * needed to hydrate the investor deck markdown.
 *
 * Uses materialized views (refreshed every 15 min) for expensive aggregates.
 * Total query time: <50ms (down from >120s).
 *
 * GET /functions/v1/investor-portal-stats
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvestorStats {
  // Core counts
  vehicle_count: number;
  image_count: number;
  comment_count: number;
  bid_count: number;
  estimate_count: number;
  analysis_count: number;
  identity_count: number;
  org_count: number;
  user_profiles: number;
  observations_count: number;
  image_extractions: number;
  // Financial
  total_value: number;
  vehicles_with_price: number;
  // Infrastructure
  db_size_gb: number;
  table_count: number;
  edge_function_count: number;
  // Operational
  data_freshness_pct: number;
  daily_rate: number;
  // Queue
  queue_complete: number;
  queue_pending: number;
  queue_failed: number;
  // Meta
  generated_at: string;
}

async function getStats(): Promise<InvestorStats> {
  const dbUrl = Deno.env.get("NUKE_DB_POOL_URL") || Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) throw new Error("SUPABASE_DB_URL not set");

  const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
  const pool = new Pool(dbUrl, 1, true);
  const conn = await pool.connect();

  try {
    // All queries below are <1ms each (matviews + pg_class estimates)

    // 1. Big table estimates from pg_class (instant, ~0.5ms)
    const bigCounts = await conn.queryObject<{ relname: string; reltuples: number }>`
      SELECT relname, reltuples::bigint AS reltuples
      FROM pg_class
      WHERE relname IN (
        'vehicles', 'vehicle_images', 'auction_comments', 'bat_bids',
        'nuke_estimates', 'bat_user_profiles', 'vehicle_observations',
        'external_identities'
      )
    `;
    const pg: Record<string, number> = {};
    for (const row of bigCounts.rows) {
      pg[row.relname] = Number(row.reltuples);
    }

    // 2. Exact counts from materialized view (was 6.3s, now <0.1ms)
    const exactCounts = await conn.queryObject<{
      analysis_count: number;
      org_count: number;
      image_extractions: number;
      table_count: number;
    }>`
      SELECT analysis_count, org_count, image_extractions, table_count
      FROM mv_investor_exact_counts
      LIMIT 1
    `;
    const exact = exactCounts.rows[0];

    // 3. Financial + freshness + daily rate from materialized view (was 122s, now <0.1ms)
    const vehicleStats = await conn.queryObject<{
      vehicles_with_price: number;
      total_value: number;
      total_vehicles: number;
      updated_7d: number;
      daily_rate: number;
    }>`
      SELECT vehicles_with_price, total_value, total_vehicles, updated_7d, daily_rate
      FROM mv_investor_portal_stats
      LIMIT 1
    `;
    const vs = vehicleStats.rows[0];
    const data_freshness_pct = Number(vs.total_vehicles) > 0
      ? Math.round((Number(vs.updated_7d) / Number(vs.total_vehicles)) * 1000) / 10
      : 0;

    // 4. Queue health from materialized view (was 2.8s, now <0.1ms)
    const queueStats = await conn.queryObject<{
      queue_complete: number;
      queue_pending: number;
      queue_failed: number;
    }>`
      SELECT queue_complete, queue_pending, queue_failed
      FROM mv_investor_queue_counts
      LIMIT 1
    `;
    const qs = queueStats.rows[0];

    // 5. DB size (instant, ~1ms)
    const dbSize = await conn.queryObject<{ db_size_bytes: number }>`
      SELECT pg_database_size(current_database()) AS db_size_bytes
    `;
    const db_size_gb = Math.round(Number(dbSize.rows[0].db_size_bytes) / 1024 / 1024 / 1024 * 10) / 10;

    return {
      vehicle_count:      Number(pg["vehicles"] ?? 0),
      image_count:        Number(pg["vehicle_images"] ?? 0),
      comment_count:      Number(pg["auction_comments"] ?? 0),
      bid_count:          Number(pg["bat_bids"] ?? 0),
      estimate_count:     Number(pg["nuke_estimates"] ?? 0),
      identity_count:     Number(pg["external_identities"] ?? 0),
      user_profiles:      Number(pg["bat_user_profiles"] ?? 0),
      observations_count: Number(pg["vehicle_observations"] ?? 0),
      analysis_count:     Number(exact.analysis_count),
      org_count:          Number(exact.org_count),
      image_extractions:  Number(exact.image_extractions),
      table_count:        Number(exact.table_count),
      vehicles_with_price: Number(vs.vehicles_with_price),
      total_value:        Number(vs.total_value),
      data_freshness_pct,
      daily_rate:         Number(vs.daily_rate),
      queue_complete:     Number(qs.queue_complete),
      queue_pending:      Number(qs.queue_pending),
      queue_failed:       Number(qs.queue_failed),
      db_size_gb,
      edge_function_count: 310, // updated on deploy; filesystem count
      generated_at:       new Date().toISOString(),
    };
  } finally {
    conn.release();
    await pool.end();
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stats = await getStats();
    return new Response(JSON.stringify(stats), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("investor-portal-stats error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
