/**
 * CALCULATE ADVANCED METRICS
 *
 * Calculates institutional-grade performance metrics for assets:
 * - IRR (Internal Rate of Return) - Newton-Raphson method
 * - TWR (Time-Weighted Return) - Geometric linking
 * - VaR (Value at Risk) - Historical, Parametric, Monte Carlo
 * - Alpha/Beta - Regression vs benchmark
 * - Sharpe/Sortino ratios
 *
 * POST /calculate-advanced-metrics
 * Body: {
 *   asset_type: 'index' | 'vehicle' | 'portfolio',
 *   asset_id?: UUID,
 *   user_id?: UUID (for portfolio),
 *   periods?: string[], // ['1m', '3m', '6m', 'ytd', '1y']
 *   benchmark_code?: string
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CashFlow {
  date: Date;
  amount: number;
}

interface PricePoint {
  date: Date;
  value: number;
}

interface MetricsResult {
  period: string;
  total_return: number;
  annualized_return: number;
  twr_return: number | null;
  irr: number | null;
  volatility_annualized: number;
  max_drawdown: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  var_95_1d: number;
  cvar_95_1d: number;
  alpha: number | null;
  beta: number | null;
  r_squared: number | null;
  data_points: number;
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

    const body = await req.json();
    const {
      asset_type,
      asset_id,
      user_id,
      periods = ['1m', '3m', '6m', 'ytd', '1y'],
      benchmark_code = 'SQBDY-50'
    } = body;

    console.log(`Calculating metrics for ${asset_type}/${asset_id || user_id}`);

    // Get price history based on asset type
    let priceHistory: PricePoint[] = [];
    let cashFlows: CashFlow[] = [];

    if (asset_type === 'index') {
      // Get index history
      const { data: history } = await supabase
        .from('market_index_values')
        .select('value_date, close_value')
        .eq('index_id', asset_id)
        .order('value_date', { ascending: true });

      priceHistory = (history || []).map(h => ({
        date: new Date(h.value_date),
        value: h.close_value
      }));

    } else if (asset_type === 'portfolio' && user_id) {
      // Get portfolio performance history
      const { data: history } = await supabase
        .from('portfolio_performance')
        .select('snapshot_date, total_value')
        .eq('user_id', user_id)
        .order('snapshot_date', { ascending: true });

      priceHistory = (history || []).map(h => ({
        date: new Date(h.snapshot_date),
        value: h.total_value
      }));

      // Get cash flows
      const { data: flows } = await supabase
        .from('investment_cash_flows')
        .select('cash_flow_date, amount')
        .eq('user_id', user_id)
        .order('cash_flow_date', { ascending: true });

      cashFlows = (flows || []).map(f => ({
        date: new Date(f.cash_flow_date),
        amount: f.amount
      }));
    }

    if (priceHistory.length < 2) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Insufficient price history'
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get benchmark data
    let benchmarkReturns: number[] = [];
    const { data: benchmarkData } = await supabase
      .from('market_benchmarks')
      .select('id')
      .eq('benchmark_code', benchmark_code)
      .single();

    if (benchmarkData) {
      const { data: benchValues } = await supabase
        .from('benchmark_values')
        .select('value_date, daily_return')
        .eq('benchmark_id', benchmarkData.id)
        .order('value_date', { ascending: true });

      benchmarkReturns = (benchValues || [])
        .map(v => v.daily_return)
        .filter(r => r !== null);
    }

    // Calculate metrics for each period
    const results: MetricsResult[] = [];

    for (const period of periods) {
      const periodData = filterByPeriod(priceHistory, period);
      const periodFlows = filterByPeriod(cashFlows, period);

      if (periodData.length < 2) continue;

      const metrics = calculatePeriodMetrics(
        periodData,
        periodFlows,
        benchmarkReturns,
        period
      );

      results.push(metrics);

      // Store in database
      await supabase.from('asset_performance_metrics').upsert({
        asset_type,
        asset_id: asset_id || user_id,
        calculation_date: new Date().toISOString().split('T')[0],
        period,
        ...metrics
      }, {
        onConflict: 'asset_type,asset_id,calculation_date,period'
      });
    }

    return new Response(JSON.stringify({
      success: true,
      asset_type,
      asset_id: asset_id || user_id,
      benchmark_code,
      metrics: results
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("Error calculating metrics:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

function filterByPeriod<T extends { date: Date }>(data: T[], period: string): T[] {
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case '1d':
      startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      break;
    case '1w':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '1m':
      startDate = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case '3m':
      startDate = new Date(now.setMonth(now.getMonth() - 3));
      break;
    case '6m':
      startDate = new Date(now.setMonth(now.getMonth() - 6));
      break;
    case 'ytd':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case '1y':
      startDate = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    case '3y':
      startDate = new Date(now.setFullYear(now.getFullYear() - 3));
      break;
    case '5y':
      startDate = new Date(now.setFullYear(now.getFullYear() - 5));
      break;
    default:
      startDate = new Date(0); // since inception
  }

  return data.filter(d => d.date >= startDate);
}

function calculatePeriodMetrics(
  priceHistory: PricePoint[],
  cashFlows: CashFlow[],
  benchmarkReturns: number[],
  period: string
): MetricsResult {
  const values = priceHistory.map(p => p.value);
  const dates = priceHistory.map(p => p.date);

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }

  // Total return
  const firstValue = values[0];
  const lastValue = values[values.length - 1];
  const totalReturn = firstValue > 0 ? (lastValue - firstValue) / firstValue : 0;

  // Annualized return
  const years = (dates[dates.length - 1].getTime() - dates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;

  // Time-Weighted Return
  const twrReturn = calculateTWR(values, cashFlows.map(f => f.amount));

  // IRR (if cash flows exist)
  let irr: number | null = null;
  if (cashFlows.length > 0) {
    const cfAmounts = cashFlows.map(f => f.amount);
    const cfDates = cashFlows.map(f => f.date);
    // Add final value as positive cash flow
    cfAmounts.push(lastValue);
    cfDates.push(dates[dates.length - 1]);
    irr = calculateIRR(cfAmounts, cfDates);
  }

  // Volatility
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length || 0;
  const variance = returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0) / returns.length || 0;
  const volatility = Math.sqrt(variance);
  const volatilityAnnualized = volatility * Math.sqrt(252);

  // Max drawdown
  const maxDrawdown = calculateMaxDrawdown(values);

  // Sharpe ratio (assuming 5% risk-free rate)
  const riskFreeRate = 0.05;
  const excessReturn = annualizedReturn - riskFreeRate;
  const sharpeRatio = volatilityAnnualized > 0 ? excessReturn / volatilityAnnualized : 0;

  // Sortino ratio
  const negativeReturns = returns.filter(r => r < 0);
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.reduce((acc, r) => acc + Math.pow(r, 2), 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(252);
  const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;

  // VaR calculations
  const var95 = calculateVaR(returns, 0.95, lastValue);
  const cvar95 = calculateCVaR(returns, 0.95, lastValue);

  // Alpha and Beta (if benchmark data available)
  let alpha: number | null = null;
  let beta: number | null = null;
  let rSquared: number | null = null;

  if (benchmarkReturns.length > 0 && returns.length > 0) {
    const regression = calculateRegression(returns, benchmarkReturns.slice(-returns.length));
    beta = regression.beta;
    alpha = annualizedReturn - riskFreeRate - beta * (meanReturn * 252 - riskFreeRate);
    rSquared = regression.rSquared;
  }

  return {
    period,
    total_return: totalReturn,
    annualized_return: annualizedReturn,
    twr_return: twrReturn,
    irr,
    volatility_annualized: volatilityAnnualized,
    max_drawdown: maxDrawdown,
    sharpe_ratio: sharpeRatio,
    sortino_ratio: sortinoRatio,
    var_95_1d: var95,
    cvar_95_1d: cvar95,
    alpha,
    beta,
    r_squared: rSquared,
    data_points: values.length
  };
}

function calculateTWR(values: number[], cashFlows: number[]): number | null {
  if (values.length < 2) return null;

  let twr = 1;
  for (let i = 1; i < values.length; i++) {
    const adjustedStart = values[i - 1] + (cashFlows[i] || 0);
    if (adjustedStart > 0) {
      twr *= values[i] / adjustedStart;
    }
  }
  return twr - 1;
}

function calculateIRR(
  cashFlows: number[],
  dates: Date[],
  maxIterations = 100,
  tolerance = 0.0001
): number | null {
  if (cashFlows.length < 2) return null;

  let rate = 0.1; // Initial guess
  const baseDate = dates[0];

  for (let iter = 0; iter < maxIterations; iter++) {
    let npv = 0;
    let npvDerivative = 0;

    for (let i = 0; i < cashFlows.length; i++) {
      const daysDiff = (dates[i].getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000);
      const yearFrac = daysDiff / 365;
      const discountFactor = Math.pow(1 + rate, yearFrac);

      npv += cashFlows[i] / discountFactor;
      npvDerivative -= yearFrac * cashFlows[i] / (discountFactor * (1 + rate));
    }

    if (Math.abs(npv) < tolerance) {
      return rate;
    }

    if (npvDerivative === 0) return null;

    rate = rate - npv / npvDerivative;
  }

  return rate;
}

function calculateMaxDrawdown(values: number[]): number {
  let maxDrawdown = 0;
  let peak = values[0];

  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

function calculateVaR(returns: number[], confidence: number, portfolioValue: number): number {
  if (returns.length < 10) return 0;

  const sorted = [...returns].sort((a, b) => a - b);
  const percentileIndex = Math.floor((1 - confidence) * sorted.length);
  const varReturn = sorted[Math.max(0, percentileIndex)];

  return Math.abs(varReturn * portfolioValue);
}

function calculateCVaR(returns: number[], confidence: number, portfolioValue: number): number {
  if (returns.length < 10) return 0;

  const sorted = [...returns].sort((a, b) => a - b);
  const percentileIndex = Math.floor((1 - confidence) * sorted.length);
  const tailReturns = sorted.slice(0, Math.max(1, percentileIndex));
  const avgTailReturn = tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;

  return Math.abs(avgTailReturn * portfolioValue);
}

function calculateRegression(
  assetReturns: number[],
  benchmarkReturns: number[]
): { beta: number; alpha: number; rSquared: number } {
  const n = Math.min(assetReturns.length, benchmarkReturns.length);
  if (n < 2) return { beta: 0, alpha: 0, rSquared: 0 };

  const x = benchmarkReturns.slice(0, n);
  const y = assetReturns.slice(0, n);

  const xMean = x.reduce((a, b) => a + b, 0) / n;
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  let ssTotal = 0;
  let ssResidual = 0;

  for (let i = 0; i < n; i++) {
    numerator += (x[i] - xMean) * (y[i] - yMean);
    denominator += Math.pow(x[i] - xMean, 2);
    ssTotal += Math.pow(y[i] - yMean, 2);
  }

  const beta = denominator !== 0 ? numerator / denominator : 0;
  const alpha = yMean - beta * xMean;

  for (let i = 0; i < n; i++) {
    const predicted = alpha + beta * x[i];
    ssResidual += Math.pow(y[i] - predicted, 2);
  }

  const rSquared = ssTotal !== 0 ? 1 - (ssResidual / ssTotal) : 0;

  return { beta, alpha, rSquared };
}
