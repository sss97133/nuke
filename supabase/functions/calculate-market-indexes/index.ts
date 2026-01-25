/**
 * CALCULATE MARKET INDEXES
 *
 * Calculates daily market index values based on vehicle pricing data.
 * Called daily via cron or manually via POST request.
 *
 * Implements:
 * - SQBDY-50: Top 50 squarebody trucks by recent pricing
 * - CLSC-100: Top 100 classic vehicles by value
 * - PROJ-ACT: Project activity momentum
 * - MKTV-USD: Overall market velocity
 *
 * POST /functions/v1/calculate-market-indexes
 * Body: {
 *   index_code?: string,  // Optional: calculate specific index
 *   date?: string         // Optional: calculate for specific date (YYYY-MM-DD)
 * }
 *
 * Returns: {
 *   success: boolean,
 *   indexes_calculated: number,
 *   results: Array<{index_code, value, count}>
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

    // Parse request body
    const body = req.method === "POST" ? await req.json() : {};
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

    // Calculate each index
    for (const index of indexes) {
      console.log(`Calculating ${index.index_code} - ${index.index_name}`);

      const calculation = await calculateIndex(supabase, index, targetDate);

      if (calculation) {
        results.push(calculation);

        // Store the calculated value
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

/**
 * Calculate a single index value based on its configuration
 */
async function calculateIndex(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult | null> {
  const method = index.calculation_method || {};

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
 * Generic squarebody calculation for year-range and model-specific indexes
 */
async function calculateSquarebodyYearRange(
  supabase: any,
  index: any,
  date: string,
  yearMin: number,
  yearMax: number,
  modelRegex: string
): Promise<IndexCalculationResult> {
  // Use RPC for efficient querying
  const { data, error } = await supabase.rpc('get_squarebody_index_stats', {
    year_min: yearMin,
    year_max: yearMax,
    model_pattern: modelRegex
  });

  // Fallback to direct query if RPC doesn't exist
  if (error || !data) {
    const { data: vehicles, error: vError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, sale_price, asking_price')
      .gte('year', yearMin)
      .lte('year', yearMax)
      .in('make', ['Chevrolet', 'GMC', 'Chevy', 'chevrolet', 'gmc', 'chevy', 'Gmc'])
      .limit(500);

    if (vError) throw vError;

    // Filter by model regex client-side
    const regex = new RegExp(modelRegex, 'i');
    const filtered = (vehicles || []).filter((v: any) => regex.test(v.model || ''));

    const prices = filtered
      .map((v: any) => v.sale_price || v.asking_price || 0)
      .filter((p: number) => p > 0);

    const avgPrice = prices.length > 0
      ? prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length
      : 0;

    return {
      index_code: index.index_code,
      index_name: index.index_name,
      value: Math.round(avgPrice),
      count: filtered.length,
      metadata: {
        avg_price: Math.round(avgPrice),
        min_price: prices.length > 0 ? Math.min(...prices) : 0,
        max_price: prices.length > 0 ? Math.max(...prices) : 0,
        sample_size: filtered.length,
        year_range: `${yearMin}-${yearMax}`,
        calculation_date: date
      }
    };
  }

  // Use RPC result
  const stats = Array.isArray(data) && data.length > 0 ? data[0] : data;
  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(Number(stats?.avg_price || 0)),
    count: Number(stats?.count || 0),
    metadata: {
      avg_price: Math.round(Number(stats?.avg_price || 0)),
      min_price: Number(stats?.min_price || 0),
      max_price: Number(stats?.max_price || 0),
      sample_size: Number(stats?.count || 0),
      year_range: `${yearMin}-${yearMax}`,
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
  // Get top 50 squarebody trucks with recent prices
  // Years: 1973-1991, Makes: Chevrolet/GMC, Models: C10/C20/K10/K20 etc.

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, asking_price, created_at')
    .gte('year', 1973)
    .lte('year', 1991)
    .in('make', ['Chevrolet', 'GMC'])
    .not('sale_price', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200); // Get more to filter and rank

  if (error) throw error;

  // Filter to C/K models and sort by price
  const squarebodies = (vehicles || [])
    .filter((v: any) => {
      const model = (v.model || '').toUpperCase();
      return model.includes('C10') || model.includes('C20') || model.includes('C30') ||
             model.includes('K10') || model.includes('K20') || model.includes('K30') ||
             model.includes('BLAZER') || model.includes('SUBURBAN');
    })
    .slice(0, 50);

  // Calculate average price as index value
  const prices = squarebodies
    .map((v: any) => v.sale_price || v.asking_price || 0)
    .filter((p: number) => p > 0);

  const avgPrice = prices.length > 0
    ? prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length
    : 0;

  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(avgPrice),
    count: squarebodies.length,
    metadata: {
      avg_price: Math.round(avgPrice),
      min_price: minPrice,
      max_price: maxPrice,
      sample_size: squarebodies.length,
      price_range: maxPrice - minPrice,
      calculation_date: date
    }
  };
}

/**
 * CLSC-100: Top 100 classic vehicles by value
 */
async function calculateClassic100(
  supabase: any,
  index: any,
  date: string
): Promise<IndexCalculationResult> {
  // Get top 100 highest-value classic vehicles (pre-1996)

  const { data: vehicles, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, sale_price, asking_price')
    .lte('year', 1995)
    .not('sale_price', 'is', null)
    .order('sale_price', { ascending: false })
    .limit(100);

  if (error) throw error;

  const prices = (vehicles || [])
    .map((v: any) => v.sale_price || v.asking_price || 0)
    .filter((p: number) => p > 0);

  const avgPrice = prices.length > 0
    ? prices.reduce((sum: number, p: number) => sum + p, 0) / prices.length
    : 0;

  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

  return {
    index_code: index.index_code,
    index_name: index.index_name,
    value: Math.round(avgPrice),
    count: vehicles?.length || 0,
    metadata: {
      avg_price: Math.round(avgPrice),
      min_price: minPrice,
      max_price: maxPrice,
      sample_size: vehicles?.length || 0,
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
  // Count recent listings with project/build keywords

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: recentProjects, error } = await supabase
    .from('vehicles')
    .select('id, title, description, created_at')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .or('title.ilike.%project%,title.ilike.%restore%,title.ilike.%build%,title.ilike.%custom%,description.ilike.%project%,description.ilike.%restore%');

  if (error) throw error;

  const count = recentProjects?.length || 0;

  // Activity score: normalized count (higher = more activity)
  // Scale: 0-100, where 50 = baseline activity
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
  // Calculate overall market velocity based on recent activity

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // Get listings from last 7 days
  const { data: recentListings, error: recentError } = await supabase
    .from('vehicles')
    .select('id, sale_price, asking_price, created_at')
    .gte('created_at', sevenDaysAgo.toISOString());

  // Get listings from 7-14 days ago
  const { data: previousListings, error: prevError } = await supabase
    .from('vehicles')
    .select('id, sale_price, asking_price, created_at')
    .gte('created_at', fourteenDaysAgo.toISOString())
    .lt('created_at', sevenDaysAgo.toISOString());

  if (recentError) throw recentError;
  if (prevError) throw prevError;

  const recentCount = recentListings?.length || 0;
  const previousCount = previousListings?.length || 0;

  // Calculate velocity as percentage change in activity
  const velocity = previousCount > 0
    ? ((recentCount - previousCount) / previousCount) * 100
    : 0;

  // Normalize to 0-100 scale (50 = no change, >50 = increasing, <50 = decreasing)
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
      open_value: calculation.value, // For now, same as close
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
