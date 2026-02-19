/**
 * Market Proof Analysis Edge Function (v2)
 *
 * Realistic comp-based market analysis with condition tiering and
 * cost-to-ready estimates. Bridges the gap between asking price and
 * comparable sales by estimating parts + labor needed.
 *
 * Key improvements over v1:
 * - Tight model matching (Road Runner != Superbird)
 * - Engine/trim tier separation (383 != Hemi)
 * - Condition tier inference from price positioning
 * - Cost-to-ready estimation (parts + labor)
 * - Realistic net profit calculation
 *
 * Input:  { pipeline_id: UUID }
 * Output: { success, deal_score, recommendation, comp_count, comp_median, cost_to_ready, net_profit, ... }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawComp {
  listing_id: string;
  vehicle_id: string;
  sale_price: number;
  bid_count: number | null;
  sale_date: string | null;
  v_year: number | null;
  v_make: string | null;
  v_model: string | null;
  v_engine_size: string | null;
}

interface CompResult {
  listing_id: string;
  vehicle_id: string;
  sale_price: number;
  bid_count: number | null;
  sale_date: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  engine_size: string | null;
  listing_url: string | null;
  match_tier: 'exact' | 'model' | 'make_year';
}

interface CostEstimate {
  condition_tier: 'project' | 'driver' | 'nice' | 'excellent';
  estimated_mechanical: number;
  estimated_body_paint: number;
  estimated_interior: number;
  estimated_misc: number;
  estimated_labor_hours: number;
  labor_rate: number;
  total_parts: number;
  total_labor: number;
  total_cost_to_ready: number;
  transport_estimate: number;
  inspection_cost: number;
  listing_fees_pct: number;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * pct);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/** High-value engine keywords that dramatically affect price */
const HEMI_KEYWORDS = ['hemi', '426', 'hemi 426'];
const BIG_BLOCK_KEYWORDS = ['440', '454', '427', '428', '429', '455', '400', '396', '390', 'big block', 'bb'];
const SPECIAL_TRIM = ['z28', 'z/28', 'ss', 'yenko', 'copo', 'l88', 'l78', 'l89', 'zl1', 'judge', 'ram air', 'six pack', '6-pack', '440+6', 'a12', 'superbird', 'daytona'];

/**
 * Determine if a comp is in the same engine/trim tier as the target.
 * This is critical - a Hemi Road Runner ($120K+) is NOT a comp for a 383 Road Runner ($30-50K).
 */
function engineTierMatch(targetModel: string | null, compModel: string | null): boolean {
  if (!targetModel || !compModel) return true; // can't filter if no data

  const targetLower = targetModel.toLowerCase();
  const compLower = compModel.toLowerCase();

  // Check if target is a Hemi car
  const targetIsHemi = HEMI_KEYWORDS.some(kw => targetLower.includes(kw));
  const compIsHemi = HEMI_KEYWORDS.some(kw => compLower.includes(kw));

  // Hemi cars are their own universe - don't mix
  if (targetIsHemi !== compIsHemi) return false;

  // Check for special high-value trims
  const targetHasSpecial = SPECIAL_TRIM.some(kw => targetLower.includes(kw));
  const compHasSpecial = SPECIAL_TRIM.some(kw => compLower.includes(kw));

  // If target is NOT special but comp IS, exclude it (inflates value)
  // If target IS special, include both (special comps are better but standard ones add data)
  if (!targetIsHemi && !targetHasSpecial && compIsHemi) return false;

  return true;
}

/**
 * Extract base model name for matching.
 * "Road Runner 383 4-Speed" -> "road runner"
 * "Camaro SS 396 4-Speed" -> "camaro"
 */
function baseModelName(model: string | null): string {
  if (!model) return '';
  const lower = model.toLowerCase().trim();

  // Two-word models
  const twoWordModels = ['road runner', 'el camino', 'grand prix', 'super bee', 'trans am'];
  for (const twm of twoWordModels) {
    if (lower.includes(twm)) return twm;
  }

  // Single-word model (first word that's not a number)
  const words = lower.split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/[^a-z0-9/-]/g, '');
    if (clean.length >= 2 && !/^\d+$/.test(clean)) return clean;
  }
  return '';
}

/**
 * Estimate condition tier based on where asking price falls relative to comps.
 * A $14K Road Runner among $30-60K comps is clearly a project car.
 */
function inferConditionTier(
  askingPrice: number,
  compMedian: number,
  compP25: number,
): 'project' | 'driver' | 'nice' | 'excellent' {
  if (compMedian === 0) return 'driver';
  const ratio = askingPrice / compMedian;

  if (ratio < 0.35) return 'project';    // < 35% of median = project/barn find
  if (ratio < 0.60) return 'driver';     // 35-60% of median = rough driver
  if (ratio < 0.85) return 'nice';       // 60-85% = nice driver
  return 'excellent';                     // 85%+ = nice/excellent condition
}

/**
 * Estimate cost to get a car ready for resale.
 * Based on condition tier and typical costs for muscle car restoration.
 * These are CONSERVATIVE estimates - real costs often run higher.
 */
function estimateCostToReady(
  conditionTier: 'project' | 'driver' | 'nice' | 'excellent',
  askingPrice: number,
): CostEstimate {
  const laborRate = 75; // $/hr average shop rate
  const notes: string[] = [];

  let mechanical = 0, bodyPaint = 0, interior = 0, misc = 0, laborHours = 0;

  switch (conditionTier) {
    case 'project':
      // Needs everything: engine rebuild, bodywork, paint, interior, chrome, etc.
      mechanical = 4000;  // engine rebuild/repair, carb, ignition, cooling
      bodyPaint = 6000;   // rust repair, bodywork, primer, paint
      interior = 2000;    // seats, carpet, headliner, gauges
      misc = 1500;        // chrome, trim, weatherstripping, gaskets
      laborHours = 200;   // 200+ hours typical for project
      notes.push('Project car - expect significant mechanical and body work');
      notes.push('Budget may need to increase 30-50% for unforeseen issues');
      notes.push('Timeline: 3-6 months typical');
      break;

    case 'driver':
      // Runs/drives but needs cosmetic and mechanical freshening
      mechanical = 2000;  // tune-up, brakes, suspension refresh
      bodyPaint = 3000;   // minor bodywork, respray likely needed
      interior = 1000;    // clean up, replace worn items
      misc = 800;         // miscellaneous
      laborHours = 80;
      notes.push('Driver condition - needs cosmetic freshening for resale');
      notes.push('Should drive and stop safely as-is');
      break;

    case 'nice':
      // Presentable, needs minor items for top dollar
      mechanical = 500;   // fluid change, tune, minor items
      bodyPaint = 1000;   // detail, touch-up, minor correction
      interior = 300;     // detail, minor fixes
      misc = 400;
      laborHours = 25;
      notes.push('Nice condition - minimal work needed for resale');
      break;

    case 'excellent':
      // Already sale-ready
      mechanical = 200;
      bodyPaint = 300;
      interior = 100;
      misc = 200;
      laborHours = 8;
      notes.push('Excellent condition - detail and safety check only');
      break;
  }

  const totalParts = mechanical + bodyPaint + interior + misc;
  const totalLabor = laborHours * laborRate;
  const transport = 1000; // average domestic transport
  const inspection = 350;
  const listingFeesPct = 8; // BaT/C&B fees ~5-8%

  return {
    condition_tier: conditionTier,
    estimated_mechanical: mechanical,
    estimated_body_paint: bodyPaint,
    estimated_interior: interior,
    estimated_misc: misc,
    estimated_labor_hours: laborHours,
    labor_rate: laborRate,
    total_parts: totalParts,
    total_labor: totalLabor,
    total_cost_to_ready: totalParts + totalLabor,
    transport_estimate: transport,
    inspection_cost: inspection,
    listing_fees_pct: listingFeesPct,
    notes,
  };
}

/**
 * Score the deal based on estimated NET profit after all costs.
 * This is the REAL score - not just discount to sticker.
 */
function scoreDeal(netProfit: number | null, roi: number | null, compCount: number): {
  deal_score: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'FAIR' | 'PASS';
} {
  if (netProfit === null || roi === null) {
    return { deal_score: 40, recommendation: 'FAIR' };
  }

  // Penalize for low comp count
  const compPenalty = compCount < 3 ? 15 : compCount < 5 ? 8 : compCount < 10 ? 3 : 0;

  let baseScore: number;
  let rec: 'STRONG_BUY' | 'BUY' | 'FAIR' | 'PASS';

  if (netProfit <= 0) {
    baseScore = 20;
    rec = 'PASS';
  } else if (roi >= 50 && netProfit >= 10000) {
    baseScore = 90;
    rec = 'STRONG_BUY';
  } else if (roi >= 30 && netProfit >= 5000) {
    baseScore = 80;
    rec = 'STRONG_BUY';
  } else if (roi >= 20 && netProfit >= 3000) {
    baseScore = 70;
    rec = 'BUY';
  } else if (roi >= 10 && netProfit >= 1000) {
    baseScore = 60;
    rec = 'BUY';
  } else if (netProfit > 0) {
    baseScore = 50;
    rec = 'FAIR';
  } else {
    baseScore = 30;
    rec = 'PASS';
  }

  const finalScore = Math.max(10, baseScore - compPenalty);
  // Adjust rec down if penalty dropped us significantly
  if (finalScore < 70 && rec === 'STRONG_BUY') rec = 'BUY';
  if (finalScore < 55 && rec === 'BUY') rec = 'FAIR';

  return { deal_score: finalScore, recommendation: rec };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const pipelineId: string | undefined = body.pipeline_id;

    if (!pipelineId) {
      return new Response(
        JSON.stringify({ error: 'pipeline_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. Look up pipeline row
    const { data: pipeline, error: pipelineError } = await supabase
      .from('acquisition_pipeline')
      .select('*')
      .eq('id', pipelineId)
      .maybeSingle();

    if (pipelineError) throw new Error(`Pipeline fetch: ${pipelineError.message}`);
    if (!pipeline) {
      return new Response(
        JSON.stringify({ error: `Pipeline row not found: ${pipelineId}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { year, make, model, engine, asking_price } = pipeline;
    if (!make) {
      return new Response(
        JSON.stringify({ error: 'Pipeline row missing make' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[market-proof] Analyzing: ${year || '?'} ${make} ${model || '?'} | asking: $${asking_price || 'N/A'}`);

    // 2. Find comps with MODEL filtering in the RPC (now fixed)
    const targetBase = baseModelName(model);
    const { data: rawComps, error: compError } = await supabase
      .rpc('find_bat_comps', {
        p_make: make,
        p_model: targetBase || null, // Use base model name for DB-level filter
        p_year: year || null,
        p_year_range: 2,
        p_limit: 200,
      });

    if (compError) throw new Error(`Comp query: ${compError.message}`);
    console.log(`[market-proof] Raw comp pool: ${rawComps?.length || 0}`);

    // 3. Filter by engine/trim tier
    const allComps: CompResult[] = [];
    const exactModelComps: CompResult[] = [];
    const modelComps: CompResult[] = [];

    if (rawComps && rawComps.length > 0) {
      for (const row of rawComps as RawComp[]) {
        // Engine tier check - exclude Hemis from 383 comps, etc.
        if (!engineTierMatch(model, row.v_model)) continue;

        const comp: CompResult = {
          listing_id: row.listing_id,
          vehicle_id: row.vehicle_id,
          sale_price: row.sale_price,
          bid_count: row.bid_count,
          sale_date: row.sale_date,
          year: row.v_year,
          make: row.v_make,
          model: row.v_model,
          engine_size: row.v_engine_size,
          listing_url: '', // not in RPC response
          match_tier: 'make_year',
        };

        // Check model match quality
        const compBase = baseModelName(row.v_model);
        if (targetBase && compBase === targetBase) {
          comp.match_tier = 'exact';
          exactModelComps.push(comp);
        } else if (targetBase && compBase && compBase.includes(targetBase)) {
          comp.match_tier = 'model';
          modelComps.push(comp);
        }

        allComps.push(comp);
      }
    }

    // Use best available comp set
    let bestComps: CompResult[];
    let matchStrategy: string;

    if (exactModelComps.length >= 3) {
      bestComps = exactModelComps;
      matchStrategy = `exact_model (${targetBase})`;
    } else if (modelComps.length + exactModelComps.length >= 3) {
      bestComps = [...exactModelComps, ...modelComps];
      matchStrategy = `model_fuzzy (${targetBase})`;
    } else if (allComps.length >= 3) {
      bestComps = allComps;
      matchStrategy = `make_year (${make} ${year || 'any'})`;
    } else {
      // Widen search - remove model filter, try just make+year
      const { data: wideComps } = await supabase.rpc('find_bat_comps', {
        p_make: make,
        p_model: null,
        p_year: year || null,
        p_year_range: 3,
        p_limit: 200,
      });

      bestComps = (wideComps || []).filter((row: RawComp) => engineTierMatch(model, row.v_model)).map((row: RawComp) => ({
        listing_id: row.listing_id,
        vehicle_id: row.vehicle_id,
        sale_price: row.sale_price,
        bid_count: row.bid_count,
        sale_date: row.sale_date,
        year: row.v_year,
        make: row.v_make,
        model: row.v_model,
        engine_size: row.v_engine_size,
        listing_url: '',
        match_tier: 'make_year' as const,
      }));
      matchStrategy = `wide_make_year (${make} +/-3yr)`;
    }

    console.log(`[market-proof] Match strategy: ${matchStrategy}, comps: ${bestComps.length}`);

    // 4. Calculate statistics
    const prices = bestComps.map(c => c.sale_price).sort((a, b) => a - b);
    const compCount = prices.length;
    const compMedian = compCount > 0 ? median(prices) : null;
    const compAvg = compCount > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / compCount) : null;
    const compMin = compCount > 0 ? prices[0] : null;
    const compMax = compCount > 0 ? prices[prices.length - 1] : null;
    const compP25 = compCount > 0 ? percentile(prices, 0.25) : null;
    const compP75 = compCount > 0 ? percentile(prices, 0.75) : null;

    // 5. Condition tier and cost-to-ready analysis
    let costEstimate: CostEstimate | null = null;
    let conditionTier: string | null = null;
    let netProfit: number | null = null;
    let totalInvestment: number | null = null;
    let roi: number | null = null;
    let targetSalePrice: number | null = null;

    if (asking_price && compMedian && compP25) {
      conditionTier = inferConditionTier(asking_price, compMedian, compP25);
      costEstimate = estimateCostToReady(conditionTier as 'project' | 'driver' | 'nice' | 'excellent', asking_price);

      // Target sale price: use P25-P50 range based on condition
      // A project car maxes out at driver condition; a nice car can hit median+
      switch (conditionTier) {
        case 'project':
          // After restoration, realistically hits P25-P40 range
          // (won't be numbers-matching concours, just a nice driver)
          targetSalePrice = Math.round(compP25 + (compMedian - compP25) * 0.3);
          break;
        case 'driver':
          // Freshened up, hits P25-median range
          targetSalePrice = Math.round((compP25 + compMedian) / 2);
          break;
        case 'nice':
          // Already nice, can hit near median
          targetSalePrice = compMedian;
          break;
        case 'excellent':
          // Can hit median or above
          targetSalePrice = compP75 ? Math.round((compMedian + compP75) / 2) : compMedian;
          break;
      }

      const listingFees = Math.round(targetSalePrice * costEstimate.listing_fees_pct / 100);
      totalInvestment = asking_price + costEstimate.total_cost_to_ready + costEstimate.transport_estimate + costEstimate.inspection_cost;
      netProfit = targetSalePrice - totalInvestment - listingFees;
      roi = totalInvestment > 0 ? Math.round((netProfit / totalInvestment) * 1000) / 10 : null;
    }

    // 6. Score based on NET economics
    const { deal_score, recommendation } = scoreDeal(netProfit, roi, compCount);

    // 7. Risk factors
    const riskFactors: string[] = [];
    if (compCount < 3) riskFactors.push(`Very few comps (${compCount}) - unreliable valuation`);
    else if (compCount < 5) riskFactors.push(`Low comp count (${compCount}) - limited confidence`);
    if (compMax && compMin && compMax > 0) {
      const spread = ((compMax - compMin) / compMax) * 100;
      if (spread > 70) riskFactors.push(`High price spread (${Math.round(spread)}%) - value highly condition-dependent`);
    }
    if (conditionTier === 'project') {
      riskFactors.push('Project car - costs can escalate 30-100% beyond estimate');
      riskFactors.push('Hidden rust, numbers-matching status, and part availability are key risks');
    }
    if (!asking_price) riskFactors.push('No asking price - cannot model economics');
    if (!model) riskFactors.push('No model specified - comps may not be comparable');
    if (asking_price && compMedian && asking_price / compMedian < 0.20) {
      riskFactors.push('Price is < 20% of median - likely parts car or major issues');
    }

    const discountToMarket = asking_price && compMedian && compMedian > 0
      ? Math.round(((compMedian - asking_price) / compMedian) * 10000) / 100
      : null;

    console.log(`[market-proof] Results: comps=${compCount} median=$${compMedian} tier=${conditionTier} net=$${netProfit} roi=${roi}% score=${deal_score} rec=${recommendation}`);

    // 8. Build market_proof_data for pipeline row
    const proofData = {
      recommendation,
      match_strategy: matchStrategy,
      condition_tier: conditionTier,
      discount_to_market: discountToMarket,
      comp_min: compMin,
      comp_max: compMax,
      comp_p25: compP25,
      comp_p75: compP75,
      cost_to_ready: costEstimate?.total_cost_to_ready || null,
      target_sale_price: targetSalePrice,
      net_profit: netProfit,
      roi_pct: roi,
      total_investment: totalInvestment,
      cost_breakdown: costEstimate ? {
        parts: costEstimate.total_parts,
        labor: costEstimate.total_labor,
        labor_hours: costEstimate.estimated_labor_hours,
        transport: costEstimate.transport_estimate,
        inspection: costEstimate.inspection_cost,
        listing_fees_pct: costEstimate.listing_fees_pct,
      } : null,
      risk_factors: riskFactors,
      cost_notes: costEstimate?.notes || [],
      analyzed_at: new Date().toISOString(),
      comp_sample: bestComps.slice(0, 10).map(c => ({
        year: c.year, model: c.model, sale_price: c.sale_price,
        sale_date: c.sale_date, bid_count: c.bid_count, match_tier: c.match_tier,
      })),
    };

    // 9. Update pipeline row
    const { error: updateError } = await supabase
      .from('acquisition_pipeline')
      .update({
        deal_score,
        comp_count: compCount,
        comp_median: compMedian,
        comp_avg: compAvg,
        estimated_value: targetSalePrice,
        estimated_profit: netProfit,
        confidence_score: compCount >= 10 ? 85 : compCount >= 5 ? 70 : compCount >= 3 ? 55 : 30,
        stage: 'market_proofed',
        market_proof_data: proofData,
      })
      .eq('id', pipelineId);

    if (updateError) throw new Error(`Pipeline update: ${updateError.message}`);

    // 10. Insert report
    const { error: reportError } = await supabase
      .from('market_proof_reports')
      .insert({
        pipeline_id: pipelineId,
        vehicle_id: pipeline.vehicle_id || null,
        comp_vehicle_ids: bestComps.map(c => c.vehicle_id),
        comp_count: compCount,
        comp_prices: prices,
        comp_median: compMedian,
        comp_avg: compAvg,
        comp_min: compMin,
        comp_max: compMax,
        estimated_value: targetSalePrice,
        estimated_value_low: compP25,
        estimated_value_high: compP75,
        asking_price: asking_price || null,
        discount_to_market: discountToMarket,
        recommendation,
        risk_factors: riskFactors,
        total_bids_analyzed: bestComps.reduce((s, c) => s + (c.bid_count || 0), 0),
        segment_analysis: {
          target: { year, make, model, engine },
          match_strategy: matchStrategy,
          base_model: targetBase,
          condition_tier: conditionTier,
          cost_to_ready: costEstimate?.total_cost_to_ready,
          target_sale_price: targetSalePrice,
          net_profit: netProfit,
          roi_pct: roi,
        },
        report_generated_at: new Date().toISOString(),
      });

    if (reportError) console.error(`[market-proof] Report insert: ${reportError.message}`);

    // 11. Response
    return new Response(
      JSON.stringify({
        success: true,
        pipeline_id: pipelineId,
        vehicle: `${year || '?'} ${make} ${model || '?'}`,
        asking_price: asking_price || null,

        // Market data
        comp_count: compCount,
        comp_median: compMedian,
        comp_avg: compAvg,
        comp_min: compMin,
        comp_max: compMax,
        comp_p25: compP25,
        comp_p75: compP75,
        match_strategy: matchStrategy,

        // Condition & costs
        condition_tier: conditionTier,
        cost_to_ready: costEstimate?.total_cost_to_ready || null,
        cost_breakdown: costEstimate ? {
          mechanical: costEstimate.estimated_mechanical,
          body_paint: costEstimate.estimated_body_paint,
          interior: costEstimate.estimated_interior,
          misc: costEstimate.estimated_misc,
          labor_hours: costEstimate.estimated_labor_hours,
          labor_rate: costEstimate.labor_rate,
          total_parts: costEstimate.total_parts,
          total_labor: costEstimate.total_labor,
          transport: costEstimate.transport_estimate,
          inspection: costEstimate.inspection_cost,
          listing_fees_pct: costEstimate.listing_fees_pct,
        } : null,
        cost_notes: costEstimate?.notes || [],

        // Economics
        total_investment: totalInvestment,
        target_sale_price: targetSalePrice,
        net_profit: netProfit,
        roi_pct: roi,

        // Scoring
        deal_score,
        recommendation,
        discount_to_market: discountToMarket,
        risk_factors: riskFactors,

        // Comps
        comps: bestComps.slice(0, 20).map(c => ({
          year: c.year, make: c.make, model: c.model,
          sale_price: c.sale_price, sale_date: c.sale_date,
          bid_count: c.bid_count, match_tier: c.match_tier,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[market-proof] Error: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
