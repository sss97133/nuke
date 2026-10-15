-- bonhams-upcoming-roster: Bonhams' scheduled car sales on the auction calendar (2026-10-16, skylar-b7: not on the public calendar).
-- Hourly at :20 (the calendar read model refreshes at :07 and :37), extract-bonhams-typesense mode upcoming: one request to the
-- search index's auctions collection, one per page of 250 car lots per sale not yet ended (2 s apart), then up to 100 new or not-yet-
-- upcoming lots landed through extract-bonhams land_lots with event_status upcoming, ended_at the run day and metadata auction_name,
-- sale_key, auction_session_days, sale_starts_on, sale_ends_on, sale_location, lot_number, has_reserve, currency and roster_first_seen_at
-- (the first read is kept). One source_census row (house_roster_facet) per run states the car lots the house lists per sale, for
-- the calendar's "N of M lots". 0 credits: the search index is Bonhams' own public one; no lot page, no Firecrawl.
-- Stop rule: select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'bonhams-upcoming-roster'), active := false)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bonhams-upcoming-roster') THEN
    PERFORM cron.schedule('bonhams-upcoming-roster', '20 * * * *', $c$
      SELECT net.http_post(
        url := get_service_url() || '/functions/v1/extract-bonhams-typesense',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || get_service_role_key_for_cron()
        ),
        body := '{"mode": "upcoming"}'::jsonb,
        timeout_milliseconds := 120000
      );
    $c$);
  END IF;
END $job$;
COMMIT;
