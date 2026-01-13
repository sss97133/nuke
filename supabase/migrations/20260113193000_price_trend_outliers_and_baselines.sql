-- ============================================================================
-- PRICE TREND OUTLIERS + BASELINE CONTROL
-- ============================================================================
-- Why:
-- - A single bad write (e.g. $16,000,000) should NEVER poison the 30D signal.
-- - We want explainable trend math: show the baseline point used.
-- - We want controllable baselines: owners/responsible parties can pin a baseline.
--
-- Notes:
-- - `vehicle_price_history` is the append-only ledger (triggered by vehicles updates).
-- - We add soft flags (`is_outlier`) instead of deleting history.
-- - We expose a small RPC for UI + LLM queryability: get_vehicle_price_trend().
--
-- Date: 2026-01-13
-- ============================================================================

begin;

-- --------------------------------------------------------------------------
-- 1) vehicle_price_history: outlier flags
-- --------------------------------------------------------------------------
alter table if exists public.vehicle_price_history
  add column if not exists is_outlier boolean not null default false,
  add column if not exists outlier_reason text;

create index if not exists idx_vph_vehicle_type_asof
  on public.vehicle_price_history(vehicle_id, price_type, as_of desc);

create index if not exists idx_vph_vehicle_type_asof_not_outlier
  on public.vehicle_price_history(vehicle_id, price_type, as_of desc)
  where is_outlier = false;

-- --------------------------------------------------------------------------
-- 2) Replace log_vehicle_price_history() to flag obvious ratio outliers
--    (keeps existing trigger name stable)
-- --------------------------------------------------------------------------
create or replace function public.log_vehicle_price_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  effective_actor uuid := coalesce(auth.uid(), new.user_id, new.owner_id, new.uploaded_by);
  prev_value numeric;
  is_out boolean;
  reason text;
  ratio_threshold numeric := 20; -- 20x jump/drop = likely bad injection
begin
  -- MSRP
  if new.msrp is distinct from old.msrp and new.msrp is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'msrp'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.msrp::numeric > prev_value * ratio_threshold) or (new.msrp::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'msrp', new.msrp, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Purchase
  if new.purchase_price is distinct from old.purchase_price and new.purchase_price is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'purchase'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.purchase_price::numeric > prev_value * ratio_threshold) or (new.purchase_price::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'purchase', new.purchase_price, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Current (internal signal)
  if new.current_value is distinct from old.current_value and new.current_value is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'current'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.current_value::numeric > prev_value * ratio_threshold) or (new.current_value::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'current', new.current_value, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Asking
  if new.asking_price is distinct from old.asking_price and new.asking_price is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'asking'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.asking_price::numeric > prev_value * ratio_threshold) or (new.asking_price::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'asking', new.asking_price, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  -- Sale
  if new.sale_price is distinct from old.sale_price and new.sale_price is not null then
    prev_value := null; is_out := false; reason := null;
    select vph.value into prev_value
      from public.vehicle_price_history vph
      where vph.vehicle_id = new.id and vph.price_type = 'sale'
      order by vph.as_of desc
      limit 1;
    if prev_value is not null and prev_value > 0 then
      if (new.sale_price::numeric > prev_value * ratio_threshold) or (new.sale_price::numeric < prev_value / ratio_threshold) then
        is_out := true;
        reason := 'ratio_vs_previous';
      end if;
    end if;
    insert into public.vehicle_price_history (vehicle_id, price_type, value, source, as_of, logged_by, is_outlier, outlier_reason)
    values (new.id, 'sale', new.sale_price, 'db_trigger', coalesce(new.updated_at, now()), effective_actor, is_out, reason);
  end if;

  return new;
end;
$$;

-- Ensure the trigger references the updated function (safe recreate).
do $$
begin
  if to_regclass('public.vehicles') is null then
    return;
  end if;

  begin
    execute 'drop trigger if exists trg_log_vehicle_price_history on public.vehicles';
  exception when others then
    null;
  end;

  execute 'create trigger trg_log_vehicle_price_history
    after update of msrp, purchase_price, current_value, asking_price, sale_price on public.vehicles
    for each row
    execute function public.log_vehicle_price_history()';
end
$$;

-- Backfill: flag obvious ratio outliers in existing history (best-effort, safe to re-run).
with ordered as (
  select
    id,
    vehicle_id,
    price_type,
    value,
    lag(value) over (partition by vehicle_id, price_type order by as_of) as prev_value,
    lead(value) over (partition by vehicle_id, price_type order by as_of) as next_value
  from public.vehicle_price_history
)
update public.vehicle_price_history vph
set
  is_outlier = true,
  outlier_reason = coalesce(vph.outlier_reason, 'ratio_vs_neighbor')
from ordered o
where vph.id = o.id
  and coalesce(vph.is_outlier, false) = false
  and (
    (o.prev_value is not null and o.prev_value > 0 and (o.value > o.prev_value * 20 or o.value < o.prev_value / 20))
    or
    (o.next_value is not null and o.next_value > 0 and (o.value > o.next_value * 20 or o.value < o.next_value / 20))
  );

-- --------------------------------------------------------------------------
-- 3) vehicle_price_baselines: pinned baselines per (vehicle, price_type, period)
-- --------------------------------------------------------------------------
create table if not exists public.vehicle_price_baselines (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  price_type text not null check (price_type in ('msrp','purchase','current','asking','sale')),
  period text not null check (period in ('1w','30d','6m','1y','5y')),
  baseline_price_history_id uuid null references public.vehicle_price_history(id) on delete set null,
  baseline_value numeric not null,
  baseline_as_of timestamptz not null,
  source text not null default 'user_pinned',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, price_type, period)
);

alter table public.vehicle_price_baselines enable row level security;

-- PostgREST stability: explicit grants
grant select on public.vehicle_price_baselines to anon, authenticated;
grant insert, update, delete on public.vehicle_price_baselines to authenticated;

-- Public read for public vehicles; private otherwise unless you have access
drop policy if exists "Public read vehicle price baselines" on public.vehicle_price_baselines;
create policy "Public read vehicle price baselines"
  on public.vehicle_price_baselines
  for select
  using (
    exists (
      select 1 from public.vehicles v
      where v.id = vehicle_price_baselines.vehicle_id
        and coalesce(v.is_public, true) = true
    )
  );

drop policy if exists "Vehicle access manage vehicle price baselines" on public.vehicle_price_baselines;
create policy "Vehicle access manage vehicle price baselines"
  on public.vehicle_price_baselines
  for all
  using (public.vehicle_user_has_access(vehicle_price_baselines.vehicle_id, auth.uid()))
  with check (public.vehicle_user_has_access(vehicle_price_baselines.vehicle_id, auth.uid()));

-- --------------------------------------------------------------------------
-- 4) RPC: get_vehicle_price_trend(vehicle_id, price_type, period)
-- --------------------------------------------------------------------------
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

  case lower(coalesce(p_period, '30d'))
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
    and vph.price_type = lower(coalesce(p_price_type, 'current'))
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
    and b.price_type = lower(coalesce(p_price_type, 'current'))
    and b.period = lower(coalesce(p_period, '30d'))
  limit 1;

  if v_pinned.baseline_value is not null and v_pinned.baseline_value > 0 then
    vehicle_id := p_vehicle_id;
    price_type := lower(coalesce(p_price_type, 'current'));
    period := lower(coalesce(p_period, '30d'));
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
        and vph.price_type = price_type
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
    and vph.price_type = lower(coalesce(p_price_type, 'current'))
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
      and vph.price_type = lower(coalesce(p_price_type, 'current'))
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
  price_type := lower(coalesce(p_price_type, 'current'));
  period := lower(coalesce(p_period, '30d'));
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
      and vph.price_type = price_type
      and vph.as_of >= v_since
      and coalesce(vph.is_outlier, false) = true;
  return next;
end;
$$;

grant execute on function public.get_vehicle_price_trend(uuid, text, text) to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- 5) RPC: set_vehicle_price_baseline(vehicle_id, price_type, period, price_history_id)
-- --------------------------------------------------------------------------
create or replace function public.set_vehicle_price_baseline(
  p_vehicle_id uuid,
  p_price_type text,
  p_period text,
  p_price_history_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean := false;
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_ok := public.vehicle_user_has_access(p_vehicle_id, auth.uid());
  if not v_ok then
    raise exception 'Access denied';
  end if;

  select vph.value, vph.as_of
    into v_row
  from public.vehicle_price_history vph
  where vph.id = p_price_history_id
    and vph.vehicle_id = p_vehicle_id
    and vph.price_type = lower(coalesce(p_price_type, 'current'))
  limit 1;

  if v_row.value is null then
    raise exception 'Price history row not found for vehicle/type';
  end if;

  insert into public.vehicle_price_baselines (
    vehicle_id, price_type, period, baseline_price_history_id, baseline_value, baseline_as_of, source, created_by, updated_at
  ) values (
    p_vehicle_id,
    lower(coalesce(p_price_type, 'current')),
    lower(coalesce(p_period, '30d')),
    p_price_history_id,
    v_row.value,
    v_row.as_of,
    'user_pinned',
    auth.uid(),
    now()
  )
  on conflict (vehicle_id, price_type, period)
  do update set
    baseline_price_history_id = excluded.baseline_price_history_id,
    baseline_value = excluded.baseline_value,
    baseline_as_of = excluded.baseline_as_of,
    source = excluded.source,
    created_by = excluded.created_by,
    updated_at = now();
end;
$$;

grant execute on function public.set_vehicle_price_baseline(uuid, text, text, uuid) to authenticated, service_role;

commit;

