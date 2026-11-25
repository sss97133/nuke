-- retained_projection_verdict_v1: an adaptive census page for retained_projection_grade_tick().
--
-- Measured live after 20261126063500 deployed (cron.job_run_details, job retained-projection-grade, 2026-11-26
-- 06:08-06:18 PT): 7 of 11 runs failed at 10.0 s on the postgres role's statement_timeout, every one in the census:
-- the keyset select, or the vehicles key-share check (FOR KEY SHARE) under the INSERT into
-- retained_projection_backfill_cars. A census page starts only before t0 + 2.5 s, so a failed page ran past 7.5 s.
-- A fixed 2,000-row page on retained_listing_drivetrain_layout_v1 holds about 1,490 distinct cars, and each is a row lock
-- written to a vehicles row. Pages commit one by one, so the census still moved (1,495 -> 6,660 cars); the runs read red.
--
-- Rule rows (platform_config 'retained_projection_verdicts'), read at call time:
--   census_rows (ceiling, 1000), census_rows_min (floor, 100), census_shrink_above_ms (2000), census_grow_below_ms (700),
--   max_census_attempts (3).
-- State (retained_projection_grading_state): census_step (the next page size, start 500), census_attempts,
--   census_skipped, census_step_ms.
-- Each census pick commits census_attempts + 1 before its select, so a run the timeout kills counts as an attempt, as a
-- car's pick does. The next pick halves the page when the last was killed. At the floor, a page killed
-- max_census_attempts times is skipped: its rows add to census_skipped, which v_retained_projection_backfill reads as
-- status census_skipped and the job assay as failed. A page that commits halves the size when it ran past
-- census_shrink_above_ms and doubles it under census_grow_below_ms.
-- The tick and the assay are patched in place, anchored on their 063500 prosrc (sha256 b2d0539c..., 523ecd5b...).
-- Revert: supabase/sql/revert_20261126111500_retained_projection_census_adaptive.sql.
-- Contract: supabase/sql/test_retained_projection_census_adaptive.sql.
--
-- Yield to the closes (lead's ruling, 2026-11-26 06:22 PT): pause_close_minutes 15 -> 30, and the tick also pauses when
-- public.auction_close_yield('retained-projection-grade') is true (the shared rule row platform_config
-- 'auction_close_yield', from its own migration), called dynamically once the function and the row exist; this
-- migration adds the job to that row's jobs when the row is there. max_paused_ticks 60 -> 300 (the closes run about
-- 10:00-13:45 PT), so a day of closes does not read paused_too_long.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';
-- wait out a running tick (it holds this advisory lock for its whole run), and keep the next one out until COMMIT
SELECT pg_advisory_xact_lock(hashtextextended('retained_projection_grade_tick', 0));
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.retained_projection_grading_state') IS NULL
     OR to_regprocedure('public.retained_projection_grade_tick()') IS NULL OR to_regprocedure('public.retained_projection_record_assay(timestamptz)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.platform_config WHERE config_key = 'retained_projection_verdicts') THEN
    RAISE EXCEPTION '20261126063500 is not applied'; END IF;
END $$;

ALTER TABLE public.retained_projection_grading_state
  ADD COLUMN IF NOT EXISTS census_step     integer,
  ADD COLUMN IF NOT EXISTS census_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS census_skipped  bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS census_step_ms  integer;
COMMENT ON COLUMN public.retained_projection_grading_state.census_step IS
  'census page size for the next pick (census_adaptive_v1): halved after a killed or slow page, doubled after a fast one, within platform_config census_rows_min .. census_rows';
COMMENT ON COLUMN public.retained_projection_grading_state.census_attempts IS
  'census picks committed since the last page committed (a pick the 10 s timeout killed leaves it above 0); at the floor, max_census_attempts skips the page';
COMMENT ON COLUMN public.retained_projection_grading_state.census_skipped IS
  'projection rows the census skipped after max_census_attempts kills at the floor; above 0 reads red (census_skipped)';

CREATE OR REPLACE FUNCTION pg_temp.swap(p_text text, p_old text, p_new text) RETURNS text LANGUAGE plpgsql AS $s$
BEGIN
  IF (length(p_text) - length(replace(p_text, p_old, ''))) / length(p_old) <> 1 THEN
    RAISE EXCEPTION 'anchor not found exactly once: %', left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END $s$;

DO $do$
DECLARE d text := pg_get_functiondef('public.retained_projection_grade_tick()'::regprocedure);
BEGIN
  IF position('census_adaptive_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure)) > 0 THEN
    RAISE NOTICE 'public.retained_projection_grade_tick(): already patched'; RETURN; END IF;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_grade_tick()'::regprocedure) <> 'b2d0539c080ac052b173004548b735ab754b5d3f95b6c90a5b0efc79ecadae2b' THEN
    RAISE EXCEPTION 'public.retained_projection_grade_tick() is not the 20261126063500 body this patch anchors on'; END IF;
  d := pg_temp.swap(d, $o0$  census_rows int := least(greatest(CASE WHEN cfg->>'census_rows' ~ '^\d{1,5}$' THEN (cfg->>'census_rows')::int END, 100), 10000);
$o0$, $n0$  -- census_adaptive_v1 (20261126111500): census_rows is the ceiling of the persisted page size census_step, census_rows_min
  -- its floor; census_grow_below_ms / census_shrink_above_ms move it; max_census_attempts kills at the floor skip a page.
  census_rows int := least(greatest(coalesce(CASE WHEN cfg->>'census_rows' ~ '^\d{1,5}$' THEN (cfg->>'census_rows')::int END, 1000), 1), 10000);
  census_min int := least(greatest(coalesce(CASE WHEN cfg->>'census_rows_min' ~ '^\d{1,5}$' THEN (cfg->>'census_rows_min')::int END, 100), 1), 10000);
  census_grow_ms int := least(coalesce(CASE WHEN cfg->>'census_grow_below_ms' ~ '^\d{1,5}$' THEN (cfg->>'census_grow_below_ms')::int END, 700), 7500);
  census_shrink_ms int := least(coalesce(CASE WHEN cfg->>'census_shrink_above_ms' ~ '^\d{1,5}$' THEN (cfg->>'census_shrink_above_ms')::int END, 2000), 7500);
  census_max_attempts int := least(greatest(coalesce(CASE WHEN cfg->>'max_census_attempts' ~ '^\d{1,3}$' THEN (cfg->>'max_census_attempts')::int END, 3), 1), 100);
  cpage int; cpage_t timestamptz; cpage_ms int; cskip boolean;
  yielding boolean;   -- auction_close_yield_v1
$n0$);
  d := pg_temp.swap(d, $o1$  IF pause IS NULL THEN
    SELECT format('%s: %s', w->>'job',$o1$, $n1$  -- auction_close_yield_v1 (20261126111500): the shared yield rule also pauses this job. public.auction_close_yield(job)
  -- reads platform_config 'auction_close_yield' (the jobs that yield; lots ending inside minutes_before_end, ended under
  -- minutes_after_end ago, or in soft close). Until that function and its rule row exist the pause_close_minutes test above
  -- stands alone; the call is dynamic so the tick plans without them.
  IF pause IS NULL AND to_regprocedure('public.auction_close_yield(text)') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.platform_config c WHERE c.config_key = 'auction_close_yield'
                AND jsonb_typeof(c.config_value->'jobs') = 'array') THEN
      EXECUTE 'SELECT public.auction_close_yield($1)' INTO yielding USING 'retained-projection-grade';
      IF yielding THEN pause := 'auction_close_yield'; END IF;
    END IF;
  END IF;
  IF pause IS NULL THEN
    SELECT format('%s: %s', w->>'job',$n1$);
  d := pg_temp.swap(d, $o2$  -- 3a. census: count each car's projections once, by source_identifier keyset ('retained' .. 'retainee' bounds the
  --     prefix under the database collation; the LIKE and the method decide). 2,000 rows: 1.4 s cold, 18 ms warm.
  LOOP
    EXIT WHEN clock_timestamp() >= until;
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    EXIT WHEN st.census_done;
    SELECT array_agg(x.vehicle_id), (array_agg(x.si ORDER BY x.si DESC, x.id DESC))[1], (array_agg(x.id ORDER BY x.si DESC, x.id DESC))[1], count(*)
      INTO vids, last_si, last_id, n
      FROM (SELECT o.id, o.source_identifier AS si, o.vehicle_id FROM public.vehicle_observations o
             WHERE o.source_identifier >= coalesce(st.census_si, 'retained') AND o.source_identifier < 'retainee'
               AND (st.census_si IS NULL OR (o.source_identifier, o.id) > (st.census_si, st.census_id))
               AND o.source_identifier LIKE 'retained\_listing\_%'
               AND o.extraction_method = 'retained_listing_property_projection_v1'
             ORDER BY o.source_identifier, o.id LIMIT census_rows) x;
    IF n = 0 THEN
      UPDATE public.retained_projection_grading_state SET census_done = true, backfill_progress_at = clock_timestamp() WHERE id;
      COMMIT;
      EXIT;
    END IF;
    INSERT INTO public.retained_projection_backfill_cars AS b (vehicle_id, projections, public_readable, censused_at)
    SELECT u.v, count(*), bool_or(v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
           clock_timestamp()
      FROM unnest(vids) u(v) JOIN public.vehicles v ON v.id = u.v
     GROUP BY u.v
    ON CONFLICT (vehicle_id) DO UPDATE SET projections = b.projections + EXCLUDED.projections, censused_at = EXCLUDED.censused_at;
    n_census := n_census + n;
    UPDATE public.retained_projection_grading_state
       SET census_si = last_si, census_id = last_id, backfill_progress_at = clock_timestamp() WHERE id;
    COMMIT;
  END LOOP;

$o2$, $n2$  -- 3a. census: count each car's projections once, by source_identifier keyset ('retained' .. 'retainee' bounds the
  --     prefix under the database collation; the LIKE and the method decide).
  --     census_adaptive_v1 (20261126111500): the page size is the persisted census_step, within census_rows_min ..
  --     census_rows. Each pick commits census_attempts + 1 before its select, so a run the 10 s timeout kills mid-page
  --     counts as an attempt (as a car's pick does). The next pick halves the page when the last one was killed, and
  --     counts kills afresh at the new size; at the floor, a page killed max_census_attempts times is skipped: the cursor
  --     moves past it, its rows add to census_skipped (red in v_retained_projection_backfill), its cars fall back to the
  --     gated matcher. A page that commits halves the size when it ran past census_shrink_above_ms and doubles it when it
  --     ran under census_grow_below_ms. Live 2026-11-26: a cold 2,000-row page (about 1,490 cars, each a key-share lock
  --     written to a vehicles row) ran past 7.5 s.
  IF census_min > census_rows THEN census_min := census_rows; END IF;
  LOOP
    EXIT WHEN clock_timestamp() >= until;
    SELECT * INTO st FROM public.retained_projection_grading_state WHERE id;
    EXIT WHEN st.census_done;
    cpage := least(greatest(coalesce(st.census_step, census_rows), census_min), census_rows);
    cskip := false;
    IF st.census_attempts > 0 AND cpage > census_min THEN
      cpage := greatest(census_min, cpage / 2);   -- the last pick was killed before its page committed
      st.census_attempts := 0;
    ELSIF st.census_attempts >= census_max_attempts THEN
      cskip := true;                              -- killed max_census_attempts times at the floor
    END IF;
    UPDATE public.retained_projection_grading_state
       SET census_step = cpage, census_attempts = st.census_attempts + 1 WHERE id;
    COMMIT;
    cpage_t := clock_timestamp();
    SELECT array_agg(x.vehicle_id), (array_agg(x.si ORDER BY x.si DESC, x.id DESC))[1], (array_agg(x.id ORDER BY x.si DESC, x.id DESC))[1], count(*)
      INTO vids, last_si, last_id, n
      FROM (SELECT o.id, o.source_identifier AS si, o.vehicle_id FROM public.vehicle_observations o
             WHERE o.source_identifier >= coalesce(st.census_si, 'retained') AND o.source_identifier < 'retainee'
               AND (st.census_si IS NULL OR (o.source_identifier, o.id) > (st.census_si, st.census_id))
               AND o.source_identifier LIKE 'retained\_listing\_%'
               AND o.extraction_method = 'retained_listing_property_projection_v1'
             ORDER BY o.source_identifier, o.id LIMIT cpage) x;
    IF n = 0 THEN
      UPDATE public.retained_projection_grading_state
         SET census_done = true, census_attempts = 0, backfill_progress_at = clock_timestamp() WHERE id;
      COMMIT;
      EXIT;
    END IF;
    IF NOT cskip THEN
      INSERT INTO public.retained_projection_backfill_cars AS b (vehicle_id, projections, public_readable, censused_at)
      SELECT u.v, count(*), bool_or(v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
             clock_timestamp()
        FROM unnest(vids) u(v) JOIN public.vehicles v ON v.id = u.v
       GROUP BY u.v
      ON CONFLICT (vehicle_id) DO UPDATE SET projections = b.projections + EXCLUDED.projections, censused_at = EXCLUDED.censused_at;
      n_census := n_census + n;
    END IF;
    cpage_ms := round(extract(epoch FROM clock_timestamp() - cpage_t) * 1000);
    UPDATE public.retained_projection_grading_state
       SET census_si = last_si, census_id = last_id, census_attempts = 0, census_step_ms = cpage_ms,
           census_skipped = census_skipped + CASE WHEN cskip THEN n ELSE 0 END,
           census_step = CASE WHEN cskip THEN cpage
                              WHEN cpage_ms > census_shrink_ms THEN greatest(census_min, cpage / 2)
                              WHEN cpage_ms < census_grow_ms THEN least(census_rows, cpage * 2)
                              ELSE cpage END,
           backfill_progress_at = clock_timestamp() WHERE id;
    COMMIT;
  END LOOP;

$n2$);
  EXECUTE d;
END $do$;

DO $do$
DECLARE d text := pg_get_functiondef('public.retained_projection_record_assay(timestamptz)'::regprocedure);
BEGIN
  IF position('census_skipped' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure)) > 0 THEN
    RAISE NOTICE 'public.retained_projection_record_assay(timestamptz): already patched'; RETURN; END IF;
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc WHERE oid = 'public.retained_projection_record_assay(timestamptz)'::regprocedure) <> '523ecd5bab54f14fa12968b8afd8f7da38ffd3fe761603d99cd8f988ca0ffb88' THEN
    RAISE EXCEPTION 'public.retained_projection_record_assay(timestamptz) is not the 20261126063500 body this patch anchors on'; END IF;
  d := pg_temp.swap(d, $o0$WHEN 'cars_skipped' THEN 'failed'$o0$, $n0$WHEN 'cars_skipped' THEN 'failed' WHEN 'census_skipped' THEN 'failed'$n0$);
  EXECUTE d;
END $do$;

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

UPDATE public.platform_config
   SET config_value = config_value
         || jsonb_build_object(
              'census_rows', 1000, 'census_rows_min', 100, 'census_grow_below_ms', 700, 'census_shrink_above_ms', 2000,
              'max_census_attempts', 3,
              'pause_close_minutes', 30, 'max_paused_ticks', 300,
              'max_paused_basis', 'the lead''s 2026-11-26 ruling: backfills yield while lots close (inside 30 minutes, just ended, or '
                || 'in soft close), and the day''s closes run about 10:00-13:45 PT; 300 consecutive paused ticks (5 h) is a pause '
                || 'that will not clear by itself (migration 20261126111500)',
              'census_basis', '2026-11-26 06:08-06:18 PT: 7 of 11 runs at a fixed 2,000-row census page hit the 10 s role timeout '
                || 'in the census (keyset select, then the vehicles key-share check under the INSERT; about 1,490 cars a page, '
                || 'so past 7.5 s cold). Page size is persisted in census_step (start 500): halved after a killed pick or a page '
                || 'over census_shrink_above_ms, doubled under census_grow_below_ms, ceiling census_rows (1,000, about 3.75 s at '
                || 'the killed pages'' rate), floor census_rows_min; max_census_attempts kills at the floor skip the page (read red). '
                || 'Migration 20261126111500.',
              'stall_basis', 'a step (a census page held under census_shrink_above_ms; a 50-projection chunk 1.4 s cold) fits '
                || 'every 60 s tick, so 30 ticks with no census or backfill movement is a stall, not a slow step')
 WHERE config_key = 'retained_projection_verdicts';
UPDATE public.retained_projection_grading_state SET census_step = 500 WHERE id AND census_step IS NULL;
-- the shared yield rule lists this job when its row exists (it is created by its own migration)
UPDATE public.platform_config
   SET config_value = jsonb_set(config_value, '{jobs}', (config_value->'jobs') || '["retained-projection-grade"]'::jsonb)
 WHERE config_key = 'auction_close_yield' AND jsonb_typeof(config_value->'jobs') = 'array'
   AND NOT (config_value->'jobs') ? 'retained-projection-grade';

COMMIT;
