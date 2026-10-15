-- Craigslist feeds, batch 2: dealer posts 1964-1991 (tier 4) and owner posts of every year (tier 5).
--
-- Measured 2026-10-15 on three metros (one request each, 2 s apart): dealer 1964-99 pages held 151 (sfbay), 69 (new
-- york) and 208 (los angeles) posts of which 3, 0 and 0 were already known; owner all-years pages held 354-360 posts of
-- which 12-47 were known. These are populations the owner feeds (tiers 1-3) never touch. Tiers order the due feeds
-- (poll-listing-feeds/schedule.ts): 1 and 2 first, 3 the rest of 1960-1999, then these. Dealer starts at a 15-minute
-- interval (every third run at */5), all-years at 60 minutes, and each feed's interval then follows its rate of new posts
-- (10 min to 6 h). One row per enabled US metro, same host list as the tier 1-3 feeds.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

INSERT INTO listing_feeds (source_slug, display_name, feed_url, feed_type, search_criteria, enabled, poll_interval_minutes)
SELECT 'craigslist', 'CL T4 dealer - ' || substring(f.feed_url from 'https://([a-z0-9]+)\.craigslist'),
       replace(f.feed_url, 'min_auto_year=1960&max_auto_year=1999&purveyor=owner', 'min_auto_year=1964&max_auto_year=1991&purveyor=dealer'),
       'html',
       jsonb_build_object('type', 'dealer', 'min_year', 1964, 'max_year', 1991, 'fetch_strategy', 'firecrawl_html', 'tier', 4),
       true, 15
FROM listing_feeds f
WHERE f.source_slug = 'craigslist' AND f.enabled
  AND f.feed_url LIKE '%min_auto_year=1960&max_auto_year=1999&purveyor=owner'
ON CONFLICT (feed_url) DO NOTHING;

INSERT INTO listing_feeds (source_slug, display_name, feed_url, feed_type, search_criteria, enabled, poll_interval_minutes)
SELECT 'craigslist', 'CL T5 all years - ' || substring(f.feed_url from 'https://([a-z0-9]+)\.craigslist'),
       replace(f.feed_url, 'min_auto_year=1960&max_auto_year=1999&purveyor=owner', 'purveyor=owner'),
       'html',
       jsonb_build_object('type', 'owner', 'fetch_strategy', 'firecrawl_html', 'tier', 5),
       true, 60
FROM listing_feeds f
WHERE f.source_slug = 'craigslist' AND f.enabled
  AND f.feed_url LIKE '%min_auto_year=1960&max_auto_year=1999&purveyor=owner'
ON CONFLICT (feed_url) DO NOTHING;
