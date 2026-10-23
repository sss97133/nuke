-- attribute_image_session files a signed-in account's own unfiled photos onto any vehicle. It runs as its owner
-- (SECURITY DEFINER), authenticated can execute it, and nothing compared p_vehicle_id with what the caller may edit.
-- Each photo goes through attribute_testimony at confidence 1.0 (it joins that vehicle and a pending gate is approved),
-- and the caller's own work_sessions rows for that vehicle and those days are stamped owner_confirmed. From 2026-10-17
-- the calls filed nothing because attribute_testimony failed with 42704; #2381 (20261021140000, deployed 2026-10-20
-- 08:54Z) repaired it, so the door is open again.
-- The check is relink_testimony's P3.7 rule (20260927180000): an end-user JWT files only its own photos (p_owner unset
-- or its own id) onto a vehicle user_can_edit_vehicle(p_vehicle_id, auth.uid()) allows, otherwise 42501 before any
-- row is read or written. service_role and sessions without a JWT are unchanged.
-- Everything else is live's (pg_get_functiondef, 2026-10-20; no earlier migration holds this definition): the body,
-- SECURITY DEFINER, search_path public, VOLATILE and EXECUTE for authenticated and service_role only (not PUBLIC, not
-- anon), restated below unchanged. The guard accepts live's body or this one and refuses any other.
-- Evidence (2026-10-20): reattribution_audit holds 70 filings by this function (signal owner_session_confirm,
-- 2026-06-16 to 2026-10-17 13:03Z), one account onto three vehicles, all three editable by that account today; none
-- since the repair. No unfiled photo carries a VIN-read suggestion (vin_ocr_match), the only suggestion the app files.
-- Consumers (git grep, 2026-10-20): only the iOS capture app (AttributionEngine.fileMatchedPhotos), without p_owner,
-- onto a vehicle picked from the account's own (user_id or owner_id) or a VIN-read suggestion among the vehicles
-- user_associated_vehicle_ids returns. No web, edge function, script, SQL function, view or cron job calls it.
-- Contract: supabase/sql/test_attribute_image_session_caller_check.sql (PG17).
SET lock_timeout = '5s';
SET statement_timeout = '30s';
BEGIN;
DO $guard$ BEGIN
  IF coalesce((SELECT md5(prosrc) FROM pg_proc
               WHERE oid = 'public.attribute_image_session(uuid[],uuid,uuid,text)'::regprocedure), '')
     NOT IN ('4dcd5577fb9166c75084f7a6525bc1d9', '71fcd7a07d7660b71ec654544dd6f970') THEN -- gitleaks:allow (function-definition fingerprints, not secrets)
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
    SELECT id, (taken_at)::date AS sday
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
         SELECT DISTINCT (vi.taken_at)::date
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
