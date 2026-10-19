-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_source_species -f this-file.sql
-- Contract for 20261019050000_source_species.sql, on top of the Sources board contract's synthetic sources and readers
-- (test_market_sources_board.sql). Synthetic rows only; never production.
--   * the migration applies twice;
--   * every source holding data on the board gets the species data-machine-cases.md §6 gives it, with its evidence;
--     Craigslist and KSL are classifieds in kind as well as species; Hemmings and Classic.com are aggregators;
--   * a species without evidence is refused;
--   * source_species_gaps() is empty once labelled and names a new source holding data with no species, and a forum
--     with observations and no species;
--   * a listing takes its own species from its URL or metadata, else its source's;
--   * market_sources_read() groups the board by species in the doc's order with the doc's names, lists aggregators
--     apart as not listings held, keeps them out of the board totals, and counts capture channels and unlabelled
--     sources in not_ranked.
\ir test_market_sources_board.sql

-- what the migration reads beyond the board contract's tables, with their live types (2026-10-18)
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid, kind text);
ALTER TABLE public.vehicle_events ADD COLUMN source_url text, ADD COLUMN metadata jsonb;
ALTER TABLE public.observation_sources ADD COLUMN notes text, ADD COLUMN updated_at timestamptz DEFAULT now();
INSERT INTO public.observation_sources (slug, display_name, category, created_at) VALUES
  ('hagerty-marketplace', 'Hagerty Marketplace', 'marketplace', '2025-01-01'),
  ('barnfinds', 'Barn Finds', 'marketplace', '2025-01-01'),
  ('ebay_motors', 'eBay Motors', 'marketplace', '2025-01-01'),
  ('nuke-marketplace', 'Nuke Live Floor', 'marketplace', '2025-01-01');

\ir ../migrations/20261019050000_source_species.sql
\ir ../migrations/20261019050000_source_species.sql

SELECT pg_temp.ok('every source on the board has a species, a species set holding it, and evidence',
  NOT EXISTS (SELECT 1 FROM public.market_source_days d JOIN public.observation_sources o ON o.slug = d.source_slug
              WHERE o.species IS NULL OR NOT o.species = ANY (o.species_set)
                 OR jsonb_array_length(o.species_evidence -> 'examined') = 0 OR o.species_evidence ->> 'seen' = ''));
SELECT pg_temp.ok('the doc''s assignments: timed, block houses, dealer sites, classifieds, auth-walled, aggregators',
  (SELECT jsonb_object_agg(slug, species) FROM public.observation_sources WHERE species IS NOT NULL) @> '{
     "bat": "timed_auction", "cars-and-bids": "timed_auction", "pcarmarket": "timed_auction",
     "hagerty-marketplace": "timed_auction",
     "mecum": "block_house", "bonhams": "block_house", "gooding": "block_house", "rm-sothebys": "block_house",
     "gaa-classic-cars": "block_house",
     "streetside-classics": "dealer",
     "craigslist": "classifieds", "ksl": "classifieds",
     "facebook_marketplace": "auth_walled_marketplace", "facebook-saved": "auth_walled_marketplace",
     "ebay_motors": "auth_walled_marketplace",
     "hemmings": "aggregator", "classic-com": "aggregator", "jamesedition": "aggregator", "barnfinds": "aggregator"}'::jsonb);
SELECT pg_temp.ok('craigslist and KSL are classifieds in kind too; the aggregators and Hagerty follow their species',
  (SELECT jsonb_object_agg(slug, category) FROM public.observation_sources) @> '{
     "craigslist": "classifieds", "ksl": "classifieds", "hemmings": "aggregator", "classic-com": "aggregator",
     "barnfinds": "aggregator", "hagerty-marketplace": "auction", "facebook_marketplace": "marketplace",
     "nuke-marketplace": "internal"}'::jsonb);
SELECT pg_temp.ok('a source with more than one species carries the set: Hagerty timed and classifieds, Barn Finds a curator with its own ads',
  (SELECT species_set::text[] = ARRAY['timed_auction', 'classifieds'] FROM public.observation_sources WHERE slug = 'hagerty-marketplace')
  AND (SELECT species_set::text[] = ARRAY['aggregator', 'classifieds'] FROM public.observation_sources WHERE slug = 'barnfinds'));
SELECT pg_temp.ok('evidence names what was examined, what it showed, the day, and the doc''s assignment where it has one',
  (SELECT species_evidence ->> 'examined_at' = '2026-10-18'
          AND species_evidence ->> 'seen' LIKE '%post id: 7985432409%'
          AND species_evidence ->> 'doc' LIKE '%§6 names it under Classifieds'
          AND species_evidence -> 'examined' ->> 0 LIKE 'listing_page_snapshots craigslist https://%'
   FROM public.observation_sources WHERE slug = 'craigslist')
  AND (SELECT species_evidence ->> 'listing_rule' LIKE '%bf-exclusive%' FROM public.observation_sources WHERE slug = 'barnfinds'));
SELECT pg_temp.ok('a source with nothing held keeps no species: unknown, not a guess',
  (SELECT species IS NULL AND species_evidence IS NULL FROM public.observation_sources WHERE slug = 'nothing-yet'));

SELECT pg_temp.fails('a species without evidence is refused',
  $s$UPDATE public.observation_sources SET species = 'dealer', species_set = '{dealer}', species_evidence = '{}'
     WHERE slug = 'nothing-yet'$s$);
SELECT pg_temp.fails('a species outside its own set is refused',
  $s$UPDATE public.observation_sources SET species = 'dealer' WHERE slug = 'craigslist'$s$);
SELECT pg_temp.fails('evidence without a day is refused',
  $s$UPDATE public.observation_sources SET species_evidence = species_evidence - 'examined_at' WHERE slug = 'craigslist'$s$);
SELECT pg_temp.fails('a species with no evidence at all is refused',
  $s$UPDATE public.observation_sources SET species_evidence = NULL WHERE slug = 'craigslist'$s$);

SELECT pg_temp.ok('no source holding data lacks a species once labelled', NOT EXISTS (SELECT 1 FROM public.source_species_gaps()));
INSERT INTO public.observation_sources (slug, display_name, category, created_at) VALUES
  ('new-venue', 'New Venue', 'auction', '2025-01-01'), ('some-forum', 'Some Forum', 'forum', '2025-01-01'),
  ('some-registry', 'Some Registry', 'registry', '2025-01-01');
INSERT INTO public.market_source_days (day, source_slug, display_name, landed_lots)
VALUES ((SELECT max(day) FROM public.market_source_days), 'new-venue', 'New Venue', 12);
INSERT INTO public.vehicle_observations (source_id, kind)
SELECT id, 'comment' FROM public.observation_sources WHERE slug IN ('some-forum', 'some-registry');
SELECT pg_temp.ok('a new source holding data and a forum with observations, both unlabelled, are the gaps; a registry is not asked',
  (SELECT array_agg(slug || ':' || holds ORDER BY slug) FROM public.source_species_gaps())
    = ARRAY['new-venue:held lots on the Sources board', 'some-forum:observations']);
SET ROLE anon;
SELECT pg_temp.fails('anon cannot run the gap check', $s$SELECT * FROM public.source_species_gaps()$s$);
RESET ROLE;

SELECT pg_temp.ok('a listing''s own evidence: Hagerty auction lot, Barn Finds ad and pointer post, eBay classified ad, BaT URL',
  public.listing_species_from_evidence('hagerty-marketplace', 'https://www.hagerty.com/marketplace/auction/1968-Ford-Mustang/1', NULL) = 'timed_auction'
  AND public.listing_species_from_evidence('barnfinds', 'https://barnfinds.com/bf-exclusive-1993-jeep-wrangler-renegade', NULL) = 'classifieds'
  AND public.listing_species_from_evidence('barnfinds', 'https://barnfinds.com/wrx-powered-1955-porsche-550-replica', NULL) = 'aggregator'
  AND public.listing_species_from_evidence('ebay_motors', 'https://www.ebay.com/itm/1', '{"buying_options": ["CLASSIFIED_AD"]}') = 'classifieds'
  AND public.listing_species_from_evidence('ebay_motors', 'https://www.ebay.com/itm/2', '{"buying_options": ["AUCTION"]}') IS NULL
  AND public.listing_species_from_evidence('hagerty-marketplace', 'https://bringatrailer.com/listing/1954-mg-tf-40/', NULL) = 'timed_auction'
  AND public.listing_species_from_evidence('hemmings', 'https://www.hemmings.com/classifieds/listing/x-1', NULL) IS NULL);
INSERT INTO public.vehicle_events (source_platform, source_url, metadata, created_at) VALUES
  ('hagerty', 'https://www.hagerty.com/marketplace/auction/1968-Ford-Mustang/1', NULL, now() - interval '3 days'),
  ('ebay_motors', 'https://www.ebay.com/itm/1', '{"buying_options": ["CLASSIFIED_AD"]}', now() - interval '3 days'),
  ('ebay_motors', 'https://www.ebay.com/itm/2', '{"buying_options": ["AUCTION"]}', now() - interval '3 days'),
  ('www.oldcaronline.com', 'https://www.oldcaronline.com/x-IDf1.htm', NULL, now() - interval '3 days');
SELECT pg_temp.ok('v_listing_species: own species where the listing shows it, the source''s otherwise, unknown when unlabelled',
  (SELECT array_agg(coalesce(source_slug, '-') || ':' || coalesce(species::text, '-') || ':' || species_basis ORDER BY source_url)
   FROM public.v_listing_species WHERE source_url IS NOT NULL)
    = ARRAY['ebay_motors:classifieds:listing', 'ebay_motors:auth_walled_marketplace:source_primary',
            'hagerty-marketplace:timed_auction:listing', '-:-:unknown']);
SELECT pg_temp.ok('the listing view runs as its caller and only service_role reads it',
  (SELECT reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid = 'public.v_listing_species'::regclass)
  AND NOT has_table_privilege('anon', 'public.v_listing_species', 'select')
  AND has_table_privilege('service_role', 'public.v_listing_species', 'select'));

SET ROLE anon;
DO $$
DECLARE b jsonb := public.market_sources_read();
  cols jsonb := b -> 'columns';
  sp int; lb int; ch int; ev int;
  r jsonb;
  seq text[];
BEGIN
  SELECT i - 1 INTO sp FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'species';
  SELECT i - 1 INTO lb FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'species_label';
  SELECT i - 1 INTO ch FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'counts_as_held';
  SELECT i - 1 INTO ev FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'species_evidence';
  PERFORM pg_temp.ok('the board keeps its columns and appends species, label, counts_as_held and evidence',
    cols ->> 27 = 'population_grade' AND sp = 28 AND lb = 29 AND ch = 30 AND ev = 31 AND jsonb_array_length(cols) = 32);
  PERFORM pg_temp.ok('the groups, in the doc''s order with its names and what each counts',
    (SELECT array_agg(g ->> 'label' ORDER BY o) FROM jsonb_array_elements(b -> 'species_groups') WITH ORDINALITY x(g, o))
      = ARRAY['Timed with soft close', 'Block houses', 'Dealer sites', 'Classifieds', 'Auth-walled marketplaces', 'Aggregators']
    AND (SELECT g ->> 'unit' = 'pages read, not listings held' AND g -> 'counts_as_held' = 'false'::jsonb
         FROM jsonb_array_elements(b -> 'species_groups') g WHERE g ->> 'species' = 'aggregator'));
  SELECT array_agg(x ->> sp ORDER BY o) INTO seq FROM jsonb_array_elements(b -> 'rows') WITH ORDINALITY e(x, o);
  PERFORM pg_temp.ok('rows run species by species in that order',
    (SELECT array_agg(DISTINCT s) FROM unnest(seq) s)
      = (SELECT array_agg(DISTINCT s) FROM unnest(ARRAY['timed_auction', 'block_house', 'dealer', 'classifieds',
                                                         'auth_walled_marketplace', 'aggregator']) s)
    AND seq = (SELECT array_agg(s ORDER BY array_position(ARRAY['timed_auction', 'block_house', 'dealer', 'classifieds',
                                                               'auth_walled_marketplace', 'aggregator'], s), o)
               FROM unnest(seq) WITH ORDINALITY u(s, o)));
  PERFORM pg_temp.ok('within a species, by held lots: Craigslist then KSL; Mecum heads the block houses',
    (SELECT array_agg(x ->> 0 ORDER BY o) FROM jsonb_array_elements(b -> 'rows') WITH ORDINALITY e(x, o) WHERE x ->> sp = 'classifieds')
      = ARRAY['craigslist', 'ksl']
    AND (SELECT x ->> 0 FROM jsonb_array_elements(b -> 'rows') WITH ORDINALITY e(x, o) WHERE x ->> sp = 'block_house' ORDER BY o LIMIT 1) = 'mecum');
  SELECT x INTO r FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 = 'jamesedition';
  PERFORM pg_temp.ok('an aggregator is on the board, apart, and does not count as listings held',
    r ->> sp = 'aggregator' AND r ->> lb = 'Aggregators' AND r -> ch = 'false'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 = 'craigslist';
  PERFORM pg_temp.ok('a row carries its label and its evidence',
    r ->> lb = 'Classifieds' AND r -> ch = 'true'::jsonb AND r -> ev ->> 'seen' LIKE '%post id%');
  PERFORM pg_temp.ok('the capture channel and the unlabelled new venue are counted, not ranked',
    b -> 'not_ranked' = '{"capture channels": 1, "no species evidence": 1}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 IN ('new-venue', 'facebook-saved')));
  PERFORM pg_temp.ok('board totals count listing-holding species only: the aggregators'' landings are left out',
    (b -> 'landing' -> 'totals' ->> 'landed_1h')::int
      = (SELECT sum((b -> 'landing' -> 'sources' -> (x ->> 0) ->> 'landed_1h')::int)
         FROM jsonb_array_elements(b -> 'rows') x WHERE x -> ch = 'true'::jsonb)
    AND (SELECT sum((b -> 'landing' -> 'sources' -> (x ->> 0) ->> 'landed_1h')::int)
         FROM jsonb_array_elements(b -> 'rows') x WHERE x -> ch = 'false'::jsonb) > 0);
END $$;
RESET ROLE;
SELECT pg_temp.ok('the reader is still a definer with a pinned search_path that PUBLIC cannot run',
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE proname = 'market_sources_read')
  AND NOT has_function_privilege('public', 'public.market_sources_read()', 'execute'));
