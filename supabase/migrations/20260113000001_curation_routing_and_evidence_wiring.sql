-- Curation routing + evidence wiring
-- Goal:
-- - Route newly created data gaps / conflicts to qualified voices (provenance-driven)
-- - Avoid duplicate pings
--
-- Safe to run multiple times (IF NOT EXISTS + guarded triggers)

begin;

-- ============================================================================
-- 1) Dedupe table for curation pings (prevents notification spam)
-- ============================================================================

create table if not exists public.curation_pings (
  id uuid primary key default gen_random_uuid(),
  ping_type text not null check (ping_type in ('data_gap', 'data_conflict')),
  related_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (ping_type, related_id, user_id)
);

create index if not exists idx_curation_pings_user_created
  on public.curation_pings(user_id, created_at desc);

create index if not exists idx_curation_pings_related
  on public.curation_pings(ping_type, related_id);

alter table public.curation_pings enable row level security;
drop policy if exists "curation_pings_read_all" on public.curation_pings;
create policy "curation_pings_read_all" on public.curation_pings
  for select using (true);
drop policy if exists "curation_pings_service_write" on public.curation_pings;
create policy "curation_pings_service_write" on public.curation_pings
  for all using (auth.jwt() ->> 'role' = 'service_role')
  with check (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================================
-- 2) RPC: suggest_qualified_voices(vehicle, field)
-- ============================================================================
-- Returns ranked candidates based on:
-- - contribution quality/verification (attributed_data_sources + user_contribution_scores)
-- - domain context (same make/model)
-- - vehicle-local context (same vehicle)
-- - recency decay (keeps "drive-by experts" in the set, but prefers active voices)

create or replace function public.suggest_qualified_voices(
  p_vehicle_id uuid,
  p_field_name text,
  p_limit integer default 5
)
returns table (
  user_id uuid,
  score numeric,
  reasons jsonb
)
language sql
stable
set search_path = public
as $$
  with v as (
    select id, make, model, year
    from public.vehicles
    where id = p_vehicle_id
  ),
  dom as (
    select
      ads.contributed_by as user_id,
      sum(coalesce(ads.contribution_value, 0) * coalesce(ads.data_quality_score, 0.5))::numeric as domain_points,
      count(*)::int as domain_contribs,
      count(*) filter (where ads.verification_status in ('auto_verified', 'peer_verified', 'expert_verified'))::int as domain_verified,
      count(*) filter (where ads.verification_status in ('disputed', 'rejected'))::int as domain_bad,
      max(ads.created_at) as last_domain_at
    from public.attributed_data_sources ads
    join public.vehicles vv on vv.id = ads.vehicle_id
    join v on v.make is not null and v.model is not null and vv.make = v.make and vv.model = v.model
    group by ads.contributed_by
  ),
  veh as (
    select
      ads.contributed_by as user_id,
      sum(coalesce(ads.contribution_value, 0) * coalesce(ads.data_quality_score, 0.5))::numeric as vehicle_points,
      count(*)::int as vehicle_contribs,
      max(ads.created_at) as last_vehicle_at
    from public.attributed_data_sources ads
    where ads.vehicle_id = p_vehicle_id
    group by ads.contributed_by
  ),
  rep as (
    select
      ucs.user_id,
      ucs.reputation_tier,
      coalesce(ucs.accuracy_rate, 0.5) as accuracy_rate,
      coalesce(ucs.avg_quality_score, 0.5) as avg_quality_score,
      ucs.last_contribution_at
    from public.user_contribution_scores ucs
  ),
  combined as (
    select
      coalesce(dom.user_id, veh.user_id, rep.user_id) as user_id,
      coalesce(dom.domain_points, 0)::numeric as domain_points,
      coalesce(veh.vehicle_points, 0)::numeric as vehicle_points,
      coalesce(dom.domain_verified, 0)::int as domain_verified,
      coalesce(dom.domain_bad, 0)::int as domain_bad,
      rep.reputation_tier,
      coalesce(rep.accuracy_rate, 0.5)::numeric as accuracy_rate,
      coalesce(rep.avg_quality_score, 0.5)::numeric as avg_quality_score,
      greatest(
        coalesce(dom.last_domain_at, 'epoch'::timestamptz),
        coalesce(veh.last_vehicle_at, 'epoch'::timestamptz),
        coalesce(rep.last_contribution_at, 'epoch'::timestamptz)
      ) as last_activity
    from dom
    full join veh on veh.user_id = dom.user_id
    full join rep on rep.user_id = coalesce(dom.user_id, veh.user_id)
  ),
  scored as (
    select
      c.user_id,
      (
        (c.domain_points + (c.vehicle_points * 1.5) + (c.domain_verified * 10) - (c.domain_bad * 20))
        * (case c.reputation_tier
            when 'authority' then 2.0
            when 'expert' then 1.6
            when 'trusted' then 1.3
            when 'contributor' then 1.1
            when 'novice' then 0.9
            else 1.0 end)
        * (0.75 + 0.25 * exp(-extract(epoch from (now() - c.last_activity)) / (60 * 60 * 24 * 30)))
        * (0.7 + 0.3 * c.accuracy_rate)
        * (0.7 + 0.3 * c.avg_quality_score)
      )::numeric as score,
      jsonb_build_object(
        'field', p_field_name,
        'domain_points', round(c.domain_points, 2),
        'vehicle_points', round(c.vehicle_points, 2),
        'domain_verified', c.domain_verified,
        'domain_bad', c.domain_bad,
        'reputation_tier', c.reputation_tier,
        'accuracy_rate', round(c.accuracy_rate, 3),
        'avg_quality_score', round(c.avg_quality_score, 3),
        'last_activity', c.last_activity
      ) as reasons
    from combined c
    where c.user_id is not null
  )
  select s.user_id, s.score, s.reasons
  from scored s
  where s.score is not null
  order by s.score desc
  limit greatest(p_limit, 0);
$$;

grant execute on function public.suggest_qualified_voices(uuid, text, integer) to authenticated, service_role;

-- ============================================================================
-- 3) Notifiers: turn gaps/conflicts into targeted pings (via create_user_notification)
-- ============================================================================

create or replace function public.notify_qualified_voices_for_data_gap(
  p_gap_id uuid,
  p_limit integer default 5
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gap record;
  v_vehicle record;
  v_sent integer := 0;
  r record;
  v_title text;
  v_msg text;
  v_action_url text;
begin
  select * into v_gap from public.data_gaps where id = p_gap_id;
  if not found then
    return 0;
  end if;

  if v_gap.is_filled is true then
    return 0;
  end if;

  if v_gap.entity_type <> 'vehicle' then
    return 0;
  end if;

  select id, year, make, model, user_id, uploaded_by into v_vehicle
  from public.vehicles
  where id = v_gap.entity_id;

  v_title := 'Data proof requested';
  v_msg :=
    coalesce(v_vehicle.year::text, '?') || ' ' ||
    coalesce(v_vehicle.make, '?') || ' ' ||
    coalesce(v_vehicle.model, '?') ||
    ' needs proof for ' || v_gap.field_name ||
    case when v_gap.gap_reason is not null and v_gap.gap_reason <> '' then ': ' || v_gap.gap_reason else '' end;

  v_action_url := '/vehicle/' || v_gap.entity_id::text;

  for r in
    with seed as (
      select v_vehicle.user_id as user_id, 100 as rank where v_vehicle.user_id is not null
      union all
      select v_vehicle.uploaded_by as user_id, 95 as rank where v_vehicle.uploaded_by is not null
      union all
      select ads.contributed_by as user_id, 80 as rank
      from public.attributed_data_sources ads
      where ads.vehicle_id = v_gap.entity_id
      union all
      select s.user_id, 60 as rank
      from public.suggest_qualified_voices(v_gap.entity_id, v_gap.field_name, p_limit) s
    ),
    ranked as (
      select user_id, max(rank) as rank
      from seed
      where user_id is not null
      group by user_id
      order by max(rank) desc
      limit greatest(p_limit, 0)
    )
    select * from ranked
  loop
    begin
      insert into public.curation_pings(ping_type, related_id, user_id, metadata)
      values (
        'data_gap',
        p_gap_id,
        r.user_id,
        jsonb_build_object('field_name', v_gap.field_name, 'entity_id', v_gap.entity_id)
      )
      on conflict (ping_type, related_id, user_id) do nothing;

      if found then
        perform public.create_user_notification(
          p_user_id := r.user_id,
          p_notification_type := 'verification_request',
          p_title := v_title,
          p_message := v_msg,
          p_vehicle_id := v_gap.entity_id,
          p_image_id := null,
          p_organization_id := null,
          p_from_user_id := null,
          p_action_url := v_action_url,
          p_metadata := jsonb_build_object(
            'gap_id', p_gap_id,
            'entity_type', v_gap.entity_type,
            'entity_id', v_gap.entity_id,
            'field_name', v_gap.field_name,
            'field_priority', v_gap.field_priority,
            'points_reward', v_gap.points_reward,
            'gap_reason', v_gap.gap_reason
          )
        );
        v_sent := v_sent + 1;
      end if;
    exception when others then
      -- Never fail the originating write (gap creation).
      null;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.notify_qualified_voices_for_data_gap(uuid, integer) from public;
grant execute on function public.notify_qualified_voices_for_data_gap(uuid, integer) to service_role;

create or replace function public.notify_qualified_voices_for_conflict(
  p_conflict_id uuid,
  p_limit integer default 5
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conf record;
  v_vehicle record;
  v_sent integer := 0;
  r record;
  v_title text;
  v_msg text;
  v_action_url text;
begin
  select * into v_conf from public.data_merge_conflicts where id = p_conflict_id;
  if not found then
    return 0;
  end if;

  select id, year, make, model, user_id, uploaded_by into v_vehicle
  from public.vehicles
  where id = v_conf.vehicle_id;

  v_title := 'Data conflict needs review';
  v_msg :=
    coalesce(v_vehicle.year::text, '?') || ' ' ||
    coalesce(v_vehicle.make, '?') || ' ' ||
    coalesce(v_vehicle.model, '?') ||
    ' has a conflict on ' || v_conf.field_name ||
    '. Existing: ' || coalesce(v_conf.existing_value, '(null)') ||
    ' Proposed: ' || coalesce(v_conf.proposed_value, '(null)');

  v_action_url := '/vehicle/' || v_conf.vehicle_id::text;

  for r in
    with seed as (
      select v_vehicle.user_id as user_id, 100 as rank where v_vehicle.user_id is not null
      union all
      select v_vehicle.uploaded_by as user_id, 95 as rank where v_vehicle.uploaded_by is not null
      union all
      select v_conf.proposed_by as user_id, 90 as rank where v_conf.proposed_by is not null
      union all
      select ads.contributed_by as user_id, 80 as rank
      from public.attributed_data_sources ads
      where ads.vehicle_id = v_conf.vehicle_id
      union all
      select s.user_id, 60 as rank
      from public.suggest_qualified_voices(v_conf.vehicle_id, v_conf.field_name, p_limit) s
    ),
    ranked as (
      select user_id, max(rank) as rank
      from seed
      where user_id is not null
      group by user_id
      order by max(rank) desc
      limit greatest(p_limit, 0)
    )
    select * from ranked
  loop
    begin
      insert into public.curation_pings(ping_type, related_id, user_id, metadata)
      values (
        'data_conflict',
        p_conflict_id,
        r.user_id,
        jsonb_build_object('field_name', v_conf.field_name, 'vehicle_id', v_conf.vehicle_id)
      )
      on conflict (ping_type, related_id, user_id) do nothing;

      if found then
        perform public.create_user_notification(
          p_user_id := r.user_id,
          p_notification_type := 'merge_proposal',
          p_title := v_title,
          p_message := v_msg,
          p_vehicle_id := v_conf.vehicle_id,
          p_image_id := null,
          p_organization_id := null,
          p_from_user_id := null,
          p_action_url := v_action_url,
          p_metadata := jsonb_build_object(
            'conflict_id', p_conflict_id,
            'vehicle_id', v_conf.vehicle_id,
            'field_name', v_conf.field_name,
            'existing_value', v_conf.existing_value,
            'proposed_value', v_conf.proposed_value,
            'proposed_by', v_conf.proposed_by,
            'resolution_status', v_conf.resolution_status
          )
        );
        v_sent := v_sent + 1;
      end if;
    exception when others then
      -- Never fail the originating write (conflict creation).
      null;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.notify_qualified_voices_for_conflict(uuid, integer) from public;
grant execute on function public.notify_qualified_voices_for_conflict(uuid, integer) to service_role;

-- ============================================================================
-- 4) Triggers: automatically notify when gaps/conflicts are created
-- ============================================================================

do $$
begin
  if to_regclass('public.data_gaps') is not null then
    create or replace function public.trg_notify_on_data_gap_insert()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      if new.is_filled is true then
        return new;
      end if;
      if new.entity_type <> 'vehicle' then
        return new;
      end if;
      -- Default: only ping on critical gaps (keeps noise down). Expand later.
      if new.field_priority <> 'critical' then
        return new;
      end if;
      perform public.notify_qualified_voices_for_data_gap(new.id, 5);
      return new;
    end;
    $fn$;

    drop trigger if exists trg_notify_on_data_gaps_insert on public.data_gaps;
    create trigger trg_notify_on_data_gaps_insert
      after insert on public.data_gaps
      for each row execute function public.trg_notify_on_data_gap_insert();
  end if;
end $$;

do $$
begin
  if to_regclass('public.data_merge_conflicts') is not null then
    create or replace function public.trg_notify_on_data_merge_conflict_insert()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      perform public.notify_qualified_voices_for_conflict(new.id, 5);
      return new;
    end;
    $fn$;

    drop trigger if exists trg_notify_on_data_merge_conflicts_insert on public.data_merge_conflicts;
    create trigger trg_notify_on_data_merge_conflicts_insert
      after insert on public.data_merge_conflicts
      for each row execute function public.trg_notify_on_data_merge_conflict_insert();
  end if;
end $$;

commit;

