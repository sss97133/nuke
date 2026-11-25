-- Contract for 20261126111500_retained_projection_census_adaptive (empty disposable PG17, dm_refinement_* only).
-- The census page size is persisted and adapts: a pick killed by the statement timeout counts as an attempt and halves
-- the next page; at the floor, max_census_attempts kills skip the page and read red; a slow page halves, a fast one
-- doubles; the revert restores the 063500 bodies byte for byte. Fixture: test_retained_projection_verdicts.sql (which
-- reverts 20261126063500 at its end; it is re-applied here). A kill is made by a statement trigger on
-- retained_projection_backfill_cars that sleeps past a 1 s statement_timeout, as the live vehicles key-share check did.
-- Run: createdb <db>; psql -d <db> -v ON_ERROR_STOP=1 -f supabase/sql/test_retained_projection_census_adaptive.sql
\set ON_ERROR_STOP on
\ir test_retained_projection_verdicts.sql
\ir ../migrations/20261126063500_retained_projection_verdicts.sql
-- A stand-in for the shared yield rule (its own migration): the function and its rule row, without this job yet.
CREATE FUNCTION public.auction_close_yield(p_job text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (c.config_value->'jobs') ? p_job AND coalesce((c.config_value->>'fixture_yield')::boolean, false)
    FROM public.platform_config c WHERE c.config_key = 'auction_close_yield' $$;
INSERT INTO public.platform_config (config_key, config_value)
VALUES ('auction_close_yield', '{"jobs": ["data-set-grades-backfill"], "fixture_yield": false}');
\ir ../migrations/20261126111500_retained_projection_census_adaptive.sql
\ir ../migrations/20261126111500_retained_projection_census_adaptive.sql
CALL public.retained_projection_grade_tick();
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('063500 + 111500 applied and graded', 8);

CREATE FUNCTION pg_temp.st() RETURNS public.retained_projection_grading_state LANGUAGE sql AS
  $$ SELECT * FROM public.retained_projection_grading_state WHERE id $$;
CREATE FUNCTION pg_temp.census_rows() RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM public.vehicle_observations o WHERE o.source_identifier LIKE 'retained\_listing\_%'
       AND o.extraction_method = 'retained_listing_property_projection_v1' $$;
CREATE FUNCTION pg_temp.restart(p_step int) RETURNS void LANGUAGE sql AS $$
  UPDATE public.retained_projection_grading_state
     SET census_done = false, census_si = NULL, census_id = NULL, census_step = p_step, census_attempts = 0,
         census_skipped = 0, census_step_ms = NULL WHERE id;
  DELETE FROM public.retained_projection_backfill_cars;
$$;
DO $$ BEGIN
  IF (SELECT census_done FROM pg_temp.st()) IS NOT TRUE OR (SELECT census_attempts FROM pg_temp.st()) <> 0
     OR (SELECT count(*) FROM public.retained_projection_backfill_cars) = 0 OR pg_temp.census_rows() < 8 THEN
    RAISE EXCEPTION 'FAIL the normal census did not finish clean (or the fixture has under 8 projections)'; END IF;
  RAISE NOTICE 'PASS normal census: done, attempts 0, % projections, % cars',
    pg_temp.census_rows(), (SELECT count(*) FROM public.retained_projection_backfill_cars);
END $$;

-- Yield to the closes: the shared rule lists this job (once, after two applies) and pauses it; a lot ending inside
-- pause_close_minutes (30) pauses it on its own; neither, it runs.
DO $$ BEGIN
  IF (SELECT config_value->'jobs' FROM public.platform_config WHERE config_key = 'auction_close_yield')
       <> '["data-set-grades-backfill", "retained-projection-grade"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL the yield row does not list the job exactly once'; END IF;
END $$;
UPDATE public.platform_config SET config_value = config_value || '{"fixture_yield": true}' WHERE config_key = 'auction_close_yield';
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT last_run->>'paused' FROM pg_temp.st()) IS DISTINCT FROM 'auction_close_yield' THEN
    RAISE EXCEPTION 'FAIL not paused by auction_close_yield: %', (SELECT last_run FROM pg_temp.st()); END IF;
END $$;
UPDATE public.platform_config SET config_value = config_value || '{"fixture_yield": false}' WHERE config_key = 'auction_close_yield';
INSERT INTO public.monitored_auctions (is_live, auction_end_time) VALUES (true, now() + interval '25 minutes');
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT last_run->>'paused' FROM pg_temp.st()) IS DISTINCT FROM 'lots closing within 30 min' THEN
    RAISE EXCEPTION 'FAIL not paused by a lot ending in 25 minutes: %', (SELECT last_run FROM pg_temp.st()); END IF;
END $$;
DELETE FROM public.monitored_auctions;
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT last_run ? 'paused' FROM pg_temp.st()) OR (SELECT paused_since FROM pg_temp.st()) IS NOT NULL
     OR (SELECT status FROM public.v_retained_projection_backfill) <> 'done' THEN
    RAISE EXCEPTION 'FAIL did not resume: %', (SELECT last_run FROM pg_temp.st()); END IF;
  RAISE NOTICE 'PASS yields: the shared rule lists the job once and pauses it; a lot ending in 25 min pauses it (30); clear, it runs';
END $$;

-- Pages of 8 with a floor of 2; never grow or shrink on time, so the sizes are the kill rule's alone.
UPDATE public.platform_config SET config_value = config_value || '{"census_rows": 8, "census_rows_min": 2,
  "census_grow_below_ms": 0, "census_shrink_above_ms": 7500, "max_census_attempts": 2}'
 WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart(8);
CREATE FUNCTION public.fixture_slow_census() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN PERFORM pg_sleep(3); RETURN NULL; END $$;
CREATE TRIGGER fixture_slow_census BEFORE INSERT ON public.retained_projection_backfill_cars
  FOR EACH STATEMENT EXECUTE FUNCTION public.fixture_slow_census();
CREATE TABLE pg_temp.seen (k int, step int, attempts int, skipped bigint, at_key boolean);

\set ON_ERROR_STOP off
SET statement_timeout = '1s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
INSERT INTO pg_temp.seen SELECT 1, census_step, census_attempts, census_skipped, census_si IS NOT NULL FROM pg_temp.st();
SET statement_timeout = '1s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
INSERT INTO pg_temp.seen SELECT 2, census_step, census_attempts, census_skipped, census_si IS NOT NULL FROM pg_temp.st();
SET statement_timeout = '1s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
INSERT INTO pg_temp.seen SELECT 3, census_step, census_attempts, census_skipped, census_si IS NOT NULL FROM pg_temp.st();
SET statement_timeout = '1s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
INSERT INTO pg_temp.seen SELECT 4, census_step, census_attempts, census_skipped, census_si IS NOT NULL FROM pg_temp.st();
SET statement_timeout = '1s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
INSERT INTO pg_temp.seen SELECT 5, census_step, census_attempts, census_skipped, census_si IS NOT NULL FROM pg_temp.st();
\set ON_ERROR_STOP on

DO $$
DECLARE got text := (SELECT string_agg(format('%s:%s/%s/%s/%s', k, step, attempts, skipped, at_key), ' ' ORDER BY k) FROM pg_temp.seen);
BEGIN
  -- 1: killed at 8 (attempt 1); 2: halved to 4, killed (attempt 1 at 4); 3: halved to 2 (the floor), killed;
  -- 4: at the floor, killed again (attempt 2); 5: attempt 2 >= max 2: the 2-row page is skipped (no INSERT, no sleep),
  --    the cursor moves, then the next floor page is picked and killed (attempt 1).
  IF got <> '1:8/1/0/f 2:4/1/0/f 3:2/1/0/f 4:2/2/0/f 5:2/1/2/t' THEN
    RAISE EXCEPTION 'FAIL kill sequence: %', got; END IF;
  IF (SELECT count(*) FROM public.retained_projection_backfill_cars) <> 0 THEN
    RAISE EXCEPTION 'FAIL a killed page left cars behind'; END IF;
  IF (SELECT status FROM public.v_retained_projection_backfill) <> 'census_skipped'
     OR (SELECT census_skipped FROM public.v_retained_projection_backfill) <> 2 THEN
    RAISE EXCEPTION 'FAIL the view does not read census_skipped red'; END IF;
  PERFORM public.retained_projection_record_assay(clock_timestamp());
  IF (SELECT reading->>'status' FROM public.job_assay_readings WHERE jobname = 'retained-projection-grade') <> 'failed' THEN
    RAISE EXCEPTION 'FAIL the assay does not read census_skipped as failed'; END IF;
  RAISE NOTICE 'PASS killed picks count: 8 -> 4 -> 2, two kills at the floor skip a 2-row page (census_skipped 2, view and assay red): %', got;
END $$;

-- Without the kills the census finishes from where it is; a fast page doubles (to the ceiling), a slow page halves.
DROP TRIGGER fixture_slow_census ON public.retained_projection_backfill_cars;
UPDATE public.platform_config SET config_value = config_value || '{"census_grow_below_ms": 7500}'
 WHERE config_key = 'retained_projection_verdicts';
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT census_done FROM pg_temp.st()) IS NOT TRUE OR (SELECT census_step FROM pg_temp.st()) <> 8
     OR (SELECT census_attempts FROM pg_temp.st()) <> 0
     OR (SELECT sum(projections) FROM public.retained_projection_backfill_cars) <> pg_temp.census_rows() - 2 THEN
    RAISE EXCEPTION 'FAIL fast pages: done %, step %, projections % of %', (SELECT census_done FROM pg_temp.st()),
      (SELECT census_step FROM pg_temp.st()), (SELECT sum(projections) FROM public.retained_projection_backfill_cars),
      pg_temp.census_rows() - 2; END IF;
  RAISE NOTICE 'PASS fast pages grow 2 -> 8 (the ceiling) and the census finishes, every row but the 2 skipped counted';
END $$;
-- A slow page: the statement trigger sleeps 50 ms (no kill), past a 10 ms shrink threshold.
CREATE OR REPLACE FUNCTION public.fixture_slow_census() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN PERFORM pg_sleep(0.05); RETURN NULL; END $$;
CREATE TRIGGER fixture_slow_census BEFORE INSERT ON public.retained_projection_backfill_cars
  FOR EACH STATEMENT EXECUTE FUNCTION public.fixture_slow_census();
UPDATE public.platform_config SET config_value = config_value || '{"census_grow_below_ms": 0, "census_shrink_above_ms": 10}'
 WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart(8);
CALL public.retained_projection_grade_tick();
DROP TRIGGER fixture_slow_census ON public.retained_projection_backfill_cars;
DO $$ BEGIN
  IF (SELECT census_done FROM pg_temp.st()) IS NOT TRUE OR (SELECT census_step FROM pg_temp.st()) <> 2
     OR (SELECT sum(projections) FROM public.retained_projection_backfill_cars) <> pg_temp.census_rows() THEN
    RAISE EXCEPTION 'FAIL slow pages: step %', (SELECT census_step FROM pg_temp.st()); END IF;
  RAISE NOTICE 'PASS slow pages halve 8 -> 4 -> 2 and stop at the floor; every row counted';
END $$;

-- The rule row is read at call time and clamped: a floor above the ceiling is the ceiling.
UPDATE public.platform_config SET config_value = config_value || '{"census_rows": 4, "census_rows_min": 50, "census_shrink_above_ms": 7500}'
 WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart(8);
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT census_step FROM pg_temp.st()) <> 4 OR (SELECT census_done FROM pg_temp.st()) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL clamp: step %', (SELECT census_step FROM pg_temp.st()); END IF;
  RAISE NOTICE 'PASS a stored step of 8 is clamped to the ceiling 4; a floor of 50 above it is the ceiling';
END $$;

-- Revert: the tick and the assay back to 063500 byte for byte, view and state as 063500 left them; then re-apply.
\ir revert_20261126111500_retained_projection_census_adaptive.sql
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)
       <> 'b2d0539c080ac052b173004548b735ab754b5d3f95b6c90a5b0efc79ecadae2b'
     OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure)
       <> '523ecd5bab54f14fa12968b8afd8f7da38ffd3fe761603d99cd8f988ca0ffb88'
     OR md5(pg_get_viewdef('public.v_retained_projection_backfill'::regclass)) <> '24164172a97bc796369d36ee3d4aca32'
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.retained_projection_grading_state'::regclass
                  AND attname LIKE 'census\_%' AND attname NOT IN ('census_si', 'census_id', 'census_done') AND NOT attisdropped)
     OR (SELECT config_value->>'census_rows' FROM public.platform_config WHERE config_key = 'retained_projection_verdicts') <> '2000'
     OR (SELECT config_value ? 'census_rows_min' FROM public.platform_config WHERE config_key = 'retained_projection_verdicts')
     OR (SELECT config_value->>'pause_close_minutes' FROM public.platform_config WHERE config_key = 'retained_projection_verdicts') <> '15'
     OR (SELECT config_value->'jobs' FROM public.platform_config WHERE config_key = 'auction_close_yield') <> '["data-set-grades-backfill"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL revert'; END IF;
  RAISE NOTICE 'PASS revert restores the tick, the assay and the view byte for byte, drops the state columns and the rule keys';
END $$;
CALL public.retained_projection_grade_tick();
\ir ../migrations/20261126111500_retained_projection_census_adaptive.sql
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT census_step FROM pg_temp.st()) <> 500 OR (SELECT status FROM public.v_retained_projection_backfill) IN ('census_skipped', 'stalled') THEN
    RAISE EXCEPTION 'FAIL re-apply: step %, status %', (SELECT census_step FROM pg_temp.st()), (SELECT status FROM public.v_retained_projection_backfill); END IF;
  RAISE NOTICE 'PASS re-applied after the revert: step 500, the tick runs';
END $$;
-- Without the shared yield function (or its rule row) the tick plans and runs; only pause_close_minutes applies.
DROP FUNCTION public.auction_close_yield(text);
CALL public.retained_projection_grade_tick();
CREATE FUNCTION public.auction_close_yield(p_job text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
DELETE FROM public.platform_config WHERE config_key = 'auction_close_yield';
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF (SELECT last_run ? 'paused' FROM pg_temp.st()) THEN RAISE EXCEPTION 'FAIL paused without the yield rule row'; END IF;
  RAISE NOTICE 'PASS without the yield function, or with it but no rule row, the tick runs unpaused';
END $$;
