-- Live market intake, after the 02:25Z database outage: three small settings, none of which turns anything on.
--
-- 1. poll-listing-feeds goes back to its pre-2026-10-15 cadence, every 15 minutes (#1293 had moved it to every 5).
--    The job stays as it is: active = false is the lead's pause and this migration does not touch it.
-- 2. The 292 Craigslist feeds that were disabled before today are all non-US metros (no fetch_strategy; Toronto, London,
--    Tokyo ...). The row now says why: scope is US and USD. Measured read-only 2026-10-15: 292 rows, enabled = false,
--    last_error NULL, last_polled_at 2026-06-12 .. 2026-07-01.
-- 3. The vocabulary for "a classified listing ended" needs no new status: vehicle_events.event_status already has
--    `ended` (113,710 rows). The column comment now defines it for classifieds.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'poll-listing-feeds'), schedule := '*/15 * * * *');

UPDATE listing_feeds
SET last_error = 'out of scope: non-US, 2026-10-15'
WHERE source_slug = 'craigslist' AND enabled = false AND last_error IS NULL
  AND NOT (search_criteria ? 'fetch_strategy');

COMMENT ON COLUMN vehicle_events.event_status IS
'Current state of the listing: sold, ended, active, unsold, bid-goes-on, listed, pending (no CHECK). extract-bat-core: sold when a sale price exists, active while the end time is ahead, else ended; ingest_bat_live_events keeps it current during a live BaT lot. For a classified (craigslist): `unknown` while the listing is live and read; `ended` when the listing is gone without an observed sale, with ended_at = the fetch time and metadata.removal = {http_status: 404, observed_at, basis: revisit} as the evidence. `ended` on a classified means withdrawn, expired or sold off-site: outcome unknown, never a sale. It is a state, not a delete: the listing observations stay. Unit: none. Grain: one vehicle listing. Clock: n/a (state as of updated_at).';
