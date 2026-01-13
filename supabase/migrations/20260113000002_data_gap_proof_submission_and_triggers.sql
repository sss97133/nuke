-- Data gap proof submission + automatic gap detection/sync
-- - Lets users submit evidence to address an open `data_gaps` row (vehicle only for now)
-- - Inserts `field_evidence` (+ optional `attributed_data_sources`) and attempts consensus auto-assign
-- - Keeps `data_gaps` in sync when vehicle core fields are filled by any path

begin;

-- ============================================================================
-- 1) RPC: submit_data_gap_evidence(gap_id, proposed_value, evidence_url, source_type, context)
-- ============================================================================

create or replace function public.submit_data_gap_evidence(
  p_gap_id uuid,
  p_proposed_value text,
  p_evidence_url text default null,
  p_source_type text default null,
  p_context text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_gap record;
  v_vehicle_id uuid;
  v_field_name text;
  v_source_type text;
  v_source_confidence integer := 50;
  v_evidence_id uuid;
  v_consensus jsonb := '{}'::jsonb;
  v_auto_assigned boolean := false;
  v_points_awarded integer := 0;
  v_attribution_id uuid;
  v_vehicle_has_column boolean := false;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_gap_id is null then
    raise exception 'p_gap_id is required';
  end if;

  if p_proposed_value is null or btrim(p_proposed_value) = '' then
    raise exception 'p_proposed_value is required';
  end if;

  select * into v_gap
  from public.data_gaps
  where id = p_gap_id;

  if not found then
    raise exception 'Data gap not found';
  end if;

  if v_gap.is_filled is true then
    return jsonb_build_object(
      'ok', true,
      'gap_id', p_gap_id,
      'gap_filled', true,
      'message', 'Gap already filled'
    );
  end if;

  if v_gap.entity_type <> 'vehicle' then
    raise exception 'Only vehicle gaps are supported';
  end if;

  v_vehicle_id := v_gap.entity_id;
  v_field_name := v_gap.field_name;

  -- Choose a source_type (trust hierarchy key)
  if p_source_type is not null and btrim(p_source_type) <> '' then
    v_source_type := btrim(p_source_type);
  else
    if p_evidence_url is not null and btrim(p_evidence_url) <> '' then
      if position('bringatrailer.com' in lower(p_evidence_url)) > 0 then
        v_source_type := 'auction_result_bat';
      else
        v_source_type := 'scraped_listing';
      end if;
    else
      v_source_type := 'user_input_unverified';
    end if;
  end if;

  -- Look up trust_level if the hierarchy exists
  if to_regclass('public.data_source_trust_hierarchy') is not null then
    select trust_level into v_source_confidence
    from public.data_source_trust_hierarchy
    where source_type = v_source_type;

    if v_source_confidence is null then
      v_source_confidence := 50;
    end if;
  end if;

  -- Insert evidence (dedupe on unique constraint)
  insert into public.field_evidence (
    vehicle_id,
    field_name,
    proposed_value,
    source_type,
    source_confidence,
    extraction_context,
    raw_extraction_data
  )
  values (
    v_vehicle_id,
    v_field_name,
    btrim(p_proposed_value),
    v_source_type,
    v_source_confidence,
    nullif(btrim(p_context), ''),
    jsonb_build_object(
      'gap_id', p_gap_id,
      'evidence_url', nullif(btrim(p_evidence_url), ''),
      'submitted_by', v_user_id,
      'submitted_at', now()
    )
  )
  on conflict (vehicle_id, field_name, source_type, proposed_value)
  do update set
    extracted_at = now(),
    raw_extraction_data = excluded.raw_extraction_data
  returning id into v_evidence_id;

  -- Try to auto-assign via consensus if:
  -- - the function exists AND
  -- - the field is a real vehicles column (avoids dynamic SQL failures)
  if to_regprocedure('public.build_field_consensus(uuid,text,boolean)') is not null then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'vehicles'
        and column_name = v_field_name
    ) into v_vehicle_has_column;

    if v_vehicle_has_column then
      v_consensus := public.build_field_consensus(v_vehicle_id, v_field_name, true);
      v_auto_assigned := coalesce((v_consensus->>'auto_assigned')::boolean, false);
    end if;
  end if;

  if v_auto_assigned then
    update public.data_gaps
    set
      is_filled = true,
      filled_by = v_user_id,
      filled_at = now()
    where id = p_gap_id;

    v_points_awarded := coalesce(v_gap.points_reward, 0);

    if v_points_awarded > 0 and to_regprocedure('public.award_points(uuid,text,integer,text)') is not null then
      perform public.award_points(
        v_user_id,
        'data_fill',
        v_points_awarded,
        format('Filled %s gap', v_field_name)
      );
    end if;
  end if;

  -- Attribute contribution (feeds qualified-voice routing + reputation engine)
  if to_regclass('public.attributed_data_sources') is not null then
    insert into public.attributed_data_sources (
      vehicle_id,
      data_field,
      contributed_by,
      data_type,
      data_id,
      contribution_value,
      verification_status,
      data_quality_score,
      source_url,
      extraction_method,
      confidence_score,
      metadata
    )
    values (
      v_vehicle_id,
      v_field_name,
      v_user_id,
      'field_evidence',
      v_evidence_id,
      case when v_auto_assigned then coalesce(v_gap.points_reward, 0) else 0 end,
      case when v_auto_assigned then 'auto_verified' else 'unverified' end,
      case
        when v_auto_assigned then
          least(1.0, greatest(0.0, coalesce((v_consensus->>'consensus_confidence')::numeric, v_source_confidence::numeric) / 100.0))
        else
          0.5
      end,
      nullif(btrim(p_evidence_url), ''),
      'manual_proof',
      least(1.0, greatest(0.0, v_source_confidence::numeric / 100.0)),
      jsonb_build_object(
        'gap_id', p_gap_id,
        'field_name', v_field_name,
        'source_type', v_source_type,
        'consensus', v_consensus
      )
    )
    returning id into v_attribution_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'gap_id', p_gap_id,
    'vehicle_id', v_vehicle_id,
    'field_name', v_field_name,
    'evidence_id', v_evidence_id,
    'source_type', v_source_type,
    'source_confidence', v_source_confidence,
    'consensus', v_consensus,
    'auto_assigned', v_auto_assigned,
    'gap_filled', v_auto_assigned,
    'points_awarded', v_points_awarded,
    'attribution_id', v_attribution_id
  );
end;
$$;

revoke all on function public.submit_data_gap_evidence(uuid, text, text, text, text) from public;
grant execute on function public.submit_data_gap_evidence(uuid, text, text, text, text) to authenticated, service_role;

-- ============================================================================
-- 2) Triggers: keep gaps created + keep them synced as core fields are filled
-- ============================================================================

do $$
begin
  if to_regprocedure('public.detect_data_gaps(text,uuid)') is not null then
    create or replace function public.trg_detect_data_gaps_on_vehicle_insert()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    begin
      perform public.detect_data_gaps('vehicle', new.id);
      return new;
    end;
    $fn$;

    drop trigger if exists trg_detect_data_gaps_on_vehicle_insert on public.vehicles;
    create trigger trg_detect_data_gaps_on_vehicle_insert
      after insert on public.vehicles
      for each row execute function public.trg_detect_data_gaps_on_vehicle_insert();
  end if;
end $$;

do $$
begin
  create or replace function public.trg_sync_data_gaps_on_vehicle_update()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $fn$
  begin
    -- Close VIN gap when VIN becomes real (not null/blank and not placeholder)
    if new.vin is not null and btrim(new.vin) <> '' and new.vin not like 'VIVA-%' then
      update public.data_gaps
      set
        is_filled = true,
        filled_at = coalesce(filled_at, now()),
        filled_by = coalesce(filled_by, auth.uid())
      where entity_type = 'vehicle'
        and entity_id = new.id
        and field_name = 'vin'
        and is_filled = false;
    end if;

    if new.year is not null then
      update public.data_gaps
      set
        is_filled = true,
        filled_at = coalesce(filled_at, now()),
        filled_by = coalesce(filled_by, auth.uid())
      where entity_type = 'vehicle'
        and entity_id = new.id
        and field_name = 'year'
        and is_filled = false;
    end if;

    if new.engine_size is not null and btrim(new.engine_size) <> '' then
      update public.data_gaps
      set
        is_filled = true,
        filled_at = coalesce(filled_at, now()),
        filled_by = coalesce(filled_by, auth.uid())
      where entity_type = 'vehicle'
        and entity_id = new.id
        and field_name = 'engine_size'
        and is_filled = false;
    end if;

    if new.transmission is not null and btrim(new.transmission) <> '' then
      update public.data_gaps
      set
        is_filled = true,
        filled_at = coalesce(filled_at, now()),
        filled_by = coalesce(filled_by, auth.uid())
      where entity_type = 'vehicle'
        and entity_id = new.id
        and field_name = 'transmission'
        and is_filled = false;
    end if;

    if new.mileage is not null then
      update public.data_gaps
      set
        is_filled = true,
        filled_at = coalesce(filled_at, now()),
        filled_by = coalesce(filled_by, auth.uid())
      where entity_type = 'vehicle'
        and entity_id = new.id
        and field_name = 'mileage'
        and is_filled = false;
    end if;

    -- Backfill gaps for older records whenever these fields change.
    if to_regprocedure('public.detect_data_gaps(text,uuid)') is not null then
      perform public.detect_data_gaps('vehicle', new.id);
    end if;

    return new;
  end;
  $fn$;

  drop trigger if exists trg_sync_data_gaps_on_vehicle_update on public.vehicles;
  create trigger trg_sync_data_gaps_on_vehicle_update
    after update of vin, year, engine_size, transmission, mileage on public.vehicles
    for each row execute function public.trg_sync_data_gaps_on_vehicle_update();
end $$;

commit;

