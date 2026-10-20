-- Drop idx_vehicle_location_observations_zcta: invalid twice, and nothing reads by it.
--
-- WHY. 20261020210000 and 20261020213000 both tried CREATE INDEX CONCURRENTLY on vehicle_location_observations (zcta)
-- WHERE zcta IS NOT NULL and both were canceled at 10 s (deploy runs for 14410d928 and 27ff6869a): a concurrent build
-- scans the whole 636,440-row heap whatever the partial predicate, and the deploy role postgres has
-- statement_timeout=10s in its rolconfig. Postgres leaves the index INVALID each time: maintained on every write,
-- never used by a read. No read needs it: the map folds (map_facts, 20261020220000) scan location rows by observed_at
-- and carry zcta along, and the map reader reads map_facts, never location rows by zcta. Dropping it removes the
-- write cost and the misleading object. If a reader ever needs it, build it off-peak in a session that may run longer
-- than 10 s, never through this deploy path.
-- Autocommit on purpose: DROP INDEX CONCURRENTLY cannot run in a transaction block; it is quick on an invalid index.
SET lock_timeout = '8s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_location_observations_zcta;
DO $verify$
BEGIN
  IF to_regclass('public.idx_vehicle_location_observations_zcta') IS NOT NULL THEN
    RAISE EXCEPTION 'idx_vehicle_location_observations_zcta still exists';
  END IF;
END
$verify$;
RESET lock_timeout;
