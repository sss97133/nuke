-- The owner's filing writer never files photos onto a vehicle record that no longer stands.
--
-- Why. attribute_image_session files an owner's photos onto the car he picked (the phone's session confirm, the web
-- capture ledger's answer). It filed onto the record named, whether or not that record still stands. A record stops
-- standing when it is removed (deleted_at set) or merged into another record (merged_into_vehicle_id set), and the
-- phone's vehicle picker lists such records, so a tap could put photos on a record nobody reads any more.
-- Change, every added line marked (20261122004500); nothing else in the body changes:
--  a. Before the caller check, a non-null p_vehicle_id is resolved with vehicle_merge_terminal (20261017021000), the
--     resolver the device filer already uses for the same act: a merged record is followed to the record that stands,
--     and every later line (the caller check, attribute_testimony, its audit row, the work-session block) uses that
--     record. The resolver answers null for a missing or removed record, a record whose status says deleted or merged,
--     a chain longer than nine hops or one that loops, and a merge held for an un-merge.
--  b. When it answers null the call is refused with SQLSTATE 42501 and the message
--     'vehicle <id> no longer stands; photos cannot be filed onto it'. Nothing is written.
--  c. A null p_vehicle_id is not resolved and behaves as before. A merged record whose survivor the caller may not
--     edit gets the existing caller refusal. The signal, the work-session rule of 20261121232000 and the return value
--     (photos filed) are unchanged.
-- Signature, return type, language, volatility, SECURITY DEFINER, SET clause, owner and grants are unchanged (CREATE OR
-- REPLACE keeps owner and grants; the post-check below compares them). The body is production's live body of 2026-11-21
-- (pg_get_functiondef) with the marked lines added; removing every line that carries the marker gives the earlier md5.
-- The migration refuses unless the live body is the one it was written from (md5 of prosrc) or already this one, so a
-- body changed in between is never overwritten, and refuses when the resolver is absent.
-- Contract: supabase/sql/test_owner_filing_resolves_dead_target.sql
-- Revert: supabase/sql/revert_20261122004500_owner_filing_resolves_dead_target.sql

begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $do$
declare
  v_md5 text;
begin
  if to_regprocedure('public.vehicle_merge_terminal(uuid)') is null then
    raise exception 'public.vehicle_merge_terminal(uuid) is not live; refusing to make the filer depend on it';
  end if;
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)');
  if v_md5 is null then raise exception 'public.attribute_image_session(uuid[],uuid,uuid,text) is not live'; end if;
  if v_md5 not in ('734210d4b21dda0e02768d8fd4c680d7', '2fd530986f2291a6afd239aa1d55e5d8') then
    raise exception 'public.attribute_image_session is not the body this migration was written against (md5 %); refusing to replace it', v_md5;
  end if;
  -- everything about the function except its body, compared after the replace
  perform set_config('nuke.m20261122004500_attrs',
    (select concat_ws('|', pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.proretset,
                      p.prolang, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
       from pg_proc p where p.oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)')), true);
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
  v_stand uuid;  -- (20261122004500) the record that stands at the end of p_vehicle_id's merges
BEGIN
  -- (20261122004500) A merged record files onto the record that stands (vehicle_merge_terminal); a missing or removed
  -- (20261122004500) record, a held merge, a loop or a longer chain is refused and nothing is written. Every later line
  -- (20261122004500) reads p_vehicle_id, so it is set to the standing record here. A null target is left as it was.
  IF p_vehicle_id IS NOT NULL THEN  -- (20261122004500)
    v_stand := public.vehicle_merge_terminal(p_vehicle_id);  -- (20261122004500)
    IF v_stand IS NULL THEN  -- (20261122004500)
      RAISE EXCEPTION 'vehicle % no longer stands; photos cannot be filed onto it', p_vehicle_id  -- (20261122004500)
        USING ERRCODE = '42501';  -- (20261122004500)
    END IF;  -- (20261122004500)
    p_vehicle_id := v_stand;  -- (20261122004500)
  END IF;  -- (20261122004500)
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
$function$;

do $do$
declare
  v_md5 text;
  v_attrs text;
begin
  select md5(p.prosrc),
         concat_ws('|', pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.proretset,
                   p.prolang, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into v_md5, v_attrs
    from pg_proc p where p.oid = to_regprocedure('public.attribute_image_session(uuid[],uuid,uuid,text)');
  if v_md5 is distinct from '2fd530986f2291a6afd239aa1d55e5d8' then
    raise exception 'public.attribute_image_session did not become the body this file names (md5 %)', coalesce(v_md5, 'null');
  end if;
  if v_attrs is distinct from current_setting('nuke.m20261122004500_attrs', true) then
    raise exception 'public.attribute_image_session: owner, security, volatility, SET clause, grants or signature moved';
  end if;
end $do$;

commit;
