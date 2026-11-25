-- retained_projection_verdict_v1: the tick's closing read is bounded and can no longer kill a run that did its work.
--
-- Measured live 2026-11-25 (cron.job_run_details, job retained-projection-grade): every run 07:31-07:43 PT failed at
-- 10.0 s on the postgres role's statement_timeout in retained_projection_record_assay(), at
-- "SELECT to_jsonb(b) FROM public.v_retained_projection_backfill b", the last statement of the tick. The census pages
-- before it committed (49,400 -> 52,369 cars). The view counted eligibility by probing vehicles once per backfill car:
-- EXPLAIN (ANALYZE, BUFFERS) at 50,650 cars, 203,149 shared buffers, 202,615 of them the vehicles_pkey probes (the
-- census-only aggregate over retained_projection_backfill_cars: 458 buffers, 15 ms). Standalone through q.sh:
-- 9.6 s cold, 0.4 s warm; the same join measured again a few minutes later, 8.9 s cold, 0.7 s warm. The tick's work
-- ends at 2.6-3.7 s (budget_ms 5000, the last step starts by 2.5 s), so a cold read had about 6.5 s and needed 9.6.
-- Runs at 07:44 and 07:45 succeeded (3.47 s, 3.72 s) only because the probe above had just warmed the vehicles pages.
-- So it is both: the read grew with the census (four index probes per car) and it had no bound inside the tick.
--
-- The fix, three anchored edits:
--   1. v_retained_projection_backfill counts from retained_projection_backfill_cars alone. Eligibility is the car's
--      public_readable, stamped at census by the same test on vehicles (is_public, deleted_at, listing_kind). Live
--      2026-11-25 07:52 PT: the stamp and the live test disagreed on 0 of 52,369 cars. It is the state as of
--      censused_at; the verdicts reader still tests vehicles live on every read, so eligibility here is a progress
--      denominator, not a gate.
--   2. retained_projection_record_assay(p_started) reads only while the caller's statement_timeout leaves at least
--      assay_reserve_ms (rule row) after it; otherwise it records the skip on the job's row (attempted_at,
--      attempt_error 'assay_reserve_ms') and returns. With no statement_timeout it always reads.
--   3. The tick commits its last_run record before the closing read, so a run's record lands even if the read fails.
-- The pause and yield block (pause_close_minutes, auction_close_yield, max_paused_ticks, watch) is not touched.
-- Anchored on the live prosrc (sha256 40ba08ca... tick, 65968d92... assay; view md5 5284dbe5...), the bodies
-- 20261126063500 + 20261126111500 produce. Apply-twice safe.
-- Revert: supabase/sql/revert_20261126164000_retained_projection_closing_read_bound.sql.
-- Contract: supabase/sql/test_retained_projection_closing_read_bound.sql.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';
-- wait out a running tick (it holds this advisory lock for its whole run), and keep the next one out until COMMIT
SELECT pg_advisory_xact_lock(hashtextextended('retained_projection_grade_tick', 0));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.retained_projection_grade_tick()') IS NULL
     OR to_regprocedure('public.retained_projection_record_assay(timestamptz)') IS NULL
     OR to_regclass('public.v_retained_projection_backfill') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.retained_projection_grading_state'::regclass
                      AND attname = 'census_step' AND NOT attisdropped) THEN
    RAISE EXCEPTION '20261126111500 is not applied'; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.swap(p_text text, p_old text, p_new text) RETURNS text LANGUAGE plpgsql AS $s$
BEGIN
  IF (length(p_text) - length(replace(p_text, p_old, ''))) / length(p_old) <> 1 THEN
    RAISE EXCEPTION 'anchor not found exactly once: %', left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END $s$;

-- 1. the progress view: no vehicles probe
DO $$
BEGIN
  IF md5(pg_get_viewdef('public.v_retained_projection_backfill'::regclass))
       NOT IN ('5284dbe54f545b24063c6f14016fde61', '6e6bb7aea9fbeeb180f7002dbc8cacfa') THEN
    RAISE EXCEPTION 'public.v_retained_projection_backfill is not the 20261126111500 view this migration replaces'; END IF;
END $$;
CREATE OR REPLACE VIEW public.v_retained_projection_backfill WITH (security_invoker = true) AS
WITH g AS (SELECT * FROM public.retained_projection_grading_state WHERE id),
rule AS (   -- typed thresholds from the rule row (platform_config 'retained_projection_verdicts'), defaults if absent
  SELECT make_interval(mins => CASE WHEN c->>'stall_minutes' ~ '^\d{1,4}$' THEN (c->>'stall_minutes')::int ELSE 30 END) AS stall_after,
         make_interval(secs => (CASE WHEN c->>'max_paused_ticks' ~ '^\d{1,5}$' THEN (c->>'max_paused_ticks')::int ELSE 60 END)
                               * (CASE WHEN c->>'tick_seconds' ~ '^\d{1,4}$' THEN (c->>'tick_seconds')::int ELSE 60 END)) AS paused_after,
         CASE WHEN c->>'max_car_attempts' ~ '^\d{1,3}$' THEN (c->>'max_car_attempts')::int ELSE 3 END AS max_attempts
    FROM (SELECT coalesce((SELECT pc.config_value FROM public.platform_config pc WHERE pc.config_key = 'retained_projection_verdicts'),
                          '{}'::jsonb) AS c) x),
c AS (   -- closing_read_v1 (20261126164000): one scan of the census table; eligible = public_readable as censused
  SELECT count(*) AS cars,
         count(*) FILTER (WHERE b.public_readable) AS eligible_cars,
         count(*) FILTER (WHERE b.public_readable AND b.graded_at IS NOT NULL) AS graded_eligible_cars,
         count(*) FILTER (WHERE b.graded_at IS NOT NULL) AS graded_cars,
         count(*) FILTER (WHERE b.graded_at IS NULL AND b.attempts >= rule.max_attempts) AS skipped_cars,
         coalesce(sum(b.projections) FILTER (WHERE b.public_readable), 0) AS eligible_projections,
         coalesce(sum(b.projections) FILTER (WHERE b.public_readable AND b.graded_at IS NOT NULL), 0) AS graded_eligible_projections
    FROM public.retained_projection_backfill_cars b
    CROSS JOIN rule)
SELECT CASE WHEN NOT g.census_done THEN 'census' WHEN NOT g.backfill_done THEN 'grading' ELSE 'done' END AS phase,
       c.cars, c.eligible_cars, c.graded_eligible_cars, c.graded_cars, c.skipped_cars, c.eligible_projections, c.graded_eligible_projections,
       g.census_si AS census_at_key,
       (SELECT max(d.graded_at) FROM public.retained_projection_verdicts d) AS newest_graded_at,
       g.backfill_progress_at,
       g.last_run_at,
       g.last_run->>'paused' AS paused,
       g.paused_since,
       rule.stall_after, rule.paused_after,
       CASE WHEN g.paused_since IS NOT NULL AND g.paused_since < statement_timestamp() - rule.paused_after THEN 'paused_too_long'
            WHEN c.skipped_cars > 0 THEN 'cars_skipped'
            WHEN g.census_skipped > 0 THEN 'census_skipped'
            WHEN g.census_done AND g.backfill_done THEN 'done'
            WHEN g.paused_since IS NOT NULL THEN 'paused'
            WHEN g.backfill_progress_at IS NULL OR g.backfill_progress_at < statement_timestamp() - rule.stall_after THEN 'stalled'
            ELSE 'running' END AS status,
       g.census_step, g.census_attempts, g.census_skipped, g.census_step_ms
  FROM g, c, rule;
REVOKE ALL ON public.v_retained_projection_backfill FROM PUBLIC, anon, authenticated;
COMMENT ON VIEW public.v_retained_projection_backfill IS
  'Backfill progress of retained_projection_grade_tick() as one row (grain: the job). Counts read retained_projection_backfill_cars only: '
  'eligible_* use public_readable, stamped at census by the vehicles visibility test (is_public, deleted_at, listing_kind), so they are as of '
  'censused_at; the verdicts reader tests vehicles live on every read. One sequential scan of the census table (about 110 cars a page); '
  'no vehicles probe (that read was 202,615 buffers and 9.6 s cold at 50,650 cars, 2026-11-25). Status thresholds from platform_config '
  '''retained_projection_verdicts''. Migration 20261126164000.';

-- 2. the assay: read only with assay_reserve_ms left under the caller's statement_timeout
DO $do$
DECLARE d text := pg_get_functiondef('public.retained_projection_record_assay(timestamptz)'::regprocedure);
BEGIN
  IF position('closing_read_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure)) > 0 THEN
    RAISE NOTICE 'public.retained_projection_record_assay(timestamptz): already patched'; RETURN; END IF;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure) <> '65968d920a6518b60606dde94117e8dcfc261279769962f07e8de04f99154e78' THEN
    RAISE EXCEPTION 'public.retained_projection_record_assay(timestamptz) is not the 20261126111500 body this patch anchors on'; END IF;
  d := pg_temp.swap(d, $o0$DECLARE r jsonb;
$o0$, $n0$DECLARE r jsonb;
  timeout_ms int; reserve_ms int;   -- closing_read_v1
$n0$);
  d := pg_temp.swap(d, $o1$  IF to_regclass('public.job_assay_readings') IS NULL THEN RETURN; END IF;
$o1$, $n1$  IF to_regclass('public.job_assay_readings') IS NULL THEN RETURN; END IF;
  -- closing_read_v1 (20261126164000): the read starts only while the caller's statement_timeout (the CALL's, which a
  -- COMMIT inside the tick does not re-arm; p_started is the tick's t0) leaves assay_reserve_ms after it. Later, the
  -- skip is recorded on the job's row (attempted_at, attempt_error 'assay_reserve_ms'), the reading keeps its last
  -- value, and v_job_health stops showing it after fresh_for. With no statement_timeout it always reads.
  SELECT s.setting::int INTO timeout_ms FROM pg_catalog.pg_settings s WHERE s.name = 'statement_timeout';
  -- (a missing row or key, or a malformed value, is the rule row's 2000; greatest() alone would make it 0, no gate)
  reserve_ms := least(greatest(coalesce((SELECT CASE WHEN c.config_value->>'assay_reserve_ms' ~ '^\d{1,5}$'
                                                     THEN (c.config_value->>'assay_reserve_ms')::int END
                                           FROM public.platform_config c WHERE c.config_key = 'retained_projection_verdicts'), 2000), 0), 60000);
  IF timeout_ms > 0 AND clock_timestamp() > p_started + make_interval(secs => (timeout_ms - reserve_ms) / 1000.0) THEN
    UPDATE public.job_assay_readings a SET attempted_at = now(), attempt_error = 'assay_reserve_ms'
     WHERE a.jobname = 'retained-projection-grade';
    RETURN;
  END IF;
$n1$);
  EXECUTE d;
END $do$;

-- 3. the tick: its last_run record commits before the closing read
DO $do$
DECLARE d text := pg_get_functiondef('public.retained_projection_grade_tick()'::regprocedure);
BEGIN
  IF position('closing_read_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)) > 0 THEN
    RAISE NOTICE 'public.retained_projection_grade_tick(): already patched'; RETURN; END IF;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure) <> '40ba08cacb4e4885bb1e9651dab05338c44096df0d22bd57629e3b3cda4ac7d0' THEN
    RAISE EXCEPTION 'public.retained_projection_grade_tick() is not the 20261126111500 body this patch anchors on'; END IF;
  d := pg_temp.swap(d, $o0$   WHERE id;
  PERFORM public.retained_projection_record_assay(t0);
  COMMIT;
  PERFORM pg_advisory_unlock$o0$, $n0$   WHERE id;
  COMMIT;   -- closing_read_v1 (20261126164000): the run's record lands before the closing read, which is bounded by
            -- assay_reserve_ms inside retained_projection_record_assay()
  PERFORM public.retained_projection_record_assay(t0);
  COMMIT;
  PERFORM pg_advisory_unlock$n0$);
  EXECUTE d;
END $do$;

UPDATE public.platform_config
   SET config_value = config_value
         || jsonb_build_object(
              'assay_reserve_ms', 2000,
              'assay_reserve_basis', '2026-11-25 07:31-07:43 PT every run died at 10.0 s in the closing read of '
                || 'v_retained_projection_backfill, which probed vehicles per backfill car (202,615 buffers at 50,650 cars; '
                || '9.6 s cold, 0.4 s warm standalone). Migration 20261126164000 makes that read one scan of '
                || 'retained_projection_backfill_cars (458 buffers, 15 ms warm at 50,650 cars; about 110 cars a page, so about '
                || '13,700 pages at the pg_class estimate of 1.51M vehicles, the ceiling on cars). The tick''s work ends by '
                || '2.6-3.7 s of the 10 s role timeout; the read starts only with 2,000 ms left, else the skip is recorded '
                || '(attempt_error assay_reserve_ms).')
 WHERE config_key = 'retained_projection_verdicts';

COMMIT;
