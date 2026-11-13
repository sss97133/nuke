\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_collecting_cars_history_supplement%' OR to_regclass('public.listing_feeds') IS NOT NULL THEN RAISE EXCEPTION 'Requires empty disposable supplement database'; END IF;
END $$;
CREATE TABLE public.listing_feeds(id uuid PRIMARY KEY,source_slug text NOT NULL,search_criteria jsonb NOT NULL,enabled boolean NOT NULL,poll_interval_minutes integer NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.listing_feeds(id,source_slug,search_criteria,enabled,poll_interval_minutes) VALUES
 ('7a39d1a1-cd75-4886-8d37-8148a1409c68','collecting-cars','{"fetch_strategy":"firecrawl_html","full_capture_interval_minutes":1440}',true,15),
 ('7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24','collecting-cars','{"fetch_strategy":"collecting_cars_history","history_version":1,"history_ceiling_id":94791,"history_after_id":131,"history_capture":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","read_at":"2026-01-01T00:00:00+00:00"},"history_pass":2,"history_discovery_complete":true}',true,15);
CREATE TEMP TABLE before_supplement AS SELECT * FROM public.listing_feeds;
SET statement_timeout='2s'; SET lock_timeout='1s';
\ir ../migrations/20261110081441_collecting_cars_history_supplement.sql
DO $$ DECLARE config jsonb; BEGIN
 IF current_setting('statement_timeout')<>'2s' OR current_setting('lock_timeout')<>'1s' THEN RAISE EXCEPTION 'Caller budgets changed'; END IF;
 IF EXISTS ((SELECT * FROM before_supplement WHERE id='7a39d1a1-cd75-4886-8d37-8148a1409c68') EXCEPT (SELECT * FROM public.listing_feeds)) THEN RAISE EXCEPTION 'Live feed changed'; END IF;
 SELECT search_criteria INTO config FROM public.listing_feeds WHERE id='7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24';
 IF config-'history_supplement_version'-'history_retained_discovery' IS DISTINCT FROM (SELECT search_criteria FROM before_supplement WHERE id='7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24') THEN RAISE EXCEPTION 'Existing cursor, capture or progress changed'; END IF;
 IF config->'history_supplement_version' IS DISTINCT FROM '1'::jsonb OR config#>>'{history_retained_discovery,version}' IS DISTINCT FROM '1' OR jsonb_array_length(config#>'{history_retained_discovery,urls}') IS DISTINCT FROM 12 THEN RAISE EXCEPTION 'Supplement manifest missing'; END IF;
 IF coalesce(config#>>'{history_retained_discovery,origin_sha256}','') !~ '^[a-f0-9]{64}$' OR config#>>'{history_retained_discovery,discovered_at}' IS NULL OR (config#>>'{history_retained_discovery,discovered_at}')::timestamptz>now() THEN RAISE EXCEPTION 'Discovery provenance invalid'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements_text(config#>'{history_retained_discovery,urls}') u(url) WHERE url !~ '^https://collectingcars\.com/for-sale/[a-zA-Z0-9+-]+$') THEN RAISE EXCEPTION 'Candidate URL invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public.listing_feeds f JOIN before_supplement b USING(id) WHERE (f.enabled,f.poll_interval_minutes,f.source_slug) IS DISTINCT FROM (b.enabled,b.poll_interval_minutes,b.source_slug)) THEN RAISE EXCEPTION 'Operating controls changed'; END IF;
END $$;
-- Reapplying configuration must preserve progress made since its first run.
UPDATE public.listing_feeds SET search_criteria=search_criteria||'{"history_targets_after_id":91798,"history_phase":"targets","history_sitemap_offset":88}'::jsonb WHERE id='7fe152d8-53cb-4bc1-9409-e8f4ebfd7c24';
CREATE TEMP TABLE before_reapply AS SELECT * FROM public.listing_feeds;
\ir ../migrations/20261110081441_collecting_cars_history_supplement.sql
DO $$ BEGIN
 IF EXISTS((SELECT * FROM before_reapply) EXCEPT (SELECT * FROM public.listing_feeds)) OR (SELECT count(*) FROM public.listing_feeds)<>2 THEN RAISE EXCEPTION 'Reapplication changed progress or feed population'; END IF;
END $$;
