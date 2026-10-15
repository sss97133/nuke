-- Barn Finds intake: queue every barnfinds.com source target, and drain the queue on a schedule.
--
-- WHY. source_targets holds 59,662 barnfinds.com post URLs and no lot had landed (vehicle_events: 0). Two causes:
-- (1) extract-barn-finds-listing wrote its event with upsert(onConflict 'source_platform,source_listing_id'), which Postgres
--     rejects (the listing key is the partial unique index idx_vehicle_events_dedup) and the error was never read;
-- (2) nothing ran it: the 1,233 barnfinds rows in import_queue came from the RSS poller, 20 posts at a time.
-- The function now writes the event by key and takes {"action": "batch"}.
--
-- WHAT. 1) queue the targets that have no import_queue row (matched with and without the trailing slash; the RSS rows
-- have none) as pending; the url stays exactly as source_targets has it, which is what source_target_coverage joins on.
-- 2) job barnfinds-intake-batch, every 5 minutes, posts {"action": "batch", "limit": 50}: at most 50 pages a run, one fetch
-- per 2 seconds, 110 s time box, stops on 403/429. At most 600 pages an hour from one site.
-- ORDER. CI applies migrations before it deploys changed functions; until the function is live a run only fails.
-- STOP. select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'barnfinds-intake-batch'), active := false)
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

INSERT INTO import_queue (listing_url, status, priority, raw_data)
SELECT st.listing_url, 'pending', 0,
       jsonb_build_object('ingested_via', 'source_targets', 'source_slug', st.source_slug)
  FROM source_targets st
 WHERE st.source_slug = 'barnfinds'
   AND st.listing_url LIKE 'https://barnfinds.com/%'
   AND NOT EXISTS (SELECT 1 FROM import_queue q WHERE q.listing_url IN (st.listing_url, rtrim(st.listing_url, '/')))
ON CONFLICT (listing_url) DO NOTHING;

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'barnfinds-intake-batch') THEN
    PERFORM cron.schedule('barnfinds-intake-batch', '*/5 * * * *', $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-barn-finds-listing',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"action": "batch", "limit": 50}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cmd$);
  END IF;
END $job$;

DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'barnfinds-intake-batch' AND active AND schedule = '*/5 * * * *') THEN
    RAISE EXCEPTION 'barnfinds-intake-batch was not scheduled';
  END IF;
END $check$;

COMMIT;
