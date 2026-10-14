-- Live definitions as production had them on 2026-10-14 (pg_get_functiondef), the "before" state of
-- supabase/migrations/20261014051000_get_vehicle_day_depth_index_probes.sql and its contract
-- supabase/sql/test_get_vehicle_day_depth_perf.sql.
--   get_vehicle_day_depth(uuid)   md5(pg_get_functiondef) e8347b640d968eeee98af6511f8ca657  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   nuke_image_depth_score(...)   md5(pg_get_functiondef) 2bd969542e4b21c3061ab34f71c61b2c  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   vehicle_user_has_access(uuid,uuid)  md5(pg_get_functiondef) 0f13ceda2c2575ba9783c24bf84ab5bf  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
-- nuke_image_depth_score is the scoring formula the reader calls per day; the migration does not change it.
-- vehicle_user_has_access is the access test the visibility check calls; the migration does not change it either. It consults
-- optional tables only where they exist (to_regclass), so a contract database needs just vehicle_user_permissions.

CREATE OR REPLACE FUNCTION public.nuke_image_depth_score(p_gated boolean, p_seen boolean, p_meta jsonb, p_placed boolean, p_clip boolean, p_connected boolean, p_confirmed boolean, p_stale boolean)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select least(1.0, greatest(0.0,
      (case when p_gated then 0.12 else 0 end)
    + (case when p_seen  then 0.30 else 0 end)
    + (case when p_seen and coalesce((p_meta->'byok_deep_analysis'->>'context_complete')::boolean, false)
            then 0.08 else 0 end)
    + (case when p_seen and coalesce((p_meta->'byok_deep_analysis'->>'intent_confidence')::numeric, 0) >= 0.6
            then 0.08 else 0 end)
    + (case when p_seen and jsonb_typeof(p_meta->'byok_deep_analysis'->'components_seen') = 'array'
                       and jsonb_array_length(p_meta->'byok_deep_analysis'->'components_seen') > 0
            then 0.07 else 0 end)
    + (case when p_placed    then 0.13 else 0 end)
    + (case when p_clip      then 0.07 else 0 end)
    + (case when p_connected then 0.08 else 0 end)
    + (case when p_confirmed then 0.07 else 0 end)
    - (case when p_seen and p_stale then 0.05 else 0 end)
  ))::numeric;
$function$;

CREATE OR REPLACE FUNCTION public.get_vehicle_day_depth(p_vehicle_id uuid)
 RETURNS TABLE(day date, photos integer, seen integer, placed integer, depth numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with imgs as (
    select id, ai_scan_metadata, coalesce(stale,false) stale,
           (vision_gate_status='approved') gated,
           (ai_scan_metadata ? 'byok_deep_analysis') seen,
           coalesce(taken_at::date, created_at::date) d
    from vehicle_images
    where vehicle_id = p_vehicle_id and is_external = false
      and coalesce(is_duplicate,false) = false and coalesce(is_superseded,false) = false
      and coalesce(taken_at::date, created_at::date) is not null
  ),
  obs as (
    select image_id, bool_or(embedding_clip_vitb32 is not null) clip
    from image_observations
    where vehicle_id = p_vehicle_id and coalesce(is_active,true) and image_id is not null
    group by image_id
  ),
  confirmed_days as (
    select distinct session_date from work_sessions
    where vehicle_id = p_vehicle_id and owner_confirmed_at is not null
  ),
  j as (
    select i.d, i.gated, i.seen, i.stale, i.ai_scan_metadata,
           (o.image_id is not null) placed, coalesce(o.clip,false) clip,
           (cd.session_date is not null) confirmed
    from imgs i
    left join obs o on o.image_id = i.id
    left join confirmed_days cd on cd.session_date = i.d
  )
  select d,
    count(*)::int,
    count(*) filter (where seen)::int,
    count(*) filter (where placed)::int,
    coalesce(round(avg(nuke_image_depth_score(gated,seen,ai_scan_metadata,placed,clip,false,confirmed,stale)),4),0)
  from j group by d order by d;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
