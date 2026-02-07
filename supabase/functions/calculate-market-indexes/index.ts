/**
 * CALCULATE MARKET INDEXES
 *
 * Calculates daily market index values based on clean_vehicle_prices.
 * Uses canonical makes (post-normalization) instead of hardcoded variants.
 * Called daily via cron or manually via POST request.
 *
 * Implements:
 * - SQBDY-50: Top 50 squarebody trucks by recent pricing
 * - SQBDY-7380, SQBDY-8187, SQBDY-8891: Year-range sub-indexes
 * - K5-BLZR, C10-TRK, SUBRBN: Model-specific indexes
 * - CLSC-100: Top 100 classic vehicles by value
 * - PROJ-ACT: Project activity momentum
 * - MKTV-USD: Overall market velocity
 *
 * POST /functions/v1/calculate-market-indexes
 * Body: {
 *   index_code?: string,  // Optional: calculate specific index
 *   date?: string         // Optional: calculate for specific date (YYYY-MM-DD)
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IndexCalculationResult {
  index_code: string;
  index_name: string;
  value: number;
  count: number;
  metadata: any;
}

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
    const targetIndexCode = body.index_code || null;
    const targetDate = body.date || new Date().toISOString().split('T')[0];

    console.log(`Calculating market indexes for date: ${targetDate}`);

    // Get all active indexes (or specific one if requested)
    const indexQuery = supabase
      .from('market_indexes')
      .select('*')
      .eq('is_active', true);

    if (targetIndexCode) {
      indexQuery.eq('index_code', targetIndexCode);
    }

    const { data: indexes, error: indexError } = await indexQuery;

    if (indexError) throw indexError;
    if (!indexes || indexes.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: "No active indexes found"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404
      });
    }

    const results: IndexCalculationResult[] = [];

    for (const index of indexes) {
      console.log(`Calculating ${index.index_code} - ${index.index_name}`);

      const calculation = await calculateIndex(supabase, index, targetDate);

      if (calculation) {
        results.push(calculation);
        await storeIndexValue(supabase, index.id, targetDate, calculation);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      date: targetDate,
      indexes_calculated: results.length,
      results: results
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("Error calculating indexes:", e);
    return new Response(JSON.stringify({
      error: e.message,
      stack: e.stack
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function calculateIndex(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult | null> {
  switch (index.index_code) {
    case 'SQBDY-50':
      return await calculateSquarebody50(supabase, index, date);
    case 'SQBDY-7380':
      return await calculateSquarebodyYearRange(supabase, index, date, 1973, 1980,
        '(c10|c20|c30|k10|k20|k30|blazer|jimmy|suburban|sierra|silverado|scottsdale|cheyenne|pickup)');
    case 'SQBDY-8187':
      return await calculateSquarebodyYearRange(supabase, index, date, 1981, 1987,
        '(c10|c20|c30|k10|k20|k30|blazer|jimmy|suburban|sierra|silverado|scottsdale|cheyenne|pickup)');
    case 'SQBDY-8891':
      return await calculateSquarebodyYearRange(supabase, index, date, 1988, 1991,
        '(r1500|r2500|r3500|v1500|v2500|v3500|blazer|jimmy|suburban|crew cab)');
    case 'K5-BLZR':
      return await calculateSquarebodyYearRange(supabase, index, date, 1973, 1991,
        '(k5|blazer|jimmy)');
    case 'C10-TRK':
      return await calculateSquarebodyYearRange(supabase, index, date, 1973, 1991,
        '(c10|c1500|c-10|sierra 1500|silverado 1500)');
    case 'SUBRBN':
      return await calculateSquarebodyYearRange(supabase, index, date, 1973, 1991,
        '(suburban)');
    case 'CLSC-100':
      return await calculateClassic100(supabase, index, date);
    case 'PROJ-ACT':
      return await calculateProjectActivity(supabase, index, date);
    case 'MKTV-USD':
      return await calculateMarketVelocity(supabase, index, date);
    default:
      console.warn(`Unknown index type: ${index.index_code}`);
      return null;
  }
}

/**
 * Squarebody year-range indexes — uses clean_vehicle_prices + canonical makes
 */
async function calculateSquarebodyYearRange(
  supabase: any,
  index: any,
  date: string,
  yearMin: number,
  yearMax: number,
  modelRegex: string
): Promise<IndexCalculationResult> {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `
      SELECT
        count(*) AS count,
        ROUND(avg(best_price)::numeric, 0) AS avg_price,
        ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS median_price,
        ROUND(min(best_price)::numeric, 0) AS min_price,
        ROUND(max(best_price)::numeric, 0) AS max_price,
        ROUND(stddev_pop(best_price)::numeric, 0) AS std_dev
      FROM clean_vehicle_prices
      WHERE UPPER(make) IN ('CHEVROLET', 'GMC')
        AND year BETWEEN ${yearMin} AND ${yearMax}
        AND model ~* '${modelRegex}'
    `
  });

  if (error) throw error;

  const stats = data?.[0] ?? {};
  const medianPrice = Number(stats.median_price || stats.avg_price || 0);

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(medianPrice),
    count: Number(stats.count || 0),
    metadata: {
      median_price: medianPrice,
      avg_price: Number(stats.avg_price || 0),
      min_price: Number(stats.min_price || 0),
      max_price: Number(stats.max_price || 0),
      std_dev: Number(stats.std_dev || 0),
      sample_size: Number(stats.count || 0),
      year_range: `${yearMin}-${yearMax}`,
      model_filter: modelRegex,
      source: 'clean_vehicle_prices',
      calculation_date: date
    }
  };
}

/**
 * SQBDY-50: Top 50 squarebody trucks by recent pricing
 */
async function calculateSquarebody50(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult> {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `
      WITH ranked AS (
        SELECT best_price
        FROM clean_vehicle_prices
        WHERE UPPER(make) IN ('CHEVROLET', 'GMC')
          AND year BETWEEN 1973 AND 1991
          AND model ~* '(c10|c20|c30|k10|k20|k30|blazer|suburban|jimmy|sierra|silverado|scottsdale|cheyenne|pickup)'
          AND is_sold = true
        ORDER BY updated_at DESC
        LIMIT 50
      )
      SELECT
        count(*) AS count,
        ROUND(avg(best_price)::numeric, 0) AS avg_price,
        ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS median_price,
        ROUND(min(best_price)::numeric, 0) AS min_price,
        ROUND(max(best_price)::numeric, 0) AS max_price
      FROM ranked
    `
  });

  if (error) throw error;

  const stats = data?.[0] ?? {};
  const medianPrice = Number(stats.median_price || stats.avg_price || 0);

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(medianPrice),
    count: Number(stats.count || 0),
    metadata: {
      median_price: medianPrice,
      avg_price: Number(stats.avg_price || 0),
      min_price: Number(stats.min_price || 0),
      max_price: Number(stats.max_price || 0),
      sample_size: Number(stats.count || 0),
      source: 'clean_vehicle_prices (top 50 recent sold)',
      calculation_date: date
    }
  };
}

/**
 * CLSC-100: Top 100 classic vehicles by value — uses clean_vehicle_prices
 */
async function calculateClassic100(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult> {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `
      WITH top100 AS (
        SELECT best_price
        FROM clean_vehicle_prices
        WHERE year <= 1995
          AND is_sold = true
        ORDER BY best_price DESC
        LIMIT 100
      )
      SELECT
        count(*) AS count,
        ROUND(avg(best_price)::numeric, 0) AS avg_price,
        ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY best_price)::numeric, 0) AS median_price,
        ROUND(min(best_price)::numeric, 0) AS min_price,
        ROUND(max(best_price)::numeric, 0) AS max_price
      FROM top100
    `
  });

  if (error) throw error;

  const stats = data?.[0] ?? {};

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(Number(stats.avg_price || 0)),
    count: Number(stats.count || 0),
    metadata: {
      avg_price: Number(stats.avg_price || 0),
      median_price: Number(stats.median_price || 0),
      min_price: Number(stats.min_price || 0),
      max_price: Number(stats.max_price || 0),
      sample_size: Number(stats.count || 0),
      source: 'clean_vehicle_prices (top 100 sold classics)',
      calculation_date: date
    }
  };
}

/**
 * PROJ-ACT: Project Activity Index (build momentum)
 */
async function calculateProjectActivity(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult> {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `SELECT count(*) AS count FROM vehicles WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days' AND (title ILIKE '%project%' OR title ILIKE '%restore%' OR title ILIKE '%build%' OR title ILIKE '%custom%')`
  });

  if (error) throw error;

  const count = Number(data?.[0]?.count || 0);
  const activityScore = Math.min(100, (count / 10) * 100);

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(activityScore),
    count: count,
    metadata: {
      activity_score: activityScore,
      listings_30d: count,
      calculation_date: date,
      note: "Score 0-100, where 50 is baseline activity"
    }
  };
}

/**
 * MKTV-USD: Market Velocity (overall market momentum)
 */
async function calculateMarketVelocity(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult> {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `
      SELECT
        count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS recent_count,
        count(*) FILTER (WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days') AS previous_count
      FROM vehicles
      WHERE deleted_at IS NULL
        AND created_at >= NOW() - INTERVAL '14 days'
    `
  });

  if (error) throw error;

  const recentCount = Number(data?.[0]?.recent_count || 0);
  const previousCount = Number(data?.[0]?.previous_count || 0);

  const velocity = previousCount > 0
    ? ((recentCount - previousCount) / previousCount) * 100
    : 0;

  const velocityScore = Math.max(0, Math.min(100, 50 + velocity));

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(velocityScore),
    count: recentCount,
    metadata: {
      velocity_score: velocityScore,
      recent_listings: recentCount,
      previous_listings: previousCount,
      change_pct: velocity.toFixed(2),
      calculation_date: date,
      note: "Score 50 = stable, >50 = accelerating, <50 = decelerating"
    }
  };
}

/**
 * Store calculated index value in database
 */
async function storeIndexValue(
  supabase: any,
  indexId: string,
  date: string,
  calculation: IndexCalculationResult
): Promise<void> {
  const { error } = await supabase
    .from('market_index_values')
    .upsert({
      index_id: indexId,
      value_date: date,
      close_value: calculation.value,
      open_value: calculation.value,
      high_value: calculation.value,
      low_value: calculation.value,
      volume: calculation.count,
      components_snapshot: { count: calculation.count },
      calculation_metadata: calculation.metadata
    }, {
      onConflict: 'index_id,value_date'
    });

  if (error) {
    console.error(`Failed to store index value for ${calculation.index_code}:`, error);
    throw error;
  }

  console.log(`Stored ${calculation.index_code}: ${calculation.value}`);
}
