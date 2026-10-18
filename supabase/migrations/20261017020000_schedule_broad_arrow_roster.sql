-- broad-arrow-roster: Broad Arrow's upcoming sales on the auction calendar (2026-10-16, skylar-b7: not on the public calendar).
-- Hourly at :22 (the calendar read model refreshes at :07 and :37), extract-broad-arrow action roster: the site's own public pages by
-- plain fetch, 2 s apart (the /vehicles listing pages, then one event page per sale), no Firecrawl, 0 credits. Up to 40 lots not yet
-- landed as upcoming are landed per run (event_status upcoming, ended_at the run day, metadata auction_name, sale_key, auction_session_days,
-- sale_starts_on, sale_ends_on, sale_location, lot_number, currency, roster_first_seen_at kept from the first read); one source_census
-- row (house_roster_facet) per run states the vehicle cards listed per sale for the calendar's "N of M lots".
-- Stop rule: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'broad-arrow-roster'), active := false)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'broad-arrow-roster') THEN
    PERFORM cron.schedule('broad-arrow-roster', '22 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-broad-arrow',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_service_role_key_for_cron()
        ),
        body := '{"action": "roster"}'::jsonb,
        timeout_milliseconds := 120000
      );
    $c$);
  END IF;
END $job$;
COMMIT;
