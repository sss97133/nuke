-- Revert of 20261122004500_owner_filing_resolves_dead_target: puts production's earlier body of attribute_image_session
-- back (the record named is filed onto as named, whether or not it still stands). Photos filed onto a standing record
-- while the migration was live stay where they were filed.
-- A body that is neither the earlier one nor the one the migration installed is left alone and the revert refuses.
-- A function that does not exist is created with the earlier body (the contract uses this to install it in an empty database).
-- Run as the function owner, e.g. psql -X -v ON_ERROR_STOP=1 -f supabase/sql/revert_20261122004500_owner_filing_resolves_dead_target.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $do$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)');
  if v_md5 is not null and v_md5 not in ('734210d4b21dda0e02768d8fd4c680d7', '2fd530986f2291a6afd239aa1d55e5d8') then
    raise exception 'public.attribute_image_session is not the body this revert was written against (md5 %); refusing to replace it', v_md5;
  end if;
end $do$;

CREATE OR REPLACE FUNCTION public.attribute_image_session(p_image_ids uuid[], p_vehicle_id uuid, p_owner uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'owner_session_confirm'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid := COALESCE(auth.uid(), p_owner);
  r record;
  res jsonb;
  n int := 0;
BEGIN
  -- Caller check (2026-10-20, relink_testimony's P3.7 rule): an end-user JWT files only its own photos, onto a vehicle
  -- it can edit. service_role and JWT-less sessions are unchanged.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF auth.uid() IS NULL
       OR (p_owner IS NOT NULL AND p_owner IS DISTINCT FROM auth.uid())
       OR p_vehicle_id IS NULL
       OR NOT public.user_can_edit_vehicle(p_vehicle_id, auth.uid()) THEN
      RAISE EXCEPTION 'attribute_image_session: you can only file your own photos onto a vehicle you can edit'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR r IN
    SELECT id, (taken_at AT TIME ZONE 'America/Los_Angeles')::date AS sday
    FROM vehicle_images
    WHERE id = ANY(p_image_ids)
      AND user_id = v_owner
      AND vehicle_id IS NULL
  LOOP
    -- (20261121232000) the owner's signal only when a signed-in end user made the call; a service or JWT-less call naming
    -- p_owner still files the photo but records service_session_confirm
    res := attribute_testimony('image', r.id, p_vehicle_id, p_reason, v_owner, 1.0,
                               case when auth.uid() is not null then 'owner_session_confirm' else 'service_session_confirm' end);
    IF (res->>'success')::boolean THEN
      n := n + 1;
    ELSIF res->>'error' = 'file_hash_exists_on_target' THEN
      UPDATE vehicle_images SET is_duplicate = true, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  -- Also auto-confirm any matching work_sessions rows for the dates covered by these images
  IF p_vehicle_id IS NOT NULL AND n > 0 AND p_reason = 'owner_session_confirm' THEN  -- (20261121232000) only the session-confirm act signs work sessions
    UPDATE public.work_sessions ws
       SET owner_confirmed_at = COALESCE(ws.owner_confirmed_at, now()),
           owner_confirmed_by = COALESCE(ws.owner_confirmed_by, v_owner),
           updated_at = now()
     WHERE ws.user_id = v_owner
       AND ws.vehicle_id = p_vehicle_id
       AND ws.owner_confirmed_at IS NULL
       AND ws.session_date IN (
         -- The owner's local working day (America/Los_Angeles). The UTC day is kept as well while the
         -- session derivers still key work_sessions by the UTC date (backward compatible).
         SELECT DISTINCT (vi.taken_at AT TIME ZONE 'America/Los_Angeles')::date
         FROM public.vehicle_images vi
         WHERE vi.id = ANY(p_image_ids)
           AND vi.taken_at IS NOT NULL
         UNION
         SELECT DISTINCT (vi.taken_at AT TIME ZONE 'UTC')::date
         FROM public.vehicle_images vi
         WHERE vi.id = ANY(p_image_ids)
           AND vi.taken_at IS NOT NULL
       );
  END IF;

  RETURN n;
END;
$function$
;

do $do$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)');
  if v_md5 is distinct from '734210d4b21dda0e02768d8fd4c680d7' then
    raise exception 'public.attribute_image_session did not become the earlier body (md5 %)', coalesce(v_md5, 'null');
  end if;
end $do$;

commit;
