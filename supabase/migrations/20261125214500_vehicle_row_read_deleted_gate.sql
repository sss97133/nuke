-- vehicle_publicly_readable + vehicle_row_read: a deleted car is public only as a merge redirect.
--
-- WHY. vehicle_row_read(uuid) is SECURITY DEFINER and anon may execute it. It gates a non-insider on is_public alone, so a
-- deleted car still flagged public answers anon and every signed-in stranger with its whole (projected) row. Prod
-- 2026-11-25 (read-only, counts only, 185 of 256 primary-key slices = 1,076,292 of an estimated 1.49M rows): 64,362
-- deleted and public, 39,600 of them not merged; about 89k and 55k for the table. The merged stubs (34,527 deleted,
-- public and merged, EXPLAIN ANALYZE actual rows) are what the profile's merged-car redirect resolves, so a deleted car
-- cannot simply vanish: it may still say where it went.
--
-- WHAT.
--   public.vehicle_publicly_readable(is_public, deleted_at, merged_into_vehicle_id): the one public-row predicate,
--     coalesce(is_public, false) AND (deleted_at IS NULL OR merged_into_vehicle_id IS NOT NULL). Plain SQL, IMMUTABLE,
--     no SET clause and no table read, so the planner inlines it; get_vehicle_profile_data and the vehicles read policy
--     call it next (their own PRs), so the three cannot drift. anon and authenticated may execute it (a policy needs it).
--   vehicle_row_read: a non-insider reads a car only when the predicate holds. A deleted car that was merged answers a
--     non-insider with the redirect only, {"id", "merged_into_vehicle_id"}, never its row; a deleted car that was not
--     merged answers NULL, exactly like a missing one. Insiders (owner, user, creator, uploader,
--     vehicle_user_has_access, service_role) still read their deleted car whole, so the garage, edit forms and merge
--     and dedup tools are unchanged. Everything else in the body is the live one.
-- Callers, by grep: web useVehicle (unused), vehicleService.getById (VehicleForm), EditVehicle, VehicleEditModal, AddVehicle,
-- MergeProposalsDashboard, vehicleDeduplicationService, InvoiceManager (moving to vehicle_plates_read); iOS GarageReaders.
-- CONTRACT: supabase/sql/test_vehicle_row_read_deleted_gate.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125214500_vehicle_row_read_deleted_gate.sql (the prior live body; the predicate stays).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE s text;
BEGIN
  SELECT encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') INTO s
  FROM pg_proc p WHERE p.oid = 'public.vehicle_row_read(uuid)'::regprocedure;
  IF s IS DISTINCT FROM '39f79cb8301139eedafa9d0ec9b2e73bc920484dc1149c116df4401d58b4c795'
     AND position('vehicle_row_read_deleted_gate_v1' in pg_get_functiondef('public.vehicle_row_read(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'vehicle_row_read changed after it was read for 20261125214500 (sha256 %); review it', s;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_publicly_readable(p_is_public boolean, p_deleted_at timestamptz,
                                                            p_merged_into_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT coalesce(p_is_public, false) AND (p_deleted_at IS NULL OR p_merged_into_vehicle_id IS NOT NULL)
$function$;
COMMENT ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) IS
  'The public-row predicate for vehicles: public, and not deleted unless it was merged (a merged stub stays readable as '
  'a redirect only). Called by vehicle_row_read, get_vehicle_profile_data and the vehicles read policy. Inlinable: keep it '
  'plain SQL with no SET clause and no table read.';
REVOKE ALL ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_publicly_readable(boolean, timestamptz, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
  v_redirect uuid;
BEGIN
  -- vehicle_row_read_deleted_gate_v1: public means vehicle_publicly_readable; a deleted merged car is a redirect only.
  SELECT to_jsonb(v.*),
         public.vehicle_publicly_readable(v.is_public, v.deleted_at, v.merged_into_vehicle_id),
         CASE WHEN v.deleted_at IS NOT NULL THEN v.merged_into_vehicle_id END,
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_redirect, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  IF v_redirect IS NOT NULL THEN
    RETURN jsonb_build_object('id', p_vehicle_id, 'merged_into_vehicle_id', v_redirect);
  END IF;
  RETURN public.vehicle_row_public_projection(v_row);
END;
$function$;

DO $check$
DECLARE f record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS res,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         position('vehicle_row_read_deleted_gate_v1' in p.prosrc) > 0
           AND position('vehicle_publicly_readable' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_row_read(uuid)'::regprocedure;
  IF NOT (f.prosecdef AND f.provolatile = 's' AND f.proconfig = ARRAY['search_path=public'] AND f.res = 'jsonb'
          AND f.anon_x AND f.marked) THEN
    RAISE EXCEPTION 'vehicle_row_read not as intended';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.vehicle_publicly_readable(boolean,timestamptz,uuid)'::regprocedure
                 AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql') AND NOT p.prosecdef
                 AND p.proconfig IS NULL AND p.provolatile = 'i'
                 AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'vehicle_publicly_readable not inlinable or not executable by anon';
  END IF;
END $check$;
COMMIT;
