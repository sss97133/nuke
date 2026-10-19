-- Schedule bonhams-typesense-land: every 5 minutes, one Typesense request (Bonhams' public search index, free) and up to
-- 100 lots landed through extract-bonhams (vehicles, vehicle_events by listing key, vehicle_observations with the source
-- document kept). Cursor: metadata.ts_page of the last landed event; wraps to page 1 after page 1706 (a revisit).
-- Throttle: 1 request to Bonhams per 5 minutes; 403/429 returns without retrying.
-- Bound: 100 lots x 288 runs = 28,800 lots/day at most; 34,101 car lots in the index (2026-10-15).
-- Stop rule: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'bonhams-typesense-land'), active := false)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bonhams-typesense-land') THEN
    PERFORM cron.schedule('bonhams-typesense-land', '*/5 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-bonhams-typesense',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_service_role_key_for_cron()
        ),
        body := '{"mode": "land", "batch_size": 100}'::jsonb,
        timeout_milliseconds := 120000
      );
    $c$);
  END IF;
END $job$;

COMMIT;
