-- Rebuild idx_vehicle_location_observations_zcta, left INVALID by 20261020210000.
--
-- WHY. The deploy of 20261020210000 (run for 14410d928, 2026-10-20 05:02Z) applied the table, column, trigger and
-- writer, then its CREATE INDEX CONCURRENTLY was canceled after 10.3 s ("canceling statement due to statement
-- timeout"): the deploy role postgres carries statement_timeout=10s in its rolconfig and the file's SET after COMMIT
-- did not govern the build. Postgres leaves such an index INVALID: maintained on every write, never used by a read.
-- vehicle_location_observations has 636,440 rows (327,358 with a five-digit postal code) and the build scanned them all.
--
-- WHAT. Drop the invalid index and build it again now, while only 2,006 rows carry a zcta (the back-fill writer
-- key_vehicle_location_zcta() has run one 2,000-row batch and is held until this index is valid): a partial index on
-- (zcta) WHERE zcta IS NOT NULL over 2,006 rows builds in well under the 10 s the role allows, and the back-fill then
-- grows it row by row. Autocommit on purpose (psql -f applies each statement; CONCURRENTLY cannot run in a transaction).
-- Preflight refuses when the index is already valid; verify fails the deploy if it is not valid afterwards.
SET lock_timeout = '8s';
DO $preflight$
BEGIN
  IF EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_location_observations_zcta') AND indisvalid) THEN
    RAISE EXCEPTION 'idx_vehicle_location_observations_zcta is already valid; nothing to rebuild';
  END IF;
  IF (SELECT count(*) FROM public.vehicle_location_observations WHERE zcta IS NOT NULL) > 50000 THEN
    RAISE EXCEPTION 'more than 50,000 rows already carry a zcta: this build would not fit the deploy role''s 10 s; build it off-peak with a longer session';
  END IF;
END
$preflight$;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_location_observations_zcta;
CREATE INDEX CONCURRENTLY idx_vehicle_location_observations_zcta
  ON public.vehicle_location_observations (zcta) WHERE zcta IS NOT NULL;
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_location_observations_zcta')
                 AND indisvalid AND indisready AND indislive) THEN
    RAISE EXCEPTION 'idx_vehicle_location_observations_zcta is not valid after the rebuild';
  END IF;
END
$verify$;
COMMENT ON INDEX public.idx_vehicle_location_observations_zcta IS
'Partial btree on vehicle_location_observations (zcta) WHERE zcta IS NOT NULL: the ZIP-level map fold reads by it. Built CONCURRENTLY by 20261020213000 after 20261020210000 left it invalid under the deploy role''s 10 s statement_timeout.';
RESET lock_timeout;
