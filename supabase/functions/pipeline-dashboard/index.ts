/**
 * Pipeline Dashboard Edge Function
 *
 * Provides a comprehensive view of the acquisition pipeline.
 * Returns stage counts, top targets, recent activity, and overall health metrics.
 *
 * Input:  {} (no params needed) or { action: "summary" | "targets" | "activity" }
 * Output: Pipeline dashboard data
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action = 'summary' } = await req.json().catch(() => ({}));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Stage breakdown
    let stageCounts = null;
    try {
      const res = await supabase.rpc('exec_sql', {
        query: `
          SELECT stage, count(*) as count,
            count(*) FILTER (WHERE asking_price IS NOT NULL) as priced,
            round(avg(deal_score)) as avg_score,
            round(avg(asking_price)) as avg_ask,
            round(avg(comp_median)) as avg_median,
            sum(CASE WHEN asking_price IS NOT NULL AND comp_median IS NOT NULL
                THEN comp_median - asking_price ELSE 0 END) as total_upside
          FROM acquisition_pipeline GROUP BY stage
          ORDER BY CASE stage WHEN 'target' THEN 1 WHEN 'market_proofed' THEN 2 WHEN 'discovered' THEN 3 ELSE 4 END
        `,
      });
      stageCounts = res.data;
    } catch { /* ignore */ }

    // Top targets (up to 20)
    const { data: targets } = await supabase
      .from('acquisition_pipeline')
      .select('id, year, make, model, asking_price, deal_score, comp_median, location_city, location_state, discovery_url, market_proof_data')
      .eq('stage', 'target')
      .order('deal_score', { ascending: false })
      .order('asking_price', { ascending: true })
      .limit(20);

    // Total pipeline counts
    const { count: totalCount } = await supabase
      .from('acquisition_pipeline')
      .select('*', { count: 'exact', head: true });

    // Recent market proof reports
    const { data: recentReports } = await supabase
      .from('market_proof_reports')
      .select('id, pipeline_id, comp_count, comp_median, recommendation, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // Format targets with upside calculation
    const formattedTargets = (targets || []).map((t) => ({
      id: t.id,
      vehicle: `${t.year || '?'} ${t.make} ${t.model || '?'}`,
      asking_price: t.asking_price,
      comp_median: t.comp_median,
      deal_score: t.deal_score,
      upside: t.comp_median && t.asking_price ? t.comp_median - t.asking_price : null,
      discount_pct: t.comp_median && t.asking_price && t.comp_median > 0
        ? Math.round(((t.comp_median - t.asking_price) / t.comp_median) * 1000) / 10
        : null,
      location: [t.location_city, t.location_state].filter(Boolean).join(', ') || null,
      recommendation: t.market_proof_data?.recommendation || null,
      listing_url: t.discovery_url,
    }));

    const totalUpside = formattedTargets.reduce((sum, t) => sum + (t.upside || 0), 0);

    return new Response(
      JSON.stringify({
        total_vehicles: totalCount || 0,
        stages: stageCounts || [],
        target_count: formattedTargets.length,
        total_target_upside: totalUpside,
        avg_target_discount: formattedTargets.length > 0
          ? Math.round(
              formattedTargets.reduce((s, t) => s + (t.discount_pct || 0), 0) / formattedTargets.length * 10,
            ) / 10
          : 0,
        targets: formattedTargets,
        recent_reports: recentReports || [],
        generated_at: new Date().toISOString(),
      }),
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
