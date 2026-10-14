-- 20261014090000_job_health_run_digest_and_assay_readings.sql
--
-- v_job_health answers from a compact digest of pg_cron runs and from stored assay readings, instead of re-reading
-- cron history and re-running seven assays on every read. Same columns, same CASE rules.
--
-- MEASURED (prod, read-only, scripts/data/q.sh as postgres, 2026-10-14 05:05-05:53Z):
--   select * from v_job_health: 31.2 s server time against a 10 s role timeout, so every full read failed. Inside it:
--   assay_vehicle_metric_fold 18.9 s, assay_retained_listing_properties 3.2 s, assay_vin_reference_intake 2.2 s,
--   get_live_auction_health()->closing_stream 1.8 s, assay_bat_sale_intake 1.7 s, taxonomy 0.013 s, residual 0.039 s.
--   The 7-day run window alone took 5.4-6.6 s: a seq scan of cron.job_run_details (45,397 pages, 784,693 rows since
--   2026-04-13). That table belongs to supabase_admin, so postgres can neither index nor VACUUM it (no MAINTAIN), and
--   pg_cron's own writes never reach pgstat (n_tup_ins 0), so autovacuum never visits it. Its last 7 days (66k rows)
--   are spread over 13.7k pages; a runid-bounded 7-day scan still read 4-15k pages and took 0.2-8.8 s across eight
--   samples, because shared_buffers turns over in under 90 s. get_live_auction_health(date) also sorted the whole
--   table by start_time for cron_status.
--
-- WHAT.
--   1. public.cron_run_digest: one narrow row per pg_cron run of the last 8 days (runid, jobid, status, start_time,
--      the first 300 characters of a failure's return_message, first_seen_at). Written only by refresh_job_health().
--   2. public.job_health_live_from(): the runid from which v_job_health reads cron.job_run_details live: the oldest
--      digest run that is still open and was first seen within the hour, else one past the newest digest run, else 0.
--   3. public.job_assay_readings: the latest reading of each of the five slow assays, one row per job, with its clock
--      (assayed_at), cost (elapsed_ms), cadence (refresh_every) and the age after which v_job_health stops using it and
--      runs the assay live (fresh_for). Written only by refresh_job_health().
--   4. public.refresh_job_health(p_assays, p_assay_budget): due assays first, shortest cadence first (the closing stream
--      compares heartbeats with now(), so it runs at the start of the transaction); then the digest: copy every run from
--      job_health_live_from() on, re-read older open runs by runid, trim below 8 days. pg_cron job refresh-job-health,
--      every 5 minutes, 120 s budget; no new assay starts after p_assay_budget (40 s).
--   5. v_job_health: runs = finished digest rows below the live mark + open digest rows re-read by runid + every
--      cron.job_run_details row from the mark on. Exact, because pg_cron commits runids in order and never changes a
--      finished run; an empty or stale digest only moves the mark back (slower, still exact). One difference: a run
--      deleted from cron.job_run_details after it was copied stays in the 7-day window. The bat-live-pull,
--      qualify-bat-archived-sales, project-retained-listing-properties, qualify-retained-vin-references and
--      drain-vehicle-derived-queues assays read job_assay_readings while assayed_at is within fresh_for, else run live;
--      each reading keeps its own clock (checked_at, as_of_at or measured_at). Taxonomy and residual stay live.
--   6. get_live_auction_health(date): cron_status takes the newest run by runid (a backward pkey walk, 1 ms on prod)
--      instead of sorting the table by start_time (about 2 s). A job's runs never overlap, so runid order is start_time
--      order; the one difference is a run that never started (start_time NULL), which DESC put first indefinitely.
--
-- SCHEMA_LAW pre-mint checklist:
--   1. Search (2026-10-14): no relation or function matching run_digest|assay_reading|job_health|cron_run except
--      v_job_health; scripts/guardrails/check-capability-before-mint.mjs CLEAR for all four names.
--   2. Not a fact class: operator caches of pg_cron's run log and of existing assays. 3. No testimony, no DNA columns.
--   4. Storage: about 75k digest rows (under 10 MB) and 5 reading rows. 5. Invariants: CHECKs on the readings.
--   6. One writer: refresh_job_health(), run by pg_cron as postgres. 7. CI-applied; RLS on, no policy; SELECT for
--      service_role only. Retires nothing; it removes the per-read history scan and assay runs.
-- COST. Measured cold: closing stream 1.8 s every 5 min; the three intake assays 1.7-3.2 s every 15 min; metric fold
--   6-19 s every 30 min. Worst case about 85 s an hour (2.4% of one core); the digest copy is about 35 runs a run.
-- CONTRACT. supabase/sql/test_job_health_readers.sql (PostgreSQL 17, CI job job-health-readers-contract).
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '15s';

DO $guard$
BEGIN
  IF encode(sha256(convert_to(pg_get_viewdef('public.v_job_health'::regclass, true), 'UTF8')), 'base64')
     IS DISTINCT FROM 'p+lMNHgRes+KIBCvLHpCkhx54qYexyu7DjDOeeSVwxw=' THEN
    RAISE EXCEPTION 'v_job_health changed after 2026-10-14 05:46Z; re-read it before replacing it';
  END IF;
  IF encode(sha256(convert_to(pg_get_functiondef('public.get_live_auction_health(date)'::regprocedure), 'UTF8')), 'base64')
     IS DISTINCT FROM 'vexAqbXh+D0e+xUoPin84xWhsEAww/HJdjkJSoo+m50=' THEN
    RAISE EXCEPTION 'get_live_auction_health(date) changed after 2026-10-14 05:46Z; re-read it before replacing it';
  END IF;
  IF to_regclass('public.cron_run_digest') IS NOT NULL OR to_regclass('public.job_assay_readings') IS NOT NULL
     OR to_regprocedure('public.job_health_live_from()') IS NOT NULL
     OR to_regprocedure('public.refresh_job_health(boolean,interval)') IS NOT NULL THEN
    RAISE EXCEPTION 'job health digest objects already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-job-health') THEN
    RAISE EXCEPTION 'cron job refresh-job-health already exists';
  END IF;
END
$guard$;

-- 1. The run digest ---------------------------------------------------------------------------------------------------
CREATE TABLE public.cron_run_digest (
  runid         bigint      PRIMARY KEY,
  jobid         bigint      NOT NULL,
  status        text,
  start_time    timestamptz,
  error_head    text,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX cron_run_digest_open_idx ON public.cron_run_digest (runid)
  WHERE status IS DISTINCT FROM 'succeeded' AND status IS DISTINCT FROM 'failed';
ALTER TABLE public.cron_run_digest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_run_digest FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cron_run_digest TO service_role;

COMMENT ON TABLE public.cron_run_digest IS
'Narrow copy of cron.job_run_details for the last 8 days, one row per pg_cron run (grain: runid), so v_job_health reads a few hundred pages instead of the scattered, never-vacuumed run log. Written only by refresh_job_health() (pg_cron job refresh-job-health, every 5 minutes): it copies every run from job_health_live_from() on, re-reads older open runs by runid and trims runs below 8 days. v_job_health reads finished rows below the live mark from here and everything else from cron.job_run_details, so its answer is exact even when this table is empty or stale. A run deleted from cron.job_run_details after it was copied stays here until it is 8 days old. RLS on with no policy: service_role reads. Minted 2026-10-14 (migration 20261014090000).';
COMMENT ON COLUMN public.cron_run_digest.runid IS 'cron.job_run_details.runid of the run. Unit: none (key). Source: pg_cron. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.cron_run_digest.jobid IS 'cron.job.jobid the run belongs to. Unit: none (key). Source: cron.job_run_details.jobid. Grain: one run. Clock: n/a.';
COMMENT ON COLUMN public.cron_run_digest.status IS 'pg_cron status as last copied: starting, connecting, sending, running, succeeded or failed. succeeded and failed are final; any other value is re-read from cron.job_run_details. Unit: none (text). Source: cron.job_run_details.status. Grain: one run. Clock: as of the last refresh.';
COMMENT ON COLUMN public.cron_run_digest.start_time IS 'When pg_cron started the run; NULL for a run that never started (connection failed, server restarted). Unit: timestamptz. Source: cron.job_run_details.start_time. Grain: one run. Clock: run start.';
COMMENT ON COLUMN public.cron_run_digest.error_head IS 'First 300 characters of return_message for a failed run (what v_job_health.last_error shows); NULL for every other status. Unit: none (text). Source: cron.job_run_details.return_message. Grain: one run. Clock: as of the last refresh.';
COMMENT ON COLUMN public.cron_run_digest.first_seen_at IS 'When refresh_job_health() first copied the run. An open run first seen more than an hour ago no longer holds back job_health_live_from(); it is re-read by runid instead. Unit: timestamptz. Source: refresh_job_health(). Grain: one run. Clock: copy time.';

-- 2. Stored assay readings --------------------------------------------------------------------------------------------
CREATE TABLE public.job_assay_readings (
  jobname       text        PRIMARY KEY,
  reading       jsonb,
  assayed_at    timestamptz,
  elapsed_ms    integer,
  attempted_at  timestamptz,
  attempt_error text,
  refresh_every interval    NOT NULL,
  fresh_for     interval    NOT NULL,
  CONSTRAINT job_assay_readings_cadence_check CHECK (refresh_every > interval '0' AND fresh_for > refresh_every),
  CONSTRAINT job_assay_readings_clock_check CHECK ((assayed_at IS NULL) = (elapsed_ms IS NULL) AND elapsed_ms >= 0)
);
ALTER TABLE public.job_assay_readings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_assay_readings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.job_assay_readings TO service_role;
INSERT INTO public.job_assay_readings (jobname, refresh_every, fresh_for) VALUES
  ('bat-live-pull',                       interval '5 minutes',  interval '15 minutes'),
  ('qualify-bat-archived-sales',          interval '15 minutes', interval '35 minutes'),
  ('project-retained-listing-properties', interval '15 minutes', interval '35 minutes'),
  ('qualify-retained-vin-references',     interval '15 minutes', interval '35 minutes'),
  ('drain-vehicle-derived-queues',        interval '30 minutes', interval '65 minutes');

COMMENT ON TABLE public.job_assay_readings IS
'The latest reading of each slow v_job_health assay, one row per job (grain: jobname): bat-live-pull (get_live_auction_health()->closing_stream), qualify-bat-archived-sales (assay_bat_sale_intake), project-retained-listing-properties (assay_retained_listing_properties), qualify-retained-vin-references (assay_vin_reference_intake), drain-vehicle-derived-queues (assay_vehicle_metric_fold). Written only by refresh_job_health() every 5 minutes for the rows that are due (refresh_every). v_job_health uses a reading while assayed_at is within fresh_for and runs the assay live otherwise, so a stopped refresher makes the view slow, never stale beyond fresh_for. Each reading also carries the assay''s own clock (checked_at, as_of_at or measured_at). RLS on with no policy: service_role reads. Minted 2026-10-14 (migration 20261014090000).';
COMMENT ON COLUMN public.job_assay_readings.jobname IS 'cron.job.jobname whose assay this is; the same name selects the branch in v_job_health. Unit: none (key). Source: migration 20261014090000. Grain: one job. Clock: n/a.';
COMMENT ON COLUMN public.job_assay_readings.reading IS 'The assay''s jsonb reading exactly as the function returned it (v_job_health.assay). Unit: none (jsonb). Source: the assay function. Grain: one job. Clock: assayed_at.';
COMMENT ON COLUMN public.job_assay_readings.assayed_at IS 'When the assay behind reading started (clock_timestamp()); NULL until the first success. Unit: timestamptz. Source: refresh_job_health(). Grain: one job. Clock: assay start.';
COMMENT ON COLUMN public.job_assay_readings.elapsed_ms IS 'How long the assay behind reading took. Unit: milliseconds. Source: refresh_job_health(). Grain: one job. Clock: assayed_at.';
COMMENT ON COLUMN public.job_assay_readings.attempted_at IS 'When refresh_job_health() last started this assay, successful or not; the cadence counts from here. Unit: timestamptz. Source: refresh_job_health(). Grain: one job. Clock: attempt start.';
COMMENT ON COLUMN public.job_assay_readings.attempt_error IS 'SQLSTATE of the last attempt when it raised (reading and assayed_at then keep the previous success); NULL after a success. Unit: none (SQLSTATE). Source: refresh_job_health(). Grain: one job. Clock: attempted_at.';
COMMENT ON COLUMN public.job_assay_readings.refresh_every IS 'How often refresh_job_health() re-runs the assay (due when attempted_at is older than this, less one minute of slack for the 5-minute schedule). Unit: interval. Source: migration 20261014090000. Grain: one job. Clock: n/a.';
COMMENT ON COLUMN public.job_assay_readings.fresh_for IS 'The oldest reading v_job_health will show; beyond it the view runs the assay live. Unit: interval. Source: migration 20261014090000. Grain: one job. Clock: n/a.';

-- 3. The live mark ----------------------------------------------------------------------------------------------------
CREATE FUNCTION public.job_health_live_from()
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(
    (SELECT min(g.runid) FROM public.cron_run_digest g
      WHERE g.status IS DISTINCT FROM 'succeeded' AND g.status IS DISTINCT FROM 'failed'
        AND g.first_seen_at > statement_timestamp() - interval '1 hour'),
    (SELECT max(g.runid) + 1 FROM public.cron_run_digest g),
    0::bigint)
$function$;
REVOKE ALL ON FUNCTION public.job_health_live_from() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_health_live_from() TO service_role;
COMMENT ON FUNCTION public.job_health_live_from() IS
'The runid from which v_job_health reads cron.job_run_details live: the oldest cron_run_digest run that is still open and was first seen within the hour, else one past the newest digest run, else 0 (empty digest: read everything live). Every finished digest row below it is final. Migration 20261014090000.';

-- 4. The writer -------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.refresh_job_health(p_assays boolean DEFAULT true,
                                          p_assay_budget interval DEFAULT interval '40 seconds')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_started constant timestamptz := clock_timestamp();
  v_mark    bigint;
  v_copied  bigint := 0;
  v_reread  bigint := 0;
  v_trimmed bigint := 0;
  v_assays  jsonb  := '[]'::jsonb;
  v_job     text;
  v_reading jsonb;
  v_t0      timestamptz;
  v_ms      integer;
BEGIN
  -- 1. Due assays, shortest cadence first: the closing stream compares heartbeats with now(), the transaction start.
  IF p_assays THEN
    FOR v_job IN
      SELECT a.jobname FROM public.job_assay_readings a
       WHERE a.attempted_at IS NULL OR a.attempted_at < now() - a.refresh_every + interval '1 minute'
       ORDER BY a.refresh_every, a.attempted_at NULLS FIRST, a.jobname
    LOOP
      EXIT WHEN clock_timestamp() - v_started > p_assay_budget;
      v_t0 := clock_timestamp();
      BEGIN
        IF v_job = 'bat-live-pull' THEN
          v_reading := public.get_live_auction_health() -> 'closing_stream';
        ELSIF v_job = 'qualify-bat-archived-sales' THEN
          v_reading := public.assay_bat_sale_intake();
        ELSIF v_job = 'project-retained-listing-properties' THEN
          v_reading := public.assay_retained_listing_properties();
        ELSIF v_job = 'qualify-retained-vin-references' THEN
          v_reading := public.assay_vin_reference_intake();
        ELSIF v_job = 'drain-vehicle-derived-queues' THEN
          v_reading := public.assay_vehicle_metric_fold();
        ELSE
          RAISE EXCEPTION 'no assay is registered for job %', v_job USING ERRCODE = 'undefined_function';
        END IF;
        v_ms := round(1000 * extract(epoch FROM clock_timestamp() - v_t0))::integer;
        UPDATE public.job_assay_readings a
           SET reading = v_reading, assayed_at = v_t0, elapsed_ms = v_ms, attempted_at = v_t0, attempt_error = NULL
         WHERE a.jobname = v_job;
        v_assays := v_assays || jsonb_build_array(jsonb_build_object('jobname', v_job, 'ms', v_ms));
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.job_assay_readings a SET attempted_at = v_t0, attempt_error = SQLSTATE WHERE a.jobname = v_job;
        v_assays := v_assays || jsonb_build_array(jsonb_build_object('jobname', v_job, 'sqlstate', SQLSTATE));
      END;
    END LOOP;
  END IF;

  -- 2. The digest. An empty digest starts 8 days back (one scan of the run log); otherwise from the live mark.
  IF EXISTS (SELECT 1 FROM public.cron_run_digest) THEN
    v_mark := public.job_health_live_from();
  ELSE
    SELECT min(d.runid) INTO v_mark FROM cron.job_run_details d
     WHERE d.start_time > now() - interval '8 days 1 hour';
    v_mark := coalesce(v_mark, (SELECT max(d.runid) + 1 FROM cron.job_run_details d), 0);
  END IF;

  INSERT INTO public.cron_run_digest AS g (runid, jobid, status, start_time, error_head)
  SELECT d.runid, d.jobid, d.status, d.start_time,
         CASE WHEN d.status = 'failed' THEN left(d.return_message, 300) END
    FROM cron.job_run_details d
   WHERE d.runid >= v_mark AND d.jobid IS NOT NULL
  ON CONFLICT (runid) DO UPDATE
     SET status = EXCLUDED.status, start_time = EXCLUDED.start_time, error_head = EXCLUDED.error_head
   WHERE (g.status, g.start_time, g.error_head)
         IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.start_time, EXCLUDED.error_head);
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  -- Open runs below the mark (first seen more than an hour ago): re-read each by runid.
  UPDATE public.cron_run_digest g
     SET status = d.status, start_time = d.start_time,
         error_head = CASE WHEN d.status = 'failed' THEN left(d.return_message, 300) END
    FROM cron.job_run_details d
   WHERE d.runid = g.runid
     AND g.runid < v_mark
     AND g.status IS DISTINCT FROM 'succeeded' AND g.status IS DISTINCT FROM 'failed'
     AND (g.status, g.start_time, g.error_head)
         IS DISTINCT FROM (d.status, d.start_time, CASE WHEN d.status = 'failed' THEN left(d.return_message, 300) END);
  GET DIAGNOSTICS v_reread = ROW_COUNT;

  DELETE FROM public.cron_run_digest g
   WHERE g.runid < (SELECT min(x.runid) FROM public.cron_run_digest x WHERE x.start_time > now() - interval '8 days');
  GET DIAGNOSTICS v_trimmed = ROW_COUNT;

  RETURN jsonb_build_object('live_from', v_mark, 'copied', v_copied, 'reread', v_reread, 'trimmed', v_trimmed,
    'assays', v_assays, 'ms', round(1000 * extract(epoch FROM clock_timestamp() - v_started)));
END
$function$;
REVOKE ALL ON FUNCTION public.refresh_job_health(boolean, interval) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.refresh_job_health(boolean, interval) IS
'The one writer of cron_run_digest and job_assay_readings, run by pg_cron job refresh-job-health every 5 minutes as postgres. First the due assays, shortest cadence first, each in its own subtransaction (a raise keeps the previous reading and records attempt_error); no new assay starts after p_assay_budget. Then the digest: copy every run from job_health_live_from() on, re-read older open runs by runid, trim runs below 8 days. p_assays false refreshes the digest only. Returns {live_from, copied, reread, trimmed, assays, ms}. Migration 20261014090000.';

-- 5. Fill the digest before the view changes, so the view's lock is held only briefly at the end -----------------
SELECT public.refresh_job_health(p_assays := false);

-- 6. cron_status by a backward pkey walk ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_live_auction_health(p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH day_bounds AS MATERIALIZED (
  SELECT coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date) AS day,
    coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date)::timestamp
      AT TIME ZONE 'America/Los_Angeles' AS starts,
    (coalesce(p_day,(now() AT TIME ZONE 'America/Los_Angeles')::date)+1)::timestamp
      AT TIME ZONE 'America/Los_Angeles' AS ends
), candidates AS MATERIALIZED (
  SELECT m.vehicle_id,rtrim(m.external_auction_url,'/') AS url,m.auction_end_time AS ends,
    nullif(m.stream_state->>'terminal_observation_id','')::uuid AS terminal_id
  FROM public.monitored_auctions m
  JOIN public.live_auction_sources s ON s.id=m.source_id AND s.slug='bat'
  CROSS JOIN day_bounds b
  WHERE m.auction_end_time>=b.starts AND m.auction_end_time<b.ends
  UNION ALL
  SELECT e.vehicle_id,rtrim(e.source_url,'/'),e.ended_at,NULL::uuid
  FROM public.vehicle_events e CROSS JOIN day_bounds b
  WHERE e.source_platform='bat' AND e.event_type='auction'
    AND e.ended_at>=b.starts AND e.ended_at<b.ends
  UNION ALL
  SELECT a.vehicle_id,rtrim(a.source_url,'/'),a.auction_end_date,NULL::uuid
  FROM public.auction_events a CROSS JOIN day_bounds b
  WHERE a.source='bat' AND a.auction_end_date>=b.starts AND a.auction_end_date<b.ends
), lots AS MATERIALIZED (
  -- One source listing across caches and parent aliases; a missing URL stays
  -- separate by vehicle rather than disappearing from the denominator.
  SELECT url,CASE WHEN nullif(url,'') IS NULL THEN vehicle_id END AS unbound_vehicle,
    array_agg(DISTINCT vehicle_id) AS vehicle_ids,max(ends) AS scheduled_end,
    array_agg(DISTINCT terminal_id) FILTER(WHERE terminal_id IS NOT NULL) AS terminal_ids
  FROM candidates
  GROUP BY url,CASE WHEN nullif(url,'') IS NULL THEN vehicle_id END
), reconciled AS MATERIALIZED (
  SELECT l.*,CASE WHEN cardinality(result.outcomes)=1 THEN coalesce(result.latest_end,l.scheduled_end)
      ELSE greatest(result.latest_end,l.scheduled_end) END AS closes_at,
    coalesce(result.outcomes,ARRAY[]::text[]) AS outcomes,
    receipt.has_native_receipt,receipt.late_native_admission
  FROM lots l
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT a.outcome) FILTER(WHERE a.outcome IN ('sold','reserve_not_met','cancelled')) AS outcomes,
      max(a.auction_end_date) AS latest_end
    FROM public.auction_events a
    WHERE a.vehicle_id=ANY(l.vehicle_ids) AND a.source='bat'
      AND a.source_url IN (l.url,l.url||'/')
  ) result ON true
  LEFT JOIN LATERAL (
    SELECT count(*)>0 AS has_native_receipt,
      coalesce(bool_or(o.structured_data->>'clock_basis'='native_comment_timestamp'
        AND o.ingested_at>o.observed_at+interval '2 seconds'),false) AS late_native_admission
    FROM public.vehicle_observations o
    WHERE o.id=ANY(l.terminal_ids) AND o.vehicle_id=ANY(l.vehicle_ids)
      AND o.source_url IN (l.url,l.url||'/') AND o.kind='sale_result'
      AND o.extraction_method='bat_public_live_v1'
  ) receipt ON true
), today AS MATERIALIZED (
  -- An extension into tomorrow moves the lot out of today's denominator.
  SELECT r.* FROM reconciled r CROSS JOIN day_bounds b
  WHERE r.closes_at>=b.starts AND r.closes_at<b.ends
), settlement AS MATERIALIZED (
  SELECT jsonb_build_object(
    'date',(SELECT day FROM day_bounds),'timezone','America/Los_Angeles',
    'status',CASE WHEN count(*)=0 THEN 'idle'
      WHEN count(*) FILTER(WHERE cardinality(outcomes)>1 OR
        (closes_at<now()-interval '5 minutes' AND cardinality(outcomes)=0))>0 THEN 'failed'
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=0)>0 THEN 'pending'
      ELSE 'passed' END,
    'expected_known_lots',count(*),
    'due_known_lots',count(*) FILTER(WHERE closes_at<=now()),
    'upcoming_known_lots',count(*) FILTER(WHERE closes_at>now()),
    'confirmed_closed_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1),
    'sold_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['sold']::text[]),
    'reserve_not_met_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['reserve_not_met']::text[]),
    'cancelled_lots',count(*) FILTER(WHERE closes_at<=now() AND outcomes=ARRAY['cancelled']::text[]),
    'unresolved_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=0),
    'overdue_result_lots',count(*) FILTER(WHERE closes_at<now()-interval '5 minutes' AND cardinality(outcomes)=0),
    'conflicting_result_lots',count(*) FILTER(WHERE cardinality(outcomes)>1),
    'unbound_lots',count(*) FILTER(WHERE nullif(url,'') IS NULL),
    'native_terminal_receipt_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND has_native_receipt),
    'late_native_terminal_admission_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND late_native_admission),
    'closed_without_native_terminal_receipt_lots',count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1 AND NOT has_native_receipt),
    'terminal_capture_status',CASE
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1)=0 THEN 'idle'
      WHEN count(*) FILTER(WHERE closes_at<=now() AND cardinality(outcomes)=1
        AND (NOT has_native_receipt OR late_native_admission))>0 THEN 'failed'
      ELSE 'passed' END,
    'native_event_to_admission_slo_seconds',2,
    'result_grace_seconds',300,
    'inventory_scope','Known BaT listings in Nuke monitors and auction caches, deduplicated by source URL',
    'source_inventory_completeness','unverified',
    'continuous_capture_completeness','unverified; a terminal receipt can be late recovery',
    'checked_at',now()) AS reading
  FROM today
), closing AS MATERIALIZED (
  SELECT m.*, EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
    WHERE (session.value->>'connected')::boolean
      AND session.value->>'error' IS NULL
      AND (session.value->>'at')::timestamptz>now()-interval '3 seconds'
      AND NOT ((session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds')) AS covered,
    EXISTS(SELECT 1 FROM jsonb_each(coalesce(m.stream_state->'sessions','{}'::jsonb)) session
      WHERE (session.value->>'at')::timestamptz>now()-interval '3 seconds'
        AND (session.value->>'pending')::integer>0
        AND (session.value->>'oldest_received_at')::timestamptz<now()-interval '2 seconds') AS admission_overdue
  FROM public.monitored_auctions m JOIN public.live_auction_sources source ON source.id=m.source_id AND source.slug='bat'
  WHERE m.auction_end_time<=now()+interval '15 minutes' AND m.auction_end_time>now()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM public.auction_events a WHERE a.vehicle_id=m.vehicle_id
      AND rtrim(a.source_url,'/')=rtrim(m.external_auction_url,'/') AND a.outcome IN ('sold','reserve_not_met','cancelled'))
), stream AS (
  SELECT jsonb_build_object('status',CASE WHEN (SELECT reading->>'status'='failed'
      OR reading->>'terminal_capture_status'='failed' FROM settlement) THEN 'failed' WHEN count(*)=0 THEN 'idle'
    WHEN count(*) FILTER(WHERE NOT is_live OR NOT covered OR admission_overdue OR coalesce((stream_state->>'unqualified_frames')::integer,0)>0)>0 THEN 'failed' ELSE 'passed' END,
    'eligible_lots',count(*),'covered_lots',count(*) FILTER(WHERE is_live AND covered),
    'missing_lots',count(*) FILTER(WHERE NOT is_live OR NOT covered),
    'admission_overdue_lots',count(*) FILTER(WHERE admission_overdue),
    'unqualified_lots',count(*) FILTER(WHERE coalesce((stream_state->>'unqualified_frames')::integer,0)>0),
    'receipt_to_admission_slo_seconds',2,'heartbeat_stale_after_seconds',3,
    'source_publication_lag','unknown unless native comment timestamp is present',
    'daily_settlement',(SELECT reading FROM settlement),
    'coverage_scope','current subscriptions and acknowledgement queues; outages can lose non-replayable extension/stat events',
    'checked_at',now()) AS reading FROM closing
)
SELECT jsonb_build_object(
  'total_monitored',(SELECT count(*) FROM public.monitored_auctions WHERE is_live),
  'soft_close_count',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND is_in_soft_close),
  'overdue_sync',(SELECT count(*) FROM public.monitored_auctions WHERE is_live AND next_poll_at<now()-interval '2 minutes'),
  'avg_bid_dollars',(SELECT round(avg(current_bid_cents)::numeric/100,2) FROM public.monitored_auctions WHERE is_live AND current_bid_cents>0),
  'total_bids',(SELECT sum(bid_count) FROM public.monitored_auctions WHERE is_live),
  'platforms',(SELECT jsonb_agg(jsonb_build_object('slug',s.slug,'active_auctions',s.active_count,'health_status',s.health_status))
    FROM (SELECT source.slug,source.health_status,count(m.id) AS active_count FROM public.live_auction_sources source
      LEFT JOIN public.monitored_auctions m ON m.source_id=source.id AND m.is_live WHERE source.is_active
      GROUP BY source.id,source.slug,source.health_status) s),
  'cron_status',(SELECT jsonb_build_object('job_id',j.jobid,'last_run',d.start_time,'last_status',d.status)
    FROM cron.job j LEFT JOIN LATERAL(SELECT start_time,status FROM cron.job_run_details WHERE jobid=j.jobid ORDER BY runid DESC LIMIT 1)d ON true
    WHERE j.jobname='bat-live-pull'),
  'last_sync',(SELECT max(updated_at) FROM public.monitored_auctions WHERE is_live),
  'closing_stream',(SELECT reading FROM stream),
  'daily_closes',(SELECT reading FROM settlement),'checked_at',now());
$function$;

-- 7. The view ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_job_health AS
 WITH bat_sale_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN r.assayed_at > (statement_timestamp() - r.fresh_for) THEN r.reading
                    ELSE public.assay_bat_sale_intake()
                END AS reading
           FROM ( SELECT 1) one
             LEFT JOIN public.job_assay_readings r ON r.jobname = 'qualify-bat-archived-sales'::text
        ), retained_listing_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN r.assayed_at > (statement_timestamp() - r.fresh_for) THEN r.reading
                    ELSE public.assay_retained_listing_properties()
                END AS reading
           FROM ( SELECT 1) one
             LEFT JOIN public.job_assay_readings r ON r.jobname = 'project-retained-listing-properties'::text
        ), vin_reference_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN r.assayed_at > (statement_timestamp() - r.fresh_for) THEN r.reading
                    ELSE public.assay_vin_reference_intake()
                END AS reading
           FROM ( SELECT 1) one
             LEFT JOIN public.job_assay_readings r ON r.jobname = 'qualify-retained-vin-references'::text
        ), taxonomy_assay AS MATERIALIZED (
         SELECT public.assay_vehicle_taxonomy_fold() AS reading
        ), residual_assay AS MATERIALIZED (
         SELECT public.assay_sale_residual_fold() AS reading
        ), stream_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN r.assayed_at > (statement_timestamp() - r.fresh_for) THEN r.reading
                    ELSE public.get_live_auction_health() -> 'closing_stream'::text
                END AS reading
           FROM ( SELECT 1) one
             LEFT JOIN public.job_assay_readings r ON r.jobname = 'bat-live-pull'::text
        ), metric_assay AS MATERIALIZED (
         SELECT
                CASE
                    WHEN r.assayed_at > (statement_timestamp() - r.fresh_for) THEN r.reading
                    ELSE public.assay_vehicle_metric_fold()
                END AS reading
           FROM ( SELECT 1) one
             LEFT JOIN public.job_assay_readings r ON r.jobname = 'drain-vehicle-derived-queues'::text
          WHERE (EXISTS ( SELECT 1
                   FROM cron.job
                  WHERE job.jobname = 'drain-vehicle-derived-queues'::text))
        ), recent_runs AS (
         SELECT g.jobid,
            g.status,
            g.start_time,
            g.error_head AS return_message
           FROM public.cron_run_digest g
          WHERE g.runid < (( SELECT public.job_health_live_from() AS job_health_live_from)) AND (g.status = 'succeeded'::text OR g.status = 'failed'::text)
        UNION ALL
         SELECT d.jobid,
            d.status,
            d.start_time,
            d.return_message
           FROM public.cron_run_digest g
             JOIN cron.job_run_details d ON d.runid = g.runid
          WHERE g.runid < (( SELECT public.job_health_live_from() AS job_health_live_from)) AND g.status IS DISTINCT FROM 'succeeded'::text AND g.status IS DISTINCT FROM 'failed'::text
        UNION ALL
         SELECT d.jobid,
            d.status,
            d.start_time,
            d.return_message
           FROM cron.job_run_details d
          WHERE d.runid >= public.job_health_live_from()
        ), runs AS (
         SELECT r.jobid,
            r.status,
            r.start_time,
            r.return_message,
            row_number() OVER (PARTITION BY r.jobid ORDER BY r.start_time DESC) AS rn
           FROM recent_runs r
          WHERE r.start_time > (now() - '7 days'::interval)
        ), first_ok AS (
         SELECT runs.jobid,
            min(runs.rn) AS rn
           FROM runs
          WHERE runs.status <> 'failed'::text
          GROUP BY runs.jobid
        ), streak AS (
         SELECT r.jobid,
            count(*) AS n
           FROM runs r
             LEFT JOIN first_ok f USING (jobid)
          WHERE r.status = 'failed'::text AND r.rn < COALESCE(f.rn, 2147483647::bigint)
          GROUP BY r.jobid
        ), day AS (
         SELECT runs.jobid,
            count(*) AS runs_24h,
            count(*) FILTER (WHERE runs.status = 'failed'::text) AS failed_24h
           FROM runs
          WHERE runs.start_time > (now() - '24:00:00'::interval)
          GROUP BY runs.jobid
        ), last_run AS (
         SELECT runs.jobid,
            runs.status AS last_status,
            runs.start_time AS last_run_at
           FROM runs
          WHERE runs.rn = 1
        ), last_err AS (
         SELECT DISTINCT ON (runs.jobid) runs.jobid,
            "left"(runs.return_message, 300) AS last_error
           FROM runs
          WHERE runs.status = 'failed'::text
          ORDER BY runs.jobid, runs.start_time DESC
        )
 SELECT j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    COALESCE(day.runs_24h, 0::bigint) AS runs_24h,
    COALESCE(day.failed_24h, 0::bigint) AS failed_24h,
    COALESCE(s.n, 0::bigint) AS consecutive_failures,
    lr.last_status,
    lr.last_run_at,
    le.last_error,
    "substring"(j.command, 'app\.writer''\s*,\s*''([^'']+)'::text) AS declared_writer,
    "left"(regexp_replace(j.command, '\s+'::text, ' '::text, 'g'::text), 200) AS command,
        CASE
            WHEN j.jobname = 'bat-live-pull'::text THEN ( SELECT stream_assay.reading ->> 'status'::text
               FROM stream_assay)
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)
            WHEN j.jobname = 'project-retained-listing-properties'::text THEN ( SELECT retained_listing_assay.reading ->> 'status'::text
               FROM retained_listing_assay)
            WHEN j.jobname = 'qualify-retained-vin-references'::text THEN ( SELECT vin_reference_assay.reading ->> 'status'::text
               FROM vin_reference_assay)
            WHEN j.jobname = 'qualify-bat-archived-sales'::text THEN ( SELECT bat_sale_assay.reading ->> 'status'::text
               FROM bat_sale_assay)
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN ( SELECT taxonomy_assay.reading ->> 'status'::text
               FROM taxonomy_assay)
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN ( SELECT residual_assay.reading ->> 'status'::text
               FROM residual_assay)
            ELSE NULL::text
        END AS assay_status,
        CASE
            WHEN j.jobname = 'bat-live-pull'::text THEN ( SELECT stream_assay.reading
               FROM stream_assay)
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)
            WHEN j.jobname = 'project-retained-listing-properties'::text THEN ( SELECT retained_listing_assay.reading
               FROM retained_listing_assay)
            WHEN j.jobname = 'qualify-retained-vin-references'::text THEN ( SELECT vin_reference_assay.reading
               FROM vin_reference_assay)
            WHEN j.jobname = 'qualify-bat-archived-sales'::text THEN ( SELECT bat_sale_assay.reading
               FROM bat_sale_assay)
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN ( SELECT taxonomy_assay.reading
               FROM taxonomy_assay)
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN ( SELECT residual_assay.reading
               FROM residual_assay)
            ELSE NULL::jsonb
        END AS assay,
        CASE
            WHEN NOT j.active THEN 'paused'::text
            WHEN lr.last_status = 'failed'::text THEN 'failed'::text
            WHEN j.jobname = 'bat-live-pull'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at < (now() - '00:02:00'::interval) THEN 'failed'::text
                WHEN (( SELECT stream_assay.reading ->> 'status'::text
                   FROM stream_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT stream_assay.reading ->> 'status'::text
                   FROM stream_assay)) = 'passed'::text THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN j.jobname = 'drain-sale-residual-fold'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT residual_assay.reading ->> 'status'::text
                   FROM residual_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT residual_assay.reading ->> 'status'::text
                   FROM residual_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT taxonomy_assay.reading ->> 'status'::text
                   FROM taxonomy_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT taxonomy_assay.reading ->> 'status'::text
                   FROM taxonomy_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'qualify-bat-archived-sales'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT bat_sale_assay.reading ->> 'status'::text
                   FROM bat_sale_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT bat_sale_assay.reading ->> 'status'::text
                   FROM bat_sale_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'project-retained-listing-properties'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:05:00'::interval) THEN 'failed'::text
                WHEN (( SELECT retained_listing_assay.reading ->> 'status'::text
                   FROM retained_listing_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT retained_listing_assay.reading ->> 'status'::text
                   FROM retained_listing_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'qualify-retained-vin-references'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:30:00'::interval) THEN 'failed'::text
                WHEN (( SELECT vin_reference_assay.reading ->> 'status'::text
                   FROM vin_reference_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT vin_reference_assay.reading ->> 'status'::text
                   FROM vin_reference_assay)) = 'passed'::text AND lr.last_status = 'succeeded'::text THEN 'passed'::text
                ELSE 'unknown'::text
            END
            WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE
                WHEN lr.last_run_at IS NULL OR lr.last_run_at <= (statement_timestamp() - '00:15:00'::interval) THEN 'failed'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = 'failed'::text THEN 'failed'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = ANY (ARRAY['partial'::text, 'unavailable'::text]) THEN 'unknown'::text
                WHEN lr.last_status <> 'succeeded'::text THEN 'unknown'::text
                WHEN (( SELECT metric_assay.reading ->> 'status'::text
                   FROM metric_assay)) = 'passed'::text THEN 'passed'::text
                ELSE 'idle'::text
            END
            WHEN lr.last_status = 'succeeded'::text THEN 'passed'::text
            ELSE 'unknown'::text
        END AS health_status
   FROM cron.job j
     LEFT JOIN day ON day.jobid = j.jobid
     LEFT JOIN streak s ON s.jobid = j.jobid
     LEFT JOIN last_run lr ON lr.jobid = j.jobid
     LEFT JOIN last_err le ON le.jobid = j.jobid;

COMMENT ON VIEW public.v_job_health IS
'One row per pg_cron job: 24 h runs and failures, consecutive-failure streak (7 d window), last status and error, declared app.writer, the job''s assay reading and health_status. Runs: finished cron_run_digest rows below job_health_live_from(), open digest rows re-read by runid, and cron.job_run_details from the mark on (exact; refresh_job_health() keeps the digest every 5 minutes). The bat-live-pull, qualify-bat-archived-sales, project-retained-listing-properties, qualify-retained-vin-references and drain-vehicle-derived-queues assays read job_assay_readings while assayed_at is within fresh_for and run live otherwise; each reading keeps its own clock (checked_at, as_of_at or measured_at). 2026-09-28; reads made fast 2026-10-14 (20261014090000).';

-- 8. Register the writer and schedule it ----------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT v.table_name, NULL, 'refresh_job_health', v.description, true,
       'refresh_job_health() only (pg_cron job refresh-job-health, every 5 minutes). Migration 20261014090000.'
  FROM (VALUES
    ('cron_run_digest', '8-day narrow copy of cron.job_run_details that v_job_health reads below job_health_live_from().'),
    ('job_assay_readings', 'Latest reading of the five slow v_job_health assays with its clock, cost and cadence.')
  ) AS v(table_name, description)
 WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = v.table_name AND r.column_name IS NULL);

SELECT cron.schedule('refresh-job-health', '*/5 * * * *',
  $cmd$SET statement_timeout = '120s'; SELECT public.refresh_job_health();$cmd$);

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cron_run_digest) THEN
    RAISE EXCEPTION 'cron_run_digest is empty after the first refresh';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-job-health' AND schedule = '*/5 * * * *') THEN
    RAISE EXCEPTION 'refresh-job-health is not scheduled';
  END IF;
END
$verify$;

COMMIT;
