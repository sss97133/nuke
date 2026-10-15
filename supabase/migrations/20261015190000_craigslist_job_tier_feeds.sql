-- Craigslist gets its own job, tier feeds, and a yield-driven schedule.
--
-- Measured 2026-10-15: one 110 s run of the shared poller makes about 55 requests at one per 2 s; every 15 minutes
-- that is 5,000 a day against 43,000 a polite site allows. 93% of the URLs on a search page are known; sfbay alone has
-- 106 unseen posts on its first owner page. Pages 2 and 3 are the same page (the paging parameter is ignored).
--
-- 1. listing_feeds.new_rate_per_hour and last_new_count: the yield of each poll (new posts on the page), so a feed's
--    poll_interval_minutes follows its rate of new posts (poll-listing-feeds/schedule.ts: 10 minutes to 6 hours).
-- 2. Tier feeds, one per enabled US Craigslist metro: tier 1 = private party 1964-1973, tier 2 = private party
--    1974-1991. The existing 1960-1999 owner feeds become tier 3 (the rest of the range). Lower tiers are selected first.
--    Dealer posts and 1992+ come later, in batches, once yield is measured.
-- 3. A Craigslist-only job, poll-craigslist, every 10 minutes (the owner's tier order, one site, one pacing clock), and
--    the general job leaves Craigslist out. Each Craigslist run starts with the removal sweep (12 posts, a 404 or a
--    notice page ends the listing) and then polls feeds with what is left. A 403/429 stops the run and backs the feed off
--    (existing intake_backoff). After two hours with no block the cadence goes to */5.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE listing_feeds ADD COLUMN IF NOT EXISTS new_rate_per_hour numeric;
ALTER TABLE listing_feeds ADD COLUMN IF NOT EXISTS last_new_count integer;
COMMENT ON COLUMN listing_feeds.new_rate_per_hour IS
  'Smoothed rate of new posts per hour seen on this feed''s search page (exponential average, 0.4 weight on the latest poll). Written by poll-listing-feeds for Craigslist; drives poll_interval_minutes (10 min .. 6 h). Unit: posts per hour. NULL before the first yield reading.';
COMMENT ON COLUMN listing_feeds.last_new_count IS
  'Posts on the search page at the last poll that were not yet known (new to import_queue and vehicles). Written by poll-listing-feeds for Craigslist. Unit: posts.';

-- Tier 3: the existing owner 1960-1999 feeds.
UPDATE listing_feeds
SET search_criteria = search_criteria || '{"tier": 3}'::jsonb
WHERE source_slug = 'craigslist' AND enabled
  AND feed_url LIKE '%min_auto_year=1960&max_auto_year=1999&purveyor=owner';

-- Tiers 1 and 2: the same metros, narrower year ranges.
INSERT INTO listing_feeds (source_slug, display_name, feed_url, feed_type, search_criteria, enabled, poll_interval_minutes)
SELECT 'craigslist', 'CL T' || t.tier || ' - ' || substring(f.feed_url from 'https://([a-z0-9]+)\.craigslist'),
       replace(f.feed_url, 'min_auto_year=1960&max_auto_year=1999', 'min_auto_year=' || t.lo || '&max_auto_year=' || t.hi),
       'html',
       jsonb_build_object('type', 'owner', 'min_year', t.lo, 'max_year', t.hi, 'fetch_strategy', 'firecrawl_html', 'tier', t.tier),
       true, 10
FROM listing_feeds f
CROSS JOIN (VALUES (1, 1964, 1973), (2, 1974, 1991)) AS t(tier, lo, hi)
WHERE f.source_slug = 'craigslist' AND f.enabled
  AND f.feed_url LIKE '%min_auto_year=1960&max_auto_year=1999&purveyor=owner'
ON CONFLICT (feed_url) DO NOTHING;

-- The Craigslist-only job, every 10 minutes.
SELECT cron.schedule('poll-craigslist', '*/10 * * * *', $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/poll-listing-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"source": "craigslist", "batch_size": 100}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$);

-- The general job leaves Craigslist to it.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'poll-listing-feeds'), command := $cmd$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/poll-listing-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"batch_size": 40, "exclude_source": "craigslist"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$);
