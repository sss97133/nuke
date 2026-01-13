-- Rehydrate a wrong (auto) merge into a new vehicle profile (best-effort, reversible)
--
-- Why:
-- - Some historical auto-merges hard-deleted the duplicate vehicle.
-- - We still need a way to "undo" the merge by creating a new vehicle and moving clearly-foreign rows.
--
-- Strategy:
-- - Use the profile_merged timeline event (source of truth) to obtain duplicate_vehicle_id + merge timestamp.
-- - Move rows that are *clearly* from the old profile:
--   - rows created before the primary vehicle existed (created_at < vehicles.created_at)
--   - and/or image URLs that still embed the old vehicle id path
--
-- Notes:
-- - This does NOT try to reconstruct every moved row in all cases. It is intentionally conservative.
-- - For future-proof undo, we should log moved row IDs at merge time (see follow-up work).

begin;

create or replace function public.rehydrate_profile_merge(
  p_primary_vehicle_id uuid,
  p_merge_event_id uuid,
  p_execute boolean default false,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := coalesce(auth.uid(), p_actor_user_id);
  v_primary record;
  v_merge_event record;
  v_duplicate_vehicle_id uuid;
  v_new_vehicle_id uuid;

  v_img_ids uuid[];
  v_event_ids uuid[];
  v_org_ids uuid[];
  v_price_ids uuid[];
  v_doc_ids uuid[];

  v_img_moved int := 0;
  v_event_moved int := 0;
  v_org_moved int := 0;
  v_price_moved int := 0;
  v_doc_moved int := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_primary_vehicle_id is null then
    raise exception 'p_primary_vehicle_id is required';
  end if;
  if p_merge_event_id is null then
    raise exception 'p_merge_event_id is required';
  end if;

  -- Permission: user must have access to the primary vehicle
  if to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') is not null then
    if public.vehicle_user_has_access(p_primary_vehicle_id, v_user_id) is not true then
      raise exception 'Not authorized to rehydrate merge for this vehicle';
    end if;
  end if;

  select * into v_primary
  from public.vehicles
  where id = p_primary_vehicle_id;
  if not found then
    raise exception 'Primary vehicle not found';
  end if;

  select * into v_merge_event
  from public.timeline_events
  where id = p_merge_event_id;
  if not found then
    raise exception 'Merge event not found';
  end if;
  if v_merge_event.vehicle_id <> p_primary_vehicle_id then
    raise exception 'Merge event does not belong to the primary vehicle';
  end if;
  if v_merge_event.event_type <> 'profile_merged' then
    raise exception 'Merge event is not profile_merged';
  end if;

  v_duplicate_vehicle_id := nullif((v_merge_event.metadata->>'duplicate_vehicle_id')::text, '')::uuid;
  if v_duplicate_vehicle_id is null then
    raise exception 'Merge event missing duplicate_vehicle_id in metadata';
  end if;

  -- Build conservative ID lists
  -- 1) Images: either pre-date the primary vehicle OR still contain the old vehicle id in the URL path
  select coalesce(array_agg(id), '{}'::uuid[]) into v_img_ids
  from public.vehicle_images
  where vehicle_id = p_primary_vehicle_id
    and (
      created_at < v_primary.created_at
      or position(v_duplicate_vehicle_id::text in coalesce(image_url, '')) > 0
    );

  -- 2) Timeline events: only those that pre-date the primary vehicle
  select coalesce(array_agg(id), '{}'::uuid[]) into v_event_ids
  from public.timeline_events
  where vehicle_id = p_primary_vehicle_id
    and created_at < v_primary.created_at;

  -- 3) Organization links: only those that pre-date the primary vehicle
  if to_regclass('public.organization_vehicles') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_org_ids
    from public.organization_vehicles
    where vehicle_id = p_primary_vehicle_id
      and created_at < v_primary.created_at;
  else
    v_org_ids := '{}'::uuid[];
  end if;

  -- 4) Price history: only those that pre-date the primary vehicle
  if to_regclass('public.vehicle_price_history') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_price_ids
    from public.vehicle_price_history
    where vehicle_id = p_primary_vehicle_id
      and created_at < v_primary.created_at;
  else
    v_price_ids := '{}'::uuid[];
  end if;

  -- 5) Documents: only those that pre-date the primary vehicle (if table exists)
  if to_regclass('public.vehicle_documents') is not null then
    select coalesce(array_agg(id), '{}'::uuid[]) into v_doc_ids
    from public.vehicle_documents
    where vehicle_id = p_primary_vehicle_id
      and created_at < v_primary.created_at;
  else
    v_doc_ids := '{}'::uuid[];
  end if;

  -- Return plan (dry run)
  if p_execute is not true then
    return jsonb_build_object(
      'ok', true,
      'mode', 'plan',
      'primary_vehicle_id', p_primary_vehicle_id,
      'duplicate_vehicle_id', v_duplicate_vehicle_id,
      'primary_created_at', v_primary.created_at,
      'will_move', jsonb_build_object(
        'vehicle_images', jsonb_build_object('count', coalesce(array_length(v_img_ids, 1), 0), 'ids', v_img_ids),
        'timeline_events', jsonb_build_object('count', coalesce(array_length(v_event_ids, 1), 0), 'ids', v_event_ids),
        'organization_vehicles', jsonb_build_object('count', coalesce(array_length(v_org_ids, 1), 0), 'ids', v_org_ids),
        'vehicle_price_history', jsonb_build_object('count', coalesce(array_length(v_price_ids, 1), 0), 'ids', v_price_ids),
        'vehicle_documents', jsonb_build_object('count', coalesce(array_length(v_doc_ids, 1), 0), 'ids', v_doc_ids)
      )
    );
  end if;

  -- Execute: create a new vehicle and move selected rows
  perform set_config('app.is_merging_vehicles', 'TRUE', false);

  insert into public.vehicles (
    year,
    make,
    model,
    vin,
    is_public,
    profile_origin,
    discovery_source,
    origin_metadata,
    uploaded_by
  )
  values (
    v_primary.year,
    v_primary.make,
    v_primary.model,
    null,
    false,
    'rehydrated_split',
    'rehydrate_profile_merge',
    jsonb_build_object(
      'rehydrated_from_vehicle_id', p_primary_vehicle_id,
      'rehydrated_from_merge_event_id', p_merge_event_id,
      'original_duplicate_vehicle_id', v_duplicate_vehicle_id,
      'created_at', now()
    ),
    v_user_id
  )
  returning id into v_new_vehicle_id;

  if coalesce(array_length(v_img_ids, 1), 0) > 0 then
    update public.vehicle_images
    set vehicle_id = v_new_vehicle_id,
        updated_at = now()
    where id = any(v_img_ids);
    get diagnostics v_img_moved = row_count;
  end if;

  if coalesce(array_length(v_event_ids, 1), 0) > 0 then
    update public.timeline_events
    set vehicle_id = v_new_vehicle_id,
        updated_at = now()
    where id = any(v_event_ids);
    get diagnostics v_event_moved = row_count;
  end if;

  if coalesce(array_length(v_org_ids, 1), 0) > 0 then
    update public.organization_vehicles
    set vehicle_id = v_new_vehicle_id,
        updated_at = now()
    where id = any(v_org_ids);
    get diagnostics v_org_moved = row_count;
  end if;

  if coalesce(array_length(v_price_ids, 1), 0) > 0 then
    update public.vehicle_price_history
    set vehicle_id = v_new_vehicle_id
    where id = any(v_price_ids);
    get diagnostics v_price_moved = row_count;
  end if;

  if coalesce(array_length(v_doc_ids, 1), 0) > 0 then
    update public.vehicle_documents
    set vehicle_id = v_new_vehicle_id,
        updated_at = now()
    where id = any(v_doc_ids);
    get diagnostics v_doc_moved = row_count;
  end if;

  -- Audit trail: add notes to both vehicles
  begin
    insert into public.timeline_events (
      vehicle_id, user_id, event_type, event_date, title, description, source, source_type, metadata
    )
    values (
      p_primary_vehicle_id,
      v_user_id,
      'other',
      now(),
      'Rehydrated merged profile (split)',
      'Created a new vehicle profile and moved clearly-foreign rows out of this profile to prevent cross-contamination.',
      'system',
      'system',
      jsonb_build_object('action', 'rehydrate_profile_merge', 'new_vehicle_id', v_new_vehicle_id, 'merge_event_id', p_merge_event_id)
    );
  exception when others then
    null;
  end;

  begin
    insert into public.timeline_events (
      vehicle_id, user_id, event_type, event_date, title, description, source, source_type, metadata
    )
    values (
      v_new_vehicle_id,
      v_user_id,
      'other',
      now(),
      'Rehydrated from merge',
      format('Rehydrated from merge on %s (primary=%s).', v_merge_event.created_at, p_primary_vehicle_id),
      'system',
      'system',
      jsonb_build_object('action', 'rehydrate_profile_merge', 'primary_vehicle_id', p_primary_vehicle_id, 'merge_event_id', p_merge_event_id)
    );
  exception when others then
    null;
  end;

  -- Generate gaps for the new profile (VIN will be missing)
  if to_regprocedure('public.detect_data_gaps(text,uuid)') is not null then
    perform public.detect_data_gaps('vehicle', v_new_vehicle_id);
  end if;

  perform set_config('app.is_merging_vehicles', 'FALSE', false);

  return jsonb_build_object(
    'ok', true,
    'mode', 'executed',
    'primary_vehicle_id', p_primary_vehicle_id,
    'new_vehicle_id', v_new_vehicle_id,
    'duplicate_vehicle_id', v_duplicate_vehicle_id,
    'moved', jsonb_build_object(
      'vehicle_images', v_img_moved,
      'timeline_events', v_event_moved,
      'organization_vehicles', v_org_moved,
      'vehicle_price_history', v_price_moved,
      'vehicle_documents', v_doc_moved
    )
  );
exception when others then
  perform set_config('app.is_merging_vehicles', 'FALSE', false);
  raise;
end;
$$;

revoke all on function public.rehydrate_profile_merge(uuid, uuid, boolean, uuid) from public;
grant execute on function public.rehydrate_profile_merge(uuid, uuid, boolean, uuid) to authenticated, service_role;

commit;

