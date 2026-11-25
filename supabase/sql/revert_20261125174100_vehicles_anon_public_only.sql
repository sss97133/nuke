-- Revert 20261125174100_vehicles_anon_public_only: drop the restrictive anon policy and the anon role setting; a policy
-- copy row whose recorded vehicles hash was current before the drop is re-recorded after it, as the migration did.
SET lock_timeout = '3s';
CREATE TEMP TABLE _vehicles_copy_before AS SELECT NULL::text AS reader, NULL::text AS policy_filter, NULL::text AS h LIMIT 0;
DO $b$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    INSERT INTO _vehicles_copy_before
    SELECT c.reader, c.policy_filter, (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter))
      FROM public.private_row_policy_copies c WHERE c.relation = 'vehicles';
  END IF;
END $b$;
DROP POLICY IF EXISTS vehicles_anon_public_only ON public.vehicles;
DO $a$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    UPDATE public.private_row_policy_copies c
       SET recorded_hash = (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter)),
           recorded_at = now(),
           note = c.note || ' [re-recorded by revert of 20261125174100]'
      FROM _vehicles_copy_before b
     WHERE c.relation = 'vehicles' AND c.reader = b.reader AND c.policy_filter = b.policy_filter
       AND c.recorded_hash = b.h
       AND b.h IS DISTINCT FROM (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter));
  END IF;
END $a$;
DROP TABLE _vehicles_copy_before;
ALTER ROLE anon RESET constraint_exclusion;
NOTIFY pgrst, 'reload config';
