-- 20261110090000 made vehicle_profile_read (security invoker) read vehicles.is_replica. anon and authenticated hold
-- column-level SELECT on vehicles (338 columns on 2026-11-06) and is_replica was not among them, so every logged-out
-- profile read failed with "permission denied for table vehicles" from 16:25Z. Grant the column the way the other
-- public columns are granted; the row policies still bound the rows. (replica_quote stays ungranted: free text.)
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
GRANT SELECT (is_replica) ON public.vehicles TO anon, authenticated;
DO $$ BEGIN
  IF NOT has_column_privilege('anon', 'public.vehicles', 'is_replica', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.vehicles', 'is_replica', 'SELECT') THEN
    RAISE EXCEPTION 'vehicles.is_replica is not readable by anon and authenticated';
  END IF;
END $$;
COMMIT;
