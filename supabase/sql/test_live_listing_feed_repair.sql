\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database only'; END IF;
END $$;
CREATE TABLE public.listing_feeds (
 id uuid PRIMARY KEY, source_slug text, enabled boolean, feed_url text,
 search_criteria jsonb, last_error text, error_count integer, updated_at timestamptz
);
INSERT INTO public.listing_feeds VALUES
 ('b83e8f12-517d-41e6-8a63-2f62ca28f19d','autohunter',true,'https://www.autohunter.com/auctions','{"fetch_strategy":"firecrawl_html","other":"preserve"}','HTTP404',436,now()),
 ('004216ee-9af6-4f3c-a38d-bbda2ccb6a41','mecum',true,'https://www.mecum.com/newest-lots/','{"fetch_strategy":"firecrawl_html","other":"preserve"}','parsed_zero',289,now()),
 ('00000000-0000-0000-0000-000000000001','held-source',false,'https://held.invalid','{}','held',2,now());
\ir ../migrations/20261030223500_repair_live_listing_feeds.sql
-- Re-applying must be harmless and retain historical error counters/config.
\ir ../migrations/20261030223500_repair_live_listing_feeds.sql
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.listing_feeds WHERE source_slug='autohunter' AND NOT enabled AND error_count=436
   AND search_criteria->>'source_status'='archive_only' AND search_criteria->>'other'='preserve'
   AND search_criteria->'source_status_evidence'->>'url'='https://autohunter.com/Support') THEN
   RAISE EXCEPTION 'archive-only source did not retain its status evidence and config'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.listing_feeds WHERE source_slug='mecum' AND enabled AND error_count=289
   AND search_criteria->>'fetch_strategy'='mecum_public_index' AND search_criteria->>'other'='preserve'
   AND last_error='parsed_zero') THEN RAISE EXCEPTION 'native strategy did not preserve feed history'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.listing_feeds WHERE source_slug='held-source' AND NOT enabled AND last_error='held') THEN
   RAISE EXCEPTION 'unrelated hold changed'; END IF;
END $$;
