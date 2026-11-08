\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_purplewave%' OR to_regclass('public.observation_sources') IS NOT NULL THEN
  RAISE EXCEPTION 'Requires empty disposable PurpleWave contract database';
 END IF;
END $$;
CREATE TYPE public.observation_kind AS ENUM ('listing');
CREATE TYPE public.source_species AS ENUM ('timed_auction');
CREATE TABLE public.observation_sources(slug text PRIMARY KEY, display_name text, category text, base_url text,
 base_trust_score numeric, supported_observations observation_kind[], requires_auth boolean, notes text,
 species source_species, species_set source_species[], species_evidence jsonb);
CREATE TABLE public.listing_feeds(id uuid PRIMARY KEY,source_slug text,feed_url text,search_criteria jsonb,
 enabled boolean,poll_interval_minutes int,updated_at timestamptz);
CREATE TABLE public.live_board_houses(house text PRIMARY KEY,label text,host_pattern text,enabled boolean,note text);
INSERT INTO listing_feeds VALUES('2b413532-64b4-4756-9840-7ec8ffd45f6e','purplewave','https://www.purplewave.com/search',
 '{"fetch_strategy":"firecrawl_html","unrelated":"keep"}',false,60,now());
\ir ../migrations/20261108191000_purplewave_native_snapshots.sql
UPDATE listing_feeds SET search_criteria=search_criteria || '{"native_page":3,"native_offset":4}';
\ir ../migrations/20261108191000_purplewave_native_snapshots.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM observation_sources WHERE slug='purplewave' AND species='timed_auction'
   AND supported_observations=ARRAY['listing']::observation_kind[] AND jsonb_array_length(species_evidence->'examined')=2)
 THEN RAISE EXCEPTION 'Native source species/observation contract missing'; END IF;
 IF NOT EXISTS(SELECT FROM listing_feeds WHERE enabled=false AND poll_interval_minutes=60
   AND search_criteria->>'fetch_strategy'='purplewave_public_json' AND search_criteria->>'unrelated'='keep'
   AND search_criteria->>'native_page'='3' AND search_criteria->>'native_offset'='4')
 THEN RAISE EXCEPTION 'Feed hold, cadence, cursor or unrelated settings changed'; END IF;
END $$;
