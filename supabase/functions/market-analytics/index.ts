/**
 * MARKET ANALYTICS API
 *
 * Institutional-grade analytics for collector vehicle indexes.
 * Correlation matrix, sector analysis, risk decomposition.
 *
 * GET /market-analytics - Full market overview
 * GET /market-analytics?type=correlation - Correlation matrix
 * GET /market-analytics?type=sectors - Sector breakdown
 * GET /market-analytics?type=comparison&indexes=SQBDY-50,K5-BLZR - Compare indexes
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const url = new URL(req.url);
    const analysisType = url.searchParams.get("type") || "overview";
    const indexCodes = url.searchParams.get("indexes")?.split(",") || [];

    switch (analysisType) {
      case "overview":
        return await getMarketOverview(supabase);
      case "correlation":
        return await getCorrelationMatrix(supabase);
      case "sectors":
        return await getSectorAnalysis(supabase);
      case "comparison":
        return await getIndexComparison(supabase, indexCodes);
      default:
        return await getMarketOverview(supabase);
    }

  } catch (e: any) {
    console.error("Market analytics error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

async function getMarketOverview(supabase: any) {
  // Get all active indexes with latest values
  const { data: indexes } = await supabase
    .from('market_indexes')
    .select(`
      id, index_code, index_name, description,
      market_index_values(close_value, volume, value_date, calculation_metadata)
    `)
    .eq('is_active', true)
    .order('index_code');

  // Get market stats
  const { data: stats } = await supabase.rpc('get_squarebody_market_stats');

  // Build overview
  const indexSummary = (indexes || []).map((idx: any) => {
    const latest = idx.market_index_values?.[0];
    return {
      code: idx.index_code,
      name: idx.index_name,
      value: latest?.close_value || 0,
      volume: latest?.volume || 0,
      as_of: latest?.value_date
    };
  });

  // Categorize indexes
  const squarebodyIndexes = indexSummary.filter((i: any) =>
    i.code.startsWith('SQBDY') || ['K5-BLZR', 'C10-TRK', 'SUBRBN'].includes(i.code)
  );

  const totalMarketCap = squarebodyIndexes.reduce((sum: number, idx: any) =>
    sum + (idx.value * idx.volume), 0
  );

  return new Response(JSON.stringify({
    success: true,
    analysis_type: "market_overview",
    generated_at: new Date().toISOString(),
    market_summary: {
      total_vehicles_tracked: stats?.[0]?.total_discovered || 0,
      total_market_capitalization: totalMarketCap,
      average_vehicle_value: stats?.[0]?.average_price || 0,
      price_range: {
        min: stats?.[0]?.price_min || 0,
        max: stats?.[0]?.price_max || 0
      },
      recent_activity: {
        this_week: stats?.[0]?.discovered_this_week || 0,
        this_month: stats?.[0]?.discovered_this_month || 0
      }
    },
    indexes: indexSummary,
    sectors: {
      squarebody: {
        name: "Squarebody Trucks (1973-1991)",
        indexes: squarebodyIndexes,
        total_volume: squarebodyIndexes.reduce((s: number, i: any) => s + i.volume, 0),
        avg_value: squarebodyIndexes.length > 0
          ? squarebodyIndexes.reduce((s: number, i: any) => s + i.value, 0) / squarebodyIndexes.length
          : 0
      }
    },
    methodology: {
      index_calculation: "Price-weighted average of component vehicles",
      data_sources: ["Bring a Trailer", "Cars & Bids", "Dealer networks"],
      update_frequency: "Daily",
      historical_data: "Available via /index-history endpoint"
    }
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function getCorrelationMatrix(supabase: any) {
  // Get historical data for all squarebody indexes
  const { data: indexes } = await supabase
    .from('market_indexes')
    .select('id, index_code, index_name')
    .eq('is_active', true)
    .like('index_code', 'SQBDY%')
    .order('index_code');

  const additionalIndexes = await supabase
    .from('market_indexes')
    .select('id, index_code, index_name')
    .in('index_code', ['K5-BLZR', 'C10-TRK', 'SUBRBN']);

  const allIndexes = [...(indexes || []), ...(additionalIndexes.data || [])];

  // Get 90 days of history for each
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  const histories: { [key: string]: number[] } = {};

  for (const idx of allIndexes) {
    const { data: history } = await supabase
      .from('market_index_values')
      .select('value_date, close_value')
      .eq('index_id', idx.id)
      .gte('value_date', startDate.toISOString().split('T')[0])
      .order('value_date', { ascending: true });

    if (history && history.length > 0) {
      // Calculate daily returns
      const returns: number[] = [];
      for (let i = 1; i < history.length; i++) {
        if (history[i].close_value > 0 && history[i-1].close_value > 0) {
          returns.push((history[i].close_value - history[i-1].close_value) / history[i-1].close_value);
        }
      }
      histories[idx.index_code] = returns;
    }
  }

  // Calculate correlation matrix
  const codes = Object.keys(histories);
  const correlationMatrix: { [key: string]: { [key: string]: number } } = {};

  for (const code1 of codes) {
    correlationMatrix[code1] = {};
    for (const code2 of codes) {
      correlationMatrix[code1][code2] = calculateCorrelation(
        histories[code1],
        histories[code2]
      );
    }
  }

  // Find highest and lowest correlations (excluding self)
  const correlationPairs: { pair: string; correlation: number }[] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      correlationPairs.push({
        pair: `${codes[i]} / ${codes[j]}`,
        correlation: correlationMatrix[codes[i]][codes[j]]
      });
    }
  }
  correlationPairs.sort((a, b) => b.correlation - a.correlation);

  return new Response(JSON.stringify({
    success: true,
    analysis_type: "correlation_matrix",
    generated_at: new Date().toISOString(),
    period: {
      days: 90,
      start_date: startDate.toISOString().split('T')[0]
    },
    correlation_matrix: correlationMatrix,
    insights: {
      highest_correlation: correlationPairs[0] || null,
      lowest_correlation: correlationPairs[correlationPairs.length - 1] || null,
      diversification_note: "Lower correlation between holdings = better diversification"
    },
    methodology: {
      calculation: "Pearson correlation coefficient of daily returns",
      interpretation: {
        "1.0": "Perfect positive correlation (move together)",
        "0.0": "No correlation (independent)",
        "-1.0": "Perfect negative correlation (move opposite)"
      }
    }
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function getSectorAnalysis(supabase: any) {
  // Get all indexes with values
  const { data: indexes } = await supabase
    .from('market_indexes')
    .select(`
      id, index_code, index_name, description, calculation_method,
      market_index_values(close_value, volume, value_date)
    `)
    .eq('is_active', true);

  // Define sectors
  const sectors = {
    early_era: {
      name: "Early Squarebody (1973-1980)",
      description: "Round headlight era, highest collector interest",
      indexes: ['SQBDY-7380'],
      characteristics: ["Single round headlights", "Original body style", "Peak collector demand"]
    },
    mid_era: {
      name: "Mid Squarebody (1981-1987)",
      description: "Dual rectangular headlight era",
      indexes: ['SQBDY-8187'],
      characteristics: ["Dual rectangular headlights", "Updated interior", "Strong value proposition"]
    },
    late_era: {
      name: "R/V Series (1988-1991)",
      description: "Final squarebody production",
      indexes: ['SQBDY-8891'],
      characteristics: ["Final year trucks", "Limited production SUVs", "Emerging collector interest"]
    },
    blazer: {
      name: "K5 Blazer / Jimmy",
      description: "Full-size removable-top SUVs",
      indexes: ['K5-BLZR'],
      characteristics: ["Removable top", "4x4 standard", "Premium segment leader"]
    },
    pickup: {
      name: "C/K Pickups",
      description: "Half-ton work trucks",
      indexes: ['C10-TRK'],
      characteristics: ["Workhorse trucks", "Largest production volume", "Entry-level collectibles"]
    },
    suburban: {
      name: "Suburban",
      description: "Full-size SUVs",
      indexes: ['SUBRBN'],
      characteristics: ["Family haulers", "Undervalued segment", "Highest utility"]
    }
  };

  // Populate sector data
  const sectorData: any = {};

  for (const [key, sector] of Object.entries(sectors)) {
    const sectorIndexes = (indexes || []).filter((idx: any) =>
      sector.indexes.includes(idx.index_code)
    );

    const values = sectorIndexes.map((idx: any) => ({
      code: idx.index_code,
      name: idx.index_name,
      value: idx.market_index_values?.[0]?.close_value || 0,
      volume: idx.market_index_values?.[0]?.volume || 0
    }));

    const avgValue = values.length > 0
      ? values.reduce((s: number, v: any) => s + v.value, 0) / values.length
      : 0;

    const totalVolume = values.reduce((s: number, v: any) => s + v.volume, 0);

    sectorData[key] = {
      ...sector,
      current_value: Math.round(avgValue),
      total_volume: totalVolume,
      market_cap: Math.round(avgValue * totalVolume),
      indexes: values
    };
  }

  // Rank sectors by value
  const sectorRanking = Object.entries(sectorData)
    .map(([key, data]: [string, any]) => ({
      sector: key,
      name: data.name,
      value: data.current_value
    }))
    .sort((a, b) => b.value - a.value);

  return new Response(JSON.stringify({
    success: true,
    analysis_type: "sector_analysis",
    generated_at: new Date().toISOString(),
    sectors: sectorData,
    ranking: sectorRanking,
    investment_thesis: {
      premium_segment: "K5 Blazer / Early Era - highest values, proven appreciation",
      value_segment: "Suburban / C10 - undervalued relative to market, utility play",
      growth_segment: "R/V Series - emerging collector interest, limited supply"
    }
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function getIndexComparison(supabase: any, indexCodes: string[]) {
  if (indexCodes.length < 2) {
    return new Response(JSON.stringify({
      success: false,
      error: "Specify at least 2 index codes to compare (e.g., ?indexes=SQBDY-50,K5-BLZR)"
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Get index data
  const { data: indexes } = await supabase
    .from('market_indexes')
    .select(`
      id, index_code, index_name, description,
      market_index_values(close_value, volume, value_date, calculation_metadata)
    `)
    .in('index_code', indexCodes);

  if (!indexes || indexes.length < 2) {
    return new Response(JSON.stringify({
      success: false,
      error: "Could not find specified indexes"
    }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Compare metrics
  const comparison = indexes.map((idx: any) => {
    const latest = idx.market_index_values?.[0];
    const metadata = latest?.calculation_metadata || {};

    return {
      code: idx.index_code,
      name: idx.index_name,
      description: idx.description,
      current_value: latest?.close_value || 0,
      volume: latest?.volume || 0,
      as_of: latest?.value_date,
      metrics: {
        avg_price: metadata.avg_price || latest?.close_value || 0,
        min_price: metadata.min_price || 0,
        max_price: metadata.max_price || 0,
        sample_size: metadata.sample_size || latest?.volume || 0
      }
    };
  });

  // Calculate relative metrics
  const baseIndex = comparison[0];
  const relativeComparison = comparison.map((idx: any) => ({
    ...idx,
    relative_to_base: {
      value_ratio: (idx.current_value / baseIndex.current_value).toFixed(2),
      premium_discount: ((idx.current_value - baseIndex.current_value) / baseIndex.current_value * 100).toFixed(1) + '%'
    }
  }));

  return new Response(JSON.stringify({
    success: true,
    analysis_type: "index_comparison",
    generated_at: new Date().toISOString(),
    indexes: relativeComparison,
    summary: {
      highest_value: comparison.reduce((max: any, idx: any) =>
        idx.current_value > max.current_value ? idx : max
      ),
      lowest_value: comparison.reduce((min: any, idx: any) =>
        idx.current_value < min.current_value ? idx : min
      ),
      spread: Math.max(...comparison.map((i: any) => i.current_value)) -
              Math.min(...comparison.map((i: any) => i.current_value))
    }
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function calculateCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  const xSlice = x.slice(0, n);
  const ySlice = y.slice(0, n);

  const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
  const yMean = ySlice.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;

  for (let i = 0; i < n; i++) {
    const xDiff = xSlice[i] - xMean;
    const yDiff = ySlice[i] - yMean;
    numerator += xDiff * yDiff;
    xDenominator += xDiff * xDiff;
    yDenominator += yDiff * yDiff;
  }

  const denominator = Math.sqrt(xDenominator * yDenominator);
  if (denominator === 0) return 0;

  return Number((numerator / denominator).toFixed(3));
}
