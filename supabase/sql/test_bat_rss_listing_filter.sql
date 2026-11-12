\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_bat_rss_listing%' OR to_regclass('public.listing_feeds') IS NOT NULL THEN
   RAISE EXCEPTION 'Requires empty disposable RSS filter database';
 END IF;
END $$;
CREATE TABLE public.listing_feeds(id integer PRIMARY KEY,source_slug text,feed_url text,search_criteria jsonb,updated_at timestamptz);
INSERT INTO public.listing_feeds VALUES
 (1,'bat','https://bringatrailer.com/feed/','{"fetch_strategy":"rss_direct_ingest","keep":true}',now()),
 (2,'bat','https://bringatrailer.com/feed/','{"fetch_strategy":"rss_direct_ingest","listing_url_regex":"existing"}',now()),
 (3,'other','https://other.example/feed/','{"fetch_strategy":"rss_direct_ingest"}',now());
\ir ../migrations/20261108182329_filter_bat_rss_listing_intake.sql
\ir ../migrations/20261108182329_filter_bat_rss_listing_intake.sql
DO $$ DECLARE pattern text; BEGIN
 SELECT search_criteria->>'listing_url_regex' INTO pattern FROM listing_feeds WHERE id=1;
 IF pattern IS NULL OR NOT ('https://bringatrailer.com/listing/1969-chevrolet-c20-pickup-22-2' ~* pattern)
 OR NOT ('https://www.bringatrailer.com/listing/2001-mercedes-benz-sl500-192/' ~* pattern)
 OR 'https://bringatrailer.com/2026/11/08/yesterdays-comments-of-note-2626' ~* pattern
 OR 'https://bringatrailer.com/listing/' ~* pattern
 OR 'https://bringatrailer.com.evil.example/listing/car' ~* pattern THEN
   RAISE EXCEPTION 'Listing-only filter failed source examples';
 END IF;
 IF (SELECT search_criteria->>'keep' FROM listing_feeds WHERE id=1) <> 'true'
 OR (SELECT search_criteria->>'listing_url_regex' FROM listing_feeds WHERE id=2) <> 'existing'
 OR (SELECT search_criteria ? 'listing_url_regex' FROM listing_feeds WHERE id=3) THEN
   RAISE EXCEPTION 'Existing config or other source changed';
 END IF;
 RAISE NOTICE 'PASS: listing examples, editorial refusal, source scope and idempotent configuration';
END $$;
