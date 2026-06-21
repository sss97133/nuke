-- get_vehicle_valuation(vehicle) — the value's basis (the comp-based model run):
-- estimate, low/high band, confidence, comp count, staleness, when. Null when
-- unmodeled. So a price can drill to its root the way a spec drills to its source.
create or replace function public.get_vehicle_valuation(p_vehicle_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with gate as (
    select 1 from vehicles v where v.id = p_vehicle_id
      and (v.is_public = true or auth.uid() in (v.user_id, v.owner_id, v.uploaded_by))
  ),
  est as (select * from nuke_estimates ne where ne.vehicle_id = p_vehicle_id
          order by ne.calculated_at desc nulls last limit 1)
  select case when not exists (select 1 from gate) then null
    when not exists (select 1 from est) then null
    else (select jsonb_build_object(
      'value', e.estimated_value, 'value_low', e.value_low, 'value_high', e.value_high,
      'confidence', e.confidence_score,
      'comp_count', coalesce((e.signal_weights->'comps'->>'sourceCount')::int, 0),
      'is_stale', e.is_stale, 'calculated_at', e.calculated_at,
      'price_tier', e.price_tier, 'model_version', e.model_version
    ) from est e) end
$$;
grant execute on function public.get_vehicle_valuation(uuid) to anon, authenticated;
