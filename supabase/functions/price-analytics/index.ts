/**
 * PRICE ANALYTICS
 *
 * Queries clean_vehicle_prices materialized view for grouped analytics.
 * Returns count, median, p25, p75, mean, std_dev, total_value, sell-through rate.
 *
 * POST /functions/v1/price-analytics
 * Body: {
 *   "group_by": "make" | "model" | "year" | "make_year" | "make_model",
 *   "make"?: string,
 *   "model"?: string,
 *   "year_min"?: number,
 *   "year_max"?: number,
 *   "min_count"?: number,  // default 5
 *   "limit"?: number,      // default 50
 *   "sort_by"?: "count" | "median" | "total_value" | "mean",
 *   "sort_dir"?: "asc" | "desc"
 * }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    const groupBy = body.group_by || "make";
    const filterMake = body.make || null;
    const filterModel = body.model || null;
    const yearMin = body.year_min || null;
    const yearMax = body.year_max || null;
    const minCount = body.min_count ?? 5;
    const limit = Math.min(body.limit ?? 50, 500);
    const sortBy = body.sort_by || "count";
    const sortDir = body.sort_dir || "desc";

    // Build GROUP BY clause
    let groupExpr: string;
    let selectFields: string;
    switch (groupBy) {
      case "model":
        groupExpr = "make, model";
        selectFields = "make, model";
        break;
      case "year":
        groupExpr = "year";
        selectFields = "year";
        break;
      case "make_year":
        groupExpr = "make, year";
        selectFields = "make, year";
        break;
      case "make_model":
        groupExpr = "make, model";
        selectFields = "make, model";
        break;
      default: // "make"
        groupExpr = "make";
        selectFields = "make";
    }

    // Build WHERE filters
    const conditions: string[] = [];
    if (filterMake && typeof filterMake === 'string') {
      const safeMake = filterMake.slice(0, 50).replace(/'/g, "''").replace(/\\/g, '');
      conditions.push(`make = '${safeMake}'`);
    }
    if (filterModel && typeof filterModel === 'string') {
      const safeModel = filterModel.slice(0, 50).replace(/'/g, "''").replace(/\\/g, '');
      conditions.push(`model ILIKE '%${safeModel}%'`);
    }
    if (yearMin) {
      const y = parseInt(yearMin, 10);
      if (!isNaN(y) && y >= 1800 && y <= 2100) conditions.push(`year >= ${y}`);
    }
    if (yearMax) {
      const y = parseInt(yearMax, 10);
      if (!isNaN(y) && y >= 1800 && y <= 2100) conditions.push(`year <= ${y}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Validate sort
    const validSorts = ["count", "median", "total_value", "mean", "std_dev"];
    const safeSortBy = validSorts.includes(sortBy) ? sortBy : "count";
    const safeSortDir = sortDir === "asc" ? "ASC" : "DESC";

    const sql = `
      SELECT
        ${selectFields},
        count(*) AS count,
        count(*) FILTER (WHERE is_sold) AS sold_count,
        ROUND(count(*) FILTER (WHERE is_sold)::numeric / GREATEST(count(*), 1) * 100, 1) AS sell_through_pct,
        ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS median,
        ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS p25,
        ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS p75,
        ROUND(avg(best_price)::numeric, 0) AS mean,
        ROUND(stddev_pop(best_price)::numeric, 0) AS std_dev,
        ROUND(sum(best_price)::numeric, 0) AS total_value,
        ROUND(min(best_price)::numeric, 0) AS min_price,
        ROUND(max(best_price)::numeric, 0) AS max_price,
        min(year) AS year_min,
        max(year) AS year_max
      FROM clean_vehicle_prices
      ${whereClause}
      GROUP BY ${groupExpr}
      HAVING count(*) >= ${Math.max(1, Math.min(parseInt(String(minCount), 10) || 5, 1000))}
      ORDER BY ${safeSortBy} ${safeSortDir} NULLS LAST
      LIMIT ${Math.max(1, Math.min(parseInt(String(limit), 10) || 50, 500))}
    `;

    const { data: results, error } = await supabase.rpc("execute_sql", {
      query: sql,
    });

    if (error) throw error;

    // Get total summary
    const { data: summary } = await supabase.rpc("execute_sql", {
      sql: `
        SELECT
          count(*) AS total_vehicles,
          count(*) FILTER (WHERE is_sold) AS total_sold,
          ROUND(avg(best_price)::numeric, 0) AS overall_mean,
          ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS overall_median,
          ROUND(sum(best_price)::numeric, 0) AS total_market_value,
          count(DISTINCT make) AS distinct_makes
        FROM clean_vehicle_prices
        ${whereClause}
      `,
    });

    return new Response(
      JSON.stringify(
        {
          success: true,
          group_by: groupBy,
          filters: { make: filterMake, model: filterModel, year_min: yearMin, year_max: yearMax },
          result_count: results?.length ?? 0,
          summary: summary?.[0] ?? {},
          results: results ?? [],
        },
        null,
        2
      ),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[price-analytics] Error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
