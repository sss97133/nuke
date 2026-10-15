-- Pause bonhams-lot-pages (the edge-run deep pass): Bonhams answers HTTP 403 to the edge function's address (05:10Z and
-- 05:20Z 2026-10-15; the same pages read fine from a house address). The pass now runs from a runner that reads the pages
-- there and sends them to extract-bonhams (actions deep_queue / land_lot_pages).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'bonhams-lot-pages'), active := false);
COMMIT;
