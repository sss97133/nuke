-- labor_fold_v1 read limits, re-measured (lead condition on #3947, 2026-11-25): never_folded_image_line = 500 rests on
-- a fit with r 0.59 and one car's cold factor, so the row is checked against every first fold instead of typed once.
--
-- ROWS.
--   vehicle_labor_appraisal_fold_runs gains images (the car's vehicle_images rows when the fold ran) and warm (another
--     fold of the same car finished in the 60 minutes before this one started: its pages were read recently). warm is a
--     proxy: Postgres keeps no per-statement buffer hit counts a function can read, so cold means "no fold of this car
--     in the hour before", which is also the case of a visitor's first read of a never-folded car.
--   vehicle_labor_appraisal_first_folds (grain: one row per car, PK vehicle_id FK vehicles; run_id FK fold_runs ON
--     DELETE SET NULL): the car's first fold, the one that answers "what would a read have cost with no stored row":
--     started_at, ms, images, warm, error. Written by the fold_runs trigger; never pruned (fold_runs keeps 30 days).
--     Backfilled from the earliest retained run per car (fold_runs reaches back to the #3898 deploy, 2026-11-25).
--
-- CANCELLED FOLDS (ta-skeptic 2026-11-25). A fold cancelled by a timeout leaves no fold_runs row: PL/pgSQL's OTHERS
--   does not catch QUERY_CANCELED, so model_fold_tick's item transaction aborts. The tick has committed the lease first
--   (model_fold_work.attempts + 1, lease_tick), and the next tick marks the item 'tick ended while folding this vehicle
--   (timeout or cancel)' or 'tick cancelled while folding this vehicle' in last_error before it retries. That committed
--   row is the start stamp. fold_runs.after_cancel is true when the fold runs while the car's work row holds such a
--   last_error (the tick clears it only on success): the run is a retry of a cancelled attempt, so it is warm and its ms
--   is not the car's cold cost.
--   first_folds carries after_cancel too. The cancel may have happened in another model's step of the same tick; it is
--   counted as slow anyway, the safe direction (a lower line shows the status on more cars).
--
-- GAUGE. vehicle_labor_appraisal_read_limit_check() (and vehicle_labor_appraisal_gauge() -> read_limit_check), over the
--   last 7 days: image_line and slow_ms (the two rule rows as the reader applies them); first_folds; over_line;
--   slow = first folds at or over slow_ms, ended by a timeout, or after_cancel, plus cancelled_unfolded (in-scope cars
--   with no stored read whose work row's last_error is a cancel); min_slow_images = the smallest image count among
--   them (the rule's own reading: the line should sit at or under it); line_too_high = slow cars under the line, with
--   its cold count; cold_factor_p50 over cold/warm run pairs; status 'failed' when line_too_high reaches the rule row
--   read_limit_line_too_high_fails_at, else 'passed'. An over-line car that folds fast is expected (cost does not follow
--   image count), so there is no line-too-low count.
-- ASSAY. vehicle_labor_appraisal_read_limit_assay() writes the check into job_assay_readings under the seed's job,
--   vehicle-labor-appraisal-seed, so v_job_health shows it (assay_status, assay); the seed's cron command calls it after
--   the enqueue.
-- Test: supabase/sql/test_vehicle_labor_appraisal_fold.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.vehicle_labor_appraisal_fold_runs
  ADD COLUMN IF NOT EXISTS images integer,
  ADD COLUMN IF NOT EXISTS warm boolean,
  ADD COLUMN IF NOT EXISTS after_cancel boolean;
CREATE INDEX IF NOT EXISTS vehicle_labor_appraisal_fold_runs_vehicle_idx
  ON public.vehicle_labor_appraisal_fold_runs (vehicle_id, started_at);

CREATE TABLE IF NOT EXISTS public.vehicle_labor_appraisal_first_folds (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  run_id bigint REFERENCES public.vehicle_labor_appraisal_fold_runs(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ms integer NOT NULL,
  images integer,
  warm boolean,
  after_cancel boolean,
  error text
);
ALTER TABLE public.vehicle_labor_appraisal_first_folds ADD COLUMN IF NOT EXISTS after_cancel boolean;
CREATE INDEX IF NOT EXISTS vehicle_labor_appraisal_first_folds_started_idx
  ON public.vehicle_labor_appraisal_first_folds (started_at);
COMMENT ON TABLE public.vehicle_labor_appraisal_first_folds IS
  'labor_fold_v1: each car''s first labor fold (grain: car). The read_limit_check gauge compares its ms with the never-folded image line and the slow line. Written by the fold_runs trigger; never pruned.';
ALTER TABLE public.vehicle_labor_appraisal_first_folds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_labor_appraisal_first_folds FROM anon, authenticated;
GRANT SELECT ON public.vehicle_labor_appraisal_first_folds TO service_role;

-- The words model_fold_tick writes into model_fold_work.last_error when a tick loses its item, and Postgres's own
-- cancel messages (read from the live tick, 2026-11-25).
CREATE OR REPLACE FUNCTION public.labor_fold_cancel_pattern()
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT 'tick ended while folding|tick cancelled while folding|statement timeout|canceling statement'
$fn$;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_fold_runs_measure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND TG_WHEN = 'BEFORE' THEN
    NEW.images := coalesce(NEW.images, (SELECT count(*) FROM public.vehicle_images vi WHERE vi.vehicle_id = NEW.vehicle_id));
    -- a retry of a fold the tick lost to a timeout or cancel (model_fold_tick's committed lease and last_error)
    NEW.after_cancel := coalesce(NEW.after_cancel, EXISTS (
      SELECT 1 FROM public.model_fold_work w
       WHERE w.vehicle_id = NEW.vehicle_id AND w.last_error ~* public.labor_fold_cancel_pattern()));
    NEW.warm := coalesce(NEW.warm, NEW.after_cancel OR EXISTS (
      SELECT 1 FROM public.vehicle_labor_appraisal_fold_runs r
       WHERE r.vehicle_id = NEW.vehicle_id AND r.started_at < NEW.started_at
         AND r.started_at + make_interval(secs => r.ms / 1000.0) >= NEW.started_at - interval '60 minutes'));
    RETURN NEW;
  END IF;
  INSERT INTO public.vehicle_labor_appraisal_first_folds (vehicle_id, run_id, started_at, ms, images, warm, after_cancel, error)
  VALUES (NEW.vehicle_id, NEW.id, NEW.started_at, NEW.ms, NEW.images, NEW.warm, NEW.after_cancel, NEW.error)
  ON CONFLICT (vehicle_id) DO NOTHING;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_fold_runs_measure() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vehicle_labor_appraisal_fold_runs_measure ON public.vehicle_labor_appraisal_fold_runs;
CREATE TRIGGER vehicle_labor_appraisal_fold_runs_measure
  BEFORE INSERT ON public.vehicle_labor_appraisal_fold_runs
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_labor_appraisal_fold_runs_measure();
DROP TRIGGER IF EXISTS vehicle_labor_appraisal_fold_runs_first ON public.vehicle_labor_appraisal_fold_runs;
CREATE TRIGGER vehicle_labor_appraisal_fold_runs_first
  AFTER INSERT ON public.vehicle_labor_appraisal_fold_runs
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_labor_appraisal_fold_runs_measure();

-- Backfill the retained runs (an operational log, not testimony): images as of now, warm by the same rule, then each
-- car's earliest retained run as its first fold.
UPDATE public.vehicle_labor_appraisal_fold_runs r
   SET images = (SELECT count(*) FROM public.vehicle_images vi WHERE vi.vehicle_id = r.vehicle_id)
 WHERE r.images IS NULL;
UPDATE public.vehicle_labor_appraisal_fold_runs r
   SET warm = EXISTS (SELECT 1 FROM public.vehicle_labor_appraisal_fold_runs p
                       WHERE p.vehicle_id = r.vehicle_id AND p.started_at < r.started_at
                         AND p.started_at + make_interval(secs => p.ms / 1000.0) >= r.started_at - interval '60 minutes')
 WHERE r.warm IS NULL;
INSERT INTO public.vehicle_labor_appraisal_first_folds (vehicle_id, run_id, started_at, ms, images, warm, error)
SELECT DISTINCT ON (r.vehicle_id) r.vehicle_id, r.id, r.started_at, r.ms, r.images, r.warm, r.error
  FROM public.vehicle_labor_appraisal_fold_runs r
 ORDER BY r.vehicle_id, r.started_at, r.id
ON CONFLICT (vehicle_id) DO NOTHING;

UPDATE public.labor_fold_read_limits
   SET value = 679,
       basis = 'A car with no stored read and at least this many vehicle_images rows is not computed at read; it answers not_yet_computed and the seed folds it. Rule (lead, 2026-11-25): time the live compute under anon claims on every folded public car at or over the current line, first call (as cold as available) and second call; if any car exceeds 7,500 ms the line is the smallest image count that did, else the largest image count measured. Reading 2026-11-25 03:30-03:37 PT, read-only, 20 s between cars, vehicle_labor_appraisal_compute under request.jwt.claims role anon, statement_timeout 10 s: 15 cars at 521-4,857 images; first call 1,140-10,053 ms, 6 of 15 at or over 7,500 ms (images 679, 957, 2,747, 3,597, 4,428, 4,857; the last three cancelled at 10 s); second call 79-5,114 ms, 0 of 15 over; anon REST reader on the stored read 129-236 ms. Smallest over: 679 images, so the line is 679. Image count alone does not order the cost (682-1,447-image cars took 1,140-4,572 ms). Taken under IO load (pg_net responses about 2 minutes behind, open queries on DataFileRead), so the reading is conservative. Replaced the 2026-11-25 fit value 500 (342 + 0.450 x images, r 0.59, one cold factor). Re-measured continuously: vehicle_labor_appraisal_read_limit_check() (in v_job_health as the assay of vehicle-labor-appraisal-seed) gives, over the last 7 days, min_slow_images (the smallest image count among first folds at or over the slow line, timed out or cancelled) and line_too_high (such cars under this line); re-run the rule when line_too_high reaches read_limit_line_too_high_fails_at or min_slow_images rises above this value.',
       measured_at = now()
 WHERE limit_key = 'never_folded_image_line';
INSERT INTO public.labor_fold_read_limits (limit_key, value, unit, basis) VALUES
  ('read_limit_line_too_high_fails_at', 1, 'cars in 7 days',
   'The read-limit assay fails when this many cars under never_folded_image_line had a first fold at or over the slow line, timed out or cancelled in the last 7 days: one such car is a visitor''s read that computed live and could time out (ta-skeptic and lead, 2026-11-25: line_too_high > 0 fails).')
ON CONFLICT (limit_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_read_limit_check()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH
  lim AS (
    SELECT coalesce((SELECT CASE WHEN v ~ '^[0-9]+$' THEN v::bigint
                                 WHEN v ~ '^[0-9]+ms$' THEN left(v, -2)::bigint
                                 WHEN v ~ '^[0-9]+s$' THEN left(v, -1)::bigint * 1000
                                 WHEN v ~ '^[0-9]+min$' THEN left(v, -3)::bigint * 60000 END
                       FROM pg_db_role_setting d, unnest(d.setconfig) c,
                            LATERAL (SELECT split_part(c, '=', 2) AS v) x
                      WHERE d.setrole = 'anon'::regrole AND d.setdatabase = 0 AND split_part(c, '=', 1) = 'statement_timeout'
                      LIMIT 1), 15000)
           * coalesce((SELECT r.value FROM public.labor_fold_read_limits r WHERE r.limit_key = 'stored_fold_share_of_anon_timeout'), 0.5)
             AS slow_ms,
           coalesce((SELECT r.value FROM public.labor_fold_read_limits r WHERE r.limit_key = 'never_folded_image_line'), 500)::int
             AS image_line),
  ff AS (
    SELECT f.vehicle_id, f.images, f.warm,
           (f.ms >= l.slow_ms OR f.error ~* public.labor_fold_cancel_pattern() OR f.after_cancel IS TRUE) AS slow
      FROM public.vehicle_labor_appraisal_first_folds f, lim l
     WHERE f.started_at > now() - interval '7 days'),
  -- in-scope cars the tick lost to a timeout or cancel before any labor fold landed (pending, leased or dead)
  cu AS (
    SELECT w.vehicle_id, (SELECT count(*) FROM public.vehicle_images vi WHERE vi.vehicle_id = w.vehicle_id) AS images
      FROM public.model_fold_work w
     WHERE w.last_error ~* public.labor_fold_cancel_pattern() AND w.updated_at > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_labor_appraisal_state s WHERE s.vehicle_id = w.vehicle_id)
       AND NOT EXISTS (SELECT 1 FROM public.vehicle_labor_appraisal_first_folds f WHERE f.vehicle_id = w.vehicle_id)
       AND public.vehicle_labor_appraisal_in_scope(w.vehicle_id)),
  sl AS (SELECT ff.images, ff.warm FROM ff WHERE ff.slow
         UNION ALL SELECT cu.images, false FROM cu),
  cf AS (
    SELECT count(*) AS n, round((percentile_cont(0.5) WITHIN GROUP (ORDER BY x.ratio))::numeric, 1) AS p50
      FROM (SELECT DISTINCT ON (c.id) c.ms::numeric / greatest(w.ms, 1) AS ratio
              FROM public.vehicle_labor_appraisal_fold_runs c
              JOIN public.vehicle_labor_appraisal_fold_runs w
                ON w.vehicle_id = c.vehicle_id AND w.warm IS TRUE AND w.error IS NULL
               AND w.started_at > c.started_at AND w.started_at <= c.started_at + interval '60 minutes'
             WHERE c.warm IS NOT TRUE AND c.error IS NULL AND c.started_at > now() - interval '7 days'
             ORDER BY c.id, w.started_at) x),
  agg AS (
    SELECT (SELECT count(*) FROM ff) AS first_folds,
           (SELECT count(*) FROM ff, lim l WHERE ff.images >= l.image_line) AS over_line,
           (SELECT count(*) FROM ff WHERE ff.slow) AS slow_first_folds,
           (SELECT count(*) FROM public.vehicle_labor_appraisal_first_folds f
             WHERE f.started_at > now() - interval '7 days' AND f.after_cancel IS TRUE) AS after_cancel_first_folds,
           (SELECT count(*) FROM cu) AS cancelled_unfolded,
           (SELECT min(sl.images) FROM sl) AS min_slow_images,
           (SELECT count(*) FROM sl, lim l WHERE sl.images < l.image_line) AS too_high,
           (SELECT count(*) FROM sl, lim l WHERE sl.images < l.image_line AND sl.warm IS NOT TRUE) AS too_high_cold,
           coalesce((SELECT r.value FROM public.labor_fold_read_limits r WHERE r.limit_key = 'read_limit_line_too_high_fails_at'), 1)
             AS fails_at)
  SELECT jsonb_build_object(
    'window_days', 7, 'image_line', lim.image_line, 'slow_ms', lim.slow_ms,
    'first_folds', agg.first_folds, 'over_line', agg.over_line, 'slow_first_folds', agg.slow_first_folds,
    'after_cancel_first_folds', agg.after_cancel_first_folds, 'cancelled_unfolded', agg.cancelled_unfolded,
    'min_slow_images', agg.min_slow_images, 'line_too_high', agg.too_high, 'line_too_high_cold', agg.too_high_cold,
    'line_too_high_fails_at', agg.fails_at, 'cold_factor_p50', cf.p50, 'cold_factor_pairs', cf.n,
    'status', CASE WHEN agg.too_high >= agg.fails_at THEN 'failed' ELSE 'passed' END)
  FROM lim, agg, cf
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_read_limit_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_read_limit_check() TO service_role;

-- v_job_health reads a job's own job_assay_readings row (assay_status, assay) when it is fresher than fresh_for.
CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_read_limit_assay()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  t0 timestamptz := clock_timestamp();
  r jsonb := public.vehicle_labor_appraisal_read_limit_check();
BEGIN
  INSERT INTO public.job_assay_readings (jobname, reading, assayed_at, elapsed_ms, attempted_at, attempt_error, refresh_every, fresh_for)
  VALUES ('vehicle-labor-appraisal-seed', r, now(), (extract(epoch FROM clock_timestamp() - t0) * 1000)::int, now(), NULL,
          interval '5 minutes', interval '15 minutes')
  ON CONFLICT (jobname) DO UPDATE SET reading = excluded.reading, assayed_at = excluded.assayed_at,
    elapsed_ms = excluded.elapsed_ms, attempted_at = excluded.attempted_at, attempt_error = NULL,
    refresh_every = excluded.refresh_every, fresh_for = excluded.fresh_for;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_read_limit_assay() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_read_limit_assay() TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_labor_appraisal_gauge()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
  WITH k AS (SELECT public.vehicle_labor_appraisal_logic_key() AS k),
  st AS (
    SELECT count(*) AS n_rows,
           count(*) FILTER (WHERE s.folded_key IS DISTINCT FROM (SELECT k FROM k)) AS off_key,
           count(*) FILTER (WHERE s.evidence_changed_at > s.folded_at) AS stale_now,
           count(*) FILTER (WHERE s.error IS NOT NULL) AS errored,
           max(s.folded_at) AS newest_folded_at
      FROM public.vehicle_labor_appraisal_state s),
  runs AS (
    SELECT count(*) AS folds_24h,
           count(*) FILTER (WHERE r.stamped_at IS NOT NULL AND r.error IS NULL) AS stamps_answered_24h,
           count(*) FILTER (WHERE r.error IS NOT NULL) AS errors_24h,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.wait_ms + r.ms)) FILTER (WHERE r.stamped_at IS NOT NULL AND r.error IS NULL) / 1000.0)::numeric, 1) AS stale_p50_s,
           round((percentile_cont(0.9) WITHIN GROUP (ORDER BY (r.wait_ms + r.ms)) FILTER (WHERE r.stamped_at IS NOT NULL AND r.error IS NULL) / 1000.0)::numeric, 1) AS stale_p90_s
      FROM public.vehicle_labor_appraisal_fold_runs r WHERE r.started_at > now() - interval '24 hours'),
  slow AS (SELECT coalesce(jsonb_agg(c.vehicle_id ORDER BY c.vehicle_id), '[]'::jsonb) AS ids
             FROM (SELECT s.vehicle_id FROM public.vehicle_labor_appraisal_state s
                   UNION
                   -- never folded and waiting in the queue under the seed's reason
                   SELECT g.vehicle_id FROM public.model_fold_signal g WHERE g.reason = 'labor_logic_key'
                   UNION
                   SELECT w.vehicle_id FROM public.model_fold_work w
                    WHERE w.state IN ('pending', 'leased') AND 'labor_logic_key' = ANY (w.reasons)) c
            WHERE public.vehicle_labor_appraisal_too_slow_to_read(c.vehicle_id))
  SELECT jsonb_build_object('rows', st.n_rows, 'off_key', st.off_key, 'stale_now', st.stale_now, 'errored', st.errored,
    'newest_folded_at', st.newest_folded_at, 'folds_24h', runs.folds_24h, 'stamps_answered_24h', runs.stamps_answered_24h,
    'errors_24h', runs.errors_24h, 'stale_p50_s', runs.stale_p50_s, 'stale_p90_s', runs.stale_p90_s, 'key', (SELECT k FROM k),
    'unlisted_callees', public.labor_fold_logic_unlisted(), 'too_slow_to_compute_at_read', slow.ids,
    'read_limit_check', public.vehicle_labor_appraisal_read_limit_check())
  FROM st, runs, slow
$fn$;
REVOKE ALL ON FUNCTION public.vehicle_labor_appraisal_gauge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_labor_appraisal_gauge() TO service_role;

-- The seed job writes the assay after each enqueue (same schedule and settings as 20261125153000).
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.alter_job(j.jobid, command :=
      $c$SET client_min_messages = error; SET statement_timeout = '30s'; SET lock_timeout = '5s'; SELECT public.vehicle_labor_appraisal_enqueue(500); SELECT public.vehicle_labor_appraisal_read_limit_assay();$c$)
      FROM cron.job j WHERE j.jobname = 'vehicle-labor-appraisal-seed';
  END IF;
END $cron$;

COMMIT;
