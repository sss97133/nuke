-- Live market intake, Craigslist: raise the controlled throttle and declare the channel.
--
-- Measured read-only 2026-10-15 00:40Z: poll-listing-feeds (pg_cron `poll-listing-feeds`, */15, batch_size 40) landed
-- 394 (10-13) and 568 (10-14) Craigslist listing events a day. The control row platform_config.source_intake did not
-- exist, so intakeThrottle() ran on its defaults (20 ingests per invocation, all sources). The latest run discovered
-- 263 listing URLs on one metro page, knew 241, ingested 20, and deferred the remaining feeds with reason
-- `invocation_limit`: the cap, not the supply, set the rate (96 runs x 20 = 1,920 ingests a day at most, shared).
--
-- This sets the control row: 40 ingests per invocation, Craigslist capped at 40. The worker spaces Craigslist ingests
-- 2 s apart (index.ts), so 40 ingests fit the 110 s invocation budget at one request per 2 s. The function still backs
-- off a source on 403/429 (`intake_backoff`). Turn it off with {"enabled": false} or lower max_ingests.
--
-- It also writes the Craigslist declaration the data-machine rules ask for (channels, markets, enumeration, capture
-- depth, revisit) on its observation_sources row, the registry the source owners already read.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

INSERT INTO platform_config (config_key, config_value, description)
VALUES (
  'source_intake',
  '{"enabled": true, "max_feeds": 40, "max_ingests": 40, "sources": {"craigslist": {"enabled": true, "max_ingests": 40}}}'::jsonb,
  'Controlled throttle for poll-listing-feeds, per invocation (pg_cron every 15 min): feeds polled, ingests attempted, per-source caps. Missing row means defaults of 40 feeds and 20 ingests.'
)
ON CONFLICT (config_key) DO UPDATE
SET config_value = EXCLUDED.config_value, description = EXCLUDED.description, updated_at = now();

UPDATE observation_sources
SET rate_limit_per_hour = 1800,
    regions_covered = ARRAY['US'],
    years_covered = '[1960,2000)',
    trust_factors = trust_factors || jsonb_build_object('collection', jsonb_build_object(
      'declared_on', '2026-10-15',
      'channel', 'craigslist for-sale cars and trucks, owner posts (purveyor=owner), search pages per metro',
      'markets', 'one listing_feeds row per craigslist metro (708 rows, 416 enabled on 2026-10-15), model years 1960-1999',
      'not_collected', 'dealer posts, model years outside 1960-1999, metros with a disabled feed',
      'enumeration', 'listing_feeds.feed_url search page, first page of results; keys are the /view/d/ share URLs found there; no pagination',
      'depth', 'ingest fetches the post page: price, odometer, attributes, place, photos, post and update times; vehicle_events listing episode',
      'revisit', 'a landed listing still on a search page is asked again after 24 h (poll-listing-feeds CRAIGSLIST_REVISIT, 5 per feed page); a listing that leaves the page is not yet marked removed',
      'runner', 'pg_cron poll-listing-feeds every 15 min, throttle platform_config source_intake',
      'pacing', 'one request per 2 s; back off on 403/429'
    )),
    updated_at = now()
WHERE slug = 'craigslist';
