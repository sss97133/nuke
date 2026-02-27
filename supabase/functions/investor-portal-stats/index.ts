/**
 * INVESTOR PORTAL STATS
 *
 * Returns live metrics for the investor offering portal.
 * Called after access code entry — returns all template variables
 * needed to hydrate the investor deck markdown.
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
    // 1. Big table estimates from pg_class (instant)
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

    // 2. Exact counts for smaller / analytically important tables
    const exactCounts = await conn.queryObject<{
      analysis_count: number;
      org_count: number;
      image_extractions: number;
      table_count: number;
    }>`
      SELECT
        (SELECT COUNT(*)::bigint FROM comment_discoveries)      AS analysis_count,
        (SELECT COUNT(*)::bigint FROM organizations WHERE status = 'active') AS org_count,
        (SELECT COUNT(*)::bigint FROM image_work_extractions)   AS image_extractions,
        (SELECT COUNT(*)::bigint FROM pg_stat_user_tables)      AS table_count
    `;
    const exact = exactCounts.rows[0];

    // 3. Financial metrics (SUM is indexed via sale_price)
    const financial = await conn.queryObject<{
      vehicles_with_price: number;
      total_value: number;
    }>`
      SELECT
        COUNT(*)::bigint               AS vehicles_with_price,
        COALESCE(SUM(sale_price), 0)   AS total_value
      FROM vehicles
      WHERE sale_price > 0
    `;
    const fin = financial.rows[0];

    // 4. Data freshness (% updated within 7 days)
    const freshness = await conn.queryObject<{
      total: number;
      updated_7d: number;
    }>`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days')::bigint AS updated_7d
      FROM vehicles
    `;
    const fr = freshness.rows[0];
    const data_freshness_pct = fr.total > 0
      ? Math.round((Number(fr.updated_7d) / Number(fr.total)) * 1000) / 10
      : 0;

    // 5. Daily ingestion rate
    const daily = await conn.queryObject<{ daily_rate: number }>`
      SELECT COUNT(*)::bigint AS daily_rate
      FROM vehicles
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;

    // 6. Queue health
    const queue = await conn.queryObject<{ status: string; cnt: number }>`
      SELECT status, COUNT(*)::bigint AS cnt
      FROM import_queue
      GROUP BY status
    `;
    const queueMap: Record<string, number> = {};
    for (const row of queue.rows) {
      queueMap[row.status] = Number(row.cnt);
    }

    // 7. DB size
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
      vehicles_with_price: Number(fin.vehicles_with_price),
      total_value:        Number(fin.total_value),
      data_freshness_pct,
      daily_rate:         Number(daily.rows[0].daily_rate),
      queue_complete:     queueMap["complete"] ?? 0,
      queue_pending:      queueMap["pending"] ?? 0,
      queue_failed:       queueMap["failed"] ?? 0,
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
