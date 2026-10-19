-- bonhams-lot-pages (job 551) resumes under the Firecrawl allowance (2026-10-16). deep_lots now asks firecrawl_allowance('bonhams') before any
-- purchase (22 credits a day on the 425-credit period allocation), reads a page already saved from the saved copy for nothing, records the
-- spend with firecrawl_record_spend, and takes the tier-one groups first (1964-1973 American makes, the families the allocation names). Cars only:
-- the walk lands department MOT-CAR lots and no automobilia. Bonhams' robots.txt (read 2026-10-16) disallows /ldc/, /vms-assets/, */aggregate$ and
-- */head_image*, not lot pages. Job body unchanged (20 lots a run); the allowance caps the day.
-- Stop rule: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'bonhams-lot-pages'), active := false)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT cron.alter_job(job_id := (SELECT jobid FROM cron.job WHERE jobname = 'bonhams-lot-pages'), active := true);
COMMIT;
