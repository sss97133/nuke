-- Contract for 20261126164000_retained_projection_closing_read_bound (empty disposable PG17, dm_refinement_* only).
-- The tick's closing read (retained_projection_record_assay reading v_retained_projection_backfill) can no longer kill
-- a run that did its work: the view reads no vehicles row; the read starts only while the caller's statement_timeout
-- leaves assay_reserve_ms (rule row) after it, else the skip is recorded on the job's row; the tick's last_run commits
-- before the read. Fixture: test_retained_projection_census_adaptive.sql (063500 + 111500, whose bodies here hash to the
-- live ones). Stand-ins: a slow closing read is a trigger on job_assay_readings that sleeps when a reading is written;
-- slow work is a statement trigger on retained_projection_backfill_cars that sleeps under the census INSERT. Runs use a
-- 2 s statement_timeout in place of the live 10 s.
-- Run: createdb <db>; psql -d <db> -v ON_ERROR_STOP=1 -f supabase/sql/test_retained_projection_closing_read_bound.sql
\set ON_ERROR_STOP on
\ir test_retained_projection_census_adaptive.sql
SET client_min_messages = notice;
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)
       <> '40ba08cacb4e4885bb1e9651dab05338c44096df0d22bd57629e3b3cda4ac7d0'
     OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure)
       <> '65968d920a6518b60606dde94117e8dcfc261279769962f07e8de04f99154e78'
     OR md5(pg_get_viewdef('public.v_retained_projection_backfill'::regclass)) <> '5284dbe54f545b24063c6f14016fde61' THEN
    RAISE EXCEPTION 'FAIL the fixture is not the live 111500 tick, assay and view'; END IF;
  RAISE NOTICE 'PASS fixture bodies hash to the live ones (tick 40ba08ca, assay 65968d92, view 5284dbe5)';
END $$;
-- the pause and yield block of the tick, kept to compare after the patch
CREATE TABLE pg_temp.pause_block AS
SELECT substr(p.prosrc, position('IF coalesce(cfg->>''enabled''' IN p.prosrc),
              position('fns := public.retained_projection_closure();' IN p.prosrc) - position('IF coalesce(cfg->>''enabled''' IN p.prosrc)) AS txt
  FROM pg_proc p WHERE p.oid = 'public.retained_projection_grade_tick()'::regprocedure;

-- pg_temp.st() comes from the fixture
CREATE FUNCTION pg_temp.restart_census() RETURNS void LANGUAGE sql AS $$
  UPDATE public.retained_projection_grading_state
     SET census_done = false, census_si = NULL, census_id = NULL, census_step = 500, census_attempts = 0,
         census_skipped = 0, census_step_ms = NULL, last_run_at = NULL WHERE id;
  DELETE FROM public.retained_projection_backfill_cars;
  UPDATE public.job_assay_readings SET attempt_error = NULL WHERE jobname = 'retained-projection-grade';
$$;
CREATE FUNCTION pg_temp.reading_at() RETURNS timestamptz LANGUAGE sql AS
  $$ SELECT assayed_at FROM public.job_assay_readings WHERE jobname = 'retained-projection-grade' $$;
-- stand-ins, off until a test turns them on through these settings
CREATE FUNCTION public.fixture_slow_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fixture.slow_reading', true) = 'on'
     AND (TG_OP = 'INSERT' OR NEW.assayed_at IS DISTINCT FROM OLD.assayed_at) THEN PERFORM pg_sleep(3); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_slow_reading BEFORE INSERT OR UPDATE ON public.job_assay_readings
  FOR EACH ROW EXECUTE FUNCTION public.fixture_slow_reading();
CREATE FUNCTION public.fixture_slow_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fixture.slow_work', true) = 'on' THEN PERFORM pg_sleep(1.2); END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER fixture_slow_work BEFORE INSERT ON public.retained_projection_backfill_cars
  FOR EACH STATEMENT EXECUTE FUNCTION public.fixture_slow_work();
CREATE TABLE pg_temp.ran (k text, last_run_set boolean, reading_moved boolean, attempt_error text, census_done boolean);
CREATE FUNCTION pg_temp.see(p_k text, p_before timestamptz) RETURNS void LANGUAGE sql AS $$
  INSERT INTO pg_temp.ran
  SELECT p_k, (SELECT last_run_at IS NOT NULL FROM pg_temp.st()), pg_temp.reading_at() IS DISTINCT FROM p_before,
         (SELECT attempt_error FROM public.job_assay_readings WHERE jobname = 'retained-projection-grade'),
         (SELECT census_done FROM pg_temp.st());
$$;
CREATE TABLE pg_temp.mark (at timestamptz);

-- The old body under the stand-ins, for the record: work that runs past the old read's room, then a slow read, kills
-- the run and takes its last_run with it.
SELECT pg_temp.restart_census();
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET fixture.slow_reading = 'on';
\set ON_ERROR_STOP off
SET statement_timeout = '2s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
\set ON_ERROR_STOP on
SET fixture.slow_reading = 'off';
SELECT pg_temp.see('old', (SELECT at FROM pg_temp.mark));
DO $$ BEGIN
  IF (SELECT last_run_set FROM pg_temp.ran WHERE k = 'old') THEN
    RAISE EXCEPTION 'FAIL the stand-in did not kill the old closing read'; END IF;
  RAISE NOTICE 'PASS stand-in: under the old body a slow closing read kills the run and its last_run is lost';
END $$;

\ir ../migrations/20261126164000_retained_projection_closing_read_bound.sql
\ir ../migrations/20261126164000_retained_projection_closing_read_bound.sql
DO $$ BEGIN
  IF (SELECT txt FROM pg_temp.pause_block) <> (SELECT substr(p.prosrc, position('IF coalesce(cfg->>''enabled''' IN p.prosrc),
        position('fns := public.retained_projection_closure();' IN p.prosrc) - position('IF coalesce(cfg->>''enabled''' IN p.prosrc))
        FROM pg_proc p WHERE p.oid = 'public.retained_projection_grade_tick()'::regprocedure)
     OR length((SELECT txt FROM pg_temp.pause_block)) < 1000 THEN
    RAISE EXCEPTION 'FAIL the pause and yield block changed'; END IF;
  IF (SELECT config_value->>'assay_reserve_ms' FROM public.platform_config WHERE config_key = 'retained_projection_verdicts') <> '2000'
     OR NOT (SELECT config_value ? 'assay_reserve_basis' FROM public.platform_config WHERE config_key = 'retained_projection_verdicts') THEN
    RAISE EXCEPTION 'FAIL rule row'; END IF;
  RAISE NOTICE 'PASS applied twice; the pause and yield block is byte for byte the same; rule row assay_reserve_ms 2000 with its basis';
END $$;

-- 1. The view reads no vehicles row, and its counts are the census stamp.
SELECT pg_temp.restart_census();
CALL public.retained_projection_grade_tick();
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND w.ev_class = 'public.v_retained_projection_backfill'::regclass
                AND d.refobjid = 'public.vehicles'::regclass) THEN
    RAISE EXCEPTION 'FAIL the progress view still reads vehicles'; END IF;
  SELECT * INTO r FROM public.v_retained_projection_backfill;
  IF r.cars <> (SELECT count(*) FROM public.retained_projection_backfill_cars)
     OR r.eligible_cars <> (SELECT count(*) FROM public.retained_projection_backfill_cars WHERE public_readable)
     OR r.eligible_projections <> (SELECT sum(projections) FROM public.retained_projection_backfill_cars WHERE public_readable)
     OR r.graded_eligible_cars <> (SELECT count(*) FROM public.retained_projection_backfill_cars WHERE public_readable AND graded_at IS NOT NULL)
     OR r.eligible_cars = r.cars OR r.eligible_cars = 0 THEN
    RAISE EXCEPTION 'FAIL counts: % cars, % eligible', r.cars, r.eligible_cars; END IF;
  RAISE NOTICE 'PASS the view has no vehicles edge; % cars, % eligible by the census stamp (a private car excluded)', r.cars, r.eligible_cars;
END $$;

-- 2. Slow work then a slow read: the read starts past its reserve, is skipped and recorded; the run succeeds.
SELECT pg_temp.restart_census();
UPDATE public.platform_config SET config_value = config_value || '{"assay_reserve_ms": 2500}' WHERE config_key = 'retained_projection_verdicts';
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET fixture.slow_work = 'on';
SET fixture.slow_reading = 'on';
SET statement_timeout = '3s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
SET fixture.slow_work = 'off';
SET fixture.slow_reading = 'off';
SELECT pg_temp.see('late', (SELECT at FROM pg_temp.mark));
DO $$ BEGIN
  IF (SELECT row(last_run_set, reading_moved, attempt_error) FROM pg_temp.ran WHERE k = 'late')
       IS DISTINCT FROM row(true, false, 'assay_reserve_ms'::text) THEN
    RAISE EXCEPTION 'FAIL late read: %', (SELECT row(last_run_set, reading_moved, attempt_error) FROM pg_temp.ran WHERE k = 'late'); END IF;
  RAISE NOTICE 'PASS work ran 1.2 s of a 3 s timeout with 2.5 s reserved: the read is skipped, the skip recorded, the run succeeds';
END $$;

-- 3. A read that starts in time but runs long still fails the run, and the run's last_run has already landed.
UPDATE public.platform_config SET config_value = config_value || '{"assay_reserve_ms": 500}' WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart_census();
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET fixture.slow_reading = 'on';
\set ON_ERROR_STOP off
SET statement_timeout = '2s';
CALL public.retained_projection_grade_tick();
\set call_failed :ERROR
RESET statement_timeout;
\set ON_ERROR_STOP on
SET fixture.slow_reading = 'off';
SELECT pg_temp.see('slow_read', (SELECT at FROM pg_temp.mark));
CREATE TABLE pg_temp.call_failed AS SELECT :'call_failed'::boolean AS failed;
DO $$ BEGIN
  IF NOT (SELECT failed FROM pg_temp.call_failed) THEN RAISE EXCEPTION 'FAIL the slow read did not start (it was skipped or fast)'; END IF;
  IF (SELECT row(last_run_set, reading_moved, census_done) FROM pg_temp.ran WHERE k = 'slow_read')
       IS DISTINCT FROM row(true, false, true) THEN
    RAISE EXCEPTION 'FAIL ordering: %', (SELECT row(last_run_set, reading_moved, census_done) FROM pg_temp.ran WHERE k = 'slow_read'); END IF;
  RAISE NOTICE 'PASS the run''s work and its last_run commit before the closing read';
END $$;

-- 4. The rule row is read at call time: a reserve above the timeout skips every read; no statement_timeout always reads;
--    a missing key is 2000.
UPDATE public.platform_config SET config_value = config_value || '{"assay_reserve_ms": 5000}' WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart_census();
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET statement_timeout = '2s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
SELECT pg_temp.see('reserve_5000', (SELECT at FROM pg_temp.mark));
SELECT pg_temp.restart_census();
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET statement_timeout = 0;
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
SELECT pg_temp.see('no_timeout', (SELECT at FROM pg_temp.mark));
UPDATE public.platform_config SET config_value = config_value || '{"assay_reserve_ms": 500}' WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart_census();
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET statement_timeout = '4s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
SELECT pg_temp.see('reserve_500', (SELECT at FROM pg_temp.mark));
-- the key removed: the rule's 2000 stands, so under a 2 s timeout every read is skipped
UPDATE public.platform_config SET config_value = config_value - 'assay_reserve_ms' WHERE config_key = 'retained_projection_verdicts';
SELECT pg_temp.restart_census();
TRUNCATE pg_temp.mark; INSERT INTO pg_temp.mark SELECT pg_temp.reading_at();
SET statement_timeout = '2s';
CALL public.retained_projection_grade_tick();
RESET statement_timeout;
SELECT pg_temp.see('no_key', (SELECT at FROM pg_temp.mark));
DO $$
DECLARE got text := (SELECT string_agg(format('%s:%s/%s', k, reading_moved, coalesce(attempt_error, '-')), ' ' ORDER BY k)
                       FROM pg_temp.ran WHERE k IN ('reserve_5000', 'no_timeout', 'reserve_500', 'no_key'));
BEGIN
  IF got <> 'no_key:f/assay_reserve_ms no_timeout:t/- reserve_500:t/- reserve_5000:f/assay_reserve_ms' THEN
    RAISE EXCEPTION 'FAIL rule row at call time: %', got; END IF;
  IF (SELECT reading->>'status' FROM public.job_assay_readings WHERE jobname = 'retained-projection-grade') IS DISTINCT FROM 'passed' THEN
    RAISE EXCEPTION 'FAIL the reading after a normal run: %', (SELECT reading FROM public.job_assay_readings WHERE jobname = 'retained-projection-grade'); END IF;
  RAISE NOTICE 'PASS rule row read at call time: %', got;
END $$;

-- 5. Revert: the tick, the assay and the view back to 111500 byte for byte, the rule keys gone; then re-apply.
\ir revert_20261126164000_retained_projection_closing_read_bound.sql
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)
       <> '40ba08cacb4e4885bb1e9651dab05338c44096df0d22bd57629e3b3cda4ac7d0'
     OR (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure)
       <> '65968d920a6518b60606dde94117e8dcfc261279769962f07e8de04f99154e78'
     OR md5(pg_get_viewdef('public.v_retained_projection_backfill'::regclass)) <> '5284dbe54f545b24063c6f14016fde61'
     OR obj_description('public.v_retained_projection_backfill'::regclass, 'pg_class') IS NOT NULL
     OR (SELECT config_value ?| ARRAY['assay_reserve_ms', 'assay_reserve_basis'] FROM public.platform_config WHERE config_key = 'retained_projection_verdicts') THEN
    RAISE EXCEPTION 'FAIL revert'; END IF;
  RAISE NOTICE 'PASS revert restores the tick, the assay and the view byte for byte and drops the rule keys';
END $$;
\ir ../migrations/20261126164000_retained_projection_closing_read_bound.sql
CALL public.retained_projection_grade_tick();
DO $$ BEGIN
  IF position('closing_read_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)) = 0
     OR (SELECT last_run_at FROM pg_temp.st()) IS NULL THEN
    RAISE EXCEPTION 'FAIL re-apply'; END IF;
  RAISE NOTICE 'PASS re-applied after the revert; the tick runs';
END $$;
DROP TRIGGER fixture_slow_reading ON public.job_assay_readings;
DROP TRIGGER fixture_slow_work ON public.retained_projection_backfill_cars;
