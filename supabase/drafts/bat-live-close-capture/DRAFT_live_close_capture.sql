-- DRAFT — NOT APPLIED. Needs Skylar's explicit yes before anything here runs.
-- Live BaT end-of-auction capture: measured read-only 2026-11-23 ~4:00 PM PST.
--
-- Evidence (lots that closed in the 30 h before 3 PM PST Nov 23; 270 BaT lots):
--   * 96 of 270 (36%) have their last stored comment more than 30 min before the recorded end; 26 have none.
--   * 1972 MGB (listing/1972-mg-mgb-roadster-34): BaT final bid $7,100 at 22:04Z (soft close ran past the
--     22:00Z end). Nuke: vehicles.high_bid $5,000, end still 22:00Z, 5 of 19 page bids stored, last stored
--     comment 18:27Z.
--   * 2008 Lexus SC430 (listing/2008-lexus-sc430-28): BaT final $19,000 at 21:52Z (end was 21:46Z).
--     Nuke: high_bid $12,500, 11 of 30 bids stored.
--   * bat_live_bid_lag(): 307 of 1,110 live lots have a stored bid behind the board; 270 more than 1 h.
-- Cause, as configured: bat_live_pull_run gives lots closing within 10 min ONE HTML read slot per minute
-- (live_pull.closing_slots = 1, lots_per_run = 8) on the assumption that "the native stream covers them".
-- At BaT's peak (dozens of lots closing in the same hour) one slot per minute cannot re-read each closing lot,
-- and nothing reads a lot again right after its recorded end, so a soft-close extension and the last bids
-- are missed. The Explore board (market_pulse_live) is a snapshot rebuilt every 2 min on top of that.
--
-- Proposed (config only, reversible, no row backfill):

-- 1. More closing-window reads per minute (config row; no schema change).
UPDATE live_auction_sources
SET scraping_config = jsonb_set(jsonb_set(scraping_config,
      '{live_pull,closing_slots}', '6'::jsonb),
      '{live_pull,lots_per_run}', '12'::jsonb)
WHERE slug = 'bat';
-- Revert: closing_slots 1, lots_per_run 8.

-- 2. A post-close read: needs a small change to bat_live_pull_run's cadence CASE so a lot whose recorded
--    end passed less than 15 min ago and has no outcome gets a 1-minute cadence (catches the soft-close
--    extension and the final bid). Draft as a migration after (1) is measured for a day.

-- 3. Enable the disabled catch-up cron created by #3701 (bat-live-bid-catchup, every 10 min, 20 lots):
-- SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'bat-live-bid-catchup'), active := true);

-- 4. Live board rebuild every minute instead of every 2 (build_ms to be checked first):
-- SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'refresh-market-pulse-live'), schedule := '* * * * *');

-- Separate bug found: the board has no currency. listing/1996-ferrari-550-maranello-4 bids in EUR
-- (EUR 23,000 on BaT) and the phone shows "$23,000" under "in US dollars". The board needs a currency
-- column (market_pulse_live_build) before the phone can label it; draft only.
