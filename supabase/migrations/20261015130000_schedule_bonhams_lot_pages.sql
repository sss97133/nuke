-- bonhams-lot-pages: the lot-page deep pass for Bonhams lots the search index landed. Every 10 minutes, at most 20 lots,
-- one page request per 2 s (extract-bonhams action deep_lots), newest sales first. It fills what the index lacks: the whole
-- photo gallery at full size, the sale name and venue, footnotes, the condition-report link, and keeps the raw page data on
-- the observation. A 403/429 or a page that is not a lot page ends the run and marks nothing.
-- Gate before this was turned on (2026-10-15, ten landed lots read live): 10 of 10 HTTP 200, no challenge, gallery 7 to 77
-- images per lot against 0 to 1 landed.
-- Bound: 20 lots x 144 runs = 2,880 lots a day at most. Stop rule:
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'bonhams-lot-pages'), active := false)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bonhams-lot-pages') THEN
    PERFORM cron.schedule('bonhams-lot-pages', '*/10 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-bonhams',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_service_role_key_for_cron()
        ),
        body := '{"action": "deep_lots", "limit": 20, "spacing_ms": 2000}'::jsonb,
        timeout_milliseconds := 120000
      );
    $c$);
  END IF;
END $job$;
COMMIT;
