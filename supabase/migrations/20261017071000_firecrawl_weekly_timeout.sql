-- The weekly firecrawl-target-allocation job needs more than 300 s when the database is busy: two runs on 2026-10-15 under intake
-- load hit the 300 s statement_timeout (a sample insert and the lot-signal insert), and the 19:10Z run took about 3.5 minutes on a
-- quiet minute. It reads bounded samples and writes only the firecrawl_* tables, so it gets 900 s (still bounded, never 0), like
-- the other fold jobs (treemap-refresh 20 min, map-public-cells 10 min).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'firecrawl-target-allocation-weekly'),
  command := $c$SET statement_timeout = '900s'; SELECT public.refresh_firecrawl_target_allocation();$c$);
COMMIT;
