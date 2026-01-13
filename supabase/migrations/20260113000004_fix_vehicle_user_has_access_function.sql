-- Fix vehicle_user_has_access() so missing legacy tables don't hard-fail
-- Production issue observed:
-- - public.vehicle_user_has_access() references vehicle_user_permissions, but that table may not exist.
-- - This causes runtime errors in any caller (Edge Functions, RLS helpers, etc).
--
-- This replacement:
-- - Guards each legacy table reference with to_regclass()
-- - Keeps org-based access + verified ownership checks

begin;

create or replace function public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  has_perm boolean := false;
begin
  if p_user_id is null then
    return false;
  end if;

  -- Direct vehicle-level permissions (legacy, optional)
  if to_regclass('public.vehicle_user_permissions') is not null then
    select true into has_perm
    from public.vehicle_user_permissions vup
    where vup.vehicle_id = p_vehicle_id
      and vup.user_id = p_user_id
      and coalesce(vup.is_active, true) = true
      and vup.role = any (array[
        'owner','co_owner','mechanic','appraiser','moderator','contributor','photographer','dealer_rep','sales_agent','restorer','consigner','board_member'
      ]::text[])
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  -- Vehicle contributors table (legacy collaborators)
  if to_regclass('public.vehicle_contributors') is not null then
    select true into has_perm
    from public.vehicle_contributors vc
    where vc.vehicle_id = p_vehicle_id
      and vc.user_id = p_user_id
      and coalesce(vc.status, 'active') = 'active'
      and vc.role = any (array[
        'owner','co_owner','restorer','moderator','consigner','mechanic','appraiser','photographer','sales_agent'
      ]::text[])
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  -- Organization contributors linked to this vehicle
  if to_regclass('public.organization_vehicles') is not null and to_regclass('public.organization_contributors') is not null then
    select true into has_perm
    from public.organization_vehicles ov
    where ov.vehicle_id = p_vehicle_id
      and exists (
        select 1
        from public.organization_contributors oc
        where oc.organization_id = ov.organization_id
          and oc.user_id = p_user_id
          and oc.status = 'active'
          and oc.role = any (array[
            'owner','co_founder','board_member','manager','employee','technician','contractor','moderator','contributor','photographer'
          ]::text[])
      )
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  -- Verified ownership records
  if to_regclass('public.ownership_verifications') is not null then
    select true into has_perm
    from public.ownership_verifications ov
    where ov.vehicle_id = p_vehicle_id
      and ov.user_id = p_user_id
      and ov.status = 'approved'
    limit 1;

    if has_perm then
      return true;
    end if;
  end if;

  return false;
end;
$$;

grant execute on function public.vehicle_user_has_access(uuid, uuid) to anon, authenticated, service_role;

commit;

