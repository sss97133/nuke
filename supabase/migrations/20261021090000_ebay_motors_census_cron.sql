-- ebay-motors-census: once a day, eBay's own count of what is listed (Browse API, free), written as a source_census row:
-- category total, Make and Model Year counts, vintage (1991 and older) listings tallied by 3-digit ZIP prefix, and near-me
-- local-pickup counts for 12 anchor ZIPs. About 100 Browse calls of the 5,000 a day. Off with:
--   select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'ebay-motors-census'), active := false);
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-census') THEN
    PERFORM cron.schedule('ebay-motors-census', '0 12 * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-ebay-motors',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
        body := '{"action": "census"}'::jsonb,
        timeout_milliseconds := 150000
      );
    $c$);
  END IF;
END $job$;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ebay-motors-census' AND active) THEN
    RAISE EXCEPTION 'ebay-motors-census is not scheduled and active';
  END IF;
END $check$;
COMMIT;
