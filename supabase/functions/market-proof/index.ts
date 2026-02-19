/**
 * Market Proof Analysis Edge Function
 *
 * Automates comparable sales analysis for acquisition pipeline deals.
 * Queries bat_listings joined with vehicles to find comps, calculates
 * market statistics, scores the deal, and persists results.
 *
 * Input:  { pipeline_id: UUID }
 * Output: { success, deal_score, recommendation, comp_count, comp_median, ... }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompResult {
  listing_id: string;
  vehicle_id: string;
  sale_price: number;
  bid_count: number | null;
  sale_date: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  listing_url: string | null;
}

interface MarketProofResult {
  comp_count: number;
  comp_median: number | null;
  comp_avg: number | null;
  comp_min: number | null;
  comp_max: number | null;
  comp_prices: number[];
  comp_vehicle_ids: string[];
  discount_to_market: number | null;
  deal_score: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'FAIR' | 'PASS';
  risk_factors: string[];
  comps: CompResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute median of a sorted numeric array. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Extract model keywords for fuzzy matching.
 * e.g. "Chevelle SS 454 4-Speed" -> ["chevelle"]
 * We take the first word of the model as the primary keyword - this handles
 * BaT listings like "Chevelle Malibu SS 454 4-Speed" where the first word is
 * the canonical model name.
 */
function modelKeywords(model: string | null): string[] {
  if (!model) return [];
  const words = model.trim().split(/\s+/);
  // The first word is almost always the base model name
  // Filter out pure numbers and very short tokens
  const keywords: string[] = [];
  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z0-9/-]/g, '');
    if (clean.length >= 2 && !/^\d+$/.test(clean)) {
      keywords.push(clean.toLowerCase());
    }
  }
  // Return just the first meaningful keyword for matching
  return keywords.length > 0 ? [keywords[0]] : [];
}

/**
 * Score the deal based on discount_to_market percentage.
 * Returns { deal_score, recommendation }.
 */
function scoreDeal(discountPct: number | null): {
  deal_score: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'FAIR' | 'PASS';
} {
  // discountPct is positive when asking price is BELOW median (good deal)
  // discountPct is negative when asking price is ABOVE median (bad deal)
  if (discountPct === null) {
    return { deal_score: 50, recommendation: 'FAIR' };
  }

  if (discountPct >= 40) {
    return { deal_score: 90, recommendation: 'STRONG_BUY' };
  } else if (discountPct >= 25) {
    return { deal_score: 80, recommendation: 'STRONG_BUY' };
  } else if (discountPct >= 15) {
    return { deal_score: 70, recommendation: 'BUY' };
  } else if (discountPct >= 5) {
    return { deal_score: 60, recommendation: 'BUY' };
  } else if (discountPct >= -5) {
    return { deal_score: 50, recommendation: 'FAIR' };
  } else if (discountPct >= -15) {
    return { deal_score: 35, recommendation: 'PASS' };
  } else {
    return { deal_score: 20, recommendation: 'PASS' };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  // CORS preflight
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

    // -----------------------------------------------------------------------
    // 1. Initialize Supabase client
    // -----------------------------------------------------------------------
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // -----------------------------------------------------------------------
    // 2. Look up the pipeline row
    // -----------------------------------------------------------------------
    const { data: pipeline, error: pipelineError } = await supabase
      .from('acquisition_pipeline')
      .select('*')
      .eq('id', pipelineId)
      .maybeSingle();

    if (pipelineError) {
      throw new Error(`Failed to fetch pipeline: ${pipelineError.message}`);
    }
    if (!pipeline) {
      return new Response(
        JSON.stringify({ error: `Pipeline row not found: ${pipelineId}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { year, make, model, engine, asking_price } = pipeline;

    if (!make) {
      return new Response(
        JSON.stringify({ error: 'Pipeline row missing make - cannot find comps' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    console.log(`[market-proof] Analyzing: ${year || '?'} ${make} ${model || '?'} | asking: $${asking_price || 'N/A'}`);

    // -----------------------------------------------------------------------
    // 3. Find comparable sales via optimized RPC function
    // -----------------------------------------------------------------------
    const { data: rawComps, error: compError } = await supabase
      .rpc('find_bat_comps', {
        p_make: make,
        p_model: model || null,
        p_year: year || null,
        p_year_range: 2,
        p_limit: 200,
      });

    if (compError) {
      throw new Error(`Comp query failed: ${compError.message}`);
    }

    console.log(`[market-proof] Raw comp pool: ${rawComps?.length || 0} listings for ${make}`);

    // -----------------------------------------------------------------------
    // 4. Filter by model keyword matching
    // -----------------------------------------------------------------------
    const targetKeywords = modelKeywords(model);
    let filteredComps: CompResult[] = [];

    if (rawComps && rawComps.length > 0) {
      for (const row of rawComps) {
        const compModel = row.v_model as string | null;

        // If we have model keywords, require at least one to match
        if (targetKeywords.length > 0 && compModel) {
          const compModelLower = compModel.toLowerCase();
          const matches = targetKeywords.some((kw) => compModelLower.includes(kw));
          if (!matches) continue;
        } else if (targetKeywords.length > 0 && !compModel) {
          // Target has model keywords but comp has no model - skip
          continue;
        }
        // If target has no model keywords, accept all make+year matches

        filteredComps.push({
          listing_id: row.listing_id,
          vehicle_id: row.vehicle_id,
          sale_price: row.sale_price,
          bid_count: row.bid_count,
          sale_date: row.sale_date,
          year: row.v_year,
          make: row.v_make,
          model: row.v_model,
          listing_url: row.bat_listing_url,
        });
      }
    }

    console.log(`[market-proof] Filtered comps (model match): ${filteredComps.length}`);

    // If model-filtered comps are too few, fall back to make+year only
    if (filteredComps.length < 3 && rawComps && rawComps.length > 0) {
      console.log(`[market-proof] Too few model matches, falling back to make+year pool`);
      filteredComps = (rawComps || []).map((row) => ({
          listing_id: row.listing_id,
          vehicle_id: row.vehicle_id,
          sale_price: row.sale_price,
          bid_count: row.bid_count,
          sale_date: row.sale_date,
          year: row.v_year,
          make: row.v_make,
          model: row.v_model,
          listing_url: row.bat_listing_url,
      }));
    }

    // -----------------------------------------------------------------------
    // 5. Calculate statistics
    // -----------------------------------------------------------------------
    const prices = filteredComps.map((c) => c.sale_price).sort((a, b) => a - b);
    const compCount = prices.length;
    const compMedian = compCount > 0 ? median(prices) : null;
    const compAvg = compCount > 0
      ? Math.round(prices.reduce((s, p) => s + p, 0) / compCount)
      : null;
    const compMin = compCount > 0 ? prices[0] : null;
    const compMax = compCount > 0 ? prices[prices.length - 1] : null;
    const compVehicleIds = filteredComps.map((c) => c.vehicle_id);

    // -----------------------------------------------------------------------
    // 6. Calculate discount_to_market & deal score
    // -----------------------------------------------------------------------
    let discountToMarket: number | null = null;
    if (asking_price && compMedian && compMedian > 0) {
      // Positive = below median (good), negative = above median (bad)
      discountToMarket = Math.round(((compMedian - asking_price) / compMedian) * 10000) / 100;
    }

    const { deal_score, recommendation } = scoreDeal(discountToMarket);

    // -----------------------------------------------------------------------
    // 7. Identify risk factors
    // -----------------------------------------------------------------------
    const riskFactors: string[] = [];

    if (compCount < 3) {
      riskFactors.push(`Low comp count (${compCount}) - thin market data`);
    }
    if (compCount < 10 && compCount >= 3) {
      riskFactors.push(`Moderate comp count (${compCount}) - limited market data`);
    }
    if (compMax && compMin && compMax > 0) {
      const spread = ((compMax - compMin) / compMax) * 100;
      if (spread > 70) {
        riskFactors.push(`High price spread (${Math.round(spread)}%) - volatile segment`);
      }
    }
    if (!asking_price) {
      riskFactors.push('No asking price provided - cannot calculate discount to market');
    }
    if (!model) {
      riskFactors.push('No model specified - comps based on make+year only');
    }

    // Check if comps are stale (most recent sale > 12 months old)
    const mostRecentSale = filteredComps.find((c) => c.sale_date);
    if (mostRecentSale?.sale_date) {
      const saleDate = new Date(mostRecentSale.sale_date);
      const monthsAgo = (Date.now() - saleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      if (monthsAgo > 12) {
        riskFactors.push(`Most recent comp is ${Math.round(monthsAgo)} months old - market may have shifted`);
      }
    }

    console.log(`[market-proof] Results: count=${compCount} median=$${compMedian} avg=$${compAvg} score=${deal_score} rec=${recommendation}`);

    // -----------------------------------------------------------------------
    // 8. Build result
    // -----------------------------------------------------------------------
    const result: MarketProofResult = {
      comp_count: compCount,
      comp_median: compMedian,
      comp_avg: compAvg,
      comp_min: compMin,
      comp_max: compMax,
      comp_prices: prices,
      comp_vehicle_ids: compVehicleIds,
      discount_to_market: discountToMarket,
      deal_score,
      recommendation,
      risk_factors: riskFactors,
      comps: filteredComps.slice(0, 50), // Cap detail list at 50
    };

    // -----------------------------------------------------------------------
    // 9. Update acquisition_pipeline row
    // -----------------------------------------------------------------------
    const { error: updateError } = await supabase
      .from('acquisition_pipeline')
      .update({
        deal_score,
        comp_count: compCount,
        comp_median: compMedian,
        comp_avg: compAvg,
        estimated_value: compMedian,
        estimated_profit: asking_price && compMedian ? compMedian - asking_price : null,
        confidence_score: compCount >= 10 ? 85 : compCount >= 5 ? 70 : compCount >= 3 ? 55 : 30,
        stage: 'market_proofed',
        market_proof_data: {
          recommendation,
          discount_to_market: discountToMarket,
          comp_min: compMin,
          comp_max: compMax,
          risk_factors: riskFactors,
          analyzed_at: new Date().toISOString(),
          comp_sample: filteredComps.slice(0, 10).map((c) => ({
            year: c.year,
            model: c.model,
            sale_price: c.sale_price,
            sale_date: c.sale_date,
            bid_count: c.bid_count,
          })),
        },
      })
      .eq('id', pipelineId);

    if (updateError) {
      console.error(`[market-proof] Pipeline update failed: ${updateError.message}`);
      throw new Error(`Failed to update pipeline: ${updateError.message}`);
    }

    console.log(`[market-proof] Pipeline ${pipelineId} updated to market_proofed`);

    // -----------------------------------------------------------------------
    // 10. Insert market_proof_reports row
    // -----------------------------------------------------------------------
    const { error: reportError } = await supabase
      .from('market_proof_reports')
      .insert({
        pipeline_id: pipelineId,
        vehicle_id: pipeline.vehicle_id || null,
        comp_vehicle_ids: compVehicleIds,
        comp_count: compCount,
        comp_prices: prices,
        comp_median: compMedian,
        comp_avg: compAvg,
        comp_min: compMin,
        comp_max: compMax,
        estimated_value: compMedian,
        estimated_value_low: compMin,
        estimated_value_high: compMax,
        asking_price: asking_price || null,
        discount_to_market: discountToMarket,
        recommendation,
        risk_factors: riskFactors,
        total_bids_analyzed: filteredComps.reduce((s, c) => s + (c.bid_count || 0), 0),
        segment_analysis: {
          target: {
            year,
            make,
            model,
            engine,
          },
          match_strategy: targetKeywords.length > 0 ? 'model_keyword' : 'make_year_only',
          model_keywords: targetKeywords,
          year_range: year ? [year - 2, year + 2] : null,
          raw_pool_size: rawComps?.length || 0,
          filtered_pool_size: filteredComps.length,
        },
        report_generated_at: new Date().toISOString(),
      });

    if (reportError) {
      console.error(`[market-proof] Report insert failed: ${reportError.message}`);
      // Non-fatal: pipeline was already updated
    } else {
      console.log(`[market-proof] Report inserted for pipeline ${pipelineId}`);
    }

    // -----------------------------------------------------------------------
    // 11. Return response
    // -----------------------------------------------------------------------
    return new Response(
      JSON.stringify({
        success: true,
        pipeline_id: pipelineId,
        deal_score,
        recommendation,
        discount_to_market: discountToMarket,
        comp_count: compCount,
        comp_median: compMedian,
        comp_avg: compAvg,
        comp_min: compMin,
        comp_max: compMax,
        risk_factors: riskFactors,
        asking_price: asking_price || null,
        comps: filteredComps.slice(0, 20).map((c) => ({
          year: c.year,
          make: c.make,
          model: c.model,
          sale_price: c.sale_price,
          sale_date: c.sale_date,
          bid_count: c.bid_count,
          listing_url: c.listing_url,
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
