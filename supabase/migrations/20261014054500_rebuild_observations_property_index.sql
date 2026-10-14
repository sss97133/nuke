-- Rebuild idx_vehicle_observations_property, which production holds INVALID, so the typed-property reads stop fetching every
-- observation of a vehicle from the heap to find the 3.3% that carry a property.
--
-- Measured 2026-10-14 (pg_stat_statements since 2026-09-29 09:20Z), the readers this index serves exactly:
--   candidate scan  SELECT DISTINCT vehicle_id FROM vehicle_observations WHERE vehicle_id > $1 AND property_id IS NOT NULL
--                   AND is_superseded = $2 ORDER BY vehicle_id LIMIT $3        98 calls, mean 3,877 ms, max 8,287 ms
--   claims readers over vehicle_canonical (the property fold)               293 calls, mean 8,900 ms, max 14,718 ms
--                                                                            68 calls, mean 8,473 ms, max 14,628 ms
--   the bounded public-reader-coverage inventory (an operator assay that reads typed properties by vehicle id):
--                                                                         11,192 calls, mean 410 ms, 4,585 s of database time
-- vehicle_canonical is also what get_vehicle_specs(uuid[], boolean) and the profile's field provenance read. It filters
-- is_superseded = false and joins observation_properties on property_id, so it asks for the same rows.
-- EXPLAIN as the deploy role: the candidate scan and a per-vehicle probe (vehicle_id = $1 AND property_id IS NOT NULL AND NOT
-- is_superseded) both plan as an Index Scan on idx_observations_vehicle with the property test as a Filter, so each vehicle's
-- observations are read from the heap and 96.7% of them are discarded (pg_stats null_frac of property_id 0.967267).
--
-- Cause: the index is INVALID. pg_index on 2026-10-14: indisvalid = false, indisready = false, 0 bytes, definition
-- (vehicle_id, property_id) WHERE property_id IS NOT NULL AND is_superseded = false. The planner never uses it, and
-- no valid index replaces it: idx_observations_vehicle, idx_observations_vehicle_time, idx_vo_vehicle_source_kind and
-- idx_vobs_engagement_contrib all lead with vehicle_id but none excludes the rows without a property.
-- 20261011225339 tried REINDEX INDEX CONCURRENTLY under the deploy's 120 s ceiling, was cancelled, and left
-- idx_vehicle_observations_property_ccnew, which 20261011233715 removed; this file does not repeat the REINDEX.
--
-- Steps (the 20261006141000 pattern): refuse to start while another index build runs on the table, drop the INVALID index
-- CONCURRENTLY if it is still invalid, build the same definition CONCURRENTLY, assert it is valid and unchanged. A valid
-- index of that name with another definition stops the file. No row, policy, view or function changes.
--
-- Read size and time: the build reads the heap twice. vehicle_observations is 11,191,230,464 bytes (10.42 GiB, pg_relation_size
-- 2026-10-14), so about 21 GiB of reads. The one measured calibration on this table: the concurrent build of
-- 20261006141000 on a 7,779 MB heap took 152 s in the deploy (run 37470369033, step "Apply migrations", 13:23:26Z to
-- 13:25:58Z, about 100 MB/s), which puts this one near 3.5 to 4 minutes; a cold cache or a spent disk burst budget would
-- lengthen it, and 900 s is the bound. The index itself will hold about 400 K entries (3.3% of 12.2 M rows) and is written
-- only by inserts and updates of live property rows. It is not maintained today (indisready = false), so this adds that
-- small write cost back.
-- Three builds touch this table tonight (#1120, #1122 and this file); the deploy applies one migration at a time, so merge
-- them one after another and let each deploy finish.
--
-- Build bounds: lock_timeout covers the wait for older transactions (see 20261006133000: 5 s was too short on this table);
-- both are set for this session only and the deploy's 120 s ceiling is otherwise untouched.
-- No BEGIN: the deploy applies this file with psql -f in autocommit, and CREATE INDEX CONCURRENTLY cannot run in a block.
SET statement_timeout = '900s';
SET lock_timeout = '180s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_stat_progress_create_index WHERE relid = 'public.vehicle_observations'::regclass) THEN
    RAISE EXCEPTION 'another index build is running on vehicle_observations; re-run this file when it has finished';
  END IF;
END
$guard$;

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_observations_property') AND NOT indisvalid) AS vop_invalid \gset
\if :vop_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicle_observations_property;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicle_observations_property
  ON public.vehicle_observations (vehicle_id, property_id)
  WHERE ((property_id IS NOT NULL) AND (is_superseded = false));

DO $assert$
DECLARE
  def text;
BEGIN
  IF NOT coalesce((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicle_observations_property')), false) THEN
    RAISE EXCEPTION 'idx_vehicle_observations_property is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_vehicle_observations_property and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_vehicle_observations_property'));
  IF def NOT LIKE '%USING btree (vehicle_id, property_id) WHERE ((property_id IS NOT NULL) AND (is_superseded = false))' THEN
    RAISE EXCEPTION 'idx_vehicle_observations_property exists with another definition: %', def;
  END IF;
END
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_vehicle_observations_property IS
'Live typed-property observations by vehicle: (vehicle_id, property_id) WHERE property_id IS NOT NULL AND is_superseded = false, about 3.3% of the log. The access path of vehicle_canonical (read by get_vehicle_specs and the profile field provenance) and of the keyset scan of vehicles that have any typed property: without a VALID index each read fetched every observation of the vehicle from the heap and discarded 96.7% (candidate scan mean 3.9 s, claims readers mean 8.5 to 8.9 s). Found INVALID 2026-10-14 after a REINDEX CONCURRENTLY under the 120 s deploy ceiling was cancelled on 2026-10-11; rebuilt CONCURRENTLY.';
RESET lock_timeout;
RESET statement_timeout;
