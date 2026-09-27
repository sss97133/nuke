-- Cron accountability, part 5 of 5 — the dead-man heartbeat also watches the crons.
-- Session cb179857 / jobs-rebuild, 2026-09-27. Job: pipeline-heartbeat (486, every 6 h).
--
-- Until today no organ in the database said "this job is failing". derive-vehicle-image-attribution
-- failed 408 of 408 runs on 09-25 and drain-vehicle-completion-queue 1,263 of 1,266, and the only
-- record was cron.job_run_details, which nobody reads. The July post-mortem line still stands: "both
-- dead links died by timing out every 60 s, and nothing ever raised a hand."
--
-- CHANGE: pipeline_heartbeat() gains a cron block. Any ACTIVE job that failed more than half of its
-- runs in the last 24 h (with at least 4 runs), or 20+ runs in a row, becomes a reason on a
-- 'cron_health' admin_notifications row (its own 24 h dedup, so an intake alarm cannot mask it and vice
-- versa). The read is bounded to the newest 12,000 runs by runid (PK range) — never a scan of the
-- 336 MB job_run_details table. The intake logic is unchanged from the 07-02 hardening.
-- The job's command gets its own 55 s budget (the role default is 10 s today).
--
-- Who reads it: the admin UI (AdminShell/AdminHome list admin_notifications) and the morning-receipts
-- auditor; `npm run ledger:facts` prints the same failures as DRIFT on the laptop.

CREATE OR REPLACE FUNCTION public.pipeline_heartbeat()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  p jsonb;
  new_non_unknown bigint;
  unknown_new bigint;
  vegas_err text;
  reasons text[] := '{}';
  cron_reasons text[] := '{}';
BEGIN
  -- ── Cron alarm (2026-09-27) ──────────────────────────────────────────────────
  BEGIN
    WITH m AS (SELECT max(runid) AS r FROM cron.job_run_details),
    runs AS (
      SELECT d.jobid, d.status, d.start_time,
             row_number() OVER (PARTITION BY d.jobid ORDER BY d.runid DESC) AS rn
      FROM cron.job_run_details d, m
      WHERE d.runid > m.r - 12000
    ),
    first_ok AS (
      SELECT jobid, min(rn) AS rn FROM runs WHERE status <> 'failed' GROUP BY jobid
    ),
    streak AS (
      SELECT r.jobid, count(*) AS n
      FROM runs r LEFT JOIN first_ok f USING (jobid)
      WHERE r.status = 'failed' AND r.rn < coalesce(f.rn, 2147483647)
      GROUP BY r.jobid
    ),
    day AS (
      SELECT jobid,
             count(*) AS runs_24h,
             count(*) FILTER (WHERE status = 'failed') AS failed_24h
      FROM runs
      WHERE start_time > now() - interval '24 hours'
      GROUP BY jobid
    )
    SELECT coalesce(array_agg(
             format('cron_failing:%s %s/%s in 24h (streak %s)',
                    j.jobname, day.failed_24h, day.runs_24h, coalesce(s.n, 0))
             ORDER BY j.jobid), '{}')
    INTO cron_reasons
    FROM cron.job j
    JOIN day ON day.jobid = j.jobid
    LEFT JOIN streak s ON s.jobid = j.jobid
    WHERE j.active
      AND day.runs_24h >= 4
      AND (day.failed_24h * 2 > day.runs_24h OR coalesce(s.n, 0) >= 20);
  EXCEPTION WHEN others THEN
    -- The reading failing is itself a finding, never a silent pass.
    cron_reasons := ARRAY['cron_health_reading_failed: ' || SQLERRM];
  END;

  IF array_length(cron_reasons, 1) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE notification_type = 'system_alert'
      AND metadata->>'kind' = 'cron_health'
      AND created_at > now() - interval '24 hours'
  ) THEN
    INSERT INTO admin_notifications (notification_type, title, message, action_required, priority, metadata)
    VALUES (
      'system_alert',
      'Cron health: ' || array_length(cron_reasons, 1) || ' job(s) failing',
      array_to_string(cron_reasons, '; ')
        || '. Ledger: docs/ledger/CRON_LEDGER.md (npm run ledger:facts). Pause: select cron.alter_job(job_id := <id>, active := false).',
      'system_action', 2,
      jsonb_build_object('kind', 'cron_health', 'reasons', to_jsonb(cron_reasons)));
  END IF;

  -- ── Intake heartbeat (unchanged from 20260702003000) ─────────────────────────
  -- Alarm signals computed DIRECTLY (cheap: vehicles-24h brin, listing_feeds tiny).
  -- The alarm must never depend on the full reading surviving.
  SELECT count(*) INTO new_non_unknown
  FROM vehicles
  WHERE created_at > now() - interval '24 hours'
    AND COALESCE(source, 'unknown') <> 'unknown';

  SELECT count(*) INTO unknown_new
  FROM vehicles
  WHERE source = 'unknown' AND created_at > now() - interval '24 hours';

  SELECT last_error INTO vegas_err
  FROM listing_feeds WHERE id = '46b8373b-2454-4cbb-926c-7646c90e560d';

  IF new_non_unknown = 0 THEN
    reasons := reasons || 'no_new_non_unknown_vehicles_24h';
  END IF;
  IF unknown_new > 0 THEN
    reasons := reasons || format('unknown_source_new_24h=%s', unknown_new);
  END IF;
  IF vegas_err IS NOT NULL THEN
    reasons := reasons || 'vegas_feed_last_error_present';
  END IF;

  -- Pulse snapshot is opportunistic context, never a dependency.
  BEGIN
    p := public.get_pipeline_pulse_24h();
  EXCEPTION WHEN others THEN
    p := jsonb_build_object('pulse_error', SQLERRM);
    reasons := reasons || 'pulse_reading_failed';
  END;

  IF array_length(reasons, 1) IS NULL THEN
    RETURN;  -- healthy, stay silent
  END IF;

  IF EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE notification_type = 'system_alert'
      AND metadata->>'kind' = 'pipeline_heartbeat'
      AND created_at > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO admin_notifications (notification_type, title, message, action_required, priority, metadata)
  VALUES (
    'system_alert',
    'Pipeline heartbeat: ' || array_to_string(reasons, ', '),
    'Dead-man heartbeat tripped. Reasons: ' || array_to_string(reasons, '; ')
      || '. Pulse snapshot (or its error) in metadata.pulse.',
    'system_action', 2,
    jsonb_build_object('kind', 'pipeline_heartbeat', 'reasons', to_jsonb(reasons), 'pulse', p));
END;
$function$;

COMMENT ON FUNCTION public.pipeline_heartbeat() IS
  'Dead-man switch (cron pipeline-heartbeat, 6-hourly): admin_notifications rows for dead intake / unknown-source slop / Vegas feed error (kind pipeline_heartbeat) and for any active cron failing >50% of 24h runs or 20+ in a row (kind cron_health). Each kind deduped to 1 per 24h. 2026-09-27.';

DO $do$
DECLARE
  v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'pipeline-heartbeat';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_id,
      command := $cmd$SET statement_timeout = '55s'; SELECT public.pipeline_heartbeat();$cmd$);
  END IF;
END
$do$;
