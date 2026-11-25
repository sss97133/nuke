-- Revert of 20261126164000_retained_projection_closing_read_bound: the tick and the assay back to their 20261126111500
-- bodies (byte for byte: sha256 40ba08ca... and 65968d92..., checked), the view as 111500 left it (md5 5284dbe5...,
-- checked, no comment), the rule keys assay_reserve_ms and assay_reserve_basis removed.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtextextended('retained_projection_grade_tick', 0));
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION pg_temp.swap(p_text text, p_old text, p_new text) RETURNS text LANGUAGE plpgsql AS $s$
BEGIN
  IF (length(p_text) - length(replace(p_text, p_old, ''))) / length(p_old) <> 1 THEN
    RAISE EXCEPTION 'anchor not found exactly once: %', left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END $s$;

DO $do$
DECLARE d text := pg_get_functiondef('public.retained_projection_grade_tick()'::regprocedure);
BEGIN
  IF position('closing_read_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)) = 0 THEN
    RAISE NOTICE 'public.retained_projection_grade_tick(): not patched'; RETURN; END IF;
  d := pg_temp.swap(d, $o0$   WHERE id;
  COMMIT;   -- closing_read_v1 (20261126164000): the run's record lands before the closing read, which is bounded by
            -- assay_reserve_ms inside retained_projection_record_assay()
  PERFORM public.retained_projection_record_assay(t0);
  COMMIT;
  PERFORM pg_advisory_unlock$o0$, $n0$   WHERE id;
  PERFORM public.retained_projection_record_assay(t0);
  COMMIT;
  PERFORM pg_advisory_unlock$n0$);
  EXECUTE d;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure) <> '40ba08cacb4e4885bb1e9651dab05338c44096df0d22bd57629e3b3cda4ac7d0' THEN
    RAISE EXCEPTION 'revert did not restore the 20261126111500 tick byte for byte'; END IF;
END $do$;

DO $do$
DECLARE d text := pg_get_functiondef('public.retained_projection_record_assay(timestamptz)'::regprocedure);
BEGIN
  IF position('closing_read_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure)) = 0 THEN
    RAISE NOTICE 'public.retained_projection_record_assay(timestamptz): not patched'; RETURN; END IF;
  d := pg_temp.swap(d, $o0$DECLARE r jsonb;
  timeout_ms int; reserve_ms int;   -- closing_read_v1
$o0$, $n0$DECLARE r jsonb;
$n0$);
  d := pg_temp.swap(d, $o1$  IF to_regclass('public.job_assay_readings') IS NULL THEN RETURN; END IF;
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
$o1$, $n1$  IF to_regclass('public.job_assay_readings') IS NULL THEN RETURN; END IF;
$n1$);
  EXECUTE d;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure) <> '65968d920a6518b60606dde94117e8dcfc261279769962f07e8de04f99154e78' THEN
    RAISE EXCEPTION 'revert did not restore the 20261126111500 assay byte for byte'; END IF;
END $do$;

-- the view exactly as 20261126111500 created it
CREATE OR REPLACE VIEW public.v_retained_projection_backfill WITH (security_invoker = true) AS
WITH g AS (SELECT * FROM public.retained_projection_grading_state WHERE id),
rule AS (   -- typed thresholds from the rule row (platform_config 'retained_projection_verdicts'), defaults if absent
  SELECT make_interval(mins => CASE WHEN c->>'stall_minutes' ~ '^\d{1,4}$' THEN (c->>'stall_minutes')::int ELSE 30 END) AS stall_after,
         make_interval(secs => (CASE WHEN c->>'max_paused_ticks' ~ '^\d{1,5}$' THEN (c->>'max_paused_ticks')::int ELSE 60 END)
                               * (CASE WHEN c->>'tick_seconds' ~ '^\d{1,4}$' THEN (c->>'tick_seconds')::int ELSE 60 END)) AS paused_after,
         CASE WHEN c->>'max_car_attempts' ~ '^\d{1,3}$' THEN (c->>'max_car_attempts')::int ELSE 3 END AS max_attempts
    FROM (SELECT coalesce((SELECT pc.config_value FROM public.platform_config pc WHERE pc.config_key = 'retained_projection_verdicts'),
                          '{}'::jsonb) AS c) x),
c AS (
  SELECT count(*) AS cars,
         count(*) FILTER (WHERE e.eligible) AS eligible_cars,
         count(*) FILTER (WHERE e.eligible AND b.graded_at IS NOT NULL) AS graded_eligible_cars,
         count(*) FILTER (WHERE b.graded_at IS NOT NULL) AS graded_cars,
         count(*) FILTER (WHERE b.graded_at IS NULL AND b.attempts >= rule.max_attempts) AS skipped_cars,
         coalesce(sum(b.projections) FILTER (WHERE e.eligible), 0) AS eligible_projections,
         coalesce(sum(b.projections) FILTER (WHERE e.eligible AND b.graded_at IS NOT NULL), 0) AS graded_eligible_projections
    FROM public.retained_projection_backfill_cars b
    CROSS JOIN rule
    LEFT JOIN public.vehicles v ON v.id = b.vehicle_id
   CROSS JOIN LATERAL (SELECT (v.is_public IS TRUE AND v.deleted_at IS NULL
                               AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item') AS eligible) e)
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
COMMENT ON VIEW public.v_retained_projection_backfill IS NULL;
DO $$ BEGIN
  IF md5(pg_get_viewdef('public.v_retained_projection_backfill'::regclass)) <> '5284dbe54f545b24063c6f14016fde61' THEN
    RAISE EXCEPTION 'revert did not restore the 20261126111500 view'; END IF;
END $$;

UPDATE public.platform_config SET config_value = config_value - 'assay_reserve_ms' - 'assay_reserve_basis'
 WHERE config_key = 'retained_projection_verdicts';

COMMIT;
