-- rmsothebys-discovery (job 450): rotate hourly through every RM sale with a published roster, not three fixed codes.
--
-- Measured 2026-10-15/16: the job processed only MO26, MC26 and LF26 (every 6 hours, 3 codes), so it landed nothing new after
-- 10-15 06:45Z; rmsothebys.com/upcoming/ lists nine sales and the site's SearchLots API returns rosters for eight (P226 321 lots,
-- ME26 124, LF26 65, MU26 50, S1026 9, AD26 5, PA27 3, S1226 1; 578 lots). A run writes up to 150 lots (limit is a write bound),
-- so P226 takes three entries (offsets 0, 150, 300). Ten entries rotate by hour of day, at minute 45 (off the :00/:30 jobs),
-- each entry about 2-3 times a day. Direct API read through the function (no Firecrawl).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(
  jobid,
  schedule := '45 * * * *',
  command := $job$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-rmsothebys',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || get_service_role_key_for_cron()),
    body := (
      SELECT jsonb_build_object('action', 'process', 'auction', x ->> 'c', 'save_to_db', true, 'limit', 150, 'offset', (x ->> 'o')::int)
      FROM (SELECT (ARRAY[
        '{"c":"LF26","o":0}','{"c":"P226","o":0}','{"c":"ME26","o":0}','{"c":"MU26","o":0}','{"c":"P226","o":150}',
        '{"c":"S1026","o":0}','{"c":"AD26","o":0}','{"c":"P226","o":300}','{"c":"PA27","o":0}','{"c":"S1226","o":0}'
      ]::jsonb[])[1 + (EXTRACT(HOUR FROM now())::int % 10)] AS x) s
    ),
    timeout_milliseconds := 120000
  );
  $job$
) FROM cron.job WHERE jobname = 'rmsothebys-discovery';

COMMIT;
