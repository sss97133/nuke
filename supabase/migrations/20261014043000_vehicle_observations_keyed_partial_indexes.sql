-- vehicle_observations: two small partial indexes, so reads keyed on a specification's JSON property stop scanning every
-- observation of the vehicle under the row policy.
--
-- Measured 2026-10-14. The vehicle profile's Inventory widget (InventoryWidgetLink) counts a vehicle's purchased parts with
--   HEAD vehicle_observations ?vehicle_id=eq.X &kind=eq.specification &is_superseded=eq.false &structured_data->>lifecycle_status=eq.purchased
-- Edge logs, 24 h: 265 calls, mean 3.7 s, max 12.5 s (K5 Blazer 84 calls, mean 7.9 s; Mustang 92 calls, mean 3.2 s).
-- pg_stat_statements since 2026-09-29 files the same call under one digest with every other  structured_data->>$ = $  read:
-- anon, 1,188 calls, mean 1,686 ms, max 14,904 ms, 2,003 s in total. EXPLAIN as anon on the K5 (8,470 observations, 7,859 live):
-- 1,066 ms, 31,694 buffer hits, and the policy's  EXISTS (SELECT FROM vehicles ...)  ran 7,859 times to keep the 9 matches.
--
-- Cause: under row security a qual runs before the policies only if it is leakproof. vehicle_id = and is_superseded are;
-- kind = (enum_eq) and structured_data->>'x' are not, so they wait. The policy vo_authenticated_read probes vehicles and runs
-- observation_is_public(), a case-insensitive regex over each row's JSON text (about 74 us a row), on every live observation
-- of the vehicle before the property test can discard it. No index qual can help: only leakproof quals may be index quals.
--
-- What does help: a partial index. A planner proves an index predicate from ALL of the query's quals, security level aside,
-- because skipping rows can only shrink what is evaluated. With these two the same reads probe only the keyed rows
-- (K5: 12 lifecycle rows, 783 wiring facts, against 7,859). Verified on PG17 with the live policy text, in
-- supabase/sql/test_vehicle_observations_keyed_indexes.sql.
--
--   idx_vobs_spec_lifecycle  (vehicle_id, observed_at DESC)  WHERE specification, live, lifecycle_status present
--     serves the sidebar count, InventoryPage (= 'purchased'), TablePage / LifecyclePage / VendorsPage / VendorPage
--     (IS NOT NULL, ORDER BY observed_at DESC). A key present is implied by  = 'x'  because = is strict.
--   idx_vobs_spec_wiring     (vehicle_id)  WHERE specification, live, domain = 'wiring'
--     serves useWiringFacts (the K5 connector inspector and wiring map), which reads the 783 facts of one vehicle.
--
-- Today only the K5 carries either key (12 lifecycle rows, 783 wiring facts live), so both indexes are tiny; every other
-- vehicle's call now ends at an empty index probe. No policy, row, function or cron changes. Writes: the predicates are
-- tested on each new row (kind first), no new HOT loss (the columns are already indexed).
--
-- Build: CONCURRENTLY, so writers keep writing. Each build reads the 10 GB heap twice. lock_timeout bounds the wait for
-- older transactions (see 20261006133000: a 5 s bound was too short on a table the live pull writes every minute).
-- If a build is interrupted it leaves an INVALID index; the conditional drop below clears that on a re-run and the
-- assertions at the end fail the deploy rather than leave an index IF NOT EXISTS would silently accept.
-- No BEGIN: the deploy applies this file with psql -f in autocommit, and CREATE INDEX CONCURRENTLY cannot run in a block.
SET statement_timeout = '900s';
SET lock_timeout = '180s';

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vobs_spec_lifecycle') AND NOT indisvalid) AS lc_invalid \gset
\if :lc_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vobs_spec_lifecycle;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vobs_spec_lifecycle
  ON public.vehicle_observations (vehicle_id, observed_at DESC)
  WHERE kind = 'specification' AND NOT is_superseded AND (structured_data ->> 'lifecycle_status') IS NOT NULL;

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vobs_spec_wiring') AND NOT indisvalid) AS wr_invalid \gset
\if :wr_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vobs_spec_wiring;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vobs_spec_wiring
  ON public.vehicle_observations (vehicle_id)
  WHERE kind = 'specification' AND NOT is_superseded AND (structured_data ->> 'domain') = 'wiring';

DO $assert$
DECLARE
  def text;
BEGIN
  IF NOT coalesce((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.idx_vobs_spec_lifecycle')), false) THEN
    RAISE EXCEPTION 'idx_vobs_spec_lifecycle is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_vobs_spec_lifecycle and re-run';
  END IF;
  IF NOT coalesce((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.idx_vobs_spec_wiring')), false) THEN
    RAISE EXCEPTION 'idx_vobs_spec_wiring is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_vobs_spec_wiring and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_vobs_spec_lifecycle'));
  IF def NOT LIKE '%(vehicle_id, observed_at DESC) WHERE %' OR def NOT LIKE '%lifecycle_status%' OR def NOT LIKE '%NOT is_superseded%' THEN
    RAISE EXCEPTION 'idx_vobs_spec_lifecycle exists with another definition: %', def;
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_vobs_spec_wiring'));
  IF def NOT LIKE '%(vehicle_id) WHERE %' OR def NOT LIKE '%''wiring''%' OR def NOT LIKE '%NOT is_superseded%' THEN
    RAISE EXCEPTION 'idx_vobs_spec_wiring exists with another definition: %', def;
  END IF;
END
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_vobs_spec_lifecycle IS
'Live specification observations that carry a lifecycle_status, by vehicle and time. Lets the profile sidebar count of purchased parts and the inventory, table, lifecycle and vendor pages probe only those rows: under row security the kind and JSON-property tests are not leakproof, so without it the policy ran on every live observation of the vehicle (7,859 on the K5). Built CONCURRENTLY 2026-10-14.';
COMMENT ON INDEX public.idx_vobs_spec_wiring IS
'Live specification observations in the wiring domain, by vehicle. Lets useWiringFacts (connector inspector, wiring map) probe the vehicle''s 783 wiring facts instead of running the row policy over all 7,859 live observations. Built CONCURRENTLY 2026-10-14.';
RESET lock_timeout;
RESET statement_timeout;
