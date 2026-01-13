-- ============================================================================
-- FIX get_vehicle_price_trend() ambiguous identifier (price_type)
-- ============================================================================
-- The initial version used an output column name `price_type` in SQL predicates
-- which becomes ambiguous vs the table column. This replacement uses a local
-- variable (v_price_type).
--
-- Date: 2026-01-13
-- ============================================================================

begin;

create or replace function public.get_vehicle_price_trend(
  p_vehicle_id uuid,
  p_price_type text default 'current',
  p_period text default '30d'
)
returns table (
  vehicle_id uuid,
  price_type text,
  period text,
  baseline_value numeric,
  baseline_as_of timestamptz,
  baseline_source text,
  latest_value numeric,
  latest_as_of timestamptz,
  delta_amount numeric,
  delta_pct numeric,
  outlier_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_public boolean := false;
  v_has_access boolean := false;
  v_since timestamptz;
  v_baseline record;
  v_latest record;
  v_pinned record;
  v_price_type text := lower(coalesce(p_price_type, 'current'));
  v_period text := lower(coalesce(p_period, '30d'));
begin
  if p_vehicle_id is null then
    return;
  end if;

  select coalesce(is_public, true) into v_is_public
  from public.vehicles
  where id = p_vehicle_id
  limit 1;

  v_has_access := public.vehicle_user_has_access(p_vehicle_id, auth.uid());
  if not v_is_public and not v_has_access then
    return;
  end if;

  case v_period
    when '1w' then v_since := now() - interval '7 days';
    when '30d' then v_since := now() - interval '30 days';
    when '6m' then v_since := now() - interval '180 days';
    when '1y' then v_since := now() - interval '365 days';
    when '5y' then v_since := now() - interval '1825 days';
    else v_since := now() - interval '30 days';
  end case;

  -- Latest non-outlier point
  select vph.value, vph.as_of
    into v_latest
  from public.vehicle_price_history vph
  where vph.vehicle_id = p_vehicle_id
    and vph.price_type = v_price_type
    and coalesce(vph.is_outlier, false) = false
    and vph.value is not null
    and vph.value > 0
  order by vph.as_of desc
  limit 1;

  if v_latest.value is null then
    return;
  end if;

  -- Pinned baseline (if any)
  select b.baseline_value, b.baseline_as_of
    into v_pinned
  from public.vehicle_price_baselines b
  where b.vehicle_id = p_vehicle_id
    and b.price_type = v_price_type
    and b.period = v_period
  limit 1;

  if v_pinned.baseline_value is not null and v_pinned.baseline_value > 0 then
    vehicle_id := p_vehicle_id;
    price_type := v_price_type;
    period := v_period;
    baseline_value := v_pinned.baseline_value;
    baseline_as_of := v_pinned.baseline_as_of;
    baseline_source := 'pinned';
    latest_value := v_latest.value;
    latest_as_of := v_latest.as_of;
    delta_amount := latest_value - baseline_value;
    delta_pct := case when baseline_value <> 0 then ((latest_value - baseline_value) / baseline_value) * 100 end;
    select count(*)::int into outlier_count
      from public.vehicle_price_history vph
      where vph.vehicle_id = p_vehicle_id
        and vph.price_type = v_price_type
        and vph.as_of >= v_since
        and coalesce(vph.is_outlier, false) = true;
    return next;
    return;
  end if;

  -- Auto baseline: closest point at/before the start of the window, otherwise earliest in-window.
  select vph.value, vph.as_of
    into v_baseline
  from public.vehicle_price_history vph
  where vph.vehicle_id = p_vehicle_id
    and vph.price_type = v_price_type
    and coalesce(vph.is_outlier, false) = false
    and vph.value is not null
    and vph.value > 0
    and vph.as_of <= v_since
  order by vph.as_of desc
  limit 1;

  if v_baseline.value is null then
    select vph.value, vph.as_of
      into v_baseline
    from public.vehicle_price_history vph
    where vph.vehicle_id = p_vehicle_id
      and vph.price_type = v_price_type
      and coalesce(vph.is_outlier, false) = false
      and vph.value is not null
      and vph.value > 0
      and vph.as_of >= v_since
    order by vph.as_of asc
    limit 1;
  end if;

  if v_baseline.value is null then
    return;
  end if;

  vehicle_id := p_vehicle_id;
  price_type := v_price_type;
  period := v_period;
  baseline_value := v_baseline.value;
  baseline_as_of := v_baseline.as_of;
  baseline_source := 'auto';
  latest_value := v_latest.value;
  latest_as_of := v_latest.as_of;
  delta_amount := latest_value - baseline_value;
  delta_pct := case when baseline_value <> 0 then ((latest_value - baseline_value) / baseline_value) * 100 end;
  select count(*)::int into outlier_count
    from public.vehicle_price_history vph
    where vph.vehicle_id = p_vehicle_id
      and vph.price_type = v_price_type
      and vph.as_of >= v_since
      and coalesce(vph.is_outlier, false) = true;
  return next;
end;
$$;

grant execute on function public.get_vehicle_price_trend(uuid, text, text) to anon, authenticated, service_role;

commit;

