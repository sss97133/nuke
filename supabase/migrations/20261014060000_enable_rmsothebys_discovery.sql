-- Enable cron job 450 (rmsothebys-discovery) on the three RM Sotheby's auctions not yet read: MO26, MC26 and LF26.
--
-- WHAT. Job 450 has been paused since 2026-04-25. Its command cycled PA26, AZ26, CC26, MI26 and S0226 by day of week;
-- all five are ingested. RM's lot API lists three auctions that are not: MO26 (Monterey, 13-15 Aug 2026, 199 lots), MC26
-- (Monaco, 25 Apr 2026, 77 lots) and LF26 (London, 31 Oct 2026, not yet held, 65 lots). The command now cycles those, one
-- auction per run. Through the cron API (cron.alter_job): the deploy role may call it but not write cron.job.
--
-- ORDER. Merge only after the extract-rmsothebys PR has been merged and its deploy has finished. CI applies migrations
-- BEFORE it deploys changed functions, so this migration in the same push would run the OLD function, which reads every
-- lot twice, writes automobilia as vehicles and writes a second vehicle for each of the 37 feed-written MO26 lots. Check
-- first, with a dry run that writes nothing (service key from the environment):
--   {"action":"process","auction":"LF26","save_to_db":false}  ->  total_lots 65, api_reported_total 65, duplicates_dropped 0,
--   vehicle_lots 61, skipped 4. A response without those keys is the old function: do not merge this.
--
-- VAULT. The command authenticates with get_service_role_key_for_cron(), which reads the key from public._app_secrets. The leaked
-- service-role key is being turned off and the vault given the new one. Until the vault holds a key the functions accept,
-- every run of this job is refused with 401 by requireWriteAuth and lands nothing. Check before merging, read-only (Logs
-- Explorer, last 2 hours): job 419 poll-listing-feeds runs every 15 minutes through the same function and must show only 200s.
--   select log_attributes['response.status_code'] as status, count(*) from logs where source = 'function_edge_logs'
--     and log_attributes['request.pathname'] = '/functions/v1/poll-listing-feeds' group by 1;     -- 200 only, no 401
--
-- BOUND. 4 runs a day, 00:45 / 06:45 / 12:45 / 18:45 UTC = MO26 / MC26 / LF26 / MO26 (the hour picks the code). A run reads
-- one auction (one lot-API call to rmsothebys.com, one page of at most 200) and writes at most `limit` 200 vehicle lots; the
-- largest, MO26, has 192. No Firecrawl, no AI, no other host. The existing schedule '45 */6 * * *' is kept.
-- DURATION. extract-rmsothebys writes 4 lots at once since #1124 (request field concurrency). Replayed through the real handler
-- against prod's mean statement times (vehicle insert 150 ms, vehicle_images insert 450 ms, resolver ILIKE miss 120 ms): the
-- first MO26 pass takes 33 s (127 s one lot at a time, too close to an edge function limit of 150 s), the first MC26 and LF26
-- passes 13 s each, and the re-run of MO26 6 s. Without #1124 the first MO26 run is the one that would be cut off.
--
-- BEFORE (2026-10-14, scripts/data/q.sh): vehicles under each code's listing_url prefix
--   select substring(listing_url from 'auctions/([a-z0-9]+)/') as code, count(*) from vehicles
--    where listing_url >= 'https://rmsothebys.com/auctions/' and listing_url < 'https://rmsothebys.com/auctiont'
--      and listing_url like 'https://rmsothebys.com/auctions/%' group by 1 order by 2 desc;
--   mo26 39 (38 written by a listing feed on 2026-07-13, 1 by the extractor), mc26 0, lf26 0; 1,230 under /auctions/ in all.
--
-- EXPECTED AFTER the first run of each code (RM's lists read 2026-10-14; the rule is lotKind.ts in extract-rmsothebys):
--   code  lots  written  created  found+updated  skipped (automobilia unless noted)
--   mo26   199     192      154         38          7  (6 automobilia, 1 two-car lot)
--   mc26    77      57       57          0         20  (19 automobilia, 1 boat)
--   lf26    65      61       61          0          4  (status upcoming: the sale is 31 Oct)
--   vehicles under the prefixes: mo26 39 -> 193, mc26 0 -> 57, lf26 0 -> 61; under /auctions/ 1,230 -> 1,502.
--   Day one: 272 vehicles created; vehicle_events +310, all source_platform 'rm-sothebys' (192 MO26: 154 created + 37 feed
--   vehicles that had none + the lot written on 2026-10-10, whose event sits under the old label 'rmsothebys'; 57; 61);
--   timeline_events +218 auction_sold (169 MO26, 49 MC26). Day two on: 0 created; the four runs update 192, 57, 61, 192.
--   (Replayed through the real handler against a fake database holding prod's 39 existing MO26 rows: 154 vehicles inserted,
--   38 updated, 192 events inserted, 154 images, 169 timeline rows; then the three passes together give 272, 310, 218.)
--   Of MO26's 192, 173 are sold (169 with a price, 4 price withheld by RM) and 19 unsold; MC26's 57: 50 sold (49 priced).
--
-- STOP RULE. Pause (select cron.alter_job(job_id := 450, active := false)) on any of, checked after each of the first two
-- runs and daily after (all read-only; the first four were timed on production on 2026-10-14, 0.5 to 3 s):
--   1. a new vehicle with a null year or make:
--        select count(*) from vehicles where profile_origin = 'rmsothebys_import' and created_at > '<migration time>'
--         and (year is null or make is null);                                                              -- 0
--   2. a new vehicle whose listing_url is not under https://rmsothebys.com/auctions/:
--        select count(*) from vehicles where discovery_source = 'rmsothebys' and created_at > '<migration time>'
--         and (listing_url is null or listing_url not like 'https://rmsothebys.com/auctions/%');           -- 0
--   3. a sold lot with a null sale day:
--        with v as materialized (select id from vehicles where listing_url >= 'https://rmsothebys.com/auctions/'
--          and listing_url < 'https://rmsothebys.com/auctiont' and listing_url like 'https://rmsothebys.com/auctions/%')
--        select count(*) from vehicle_events ve join v on v.id = ve.vehicle_id
--         where ve.source_platform = 'rm-sothebys' and ve.event_status = 'sold' and ve.sold_at is null;    -- 0
--        (0 today over 1,145 events, 1.3 s. The one lot written on 2026-10-10, before MO26 had a sale day, has its event
--        under the old label 'rmsothebys' with sold_at NULL; this job writes a correct one under 'rm-sothebys'.)
--   4. a lot written twice: select count(*) from (select regexp_replace(listing_url, '/+$', '') from vehicles
--        where listing_url >= 'https://rmsothebys.com/auctions/' and listing_url < 'https://rmsothebys.com/auctiont'
--          and listing_url like 'https://rmsothebys.com/auctions/mo26/%' group by 1 having count(*) > 1) d;      -- 0
--   5. the run's own report, from pg_net (kept about 6 hours):
--        select id, status_code, left(content::text, 600) from net._http_response order by id desc limit 3;
--      pause if errors > 0, if duplicates_dropped > 0, if api_reported_total <> total_lots, or if there is no response
--      (a run killed by the platform's time limit; the writes are idempotent and the next run finishes them, but halve
--      `limit` before enabling it again).
--   Also watch vehicle_completion_recompute_queue: pause if it grows by more than 5,000 an hour.
-- PAUSE AGAIN once each code has run twice: after two days MC26 and LF26 have run twice and MO26 four times.
-- One run is still owed after 2026-10-31: LF26's lots go from upcoming to sold or unsold at the sale. Run LF26 once more
-- on 2026-11-01 (re-enable, or {"action":"process","auction":"LF26","save_to_db":true,"limit":200} by hand).
--
-- DECIDED (lead, 2026-10-14). RM events are written as 'rm-sothebys', the observation_sources slug and the label of the 2,474
-- older RM events (20261007031500 had left the spelling open); #1124 does it with one constant and a test, so this job lands
-- nothing under 'rmsothebys'. One stale pair remains for a supersession: the event (sold, sold_at NULL) and the timeline row
-- dated 2026-10-10, the extraction day, of the lot written on 2026-10-10. Ids are in ~/nuke-logs/intake-free-sources-20261014/
-- rm-non-vehicle-ids.txt, with the 81 existing RM rows that lack a year or make and 42 more that RM itself lists as not vehicles.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(
  job_id   := 450,
  schedule := '45 */6 * * *',
  command  := $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/extract-rmsothebys',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := jsonb_build_object(
      'action', 'process',
      'auction', (ARRAY['MO26','MC26','LF26'])[1 + ((EXTRACT(HOUR FROM now())::int / 6) % 3)],
      'save_to_db', true,
      'limit', 200,
      'offset', 0
    ),
    timeout_milliseconds := 120000
  );
  $cmd$,
  active   := true
);

DO $check$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
     WHERE jobid = 450 AND jobname = 'rmsothebys-discovery' AND active AND schedule = '45 */6 * * *'
       AND command LIKE '%''MO26'',''MC26'',''LF26''%'
       AND command LIKE '%''limit'', 200%'
       AND command LIKE '%''save_to_db'', true%'
  ) THEN
    RAISE EXCEPTION 'cron job 450 rmsothebys-discovery was not enabled on MO26, MC26 and LF26';
  END IF;
END $check$;

COMMIT;
