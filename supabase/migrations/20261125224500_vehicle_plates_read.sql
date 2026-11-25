-- vehicle_plates_read(uuid[]): a car's plate for the callers who may read it, in one call.
--
-- WHY. license_plate is not granted to anon (20261125152500) and is being revoked from authenticated (20261125204000),
-- so the invoice page cannot embed it. Its interim read made one vehicle_row_read call per distinct car on the page and
-- took the plate off the whole row. This reader returns only the plate, for many cars at once.
--
-- WHAT. One row (vehicle_id, license_plate) per requested car the caller is an insider on, with the same insider test as
-- vehicle_row_read (the service role; or a signed-in caller who is the car's owner_id, user_id, created_by_user_id or
-- uploaded_by, or is tied by vehicle_user_has_access). Every other id returns no row: the plate is never public, so the
-- car's is_public and deleted_at do not widen or narrow it, as in vehicle_row_read's insider branch. At most the first
-- 500 ids are read. anon is not granted EXECUTE.
-- The insider test restates part of the vehicles read policies (vehicles_private_select), so the reader is registered
-- in private_row_policy_copies (#3925) when that table exists; the hourly watch then fails if those policies change.
-- CONTRACT: supabase/sql/test_vehicle_plates_read.sql (PG17). REVERSAL: DROP FUNCTION public.vehicle_plates_read(uuid[]).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicle_plates_read(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, license_plate text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- vehicle_plates_read_v1
  SELECT v.id, v.license_plate
  FROM public.vehicles v
  CROSS JOIN (SELECT auth.uid() AS uid, coalesce(auth.role() = 'service_role', false) AS service) c
  WHERE v.id = ANY ((p_vehicle_ids)[1:500])
    AND (c.service
         OR (c.uid IS NOT NULL AND (coalesce(c.uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                    OR public.vehicle_user_has_access(v.id, c.uid))))
$function$;

REVOKE ALL ON FUNCTION public.vehicle_plates_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_plates_read(uuid[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_plates_read(uuid[]) IS
  'One row (vehicle_id, license_plate) per requested car (first 500 ids) the caller is an insider on: service role, or '
  'owner_id/user_id/created_by_user_id/uploaded_by, or tied by vehicle_user_has_access (vehicle_row_read''s insider test). '
  'Other ids return no row. Not executable by anon.';

DO $reg$
BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    EXECUTE $i$INSERT INTO public.private_row_policy_copies (reader, relation, policy_filter, recorded_hash, owner_lane, note)
      VALUES ('vehicle_plates_read(uuid[])', 'vehicles', 'p.cmd IN (''SELECT'', ''ALL'')',
              '7773d11e280e80abad0422000a1ff9cc', 'ta-provenance',
              '20261125224500 restates the insider half of vehicles_private_select (plus created_by_user_id, as vehicle_row_read)')
      ON CONFLICT (reader, relation, policy_filter) DO NOTHING$i$;
  END IF;
END $reg$;

DO $check$
DECLARE f record;
BEGIN
  SELECT p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid) AS res,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
         position('vehicle_plates_read_v1' in p.prosrc) > 0 AS marked
  INTO f FROM pg_proc p WHERE p.oid = 'public.vehicle_plates_read(uuid[])'::regprocedure;
  IF NOT (f.prosecdef AND f.provolatile = 's' AND f.proconfig = ARRAY['search_path=public']
          AND f.res = 'TABLE(vehicle_id uuid, license_plate text)' AND NOT f.anon_x AND f.auth_x AND f.marked) THEN
    RAISE EXCEPTION 'vehicle_plates_read not as intended';
  END IF;
END $check$;
COMMIT;
