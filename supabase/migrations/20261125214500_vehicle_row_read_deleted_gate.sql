-- vehicle_row_read: a deleted car answers NULL to a caller who is not an insider.
--
-- WHY. vehicle_row_read(uuid) is SECURITY DEFINER and anon may execute it. It gates a non-insider on is_public alone, so a
-- deleted car that is still flagged public answers anon and every signed-in stranger with its whole (projected) row.
-- The rule for every public reader (.claude/rules/db-safety.md) is is_public = true AND deleted_at IS NULL.
-- Count before (2026-11-25, prod, read-only, counted in primary-key slices): see the PR; the count is in its body.
--
-- WHAT. One condition: v_public is now coalesce(is_public, false) AND deleted_at IS NULL. Insiders (owner, user,
-- creator, uploader, vehicle_user_has_access, service_role) still read their deleted car, so the owner's garage, the
-- edit forms and the merge and dedup tools are unchanged. A private or missing car still answers NULL. The rest of the
-- body is the live one, byte for byte. Callers, by grep: web useVehicle, vehicleService.getById (VehicleForm),
-- EditVehicle, VehicleEditModal, AddVehicle, MergeProposalsDashboard, vehicleDeduplicationService; iOS GarageReaders
-- (the owner's garage). The public profile reads get_vehicle_profile_data, not this function, and its merged-car redirect
-- is untouched.
-- CONTRACT: supabase/sql/test_vehicle_row_read_deleted_gate.sql (PG17). REVERSAL:
-- supabase/sql/revert_20261125214500_vehicle_row_read_deleted_gate.sql (the prior live body).
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
BEGIN
  SELECT to_jsonb(v.*),
         coalesce(v.is_public, false) AND v.deleted_at IS NULL,  -- vehicle_row_read_deleted_gate_v1: a deleted car is not public
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  RETURN public.vehicle_row_public_projection(v_row);
END;
$function$;

DO $check$
DECLARE f record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS res,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         position('vehicle_row_read_deleted_gate_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_row_read(uuid)'::regprocedure;
  IF NOT (f.prosecdef AND f.provolatile = 's' AND f.proconfig = ARRAY['search_path=public'] AND f.res = 'jsonb'
          AND f.anon_x AND f.marked) THEN
    RAISE EXCEPTION 'vehicle_row_read not as intended';
  END IF;
END $check$;
COMMIT;
