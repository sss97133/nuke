-- Merge high-confidence Craigslist duplicate profiles using discriminative image file_hash signatures.
--
-- This is intentionally conservative:
-- - Only considers vehicles with discovery_url on craigslist.org
-- - Uses only file_hash values that appear in <= p_max_hash_vehicles vehicles (drops stock/common images)
-- - Requires a large enough set of discriminative hashes (p_min_hashes)
-- - Requires exact match on (year, make, model) normalized (prevents dealer stock-photo collisions)
--
-- Merge behavior:
-- - Moves only non-conflicting images (avoids unique(vehicle_id,file_hash) violations)
-- - Moves timeline events + common related rows (best-effort)
-- - Marks duplicate vehicle status='merged' and sets merged_into_vehicle_id

create or replace function public.merge_craigslist_duplicates_by_image_signature(
  p_min_hashes integer default 10,
  p_max_hash_vehicles integer default 5,
  p_group_limit integer default 25,
  p_execute boolean default false,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := coalesce(auth.uid(), p_actor_user_id);

  v_group record;
  v_primary_id uuid;
  v_dup_id uuid;

  v_groups_found int := 0;
  v_groups_processed int := 0;
  v_vehicles_marked_merged int := 0;

  v_images_moved int := 0;
  v_events_moved int := 0;
  v_orgs_moved int := 0;
  v_prices_moved int := 0;
  v_docs_moved int := 0;
  v_listings_moved int := 0;

  v_rowcount int := 0;

  v_details jsonb := '[]'::jsonb;
  v_dups uuid[];
  v_dup_count int := 0;

  v_primary_created_at timestamptz;
  v_dup_created_at timestamptz;

  v_primary_total_images int;
  v_primary_total_events int;
begin
  -- Lock down execution to service contexts only.
  -- (We still rely on GRANTs below; this is a belt-and-suspenders check.)
  if coalesce(current_setting('request.jwt.claim.role', true), '') not in ('service_role') then
    -- If executed via direct SQL tooling, the claim role may be empty; allow postgres/admins.
    if session_user not in ('postgres', 'supabase_admin') then
      raise exception 'Not authorized';
    end if;
  end if;

  -- Build and process duplicate groups.
  for v_group in
    with cl as (
      select
        id,
        year,
        lower(coalesce(make, '')) as make_norm,
        lower(coalesce(model, '')) as model_norm,
        created_at
      from public.vehicles
      where discovery_url ilike '%craigslist.org%'
        and status is distinct from 'merged'
    ),
    imgs as (
      select vi.vehicle_id, vi.file_hash
      from public.vehicle_images vi
      join cl on cl.id = vi.vehicle_id
      where vi.file_hash is not null
    ),
    hash_counts as (
      select file_hash, count(distinct vehicle_id)::int as nveh
      from imgs
      group by file_hash
    ),
    filtered_imgs as (
      select i.vehicle_id, i.file_hash
      from imgs i
      join hash_counts hc on hc.file_hash = i.file_hash
      where hc.nveh between 1 and p_max_hash_vehicles
    ),
    sigs as (
      select
        fi.vehicle_id,
        md5(string_agg(distinct fi.file_hash, ',' order by fi.file_hash)) as sig,
        count(distinct fi.file_hash)::int as n_hashes
      from filtered_imgs fi
      group by fi.vehicle_id
      having count(distinct fi.file_hash) >= p_min_hashes
    ),
    groups as (
      select
        s.sig,
        c.year,
        c.make_norm,
        c.model_norm,
        array_agg(c.id order by c.created_at asc) as vehicle_ids,
        count(*)::int as vehicles
      from sigs s
      join cl c on c.id = s.vehicle_id
      group by s.sig, c.year, c.make_norm, c.model_norm
      having count(*) > 1
    )
    select *
    from groups
    order by vehicles desc
    limit p_group_limit
  loop
    v_groups_found := v_groups_found + 1;

    v_primary_id := v_group.vehicle_ids[1];
    v_dups := v_group.vehicle_ids[2:array_length(v_group.vehicle_ids, 1)];
    v_dup_count := coalesce(array_length(v_dups, 1), 0);

    select created_at into v_primary_created_at
    from public.vehicles
    where id = v_primary_id;

    if p_execute is not true then
      v_details := v_details || jsonb_build_object(
        'sig', v_group.sig,
        'year', v_group.year,
        'make_norm', v_group.make_norm,
        'model_norm', v_group.model_norm,
        'primary_vehicle_id', v_primary_id,
        'duplicate_vehicle_ids', coalesce(v_dups, '{}'::uuid[]),
        'duplicates', v_dup_count
      );
      continue;
    end if;

    -- Execute merge for each duplicate into primary.
    v_groups_processed := v_groups_processed + 1;

    perform set_config('app.is_merging_vehicles', 'TRUE', false);

    foreach v_dup_id in array v_dups
    loop
      -- Skip if already merged (race-safe)
      if exists (select 1 from public.vehicles v where v.id = v_dup_id and v.status = 'merged') then
        continue;
      end if;

      select created_at into v_dup_created_at
      from public.vehicles
      where id = v_dup_id;

      -- Move images (non-conflicting only; avoid unique(vehicle_id,file_hash) violation)
      update public.vehicle_images vi
      set vehicle_id = v_primary_id,
          updated_at = now()
      where vi.vehicle_id = v_dup_id
        and (
          vi.file_hash is null
          or not exists (
            select 1
            from public.vehicle_images vi2
            where vi2.vehicle_id = v_primary_id
              and vi2.file_hash = vi.file_hash
              and vi.file_hash is not null
          )
        );
      get diagnostics v_rowcount = row_count;
      v_images_moved := v_images_moved + v_rowcount;

      -- Move timeline events
      update public.timeline_events te
      set vehicle_id = v_primary_id,
          updated_at = now()
      where te.vehicle_id = v_dup_id;
      get diagnostics v_rowcount = row_count;
      v_events_moved := v_events_moved + v_rowcount;

      -- Move org links (best-effort)
      if to_regclass('public.organization_vehicles') is not null then
        update public.organization_vehicles ov
        set vehicle_id = v_primary_id,
            updated_at = now()
        where ov.vehicle_id = v_dup_id
          and not exists (
            select 1
            from public.organization_vehicles ov2
            where ov2.vehicle_id = v_primary_id
              and ov2.organization_id = ov.organization_id
              and ov2.relationship_type = ov.relationship_type
          );
        get diagnostics v_rowcount = row_count;
        v_orgs_moved := v_orgs_moved + v_rowcount;

        delete from public.organization_vehicles
        where vehicle_id = v_dup_id;
      end if;

      -- Move price history (best-effort)
      if to_regclass('public.vehicle_price_history') is not null then
        update public.vehicle_price_history ph
        set vehicle_id = v_primary_id
        where ph.vehicle_id = v_dup_id;
        get diagnostics v_rowcount = row_count;
        v_prices_moved := v_prices_moved + v_rowcount;
      end if;

      -- Move documents (best-effort)
      if to_regclass('public.vehicle_documents') is not null then
        update public.vehicle_documents vd
        set vehicle_id = v_primary_id,
            updated_at = now()
        where vd.vehicle_id = v_dup_id;
        get diagnostics v_rowcount = row_count;
        v_docs_moved := v_docs_moved + v_rowcount;
      end if;

      -- Move external listings (best-effort; guard unique (vehicle_id, platform, listing_id))
      if to_regclass('public.external_listings') is not null then
        update public.external_listings el
        set vehicle_id = v_primary_id,
            updated_at = now()
        where el.vehicle_id = v_dup_id
          and not exists (
            select 1
            from public.external_listings el2
            where el2.vehicle_id = v_primary_id
              and el2.platform = el.platform
              and el2.listing_id = el.listing_id
          );
        get diagnostics v_rowcount = row_count;
        v_listings_moved := v_listings_moved + v_rowcount;

        delete from public.external_listings
        where vehicle_id = v_dup_id;
      end if;

      -- Mark duplicate as merged
      update public.vehicles
      set status = 'merged',
          merged_into_vehicle_id = v_primary_id,
          is_public = false,
          updated_at = now()
      where id = v_dup_id;
      get diagnostics v_rowcount = row_count;
      if v_rowcount > 0 then
        v_vehicles_marked_merged := v_vehicles_marked_merged + 1;
      end if;

      -- Optional audit event (best-effort)
      begin
        insert into public.timeline_events (
          vehicle_id, user_id, event_type, source, title, description, event_date, source_type, metadata
        ) values (
          v_primary_id,
          v_actor_user_id,
          'profile_merged',
          'system',
          'Duplicate profile merged (Craigslist image signature)',
          'Merged a duplicate Craigslist profile with an identical discriminative image signature.',
          current_date,
          'system',
          jsonb_build_object(
            'action', 'merge_craigslist_duplicates_by_image_signature',
            'match_type', 'image_hash_signature',
            'confidence', 99,
            'duplicate_vehicle_id', v_dup_id,
            'primary_vehicle_id', v_primary_id,
            'sig', v_group.sig,
            'min_hashes', p_min_hashes,
            'max_hash_vehicles', p_max_hash_vehicles,
            'duplicate_created_at', v_dup_created_at,
            'primary_created_at', v_primary_created_at
          )
        );
      exception when others then
        null;
      end;

    end loop;

    perform set_config('app.is_merging_vehicles', 'FALSE', false);

    -- Add per-group summary
    select count(*)::int into v_primary_total_images from public.vehicle_images where vehicle_id = v_primary_id;
    select count(*)::int into v_primary_total_events from public.timeline_events where vehicle_id = v_primary_id;

    v_details := v_details || jsonb_build_object(
      'sig', v_group.sig,
      'year', v_group.year,
      'make_norm', v_group.make_norm,
      'model_norm', v_group.model_norm,
      'primary_vehicle_id', v_primary_id,
      'duplicates_merged', v_dup_count,
      'primary_images_after', v_primary_total_images,
      'primary_events_after', v_primary_total_events
    );

  end loop;

  if p_execute is not true then
    return jsonb_build_object(
      'ok', true,
      'mode', 'plan',
      'groups_found', v_groups_found,
      'group_limit', p_group_limit,
      'min_hashes', p_min_hashes,
      'max_hash_vehicles', p_max_hash_vehicles,
      'details', v_details
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', 'executed',
    'groups_found', v_groups_found,
    'groups_processed', v_groups_processed,
    'vehicles_marked_merged', v_vehicles_marked_merged,
    'moved', jsonb_build_object(
      'vehicle_images', v_images_moved,
      'timeline_events', v_events_moved,
      'organization_vehicles', v_orgs_moved,
      'vehicle_price_history', v_prices_moved,
      'vehicle_documents', v_docs_moved,
      'external_listings', v_listings_moved
    ),
    'details', v_details
  );
end;
$$;

revoke all on function public.merge_craigslist_duplicates_by_image_signature(integer, integer, integer, boolean, uuid) from public;
grant execute on function public.merge_craigslist_duplicates_by_image_signature(integer, integer, integer, boolean, uuid) to service_role;

