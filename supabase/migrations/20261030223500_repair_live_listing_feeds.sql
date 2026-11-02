-- Repair two measured discovery failures without restarting held source jobs.
-- AutoHunter's publisher notice: https://autohunter.com/Support (read 2026-10-30),
-- no new auction listings accepted; existing links remain an archive. /auctions is 404.
-- Mecum's HTML newest-lots page is a search shell. Its existing public JSON index
-- returns canonical lot permalinks. The regular feed budget and intake remain in force.
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

UPDATE public.listing_feeds
SET enabled = false,
    last_error = 'archive_only: publisher no longer accepts new auction listings; historical links retained',
    search_criteria = coalesce(search_criteria, '{}'::jsonb) || jsonb_build_object(
      'source_status', 'archive_only',
      'source_status_evidence', jsonb_build_object(
        'url', 'https://autohunter.com/Support', 'examined_at', '2026-10-30',
        'seen', 'AutoHunter is no longer accepting new auction listings at this time.',
        'historical_links', 'remain available as archive')),
    updated_at = now()
WHERE id = 'b83e8f12-517d-41e6-8a63-2f62ca28f19d'
  AND source_slug = 'autohunter' AND enabled
  AND feed_url = 'https://www.autohunter.com/auctions';

UPDATE public.listing_feeds
SET search_criteria = coalesce(search_criteria, '{}'::jsonb) || '{"fetch_strategy":"mecum_public_index"}'::jsonb,
    updated_at = now()
WHERE id = '004216ee-9af6-4f3c-a38d-bbda2ccb6a41'
  AND source_slug = 'mecum' AND enabled
  AND feed_url = 'https://www.mecum.com/newest-lots/'
  AND search_criteria->>'fetch_strategy' = 'firecrawl_html';

COMMIT;
