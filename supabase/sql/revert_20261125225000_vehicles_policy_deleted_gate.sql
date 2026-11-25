-- REVERT of 20261125225000_vehicles_policy_deleted_gate.sql: restores the two vehicles read policies of 2026-11-25
-- (qual md5 bff26993e09e17fa0a65c86b36a7634a public, 9f5079189d0163734d6fa1e83a2a388b private), which let anon and
-- signed-in strangers read deleted public cars. vehicle_publicly_readable stays (the readers use it); the watch row is
-- switched off, since it would then report the restored exposure. Apply only through a migration that copies it.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
ALTER POLICY vehicles_public_select ON public.vehicles USING (((is_public = true) OR (auth.role() = 'service_role'::text)));
ALTER POLICY vehicles_private_select ON public.vehicles USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL)
  AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by)
       OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
COMMENT ON POLICY vehicles_public_select ON public.vehicles IS NULL;
COMMENT ON POLICY vehicles_private_select ON public.vehicles IS NULL;
DO $w$ BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    UPDATE public.private_row_probes SET active = false
     WHERE relation = 'vehicles' AND subject_kind = 'vehicle' AND subject_column = 'id' AND reader = '' AND owner_lane = 'ta-provenance';
  END IF;
END $w$;
COMMIT;
