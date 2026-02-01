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

// UUID validation helper
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(str: string | undefined | null): boolean {
  return typeof str === 'string' && UUID_REGEX.test(str);
}

// Safe division helper to avoid divide-by-zero
function safeDivide(numerator: number, denominator: number, fallback: number = 0): number {
  return denominator !== 0 && isFinite(denominator) ? numerator / denominator : fallback;
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

    const url = new URL(req.url);
    const analysisType = url.searchParams.get("type") || "overview";
    const indexCodes = url.searchParams.get("indexes")?.split(",") || [];

    const offeringId = url.searchParams.get("offering_id");
    const timeframe = url.searchParams.get("timeframe") || "1d";

    switch (analysisType) {
      case "overview":
        return await getMarketOverview(supabase);
      case "correlation":
        return await getCorrelationMatrix(supabase);
      case "sectors":
        return await getSectorAnalysis(supabase);
      case "comparison":
        return await getIndexComparison(supabase, indexCodes);
      case "trading":
        if (!offeringId) {
          return new Response(JSON.stringify({ error: "offering_id required for trading analytics" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        if (!isValidUUID(offeringId)) {
          return new Response(JSON.stringify({ error: "Invalid offering_id format" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        return await getTradingAnalytics(supabase, offeringId, timeframe);
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

  // Calculate relative metrics (comparison is guaranteed to have >= 2 elements from check above)
  const baseIndex = comparison[0];
  const baseValue = baseIndex.current_value || 1; // Avoid division by zero
  const relativeComparison = comparison.map((idx: any) => ({
    ...idx,
    relative_to_base: {
      value_ratio: safeDivide(idx.current_value, baseValue, 0).toFixed(2),
      premium_discount: (safeDivide(idx.current_value - baseValue, baseValue, 0) * 100).toFixed(1) + '%'
    }
  }));

  return new Response(JSON.stringify({
    success: true,
    analysis_type: "index_comparison",
    generated_at: new Date().toISOString(),
    indexes: relativeComparison,
    summary: {
      highest_value: comparison.length > 0
        ? comparison.reduce((max: any, idx: any) =>
            idx.current_value > max.current_value ? idx : max
          )
        : null,
      lowest_value: comparison.length > 0
        ? comparison.reduce((min: any, idx: any) =>
            idx.current_value < min.current_value ? idx : min
          )
        : null,
      spread: comparison.length > 0
        ? Math.max(...comparison.map((i: any) => i.current_value)) -
          Math.min(...comparison.map((i: any) => i.current_value))
        : 0
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

/**
 * Trading Analytics for individual offerings
 * VWAP, TWAP, volatility, market impact, momentum
 */
async function getTradingAnalytics(supabase: any, offeringId: string, timeframe: string) {
  // Calculate time range
  const now = new Date();
  const timeRanges: Record<string, number> = {
    '1h': 1 * 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const startTime = new Date(now.getTime() - (timeRanges[timeframe] || timeRanges['1d']));

  // Fetch trades for the timeframe
  const { data: trades } = await supabase
    .from('market_trades')
    .select('price_per_share, shares_traded, executed_at')
    .eq('offering_id', offeringId)
    .gte('executed_at', startTime.toISOString())
    .order('executed_at', { ascending: true });

  // Fetch NBBO
  const { data: nbbo } = await supabase
    .from('nbbo_cache')
    .select('*')
    .eq('offering_id', offeringId)
    .maybeSingle();

  // Fetch current offering data (use maybeSingle to avoid throwing on not found)
  const { data: offering } = await supabase
    .from('vehicle_offerings')
    .select('current_share_price, opening_price, total_trades, total_volume_shares')
    .eq('id', offeringId)
    .maybeSingle();

  const tradeList = trades || [];
  const currentPrice = offering?.current_share_price || null;

  // VWAP: Sum(Price * Volume) / Sum(Volume)
  let vwap: number | null = null;
  let totalVolume = 0;
  if (tradeList.length > 0) {
    const totalPriceVolume = tradeList.reduce(
      (sum: number, t: any) => sum + t.price_per_share * t.shares_traded,
      0
    );
    totalVolume = tradeList.reduce((sum: number, t: any) => sum + t.shares_traded, 0);
    vwap = totalVolume > 0 ? totalPriceVolume / totalVolume : null;
  }

  // TWAP: Simple average of prices
  let twap: number | null = null;
  if (tradeList.length > 0) {
    twap = tradeList.reduce((sum: number, t: any) => sum + t.price_per_share, 0) / tradeList.length;
  }

  // Price change
  let priceChange: number | null = null;
  let priceChangePct: number | null = null;
  if (currentPrice !== null && tradeList.length > 0) {
    const firstPrice = tradeList[0].price_per_share;
    priceChange = currentPrice - firstPrice;
    // Avoid division by zero
    priceChangePct = firstPrice > 0 ? (priceChange / firstPrice) * 100 : null;
  }

  // Volatility (annualized standard deviation of returns)
  let volatility: number | null = null;
  let volatilityDaily: number | null = null;
  if (tradeList.length >= 2) {
    const returns: number[] = [];
    for (let i = 1; i < tradeList.length; i++) {
      const ret = (tradeList[i].price_per_share - tradeList[i - 1].price_per_share) /
                  tradeList[i - 1].price_per_share;
      returns.push(ret);
    }

    if (returns.length > 0) {
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      volatilityDaily = Math.sqrt(variance);
      volatility = volatilityDaily * Math.sqrt(252); // Annualized
    }
  }

  // High-Low Range
  let high: number | null = null;
  let low: number | null = null;
  if (tradeList.length > 0) {
    const prices = tradeList.map((t: any) => t.price_per_share);
    high = Math.max(...prices);
    low = Math.min(...prices);
  }

  // Momentum
  let momentum: number | null = null;
  if (tradeList.length >= 2) {
    const recentPrice = tradeList[tradeList.length - 1].price_per_share;
    const oldPrice = tradeList[0].price_per_share;
    // Avoid division by zero
    momentum = oldPrice > 0 ? ((recentPrice - oldPrice) / oldPrice) * 100 : null;
  }

  // RSI (14-period)
  let rsi: number | null = null;
  if (tradeList.length >= 15) {
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < Math.min(tradeList.length, 15); i++) {
      const change = tradeList[i].price_per_share - tradeList[i - 1].price_per_share;
      if (change > 0) {
        gains.push(change);
        losses.push(0);
      } else {
        gains.push(0);
        losses.push(Math.abs(change));
      }
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
    if (avgLoss > 0) {
      const rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
    } else {
      rsi = 100;
    }
  }

  // Market Impact estimation
  const bidDepth = nbbo?.total_bid_depth || 100;
  const askDepth = nbbo?.total_ask_depth || 100;
  const avgDepth = (bidDepth + askDepth) / 2;

  const estimatedImpact = {
    small: { shares: 10, impact_pct: (10 / avgDepth) * 0.5 },
    medium: { shares: 50, impact_pct: (50 / avgDepth) * 0.5 },
    large: { shares: 100, impact_pct: (100 / avgDepth) * 0.5 },
  };

  // Trading days calculation
  const tradingDays = timeframe === '1h' ? 1/24 :
                       timeframe === '4h' ? 1/6 :
                       timeframe === '1d' ? 1 :
                       timeframe === '7d' ? 7 : 30;
  const averageDailyVolume = totalVolume / Math.max(tradingDays, 1);

  return new Response(JSON.stringify({
    success: true,
    analysis_type: "trading_analytics",
    generated_at: new Date().toISOString(),
    offering_id: offeringId,
    timeframe,
    period: {
      start: startTime.toISOString(),
      end: now.toISOString()
    },
    price_metrics: {
      current_price: currentPrice,
      vwap,
      twap,
      high,
      low,
      price_change: priceChange,
      price_change_pct: priceChangePct
    },
    volume_metrics: {
      total_volume: totalVolume,
      trade_count: tradeList.length,
      average_daily_volume: averageDailyVolume,
      average_trade_size: tradeList.length > 0 ? totalVolume / tradeList.length : 0
    },
    risk_metrics: {
      volatility_annualized: volatility,
      volatility_daily: volatilityDaily,
      high_low_range: high !== null && low !== null ? high - low : null
    },
    momentum_indicators: {
      momentum_pct: momentum,
      rsi
    },
    liquidity_metrics: {
      bid_ask_spread: nbbo?.spread || null,
      bid_ask_spread_pct: nbbo?.spread_pct || null,
      bid_depth: nbbo?.total_bid_depth || 0,
      ask_depth: nbbo?.total_ask_depth || 0,
      estimated_market_impact: estimatedImpact
    }
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
