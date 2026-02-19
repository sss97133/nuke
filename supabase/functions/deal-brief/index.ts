/**
 * Deal Brief Edge Function
 *
 * Generates a comprehensive acquisition brief for a pipeline target.
 * Combines market proof data, comp analysis, risk assessment, and
 * recommended offer strategy into one actionable document.
 *
 * Input:  { pipeline_id: UUID } or { top_n: number } for top deals
 * Output: Deal brief with comps, risk factors, offer strategy
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pipeline_id, top_n } = await req.json().catch(() => ({}));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // If top_n requested, return briefs for top N targets
    if (top_n && !pipeline_id) {
      const { data: topTargets } = await supabase
        .from('acquisition_pipeline')
        .select('*')
        .eq('stage', 'target')
        .not('comp_median', 'is', null)
        .not('asking_price', 'is', null)
        .order('deal_score', { ascending: false })
        .limit(top_n);

      if (!topTargets || topTargets.length === 0) {
        return new Response(
          JSON.stringify({ briefs: [], message: 'No targets found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const briefs = topTargets.map((t) => buildBrief(t));
      return new Response(
        JSON.stringify({ briefs, count: briefs.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!pipeline_id) {
      return new Response(
        JSON.stringify({ error: 'pipeline_id or top_n required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch the pipeline entry
    const { data: entry, error: fetchError } = await supabase
      .from('acquisition_pipeline')
      .select('*')
      .eq('id', pipeline_id)
      .single();

    if (fetchError || !entry) {
      return new Response(
        JSON.stringify({ error: 'Pipeline entry not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch comps from BaT
    let comps: Comp[] = [];
    try {
      const { data: compData } = await supabase.rpc('find_bat_comps', {
        p_make: entry.make,
        p_model: entry.model ? (entry.model as string).split(' ')[0] : null,
        p_year: entry.year,
        p_year_range: 3,
        p_limit: 50,
      });
      if (compData) comps = compData;
    } catch { /* no comps available */ }

    // Fetch market proof report if exists
    const { data: reports } = await supabase
      .from('market_proof_reports')
      .select('*')
      .eq('pipeline_id', pipeline_id)
      .order('created_at', { ascending: false })
      .limit(1);

    const brief = buildBrief(entry, comps || [], reports?.[0] || null);

    return new Response(
      JSON.stringify(brief),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

interface Comp {
  sale_price: number;
  v_year?: number;
  v_make?: string;
  v_model?: string;
  sale_date?: string;
  bat_listing_url?: string;
  bid_count?: number;
}

function buildBrief(
  entry: Record<string, unknown>,
  comps: Comp[] = [],
  report: Record<string, unknown> | null = null,
) {
  const askingPrice = (entry.asking_price as number) || 0;
  const compMedian = (entry.comp_median as number) || 0;
  const dealScore = (entry.deal_score as number) || 0;
  const upside = compMedian && askingPrice ? compMedian - askingPrice : 0;
  const discountPct = compMedian > 0 ? Math.round(((compMedian - askingPrice) / compMedian) * 1000) / 10 : 0;

  // Comp analysis
  const compPrices = comps.filter((c) => c.sale_price > 0).map((c) => c.sale_price).sort((a, b) => a - b);
  const compStats = compPrices.length > 0 ? {
    count: compPrices.length,
    min: compPrices[0],
    max: compPrices[compPrices.length - 1],
    median: compPrices[Math.floor(compPrices.length / 2)],
    avg: Math.round(compPrices.reduce((s, p) => s + p, 0) / compPrices.length),
    p25: compPrices[Math.floor(compPrices.length * 0.25)],
    p75: compPrices[Math.floor(compPrices.length * 0.75)],
  } : null;

  // Risk assessment
  const risks: string[] = [];
  const positives: string[] = [];

  if (discountPct > 70) risks.push('Extreme discount may indicate undisclosed issues');
  if (discountPct > 50) risks.push('Significant below-market pricing - verify condition carefully');
  if (!entry.discovery_url || !(entry.discovery_url as string).startsWith('http')) risks.push('No direct listing URL - may need to search manually');
  if (askingPrice < 10000) risks.push('Very low price point - likely project/incomplete car');
  if (askingPrice < 5000) risks.push('Sub-$5K - expect major mechanical/body work needed');

  if (dealScore >= 85) positives.push('Strong deal score indicates solid opportunity');
  if (compPrices.length >= 10) positives.push('Good comp volume supports valuation confidence');
  if (discountPct >= 30 && discountPct <= 50) positives.push('Sweet spot discount range - real upside with reasonable condition expectations');
  if (entry.location_state === 'AZ' || entry.location_state === 'CA' || entry.location_state === 'NV' || entry.location_state === 'TX') {
    positives.push('Dry climate state - likely less rust');
  }

  // Offer strategy
  const conservativeOffer = Math.round(askingPrice * 0.8);
  const aggressiveOffer = Math.round(askingPrice * 0.7);
  const maxOffer = Math.round(compMedian * 0.5); // 50% of comp median = safe margin

  // Estimated costs
  const estimatedInspection = 350;
  const estimatedTransport = entry.location_state === 'CA' ? 500 : entry.location_state === 'TX' ? 800 : 1200;
  const estimatedRecon = askingPrice < 15000 ? 8000 : askingPrice < 30000 ? 5000 : 3000;
  const estimatedTotalIn = askingPrice + estimatedInspection + estimatedTransport + estimatedRecon;
  const estimatedProfit = compMedian - estimatedTotalIn;
  const estimatedROI = estimatedTotalIn > 0 ? Math.round((estimatedProfit / estimatedTotalIn) * 1000) / 10 : 0;

  // Recent comp sales
  const recentComps = comps
    .filter((c) => c.sale_price > 0)
    .sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''))
    .slice(0, 5)
    .map((c) => ({
      vehicle: `${c.v_year || '?'} ${c.v_make || ''} ${c.v_model || ''}`.trim(),
      sale_price: c.sale_price,
      sale_date: c.sale_date,
      bids: c.bid_count,
      url: c.bat_listing_url,
    }));

  return {
    // Vehicle
    pipeline_id: entry.id,
    vehicle: `${entry.year || '?'} ${entry.make} ${entry.model || ''}`.trim(),
    year: entry.year,
    make: entry.make,
    model: entry.model,
    stage: entry.stage,
    location: [entry.location_city, entry.location_state].filter(Boolean).join(', '),
    listing_url: entry.discovery_url,

    // Pricing
    asking_price: askingPrice,
    comp_median: compMedian,
    upside,
    discount_pct: discountPct,
    deal_score: dealScore,

    // Comp analysis
    comp_stats: compStats,
    recent_comps: recentComps,

    // Risk/opportunity
    risk_factors: risks,
    positive_factors: positives,

    // Offer strategy
    offer_strategy: {
      conservative_offer: conservativeOffer,
      aggressive_offer: aggressiveOffer,
      max_offer: maxOffer,
      walk_away_above: Math.round(compMedian * 0.6),
      notes: discountPct > 40
        ? 'Strong buyer position - seller likely motivated at this price point'
        : 'Fair market deal - less room for negotiation',
    },

    // Economics
    estimated_economics: {
      purchase: askingPrice,
      inspection: estimatedInspection,
      transport: estimatedTransport,
      reconditioning: estimatedRecon,
      total_investment: estimatedTotalIn,
      target_sale_price: compMedian,
      estimated_profit: estimatedProfit,
      estimated_roi_pct: estimatedROI,
    },

    // Recommendation
    recommendation: dealScore >= 85
      ? 'PURSUE - Strong economics, proceed with contact and inspection'
      : dealScore >= 70
        ? 'CONSIDER - Solid opportunity if condition verifies'
        : 'WATCH - Economics marginal, only pursue if condition is exceptional',

    generated_at: new Date().toISOString(),
  };
}
