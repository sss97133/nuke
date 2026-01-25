/**
 * INDEX HISTORY API
 *
 * Get historical values for market indexes - for charting and analysis.
 *
 * GET /index-history?index_id=xxx&days=30
 * GET /index-history?index_code=SQBDY-50&days=90
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
    const indexId = url.searchParams.get("index_id");
    const indexCode = url.searchParams.get("index_code");
    const days = parseInt(url.searchParams.get("days") || "30");

    if (!indexId && !indexCode) {
      return new Response(JSON.stringify({
        success: false,
        error: "Must specify index_id or index_code"
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get index info
    let indexQuery = supabase.from('market_indexes').select('*');
    if (indexId) {
      indexQuery = indexQuery.eq('id', indexId);
    } else {
      indexQuery = indexQuery.eq('index_code', indexCode);
    }

    const { data: indexData, error: indexError } = await indexQuery.single();
    if (indexError || !indexData) {
      return new Response(JSON.stringify({
        success: false,
        error: "Index not found"
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get historical values
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: history, error: historyError } = await supabase
      .from('market_index_values')
      .select('value_date, open_value, high_value, low_value, close_value, volume, calculation_metadata')
      .eq('index_id', indexData.id)
      .gte('value_date', startDate.toISOString().split('T')[0])
      .order('value_date', { ascending: true });

    if (historyError) throw historyError;

    // Calculate performance metrics
    const values = (history || []).map(h => h.close_value).filter(v => v > 0);
    const metrics = calculateMetrics(values, history || []);

    // Fetch advanced metrics if available
    let advancedMetrics = null;
    try {
      const { data: advMetrics } = await supabase
        .from('asset_performance_metrics')
        .select('*')
        .eq('asset_type', 'index')
        .eq('asset_id', indexData.id)
        .order('calculation_date', { ascending: false })
        .limit(10);

      if (advMetrics && advMetrics.length > 0) {
        // Group by period
        const byPeriod: Record<string, any> = {};
        for (const m of advMetrics) {
          if (!byPeriod[m.period]) {
            byPeriod[m.period] = m;
          }
        }
        advancedMetrics = {
          latest_calculation: advMetrics[0].calculation_date,
          periods: byPeriod
        };
      }
    } catch (e) {
      console.log('Advanced metrics not available:', e);
    }

    return new Response(JSON.stringify({
      success: true,
      index: {
        id: indexData.id,
        code: indexData.index_code,
        name: indexData.index_name,
        description: indexData.description
      },
      period: {
        days,
        start_date: startDate.toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        data_points: history?.length || 0
      },
      history: history || [],
      metrics,
      advanced_metrics: advancedMetrics
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("Index history error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

function calculateMetrics(values: number[], history: any[]): any {
  if (values.length < 2) {
    return {
      insufficient_data: true,
      message: "Need at least 2 data points for metrics"
    };
  }

  const first = values[0];
  const last = values[values.length - 1];
  const high = Math.max(...values);
  const low = Math.min(...values);

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    returns.push((values[i] - values[i-1]) / values[i-1]);
  }

  // Mean return
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

  // Standard deviation of returns (volatility)
  const variance = returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);

  // Annualized volatility (assuming daily data)
  const annualizedVolatility = volatility * Math.sqrt(252);

  // Total return
  const totalReturn = (last - first) / first;

  // Annualized return (CAGR approximation)
  const years = values.length / 252;
  const cagr = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;

  // Sharpe ratio (assuming 5% risk-free rate)
  const riskFreeRate = 0.05;
  const excessReturn = cagr - riskFreeRate;
  const sharpeRatio = annualizedVolatility > 0 ? excessReturn / annualizedVolatility : 0;

  // Max drawdown
  let maxDrawdown = 0;
  let peak = values[0];
  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Sortino ratio (downside deviation)
  const negativeReturns = returns.filter(r => r < 0);
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((acc, r) => acc + Math.pow(r, 2), 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);
  const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;

  return {
    price: {
      first: Math.round(first),
      last: Math.round(last),
      high: Math.round(high),
      low: Math.round(low),
      change: Math.round(last - first),
      change_pct: (totalReturn * 100).toFixed(2) + '%'
    },
    returns: {
      total_return: (totalReturn * 100).toFixed(2) + '%',
      cagr: (cagr * 100).toFixed(2) + '%',
      mean_daily_return: (meanReturn * 100).toFixed(4) + '%'
    },
    risk: {
      volatility_daily: (volatility * 100).toFixed(2) + '%',
      volatility_annualized: (annualizedVolatility * 100).toFixed(2) + '%',
      max_drawdown: (maxDrawdown * 100).toFixed(2) + '%',
      downside_deviation: (downsideDeviation * 100).toFixed(2) + '%'
    },
    risk_adjusted: {
      sharpe_ratio: sharpeRatio.toFixed(2),
      sortino_ratio: sortinoRatio.toFixed(2)
    },
    methodology: {
      risk_free_rate: '5.00%',
      annualization_factor: 252,
      note: 'Metrics calculated from daily closing values'
    }
  };
}
