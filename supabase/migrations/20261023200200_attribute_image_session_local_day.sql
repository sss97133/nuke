-- attribute_image_session: confirm work_sessions on the owner's local day, not the UTC day.
-- The iOS confirm sweep groups photos by the device's local day (AttributionEngine.sessionKey, PR
-- "candidate-set routing"); this function stamped work_sessions by (taken_at)::date, the UTC day, so
-- a shoot after 5 PM Pacific confirmed the next day's session. Skylar's shop is in America/Los_Angeles
-- (photos at 35.97,-114.86). Backward compatible: the confirm matches session_date on EITHER the local or
-- the UTC day, because derive_work_sessions / backfill_work_sessions_from_photos still write UTC dates
-- (switching those, and re-keying existing rows, is a follow-up that needs owner approval).
-- Nothing else changes: same signature, SECURITY DEFINER, search_path, caller check and grants.
-- Deploy note: not applied by the PR author. Apply with `supabase db push` (or the supabase-deploy
-- workflow) after review; the guard refuses to run if live has drifted from the reviewed body
-- (71fcd7a07d7660b71ec654544dd6f970, verified read-only 2026-10-22) or is already this one (1960e0ad7d603b701f1c96574977228a).
SET lock_timeout = '5s';
SET statement_timeout = '30s';
BEGIN;
DO $guard$ BEGIN
  IF coalesce((SELECT md5(prosrc) FROM pg_proc
               WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure), '')
     NOT IN ('71fcd7a07d7660b71ec654544dd6f970', '1960e0ad7d603b701f1c96574977228a') THEN -- gitleaks:allow (function-definition fingerprints, not secrets)
    RAISE EXCEPTION 'attribute_image_session differs from the reviewed live body; rebase and review the drift';
  END IF;
END $guard$;
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
    res := attribute_testimony('image', r.id, p_vehicle_id, p_reason, v_owner, 1.0, 'owner_session_confirm');
    IF (res->>'success')::boolean THEN
      n := n + 1;
    ELSIF res->>'error' = 'file_hash_exists_on_target' THEN
      UPDATE vehicle_images SET is_duplicate = true, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;

  -- Also auto-confirm any matching work_sessions rows for the dates covered by these images
  IF p_vehicle_id IS NOT NULL AND n > 0 THEN
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

REVOKE ALL ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attribute_image_session(uuid[], uuid, uuid, text) TO authenticated, service_role;
COMMIT;
