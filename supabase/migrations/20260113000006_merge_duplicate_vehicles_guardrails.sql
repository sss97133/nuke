-- Guardrails + permissions for merge_duplicate_vehicles()
--
-- Problem:
-- - Current function only allows merges when vehicles.user_id/uploaded_by == caller.
--   Many production vehicles are "claim-based" (user_id/uploaded_by NULL) so merges become impossible for org contributors.
-- - It also allows merges without any identity proof (VIN), which can cause cross-contamination.
-- - Function currently has search_path='' which is fragile.
--
-- Fix:
-- - Align permission with vehicle_user_has_access() so org roles (board_member, manager, etc) can act.
-- - Require VIN exact match (case-insensitive) to merge. This matches the platform safety posture:
--   "VIN is the only merge key that is allowed to be destructive."

begin;

create or replace function public.merge_duplicate_vehicles(
  p_primary_id uuid,
  p_duplicate_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary record;
  v_duplicate record;

  v_primary_vin text;
  v_dup_vin text;
  v_primary_norm text;
  v_dup_norm text;

  v_images_moved integer := 0;
  v_events_moved integer := 0;
  v_documents_moved integer := 0;
  v_orgs_moved integer := 0;
begin
  if p_primary_id is null or p_duplicate_id is null then
    raise exception 'primary and duplicate ids are required';
  end if;
  if p_primary_id = p_duplicate_id then
    raise exception 'primary and duplicate cannot be the same';
  end if;
  if p_user_id is null then
    raise exception 'user is required';
  end if;

  -- Require access to BOTH vehicles
  if to_regprocedure('public.vehicle_user_has_access(uuid,uuid)') is not null then
    if public.vehicle_user_has_access(p_primary_id, p_user_id) is not true
       or public.vehicle_user_has_access(p_duplicate_id, p_user_id) is not true then
      raise exception 'You do not have permission to merge these vehicles';
    end if;
  end if;

  select id, year, make, model, vin into v_primary
  from public.vehicles
  where id = p_primary_id;
  if not found then
    raise exception 'Primary vehicle not found';
  end if;

  select id, year, make, model, vin into v_duplicate
  from public.vehicles
  where id = p_duplicate_id;
  if not found then
    raise exception 'Duplicate vehicle not found';
  end if;

  v_primary_vin := coalesce(v_primary.vin, '');
  v_dup_vin := coalesce(v_duplicate.vin, '');

  v_primary_norm := upper(btrim(replace(replace(v_primary_vin, ' ', ''), '-', '')));
  v_dup_norm := upper(btrim(replace(replace(v_dup_vin, ' ', ''), '-', '')));

  if v_primary_norm = '' or v_primary_norm like 'VIVA-%' then
    raise exception 'Merge blocked: primary VIN is missing/placeholder. Add/verify VIN first.';
  end if;
  if v_dup_norm = '' or v_dup_norm like 'VIVA-%' then
    raise exception 'Merge blocked: duplicate VIN is missing/placeholder. Add/verify VIN first.';
  end if;

  if v_primary_norm <> v_dup_norm then
    raise exception 'Merge blocked: VINs do not match (% vs %).', v_primary_norm, v_dup_norm;
  end if;

  -- Merge is destructive: set guard flag to prevent recursion.
  perform set_config('app.is_merging_vehicles', 'TRUE', false);

  -- Move vehicle images
  update public.vehicle_images
  set vehicle_id = p_primary_id,
      updated_at = now()
  where vehicle_id = p_duplicate_id;
  get diagnostics v_images_moved = row_count;

  -- Move timeline events
  update public.timeline_events
  set vehicle_id = p_primary_id,
      updated_at = now()
  where vehicle_id = p_duplicate_id;
  get diagnostics v_events_moved = row_count;

  -- Move document associations (best-effort)
  if to_regclass('public.vehicle_documents') is not null then
    update public.vehicle_documents
    set vehicle_id = p_primary_id,
        updated_at = now()
    where vehicle_id = p_duplicate_id;
    get diagnostics v_documents_moved = row_count;
  end if;

  -- Move organization relationships (or update if already exists)
  if to_regclass('public.organization_vehicles') is not null then
    with moved_orgs as (
      update public.organization_vehicles
      set vehicle_id = p_primary_id,
          updated_at = now()
      where vehicle_id = p_duplicate_id
        and not exists (
          select 1
          from public.organization_vehicles ov2
          where ov2.vehicle_id = p_primary_id
            and ov2.organization_id = public.organization_vehicles.organization_id
            and ov2.relationship_type = public.organization_vehicles.relationship_type
        )
      returning 1
    )
    select count(*) into v_orgs_moved from moved_orgs;

    delete from public.organization_vehicles
    where vehicle_id = p_duplicate_id;
  end if;

  -- Mark duplicate vehicle as merged (do NOT hard delete; keeps reversibility possible)
  update public.vehicles
  set status = 'merged',
      merged_into_vehicle_id = p_primary_id,
      updated_at = now()
  where id = p_duplicate_id;

  perform set_config('app.is_merging_vehicles', 'FALSE', false);

  return jsonb_build_object(
    'success', true,
    'primary_vehicle_id', p_primary_id,
    'duplicate_vehicle_id', p_duplicate_id,
    'images_moved', v_images_moved,
    'events_moved', v_events_moved,
    'documents_moved', v_documents_moved,
    'organization_relationships_moved', v_orgs_moved
  );
exception when others then
  perform set_config('app.is_merging_vehicles', 'FALSE', false);
  raise;
end;
$$;

revoke all on function public.merge_duplicate_vehicles(uuid, uuid, uuid) from public;
grant execute on function public.merge_duplicate_vehicles(uuid, uuid, uuid) to authenticated, service_role;

commit;

