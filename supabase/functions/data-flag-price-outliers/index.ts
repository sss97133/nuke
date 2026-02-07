/**
 * DATA-FLAG-PRICE-OUTLIERS
 *
 * Per-make IQR-based outlier detection. Flags vehicles with unreasonable prices,
 * then refreshes the clean_vehicle_prices materialized view.
 *
 * POST /functions/v1/data-flag-price-outliers
 * Body: {
 *   "dry_run"?: boolean,
 *   "make"?: string,
 *   "iqr_multiplier"?: number  // default 3.0
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run ?? false;
    const targetMake = body.make ?? null;
    const iqrMultiplier = body.iqr_multiplier ?? 3.0;

    console.log(`[flag-outliers] dry_run=${dryRun}, make=${targetMake}, iqr=${iqrMultiplier}`);

    // Step 1: Reset existing outlier flags (unless dry run)
    if (!dryRun) {
      const resetQuery = supabase
        .from("vehicles")
        .update({ price_is_outlier: false, price_outlier_reason: null })
        .eq("price_is_outlier", true)
        .is("deleted_at", null);

      if (targetMake) resetQuery.eq("make", targetMake);
      await resetQuery;
    }

    // Step 2: Flag absolute outliers (>$25M or negative)
    const makeClause = targetMake ? `AND make = '${targetMake.replace(/'/g, "''")}'` : "";
    const { data: absoluteOutliers } = await supabase.rpc("execute_sql", {
      query: `SELECT id FROM vehicles WHERE deleted_at IS NULL AND price_is_outlier IS NOT true AND (COALESCE(sale_price, 0) > 25000000 OR COALESCE(sale_price, 0) < 0 OR COALESCE(winning_bid, 0) > 25000000 OR COALESCE(high_bid, 0) > 25000000 OR COALESCE(bat_sold_price, 0) > 25000000 OR COALESCE(asking_price, 0) > 25000000) ${makeClause}`,
    });

    let absoluteFlagged = 0;
    if (!dryRun && absoluteOutliers && Array.isArray(absoluteOutliers)) {
      const ids = absoluteOutliers.map((r: any) => r.id);
      if (ids.length > 0) {
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          await supabase
            .from("vehicles")
            .update({ price_is_outlier: true, price_outlier_reason: "absolute_cap" })
            .in("id", chunk);
        }
        absoluteFlagged = ids.length;
      }
    } else {
      absoluteFlagged = Array.isArray(absoluteOutliers) ? absoluteOutliers.length : 0;
    }

    console.log(`[flag-outliers] Absolute outliers: ${absoluteFlagged}`);

    // Step 3: Per-make IQR-based outlier detection — single query finds ALL outliers
    const makeFilter = targetMake
      ? `AND COALESCE(cm.canonical_name, v.make) = '${targetMake.replace(/'/g, "''")}'`
      : "";

    const { data: iqrOutliers } = await supabase.rpc("execute_sql", {
      query: `WITH prices AS (SELECT COALESCE(cm.canonical_name, v.make) AS make, v.id, COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric, NULLIF(v.high_bid, 0)::numeric, NULLIF(v.bat_sold_price, 0), NULLIF(v.asking_price, 0), NULLIF(v.current_value, 0)) AS best_price FROM vehicles v LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id WHERE v.deleted_at IS NULL AND v.price_is_outlier IS NOT true ${makeFilter}), stats AS (SELECT make, percentile_cont(0.25) WITHIN GROUP (ORDER BY best_price) AS q1, percentile_cont(0.75) WITHIN GROUP (ORDER BY best_price) AS q3 FROM prices WHERE best_price IS NOT NULL AND best_price BETWEEN 100 AND 25000000 GROUP BY make HAVING count(*) >= 10), bounds AS (SELECT make, q1, q3, GREATEST(100, q1 - ${iqrMultiplier} * (q3 - q1)) AS lower_bound, q3 + ${iqrMultiplier} * (q3 - q1) AS upper_bound FROM stats WHERE q3 > q1) SELECT p.id, p.make, p.best_price, b.lower_bound, b.upper_bound FROM prices p JOIN bounds b ON p.make = b.make WHERE p.best_price IS NOT NULL AND (p.best_price < b.lower_bound OR p.best_price > b.upper_bound)`,
    });

    let iqrFlagged = 0;
    const iqrOutlierList = Array.isArray(iqrOutliers) ? iqrOutliers : [];

    // Build per-make summary
    const makeSummary: Record<string, { count: number; lower: number; upper: number }> = {};
    for (const row of iqrOutlierList) {
      if (!row.make) continue;
      if (!makeSummary[row.make]) {
        makeSummary[row.make] = {
          count: 0,
          lower: Math.round(Number(row.lower_bound)),
          upper: Math.round(Number(row.upper_bound)),
        };
      }
      makeSummary[row.make].count++;
    }

    if (!dryRun && iqrOutlierList.length > 0) {
      const ids = iqrOutlierList.map((r: any) => r.id);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        await supabase
          .from("vehicles")
          .update({ price_is_outlier: true, price_outlier_reason: "iqr" })
          .in("id", chunk);
      }
      iqrFlagged = ids.length;
    }

    console.log(`[flag-outliers] IQR outliers: ${iqrOutlierList.length}`);

    // Step 4: Refresh materialized view
    if (!dryRun) {
      console.log("[flag-outliers] Refreshing clean_vehicle_prices...");
      const { error: refreshErr } = await supabase.rpc("refresh_clean_vehicle_prices");
      if (refreshErr) {
        console.error("[flag-outliers] Refresh error:", refreshErr);
      } else {
        console.log("[flag-outliers] Materialized view refreshed");
      }
    }

    // Step 5: Summary
    const { data: summary } = await supabase.rpc("execute_sql", {
      query: `SELECT count(*) FILTER (WHERE price_is_outlier = true) as total_outliers, count(*) FILTER (WHERE price_is_outlier IS NOT true) as clean_count, count(*) as total FROM vehicles WHERE deleted_at IS NULL`,
    });

    const iqrPreview = Object.entries(makeSummary)
      .map(([make, s]) => ({ make, outliers: s.count, lower_bound: s.lower, upper_bound: s.upper }))
      .sort((a, b) => b.outliers - a.outliers)
      .slice(0, 30);

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        iqr_multiplier: iqrMultiplier,
        absolute_outliers_flagged: absoluteFlagged,
        iqr_outliers_flagged: iqrFlagged,
        iqr_preview: iqrPreview,
        summary: Array.isArray(summary) ? summary[0] ?? {} : {},
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("[flag-outliers] Error:", e);
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
