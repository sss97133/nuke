-- REVERT of 20261125225000_vehicles_policy_deleted_gate.sql: restores the two vehicles read policies of 2026-11-25
-- (qual md5 bff26993e09e17fa0a65c86b36a7634a public, 9f5079189d0163734d6fa1e83a2a388b private), which let anon and
-- signed-in strangers read deleted public cars. vehicle_publicly_readable stays (the readers use it); the watch row is
-- switched off, since it would then report the restored exposure. Apply only through a migration that copies it.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
CREATE TEMP TABLE _vehicles_copy_before AS SELECT NULL::text AS reader, NULL::text AS policy_filter, NULL::text AS h LIMIT 0;
DO $b$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    INSERT INTO _vehicles_copy_before
    SELECT c.reader, c.policy_filter, (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter))
      FROM public.private_row_policy_copies c WHERE c.relation = 'vehicles';
  END IF;
END $b$;
ALTER POLICY vehicles_public_select ON public.vehicles USING (((is_public = true) OR (auth.role() = 'service_role'::text)));
ALTER POLICY vehicles_private_select ON public.vehicles USING (((is_public = false) AND (( SELECT auth.uid() AS uid) IS NOT NULL)
  AND ((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = uploaded_by)
       OR vehicle_user_has_access(id, ( SELECT auth.uid() AS uid)))));
COMMENT ON POLICY vehicles_public_select ON public.vehicles IS NULL;
COMMENT ON POLICY vehicles_private_select ON public.vehicles IS NULL;
-- Copies current just before the revert follow it, as the migration's did.
DO $a$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    UPDATE public.private_row_policy_copies c
       SET recorded_hash = (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter)), recorded_at = now(),
           note = c.note || ' [re-recorded by revert of 20261125225000]'
      FROM _vehicles_copy_before b
     WHERE c.relation = 'vehicles' AND c.reader = b.reader AND c.policy_filter = b.policy_filter AND c.recorded_hash = b.h;
  END IF;
END $a$;
DROP TABLE _vehicles_copy_before;
DO $w$ BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    UPDATE public.private_row_probes SET active = false
     WHERE relation = 'vehicles' AND subject_kind = 'vehicle' AND subject_column = 'id' AND reader = '' AND owner_lane = 'ta-provenance';
  END IF;
END $w$;
COMMIT;
