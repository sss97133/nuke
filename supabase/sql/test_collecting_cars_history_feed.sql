\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_collecting_cars_history_feed%' OR to_regclass('public.listing_feeds') IS NOT NULL THEN RAISE EXCEPTION 'Requires empty disposable history-feed database'; END IF;
END $$;
CREATE TABLE public.listing_feeds(id uuid PRIMARY KEY,source_slug text NOT NULL,display_name text NOT NULL,feed_url text NOT NULL UNIQUE,feed_type text NOT NULL,search_criteria jsonb NOT NULL,enabled boolean NOT NULL,poll_interval_minutes integer NOT NULL);
INSERT INTO public.listing_feeds VALUES('7a39d1a1-cd75-4886-8d37-8148a1409c68','collecting-cars','live','https://collectingcars.com/sitemap.xml','html','{"fetch_strategy":"firecrawl_html","full_capture_interval_minutes":1440}',true,15);
CREATE TEMP TABLE before_live AS SELECT * FROM public.listing_feeds;
\ir ../migrations/20261110042724_collecting_cars_history_feed.sql
DO $$ BEGIN
 IF EXISTS ((SELECT * FROM before_live) EXCEPT (SELECT * FROM public.listing_feeds)) THEN RAISE EXCEPTION 'Live feed changed'; END IF;
 IF (SELECT count(*) FROM public.listing_feeds)<>2 THEN RAISE EXCEPTION 'Unexpected feed population'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.listing_feeds WHERE id='7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24' AND enabled AND poll_interval_minutes=15 AND source_slug='collecting-cars' AND search_criteria @> '{"fetch_strategy":"collecting_cars_history","history_version":1,"history_ceiling_id":94791,"history_after_id":0,"history_capture":null,"history_pass":1,"history_discovery_complete":false}'::jsonb) THEN RAISE EXCEPTION 'Historical cursor initialization mismatch'; END IF;
END $$;
