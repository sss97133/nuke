-- Cron accountability — retire three dead jobs. Session cb179857, 2026-09-27; plan P1.2, approved by Skylar
-- ("fix it all" → "just do it all"). Verdicts from the cron ledger written 2026-09-26 (CRON_LEDGER.md, rows
-- 424 / 489 / 490, branch feat/cohort-terminal). Unscheduling is not deletion: the SQL function and the two edge
-- functions stay deployed; each job can be restored with cron.schedule(<name>, <schedule>, <command below>).
--
-- 424 cleanup-ended-auctions   '5 * * * *'    paused since 2026-09-27 00:35Z
--     SELECT cleanup_ended_auctions(500)
--   Redundant: sync-live-auctions already marks expired auctions ended at the end of every sync
--   (supabase/functions/sync-live-auctions/index.ts:1108). Activated 2026-07-11 by an agent session; no migration.
--
-- 489 bat-extraction-queue-slow '*/5 * * * *'  paused since 2026-09-27 00:35Z
--     SELECT net.http_post(
--       url := get_service_url() || '/functions/v1/process-bat-extraction-queue',
--       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
--       body := '{"batchSize": 15}'::jsonb,
--       timeout_milliseconds := 150000
--     );
--   Replaced: the BaT archive (catalog + lot pages, read where they live) and bat-to-db load clean rows; this job
--   stored full page HTML in prod. Re-created ~2026-07-11 by an agent session; no migration.
--
-- 490 bat-daily-discovery       '0 6 * * *'    ACTIVE until this file
--     SELECT net.http_post(
--       url := get_service_url() || '/functions/v1/bat-url-discovery',
--       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
--       body := '{"action":"discover","pages":20}'::jsonb,
--       timeout_milliseconds := 150000
--     );
--   Feeds only bat_extraction_queue, which nothing drains once 489 is gone.

DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN ('cleanup-ended-auctions', 'bat-extraction-queue-slow', 'bat-daily-discovery')
    ORDER BY jobid
  LOOP
    PERFORM cron.unschedule(r.jobid);
    RAISE NOTICE 'unscheduled % (job %)', r.jobname, r.jobid;
    n := n + 1;
  END LOOP;
  IF n <> 3 THEN
    RAISE WARNING 'expected 3 jobs to retire, found %', n;
  END IF;
END
$do$;

-- POST-APPLY (read-only): 0 rows —
--   SELECT jobid, jobname FROM cron.job
--   WHERE jobname IN ('cleanup-ended-auctions','bat-extraction-queue-slow','bat-daily-discovery');
