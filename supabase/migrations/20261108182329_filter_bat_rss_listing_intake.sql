-- BaT's RSS includes editorial posts as well as auction listings. The existing
-- rss_direct_ingest path honors listing_url_regex before invoking vehicle intake.
-- A non-listing post currently hits AI enrichment and backs off the whole feed.
SET statement_timeout = '10s';
SET lock_timeout = '2s';

UPDATE public.listing_feeds
SET search_criteria = search_criteria || jsonb_build_object(
      'listing_url_regex', '^https?://(www[.])?bringatrailer[.]com/listing/[^/?#]+/?$'),
    updated_at = now()
WHERE source_slug = 'bat'
  AND feed_url = 'https://bringatrailer.com/feed/'
  AND search_criteria->>'fetch_strategy' = 'rss_direct_ingest'
  AND NOT (search_criteria ? 'listing_url_regex');
