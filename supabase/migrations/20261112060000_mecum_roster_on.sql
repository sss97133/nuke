-- Turn mecum-upcoming-roster back on, every 6 hours at :07 (was hourly).
--
-- It was paused out of band on 2026-10-15 07:20Z with mecum-targets-landing, while extract-mecum's page save could
-- overwrite a resolved vehicle's year, make, model and VIN. The fill-only identity fix shipped and landing came back
-- 09:00Z that day; the roster was held for database load and never turned back on, so every sale's census stayed at
-- the 2026-10-16 17:20Z read. The roster reads Mecum's public search index only (no Firecrawl, no lot pages); the lots it
-- queues land through mecum-targets-landing at its held cadence. Re-reads stay scheduled inside the function: daily
-- within 7 days of a run day, weekly within 30, once the day after.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(jobid, schedule := '7 */6 * * *', active := true) FROM cron.job WHERE jobname = 'mecum-upcoming-roster';

COMMIT;
