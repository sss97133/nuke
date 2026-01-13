-- Global guardrails: auto_merge_duplicates_with_notification should never destructively merge
-- on weak signals. This enforces "VIN-only auto-merge" at the function boundary.
--
-- Even though we also raised trigger thresholds to 100, keeping this check here prevents
-- accidental merges from any other callers (manual scripts, old cron jobs, etc).

begin;

create or replace function public.auto_merge_duplicates_with_notification(
  p_primary_vehicle_id uuid,
  p_duplicate_vehicle_id uuid,
  p_match_type text,
  p_confidence integer,
  p_merged_by_user_id uuid default null
)
returns jsonb
security definer
set search_path = public
language plpgsql
as $$
declare
  v_primary record;
  v_duplicate record;
  v_users_to_notify uuid[];
  v_user_id uuid;
  v_org_vehicle record;
begin
  -- Hard safety gate: VIN-only auto merge
  if coalesce(p_confidence, 0) < 100 or p_match_type is distinct from 'vin_exact' then
    return jsonb_build_object(
      'success', false,
      'error', 'Auto-merge disabled for non-VIN matches',
      'match_type', p_match_type,
      'confidence', p_confidence
    );
  end if;

  -- Set session variable to indicate merge is in progress
  perform set_config('app.is_merging_vehicles', 'TRUE', false);

  -- Get both vehicles
  select * into v_primary from public.vehicles where id = p_primary_vehicle_id;
  select * into v_duplicate from public.vehicles where id = p_duplicate_vehicle_id;

  if not found then
    perform set_config('app.is_merging_vehicles', 'FALSE', false);
    return jsonb_build_object('success', false, 'error', 'Vehicle not found');
  end if;

  begin
    -- Merge data: prefer real VIN, non-null values, higher values
    update public.vehicles
    set
      vin = case
        when v_primary.vin is not null and v_primary.vin != '' and v_primary.vin not like 'VIVA-%' then v_primary.vin
        when v_duplicate.vin is not null and v_duplicate.vin != '' and v_duplicate.vin not like 'VIVA-%' then v_duplicate.vin
        else coalesce(v_primary.vin, v_duplicate.vin)
      end,
      trim = coalesce(v_primary.trim, v_duplicate.trim),
      color_primary = coalesce(v_primary.color_primary, v_duplicate.color_primary),
      mileage = coalesce(v_primary.mileage, v_duplicate.mileage),
      current_value = greatest(coalesce(v_primary.current_value, 0), coalesce(v_duplicate.current_value, 0)),
      sale_price = coalesce(v_primary.sale_price, v_duplicate.sale_price),
      purchase_price = coalesce(v_primary.purchase_price, v_duplicate.purchase_price),
      description = case
        when v_primary.description is not null and v_duplicate.description is not null
          then v_primary.description || E'\n\n--- Merged from duplicate profile ---\n\n' || v_duplicate.description
        else coalesce(v_primary.description, v_duplicate.description)
      end,
      notes = case
        when v_primary.notes is not null and v_duplicate.notes is not null
          then v_primary.notes || E'\n\n--- Merged from duplicate profile ---\n\n' || v_duplicate.notes
        else coalesce(v_primary.notes, v_duplicate.notes)
      end,
      updated_at = now()
    where id = p_primary_vehicle_id;

    -- Move all related data from duplicate to primary (best-effort, guard legacy tables)
    update public.vehicle_images set vehicle_id = p_primary_vehicle_id where vehicle_id = p_duplicate_vehicle_id;
    update public.timeline_events set vehicle_id = p_primary_vehicle_id where vehicle_id = p_duplicate_vehicle_id;

    if to_regclass('public.organization_vehicles') is not null then
      for v_org_vehicle in
        select * from public.organization_vehicles where vehicle_id = p_duplicate_vehicle_id
      loop
        if not exists (
          select 1 from public.organization_vehicles
          where organization_id = v_org_vehicle.organization_id
            and vehicle_id = p_primary_vehicle_id
            and relationship_type = v_org_vehicle.relationship_type
        ) then
          update public.organization_vehicles
          set vehicle_id = p_primary_vehicle_id
          where id = v_org_vehicle.id;
        else
          delete from public.organization_vehicles where id = v_org_vehicle.id;
        end if;
      end loop;
    end if;

    if to_regclass('public.vehicle_comments') is not null then
      update public.vehicle_comments set vehicle_id = p_primary_vehicle_id where vehicle_id = p_duplicate_vehicle_id;
    end if;
    if to_regclass('public.contractor_work_contributions') is not null then
      update public.contractor_work_contributions set vehicle_id = p_primary_vehicle_id where vehicle_id = p_duplicate_vehicle_id;
    end if;
    if to_regclass('public.vehicle_price_history') is not null then
      update public.vehicle_price_history set vehicle_id = p_primary_vehicle_id where vehicle_id = p_duplicate_vehicle_id;
    end if;

    -- Collect users to notify (best-effort; some environments omit legacy tables)
    begin
      select array_agg(distinct user_id) into v_users_to_notify
      from (
        select coalesce(owner_id, user_id) as user_id from public.vehicles where id = p_primary_vehicle_id
        union
        select coalesce(owner_id, user_id) as user_id from public.vehicles where id = p_duplicate_vehicle_id
        union
        select user_id from public.vehicle_contributors where vehicle_id in (p_primary_vehicle_id, p_duplicate_vehicle_id)
        union
        select oc.user_id
        from public.organization_vehicles ov
        join public.organization_contributors oc on oc.organization_id = ov.organization_id
        where ov.vehicle_id in (p_primary_vehicle_id, p_duplicate_vehicle_id)
          and oc.status = 'active'
      ) users
      where user_id is not null;
    exception
      when undefined_table then
        v_users_to_notify := null;
    end;

    if v_users_to_notify is not null then
      foreach v_user_id in array v_users_to_notify
      loop
        insert into public.user_notifications (
          user_id,
          type,
          notification_type,
          title,
          message,
          vehicle_id,
          action_url,
          metadata
        ) values (
          v_user_id,
          'vehicle_merged',
          'vehicle_merged',
          'Vehicle Profiles Merged',
          format(
            'Your %s %s %s profile was automatically merged with a duplicate. All data has been consolidated into the main profile.',
            v_primary.year,
            v_primary.make,
            v_primary.model
          ),
          p_primary_vehicle_id,
          format('/vehicle/%s', p_primary_vehicle_id),
          jsonb_build_object(
            'type', 'vehicle_merged',
            'primary_vehicle_id', p_primary_vehicle_id,
            'duplicate_vehicle_id', p_duplicate_vehicle_id,
            'match_type', p_match_type,
            'confidence', p_confidence,
            'merged_at', now()
          )
        );
      end loop;
    end if;

    -- Timeline event for the merge
    insert into public.timeline_events (
      vehicle_id,
      event_type,
      event_date,
      title,
      description,
      source,
      source_type,
      metadata
    ) values (
      p_primary_vehicle_id,
      'profile_merged',
      now(),
      'Vehicle Profile Merged',
      format('Merged duplicate profile %s (match type: %s, confidence: %s%%)', p_duplicate_vehicle_id, p_match_type, p_confidence),
      'system',
      'system',
      jsonb_build_object(
        'duplicate_vehicle_id', p_duplicate_vehicle_id,
        'match_type', p_match_type,
        'confidence', p_confidence,
        'merged_by', p_merged_by_user_id,
        'auto_merged', p_merged_by_user_id is null
      )
    );

    -- Keep existing behavior: delete duplicate to avoid VIN unique collisions.
    -- (Future improvement: soft-merge + moved-row attribution for fully reversible merges.)
    delete from public.vehicles where id = p_duplicate_vehicle_id;

    perform set_config('app.is_merging_vehicles', 'FALSE', false);

    return jsonb_build_object(
      'success', true,
      'primary_vehicle_id', p_primary_vehicle_id,
      'duplicate_vehicle_id', p_duplicate_vehicle_id,
      'notifications_sent', coalesce(array_length(v_users_to_notify, 1), 0)
    );
  exception when others then
    perform set_config('app.is_merging_vehicles', 'FALSE', false);
    raise;
  end;
end;
$$;

commit;

