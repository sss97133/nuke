-- job_health_alarms_v1: a failing job check becomes a dated episode, and an episode older than its rule's alarm_after
-- is reported out of the database (GitHub issue, workflow job-health-alarm.yml).
--
-- WHY. 2026-11-13 15:15Z (#3529) trg_close_deal_on_sale began refusing every sold auction_events write. BaT sold rows per
-- day (auction_events, source bat): 11-11 81, 11-12 174, 11-13 140, then 0 from 11-14 to 11-25 while about 250 lots a
-- day ended. v_job_health read bat-live-pull's closing-stream assay as failed the whole time, and nothing read
-- v_job_health and told anyone: no table kept when a failure began, and no workflow escalated one.
--
-- WHAT. Rows, a fold, a trigger, a job:
--   source_outcome_flow_rules  (source, outcome) -> jobname, window_len, settle_after, min_ended, min_share. Condition,
--                              the same for every row: E = lots of that source that ended in [now - settle - window,
--                              now - settle] (monitored_auctions, the lots we watch), S = auction_events of that source
--                              ended in that window with that outcome. E < min_ended -> idle (too few to tell);
--                              S < min_share * E -> failed (a partial outage fails too); else passed. Seeded for BaT
--                              sold only (2,671 sold rows ended in the 30 days to 2026-11-25) with skeptic2's replay.
--   job_health_failures        one episode per (jobname, check_key): first_failed_at, last_seen_at, cleared_at.
--                              check_key 'assay' is folded from job_assay_readings by trigger; 'flow:<source>:<outcome>'
--                              by job_health_flow_fold() every 10 minutes (cron job-health-flow-fold).
--   job_health_alarm_rules     jobname -> alarm_after, report_keys. Seeded: bat-live-pull 1 hour.
--   job_health_alarms_due()    open episodes older than their job's alarm_after; service_role only (the workflow). It
--                              returns only the reading keys named in report_keys (the issues are public).
--   job_run_streak_rules       jobname -> failed_in_row, alarm_after: check_key 'runs' fails when the job's last
--                              failed_in_row finished runs (cron.job_run_details) all failed. Folded every 5 minutes
--                              (cron job-health-runs-fold). Seeded: bat-live-pull 5 in a row, alarm at once.
--   monitored_lot_resolutions  one row per watched lot the first time a fold sees a final auction_events outcome for it
--                              (same vehicle, same listing URL): the outcome landed in (not_before, first_resolved_at],
--                              where not_before is the previous fold's clock (job_health_fold_clock), which scanned
--                              every lot ended in the 48 h before it; NULL on the first fold after deploy or for a lot
--                              outside that scan, so a lag is read only from rows with not_before. Written by job_health_flow_fold().
-- v_job_health is not edited.
--
-- REVERT. cron.unschedule('job-health-flow-fold'), cron.unschedule('job-health-runs-fold'); drop the trigger on job_assay_readings; drop the functions and the
-- five tables.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.source_outcome_flow_rules (
  source       text        NOT NULL,
  outcome      text        NOT NULL CHECK (outcome IN ('sold')),
  jobname      text        NOT NULL,
  window_len   interval    NOT NULL DEFAULT interval '24 hours' CHECK (window_len > interval '0'),
  settle_after interval    NOT NULL DEFAULT interval '1 hour'   CHECK (settle_after >= interval '0'),
  min_ended    integer     NOT NULL DEFAULT 20   CHECK (min_ended >= 1),
  min_share    numeric     NOT NULL DEFAULT 0.25 CHECK (min_share > 0 AND min_share <= 1),
  active       boolean     NOT NULL DEFAULT true,
  basis        text        NOT NULL CHECK (length(basis) >= 20),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, outcome)
);

CREATE TABLE IF NOT EXISTS public.job_health_failures (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname         text        NOT NULL,
  check_key       text        NOT NULL CHECK (check_key IN ('assay', 'runs') OR check_key ~ '^flow:[a-z0-9_-]+:[a-z_]+$'),
  first_failed_at timestamptz NOT NULL,
  last_seen_at    timestamptz NOT NULL,
  cleared_at      timestamptz,
  last_reading    jsonb,
  CHECK (last_seen_at >= first_failed_at),
  CHECK (cleared_at IS NULL OR cleared_at >= last_seen_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS job_health_failures_open_uniq
  ON public.job_health_failures (jobname, check_key) WHERE cleared_at IS NULL;

CREATE TABLE IF NOT EXISTS public.job_health_alarm_rules (
  jobname     text        PRIMARY KEY,
  alarm_after interval    NOT NULL CHECK (alarm_after >= interval '0'),
  report_keys text[]      NOT NULL DEFAULT '{}',
  basis       text        NOT NULL CHECK (length(basis) >= 20),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_run_streak_rules (
  jobname       text        PRIMARY KEY,
  failed_in_row integer     NOT NULL CHECK (failed_in_row >= 2),
  alarm_after   interval    NOT NULL DEFAULT interval '0' CHECK (alarm_after >= interval '0'),
  basis         text        NOT NULL CHECK (length(basis) >= 20),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.monitored_lot_resolutions (
  monitored_auction_id uuid        PRIMARY KEY REFERENCES public.monitored_auctions (id) ON DELETE CASCADE,
  auction_event_id     uuid        REFERENCES public.auction_events (id) ON DELETE SET NULL,
  source               text        NOT NULL,
  outcome              text        NOT NULL,
  auction_end_time     timestamptz,
  not_before           timestamptz,
  first_resolved_at    timestamptz NOT NULL,
  CHECK (not_before IS NULL OR not_before < first_resolved_at)
);

CREATE TABLE IF NOT EXISTS public.job_health_fold_clock (
  fold       text        PRIMARY KEY CHECK (fold IN ('flow', 'runs')),
  checked_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS monitored_lot_resolutions_seen ON public.monitored_lot_resolutions (first_resolved_at);

ALTER TABLE public.job_run_streak_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitored_lot_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_health_fold_clock     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_run_streak_rules, public.monitored_lot_resolutions, public.job_health_fold_clock
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.job_run_streak_rules, public.monitored_lot_resolutions, public.job_health_fold_clock TO service_role;

ALTER TABLE public.source_outcome_flow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_health_failures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_health_alarm_rules    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.source_outcome_flow_rules, public.job_health_failures, public.job_health_alarm_rules
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.source_outcome_flow_rules, public.job_health_failures, public.job_health_alarm_rules TO service_role;

INSERT INTO public.source_outcome_flow_rules (source, outcome, jobname, window_len, settle_after, min_ended, min_share, basis) VALUES
  ('bat', 'sold', 'bat-live-pull', interval '2 hours', interval '1 hour', 20, 0.25,
   'BaT sold auction_events per day 11-11 81, 11-12 174, 11-13 140, then 0 11-14..11-25 (#3529). Replay every 10 min '
   '(ta-skeptic2, 2026-11-25): a 24 h window with sold = 0 first fails 11-13 23:20Z, 6 h 22 m after the first refused '
   'lot; 2 h window, settle 1 h, at least 20 ended, failed below 0.25 x ended: first fail 11-13 20:10Z (3 h 22 m to the '
   'issue), 0 false fails in 50 eligible instants 11-10..11-12 (mean sold share 0.76).')
ON CONFLICT (source, outcome) DO NOTHING;

INSERT INTO public.job_health_alarm_rules (jobname, alarm_after, report_keys, basis) VALUES
  ('bat-live-pull', interval '1 hour',
   ARRAY['lots_ended', 'with_outcome', 'min_ended', 'min_share', 'covered_lots', 'missing_lots', 'eligible_lots',
         'unqualified_lots', 'admission_overdue_lots'],
   '65-74 BaT lots an hour close in the daytime; the 11-14..11-25 outage refused every sold write for 11 days unreported.')
ON CONFLICT (jobname) DO NOTHING;

INSERT INTO public.job_run_streak_rules (jobname, failed_in_row, alarm_after, basis) VALUES
  ('bat-live-pull', 5, interval '0',
   'Per-minute job. 2026-11-25 every run failed from 09:08Z (50 s statement timeout, plan flip after an autoanalyze of '
   'monitored_auctions); 5 in a row by 09:12Z, 10 by 09:17Z, noticed by a teammate, not by a check.')
ON CONFLICT (jobname) DO NOTHING;

-- One episode step: open (or extend) on failed, close on anything else.
CREATE OR REPLACE FUNCTION public.job_health_failure_step(p_jobname text, p_check text, p_failed boolean,
                                                          p_at timestamptz, p_reading jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
BEGIN
  IF p_failed THEN
    UPDATE public.job_health_failures SET last_seen_at = greatest(last_seen_at, p_at), last_reading = p_reading
     WHERE jobname = p_jobname AND check_key = p_check AND cleared_at IS NULL;
    IF NOT FOUND THEN
      INSERT INTO public.job_health_failures (jobname, check_key, first_failed_at, last_seen_at, last_reading)
      VALUES (p_jobname, p_check, p_at, p_at, p_reading)
      ON CONFLICT (jobname, check_key) WHERE cleared_at IS NULL DO NOTHING;
    END IF;
  ELSE
    UPDATE public.job_health_failures SET cleared_at = greatest(p_at, last_seen_at)
     WHERE jobname = p_jobname AND check_key = p_check AND cleared_at IS NULL;
  END IF;
END
$f$;
REVOKE ALL ON FUNCTION public.job_health_failure_step(text, text, boolean, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- The stored assay readings: every new reading steps the job's 'assay' episode. Never blocks the refresher.
CREATE OR REPLACE FUNCTION public.job_assay_readings_failure_fold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
BEGIN
  IF NEW.reading IS NULL OR NEW.assayed_at IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM public.job_health_failure_step(NEW.jobname, 'assay', NEW.reading->>'status' = 'failed',
                                           NEW.assayed_at, NEW.reading);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'job_assay_readings_failure_fold %: % %', NEW.jobname, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END
$f$;
REVOKE ALL ON FUNCTION public.job_assay_readings_failure_fold() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS job_assay_readings_failure_fold ON public.job_assay_readings;
CREATE TRIGGER job_assay_readings_failure_fold
  AFTER INSERT OR UPDATE OF reading, assayed_at ON public.job_assay_readings
  FOR EACH ROW EXECUTE FUNCTION public.job_assay_readings_failure_fold();

-- The flow rules: one reading per active rule, stepped into its 'flow:<source>:<outcome>' episode.
CREATE OR REPLACE FUNCTION public.job_health_flow_fold()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
DECLARE
  r record; v_ended bigint; v_with bigint; v_status text; v_reading jsonb; v_out jsonb := '[]'::jsonb;
  v_at timestamptz := clock_timestamp(); v_prev timestamptz;
BEGIN
  SELECT checked_at INTO v_prev FROM public.job_health_fold_clock WHERE fold = 'flow';
  FOR r IN SELECT * FROM public.source_outcome_flow_rules WHERE active ORDER BY source, outcome LOOP
    SELECT count(*) INTO v_ended
      FROM public.monitored_auctions m JOIN public.live_auction_sources s ON s.id = m.source_id
     WHERE s.slug = r.source
       AND m.auction_end_time >  now() - r.settle_after - r.window_len
       AND m.auction_end_time <= now() - r.settle_after;
    SELECT count(*) INTO v_with
      FROM public.auction_events e
     WHERE e.source = r.source AND e.outcome = r.outcome
       AND e.auction_end_date >  now() - r.settle_after - r.window_len
       AND e.auction_end_date <= now() - r.settle_after;
    v_status := CASE WHEN v_ended < r.min_ended THEN 'idle'
                     WHEN v_with < r.min_share * v_ended THEN 'failed' ELSE 'passed' END;
    v_reading := jsonb_build_object('status', v_status, 'source', r.source, 'outcome', r.outcome,
                                    'lots_ended', v_ended, 'with_outcome', v_with,
                                    'min_ended', r.min_ended, 'min_share', r.min_share,
                                    'window_from', now() - r.settle_after - r.window_len,
                                    'window_to', now() - r.settle_after, 'checked_at', v_at);
    PERFORM public.job_health_failure_step(r.jobname, 'flow:' || r.source || ':' || r.outcome,
                                           v_status = 'failed', v_at, v_reading);
    v_out := v_out || v_reading;
    -- Landing lag: the first time this fold sees a final outcome for a watched lot of the source.
    INSERT INTO public.monitored_lot_resolutions
      (monitored_auction_id, auction_event_id, source, outcome, auction_end_time, not_before, first_resolved_at)
    SELECT DISTINCT ON (m.id) m.id, e.id, r.source, e.outcome, m.auction_end_time,
           -- The previous fold scanned every lot ended in the 48 h before it and did not stamp this one, so its outcome
           -- landed after that fold; a lot outside that scan (or no previous fold) has an unknown landing time.
           CASE WHEN v_prev IS NOT NULL AND m.auction_end_time > v_prev - interval '48 hours' THEN v_prev END, v_at
      FROM public.monitored_auctions m
      JOIN public.live_auction_sources s ON s.id = m.source_id AND s.slug = r.source
      JOIN public.auction_events e ON e.vehicle_id = m.vehicle_id
                                  AND rtrim(e.source_url, '/') = rtrim(m.external_auction_url, '/')
                                  AND e.outcome IN ('sold', 'reserve_not_met', 'cancelled')
     WHERE m.auction_end_time > now() - interval '48 hours' AND m.auction_end_time <= now()
       AND NOT EXISTS (SELECT 1 FROM public.monitored_lot_resolutions x WHERE x.monitored_auction_id = m.id)
     ORDER BY m.id, e.id
    ON CONFLICT (monitored_auction_id) DO NOTHING;
  END LOOP;
  INSERT INTO public.job_health_fold_clock (fold, checked_at) VALUES ('flow', v_at)
  ON CONFLICT (fold) DO UPDATE SET checked_at = EXCLUDED.checked_at;
  RETURN jsonb_build_object('checked_at', v_at, 'rules', v_out);
END
$f$;
REVOKE ALL ON FUNCTION public.job_health_flow_fold() FROM PUBLIC, anon, authenticated, service_role;

-- Run streaks: the last N finished runs of each ruled job all failed.
CREATE OR REPLACE FUNCTION public.job_health_runs_fold()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
DECLARE
  r record; v_jobid bigint; v_active boolean; v_last text[]; v_in_row int; v_reading jsonb; v_out jsonb := '[]'::jsonb;
  v_at timestamptz := clock_timestamp();
BEGIN
  FOR r IN SELECT * FROM public.job_run_streak_rules ORDER BY jobname LOOP
    v_jobid := NULL; v_active := NULL;
    SELECT jobid, active INTO v_jobid, v_active FROM cron.job WHERE jobname = r.jobname;
    -- A ruled job that is gone or paused runs nothing, which a run streak would never see.
    IF v_jobid IS NULL OR v_active IS NOT TRUE THEN
      v_reading := jsonb_build_object('status', 'failed', 'reason', CASE WHEN v_jobid IS NULL THEN 'job_missing' ELSE 'job_inactive' END,
                                      'threshold', r.failed_in_row, 'checked_at', v_at);
      PERFORM public.job_health_failure_step(r.jobname, 'runs', true, v_at, v_reading);
      v_out := v_out || (v_reading || jsonb_build_object('jobname', r.jobname));
      CONTINUE;
    END IF;
    SELECT array_agg(status ORDER BY runid DESC) INTO v_last
      FROM (SELECT d.runid, d.status FROM cron.job_run_details d
             WHERE d.jobid = v_jobid AND d.status IN ('succeeded', 'failed')
             ORDER BY d.runid DESC LIMIT r.failed_in_row) x;
    v_in_row := coalesce((SELECT min(i) - 1 FROM unnest(v_last) WITH ORDINALITY u(st, i) WHERE st <> 'failed'),
                         cardinality(coalesce(v_last, '{}')));
    v_reading := jsonb_build_object('status', CASE WHEN v_in_row >= r.failed_in_row THEN 'failed' ELSE 'passed' END,
                                    'failed_in_row', v_in_row, 'threshold', r.failed_in_row, 'checked_at', v_at);
    PERFORM public.job_health_failure_step(r.jobname, 'runs', v_in_row >= r.failed_in_row, v_at, v_reading);
    v_out := v_out || (v_reading || jsonb_build_object('jobname', r.jobname));
  END LOOP;
  RETURN jsonb_build_object('checked_at', v_at, 'rules', v_out);
END
$f$;
REVOKE ALL ON FUNCTION public.job_health_runs_fold() FROM PUBLIC, anon, authenticated, service_role;

-- What the workflow reads: open episodes past their job's alarm_after, numbers only (the repo and its issues are public).
CREATE OR REPLACE FUNCTION public.job_health_alarms_due()
RETURNS TABLE (jobname text, check_key text, first_failed_at timestamptz, last_seen_at timestamptz,
               failing_for interval, alarm_after interval, numbers jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $f$
  SELECT f.jobname, f.check_key, f.first_failed_at, f.last_seen_at, now() - f.first_failed_at, w.alarm_after,
         (SELECT coalesce(jsonb_object_agg(k.key, k.value), '{}'::jsonb)
            FROM jsonb_each(coalesce(f.last_reading, '{}'::jsonb)) k
           WHERE (k.key = ANY (w.report_keys) AND jsonb_typeof(k.value) IN ('number', 'boolean'))
              OR k.key IN ('status', 'reason', 'source', 'outcome', 'checked_at', 'as_of_at', 'window_from', 'window_to'))
    FROM public.job_health_failures f
    LEFT JOIN public.job_health_alarm_rules a ON a.jobname = f.jobname
    LEFT JOIN public.job_run_streak_rules s ON s.jobname = f.jobname
   CROSS JOIN LATERAL (
     SELECT CASE WHEN f.check_key = 'runs' THEN s.alarm_after ELSE a.alarm_after END AS alarm_after,
            CASE WHEN f.check_key = 'runs' THEN ARRAY['failed_in_row', 'threshold']
                 ELSE coalesce(a.report_keys, '{}') END AS report_keys) w
   WHERE f.cleared_at IS NULL
     AND w.alarm_after IS NOT NULL
     AND f.first_failed_at <= now() - w.alarm_after
   ORDER BY f.first_failed_at
$f$;
REVOKE ALL ON FUNCTION public.job_health_alarms_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_health_alarms_due() TO service_role;

COMMENT ON TABLE public.source_outcome_flow_rules IS
'One row per (source, outcome) whose results are expected to flow: with E lots of the source ended in [now - settle_after - window_len, now - settle_after] (monitored_auctions) and S auction_events of the source ended in that window with the outcome, idle when E < min_ended, failed when S < min_share * E, else passed. Read by job_health_flow_fold() every 10 minutes. Migration 20261125090700.';
COMMENT ON TABLE public.job_health_failures IS
'Failure episodes per (jobname, check_key): opened at the first failed reading, extended by each later one, cleared by the first reading that is not failed. check_key assay = job_assay_readings (trigger); flow:<source>:<outcome> = source_outcome_flow_rules (job_health_flow_fold). Migration 20261125090700.';
COMMENT ON TABLE public.job_health_alarm_rules IS
'How long a job may have an open failure episode before job_health_alarms_due() reports it (workflow job-health-alarm.yml opens a GitHub issue). Migration 20261125090700.';

-- Seed the episodes from what is on file now: the stored assay readings, then one flow reading.
DO $seed$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.job_assay_readings WHERE reading IS NOT NULL AND assayed_at IS NOT NULL LOOP
    PERFORM public.job_health_failure_step(r.jobname, 'assay', r.reading->>'status' = 'failed', r.assayed_at, r.reading);
  END LOOP;
  IF to_regclass('public.monitored_auctions') IS NOT NULL AND to_regclass('public.live_auction_sources') IS NOT NULL THEN
    PERFORM public.job_health_flow_fold();
  END IF;
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    PERFORM public.job_health_runs_fold();
  END IF;
END
$seed$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('job-health-flow-fold', '*/10 * * * *', 'SELECT public.job_health_flow_fold()');
    PERFORM cron.schedule('job-health-runs-fold', '*/5 * * * *', 'SELECT public.job_health_runs_fold()');
  END IF;
END
$cron$;
