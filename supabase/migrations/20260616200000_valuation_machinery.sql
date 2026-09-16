-- Market estimate: surface the POWER under the hood, not 3 confident numbers.
--
-- The old get_vehicle_valuation returned value/low/high + a comp_count + confidence —
-- so the surface printed a bold "$45,500 · 300 comps · 77% confident" for a number that,
-- under the hood, was backed by ONE input with 7 of 8 model signals empty (condition,
-- rarity, survival, bid_curve, sentiment, originality, market_trend all sourceCount 0;
-- only comps fired). A confident bracket over a threadbare model is a facade — the
-- cardinal sin on a provenance platform, and existential for the valuation's credibility.
--
-- This adds the machinery the app needs to render the estimate HONESTLY: the per-signal
-- breakdown (which fired, which are empty), input_count, the deal/heat scores, the comp
-- method, and the integrity flags (is_circular). The iOS WorthBracketView reads signalsFired
-- vs signalsTotal to render honest-low (dim "~$45,500 · 1 of 8 signals") and drills into
-- the full breakdown. Additive — every prior field is still present (no app breakage).

CREATE OR REPLACE FUNCTION public.get_vehicle_valuation(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  with gate as (
    select 1 from vehicles v where v.id = p_vehicle_id
      and (v.is_public = true or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  est as (
    select * from nuke_estimates ne where ne.vehicle_id = p_vehicle_id
    order by ne.calculated_at desc nulls last limit 1
  )
  select case when not exists (select 1 from gate) then null
    when not exists (select 1 from est) then null
    else (select jsonb_build_object(
      'value', e.estimated_value, 'value_low', e.value_low, 'value_high', e.value_high,
      'confidence', e.confidence_score, 'confidence_interval_pct', e.confidence_interval_pct,
      'comp_count', coalesce((e.signal_weights->'comps'->>'sourceCount')::int, 0),
      'input_count', e.input_count,
      'is_stale', e.is_stale, 'is_circular', e.is_circular,
      'calculated_at', e.calculated_at, 'price_tier', e.price_tier, 'model_version', e.model_version,
      'comp_method', e.comp_method,
      'deal_score', e.deal_score, 'deal_score_label', e.deal_score_label,
      'heat_score', e.heat_score, 'heat_score_label', e.heat_score_label,
      'signals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', sw.key,
          'weight', (sw.value->>'weight')::numeric,
          'source_count', coalesce((sw.value->>'sourceCount')::int, 0),
          'fired', coalesce((sw.value->>'sourceCount')::int, 0) > 0
        ) order by (sw.value->>'weight')::numeric desc)
        from jsonb_each(e.signal_weights) sw
      ), '[]'::jsonb)
    ) from est e)
  end
$function$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_valuation(uuid) TO authenticated, anon;
