-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_market_sources_cohorts -f this-file.sql
-- Contract for 20261020200000_market_sources_dealer_groups_and_cohorts.sql and 20261020201000_market_sources_read_cohorts.sql,
-- on top of the species contract's synthetic sources and readers (test_source_species.sql). Synthetic rows only; never
-- production.
--   * both migrations apply twice;
--   * a dealer's held count is the vehicles it holds that it did not sell through BaT; its BaT lots go to venue_lots,
--     apart, so a BaT-only dealer holds nothing and ranks below a dealer with its own stock, and is never counted twice;
--   * a second organization row sharing a dealer's website host folds into that dealer;
--   * private sellers are count-only cohorts of BaT sellers not registered as a dealer source, with the lots naming no
--     seller recorded apart; no handle reaches the board;
--   * each owner_private source ranks by the vehicles its observations cover, counting only;
--   * the reader appends venue_lots, venue_slug and members, lists the two groups after the aggregators, keeps all three
--     count-only groups out of landing totals, and source_species_gaps() stays empty.
\ir test_source_species.sql

-- what the writer reads beyond the species contract's tables, with their live types (2026-10-19)
ALTER TABLE public.vehicle_events
  ADD COLUMN vehicle_id uuid, ADD COLUMN source_organization_id uuid,
  ADD COLUMN seller_external_identity_id uuid, ADD COLUMN seller_identifier text;
ALTER TABLE public.organizations ADD COLUMN website text, ADD COLUMN business_name text;
ALTER TABLE public.vehicle_observations ADD COLUMN vehicle_id uuid, ADD COLUMN observed_at timestamptz;
UPDATE public.observation_sources SET species = 'timed_auction', species_set = '{timed_auction}',
  species_evidence = '{"examined_at": "2026-10-19", "examined": ["synthetic"], "seen": "a new venue, labelled for this contract"}'
 WHERE slug = 'new-venue';
UPDATE public.observation_sources SET species = 'media_forum_video', species_set = '{media_forum_video}',
  species_evidence = '{"examined_at": "2026-10-19", "examined": ["synthetic"], "seen": "the species contract''s forum, labelled for this contract"}'
 WHERE slug = 'some-forum';

-- Streetside Classics: a registered dealer with its own stock and BaT lots; a second organization row shares its site.
INSERT INTO public.organizations (id, business_type, website, business_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dealer', 'https://www.streetsideclassics.com', 'Streetside Classics'),
  ('11111111-1111-1111-1111-111111111112', 'dealer', 'https://streetsideclassics.com/inventory', 'Streetside Classics (dup)'),
  ('22222222-2222-2222-2222-222222222222', 'dealer', NULL, 'BaT-only dealer');
UPDATE public.observation_sources SET business_id = '11111111-1111-1111-1111-111111111111' WHERE slug = 'streetside-classics';
INSERT INTO public.observation_sources (slug, display_name, category, business_id, created_at, species, species_set, species_evidence)
VALUES ('bat-only-dealer', 'BaT-only Dealer', 'dealer', '22222222-2222-2222-2222-222222222222', '2025-01-01', 'dealer', '{dealer}',
        '{"examined_at": "2026-10-19", "examined": ["synthetic"], "seen": "a dealer whose every vehicle is a BaT lot it sold"}');
-- vehicles: s1, s2 sold by Streetside on BaT; s3 its own stock; s4 held by the duplicate row and sold on BaT by it; b1, b2 the BaT-only dealer's
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, listing_status, created_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'sold_by', 'sold', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'sold_by', 'sold', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'consigner', 'for_sale', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111112', 'aaaaaaaa-0000-0000-0000-000000000004', 'sold_by', 'sold', now() - interval '3 days'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'sold_by', 'sold', now() - interval '2 days'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'sold_by', 'sold', now() - interval '2 days');
INSERT INTO public.organization_seller_stats (organization_id, total_listings, total_sold, active_listings, total_gross_sales, calculated_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 3, 2, 1, 90000, now()),
  ('22222222-2222-2222-2222-222222222222', 2, 2, 0, 50000, now());
-- BaT lots: the dealers' (an organization), a handle with two lots, a handle with one, an identity with one, and lots naming nobody
INSERT INTO public.vehicle_events (source_platform, created_at, vehicle_id, source_organization_id, seller_external_identity_id, seller_identifier) VALUES
  ('bat', now() - interval '2 days', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL, 'StreetsideClassics'),
  ('bat', now() - interval '2 days', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL, 'StreetsideClassics'),
  ('bat', now() - interval '3 days', 'aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111112', NULL, 'StreetsideClassics'),
  ('bat', now() - interval '2 days', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', NULL, 'batonly'),
  ('bat', now() - interval '2 days', 'bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', NULL, 'batonly'),
  ('bat', now() - interval '2 days', 'cccccccc-0000-0000-0000-000000000001', NULL, NULL, 'Handle_Two'),
  ('bat', now() - interval '2 days', 'cccccccc-0000-0000-0000-000000000002', NULL, NULL, 'handle_two'),
  ('bat', now() - interval '2 days', 'cccccccc-0000-0000-0000-000000000003', NULL, NULL, 'solo_handle'),
  ('bat', now() - interval '2 days', 'cccccccc-0000-0000-0000-000000000004', NULL, 'dddddddd-0000-0000-0000-000000000001', NULL),
  ('bat', now() - interval '2 days', 'cccccccc-0000-0000-0000-000000000005', NULL, NULL, ''),
  ('bat', now() - interval '2 days', 'cccccccc-0000-0000-0000-000000000006', NULL, NULL, NULL);
-- an owner source with observations on two vehicles
INSERT INTO public.observation_sources (slug, display_name, category, created_at, species, species_set, species_evidence)
VALUES ('iphoto', 'iPhoto', 'owner', '2025-01-01', 'owner_private', '{owner_private}',
        '{"examined_at": "2026-10-19", "examined": ["synthetic"], "seen": "the owner''s photo library"}');
INSERT INTO public.vehicle_observations (source_id, kind, vehicle_id, observed_at)
SELECT id, 'media', v.vid, v.at FROM public.observation_sources, (VALUES
  ('eeeeeeee-0000-0000-0000-000000000001'::uuid, '2026-06-20'::timestamptz),
  ('eeeeeeee-0000-0000-0000-000000000001'::uuid, '2026-06-21'::timestamptz),
  ('eeeeeeee-0000-0000-0000-000000000002'::uuid, '2026-05-01'::timestamptz)) v(vid, at)
WHERE slug = 'iphoto';

\ir ../migrations/20261020200000_market_sources_dealer_groups_and_cohorts.sql
\ir ../migrations/20261020200000_market_sources_dealer_groups_and_cohorts.sql
\ir ../migrations/20261020201000_market_sources_read_cohorts.sql
\ir ../migrations/20261020201000_market_sources_read_cohorts.sql
\ir ../migrations/20261020230000_market_sources_before_same_definition.sql
\ir ../migrations/20261020230000_market_sources_before_same_definition.sql
-- a week-earlier reading of the dealer under the old definition (BaT lots inside held, no venue lots), and one of BaT
INSERT INTO public.market_source_days (day, source_slug, display_name, landed_lots)
VALUES (current_date - 8, 'streetside-classics', 'Streetside Classics', 3150), (current_date - 8, 'bat', 'Bring a Trailer', 251000);

SELECT pg_temp.ok('the species gains private_seller, labelled; the board table gains its four columns',
  public.source_species_label('private_seller') = 'Private sellers'
  AND (SELECT count(*) = 4 FROM information_schema.columns WHERE table_name = 'market_source_days'
       AND column_name IN ('venue_lots', 'venue_slug', 'members', 'species')));

SET ROLE service_role;
SELECT pg_temp.ok('the writer takes the dealer path and writes the sources, the cohorts and the owner', public.record_market_source_day() > 0);
RESET ROLE;

-- the board contract seeds a 15-lot own-site fold for Streetside (mv_source_target_landed); held is that fold, never its BaT lots
SELECT pg_temp.ok('a dealer holds its own-site fold, not what it sold through BaT; its BaT lots are apart, under the venue',
  (SELECT landed_lots = 15 AND venue_lots = 3 AND venue_slug = 'bat' AND members IS NULL AND species IS NULL
   FROM public.market_source_days WHERE day = current_date AND source_slug = 'streetside-classics'));
SELECT pg_temp.ok('the duplicate organization row (same website host) folded into the dealer: no row of its own',
  NOT EXISTS (SELECT 1 FROM public.market_source_days WHERE day = current_date AND display_name LIKE '%(dup)%'));
SELECT pg_temp.ok('a BaT-only dealer holds nothing; its lots are venue lots, and it stays on the board',
  (SELECT landed_lots IS NULL AND venue_lots = 2 AND venue_slug = 'bat'
   FROM public.market_source_days WHERE day = current_date AND source_slug = 'bat-only-dealer'));
SELECT pg_temp.ok('the cohorts: one seller with two lots, two sellers with one (a handle and an identity), the lots naming nobody; dealers excluded',
  (SELECT jsonb_object_agg(source_slug, jsonb_build_array(members, landed_lots)) FROM public.market_source_days
   WHERE day = current_date AND category = 'seller_cohort')
  = jsonb_build_object('bat-sellers-2-9', jsonb_build_array(1, 2), 'bat-sellers-1', jsonb_build_array(2, 2),
                       'bat-sellers-none', jsonb_build_array(0, (SELECT count(*) FROM public.vehicle_events
                         WHERE lower(source_platform) = 'bat' AND source_organization_id IS NULL AND seller_external_identity_id IS NULL
                           AND nullif(trim(seller_identifier), '') IS NULL)))
  AND (SELECT bool_and(species = 'private_seller' AND venue_slug = 'bat' AND house IS NULL)
       FROM public.market_source_days WHERE day = current_date AND category = 'seller_cohort'));
SELECT pg_temp.ok('the owner source counts the vehicles its observations cover, with the latest observation',
  (SELECT landed_lots = 2 AND landed_at = '2026-06-21'::timestamptz AND category = 'owner'
   FROM public.market_source_days WHERE day = current_date AND source_slug = 'iphoto'));
SELECT pg_temp.ok('no handle reaches the board', NOT EXISTS (
  SELECT 1 FROM public.market_source_days d
  WHERE d.day = current_date AND (lower(d.display_name) LIKE '%handle%' OR lower(d.source_slug) LIKE '%handle%'
                                  OR lower(d.display_name) LIKE '%batonly%')));
SELECT pg_temp.ok('no source holding data lacks a species: cohort rows are not sources', NOT EXISTS (SELECT 1 FROM public.source_species_gaps()));

SET ROLE service_role;
SELECT pg_temp.ok('a second reading the same day writes again', public.record_market_source_day() > 0);
RESET ROLE;
SELECT pg_temp.ok('and replaces the rows, never adding to them',
  (SELECT count(*) = 1 FROM public.market_source_days WHERE day = current_date AND source_slug = 'bat-sellers-2-9')
  AND (SELECT count(*) = 1 FROM public.market_source_days WHERE day = current_date AND source_slug = 'iphoto'));

SET ROLE anon;
DO $$
DECLARE b jsonb := public.market_sources_read();
  cols jsonb := b -> 'columns';
  sp int; ch int; vl int; vs int; mb int; held int;
  r jsonb;
  groups text[];
BEGIN
  SELECT i - 1 INTO sp FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'species';
  SELECT i - 1 INTO ch FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'counts_as_held';
  SELECT i - 1 INTO vl FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'venue_lots';
  SELECT i - 1 INTO vs FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'venue_slug';
  SELECT i - 1 INTO mb FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'members';
  SELECT i - 1 INTO held FROM jsonb_array_elements_text(cols) WITH ORDINALITY c(n, i) WHERE n = 'held_lots';
  PERFORM pg_temp.ok('the board keeps its columns and appends venue_lots, venue_slug and members',
    cols ->> 31 = 'species_evidence' AND vl = 32 AND vs = 33 AND mb = 34 AND jsonb_array_length(cols) = 35);
  SELECT array_agg(g ->> 'species' ORDER BY o) INTO groups FROM jsonb_array_elements(b -> 'species_groups') WITH ORDINALITY x(g, o);
  PERFORM pg_temp.ok('the two groups follow the aggregators, count-only, with their units',
    groups = ARRAY['timed_auction', 'block_house', 'dealer', 'classifieds', 'auth_walled_marketplace', 'aggregator',
                   'private_seller', 'owner_private']
    AND (SELECT g ->> 'label' = 'Private sellers' AND g ->> 'unit' = 'BaT lots' AND g -> 'counts_as_held' = 'false'::jsonb
         FROM jsonb_array_elements(b -> 'species_groups') g WHERE g ->> 'species' = 'private_seller')
    AND (SELECT g ->> 'label' = 'Owner''s private data' AND g ->> 'unit' = 'vehicles' AND g -> 'counts_as_held' = 'false'::jsonb
         FROM jsonb_array_elements(b -> 'species_groups') g WHERE g ->> 'species' = 'owner_private'));
  PERFORM pg_temp.ok('dealers rank by held, then by venue lots: own stock first, the BaT-only dealer last',
    (SELECT array_agg(x ->> 0 ORDER BY o) FROM jsonb_array_elements(b -> 'rows') WITH ORDINALITY e(x, o) WHERE x ->> sp = 'dealer')
      = ARRAY['streetside-classics', 'bat-only-dealer']);
  SELECT x INTO r FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 = 'streetside-classics';
  PERFORM pg_temp.ok('a dealer row carries held apart from its venue lots',
    (r ->> held)::int = 15 AND (r ->> vl)::int = 3 AND r ->> vs = 'bat' AND r -> mb = 'null'::jsonb AND r -> ch = 'true'::jsonb);
  PERFORM pg_temp.ok('a week-earlier reading taken before the venue lots were set apart is not the held count''s history',
    r -> (held + 15) = 'null'::jsonb AND r -> (held + 16) = 'null'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 = 'bat';
  PERFORM pg_temp.ok('a source counted the same way a week earlier keeps its before reading',
    (r ->> (held + 15))::int = 251000 AND (r ->> (held + 16))::date = current_date - 8);
  PERFORM pg_temp.ok('the cohorts rank by lots under Private sellers, with their members, never as listings held',
    (SELECT array_agg(x ->> 0 ORDER BY o) FROM jsonb_array_elements(b -> 'rows') WITH ORDINALITY e(x, o) WHERE x ->> sp = 'private_seller')
      = ARRAY['bat-sellers-none', 'bat-sellers-1', 'bat-sellers-2-9']
    AND (SELECT bool_and(x -> ch = 'false'::jsonb AND x ->> (sp + 1) = 'Private sellers' AND x ->> vs = 'bat' AND x -> (sp + 3) = 'null'::jsonb)
         FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> sp = 'private_seller')
    AND (SELECT (x ->> mb)::int = 2 AND (x ->> held)::int = 2 FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 = 'bat-sellers-1'));
  SELECT x INTO r FROM jsonb_array_elements(b -> 'rows') x WHERE x ->> 0 = 'iphoto';
  PERFORM pg_temp.ok('the owner source ranks under its own group, count only, with its evidence',
    r ->> sp = 'owner_private' AND (r ->> held)::int = 2 AND r -> ch = 'false'::jsonb AND r -> (sp + 3) ->> 'seen' LIKE '%photo library%');
  PERFORM pg_temp.ok('owner sources no longer sit in not_ranked; the capture channel still does',
    b -> 'not_ranked' = '{"capture channels": 1}'::jsonb);
  PERFORM pg_temp.ok('landing totals still count listing-holding species only',
    (b -> 'landing' -> 'totals' ->> 'landed_7d')::int
      = (SELECT sum((b -> 'landing' -> 'sources' -> (x ->> 0) ->> 'landed_7d')::int)
         FROM jsonb_array_elements(b -> 'rows') x WHERE x -> ch = 'true'::jsonb));
  PERFORM pg_temp.ok('no seller handle appears anywhere in the anonymous read',
    b::text NOT ILIKE '%handle_two%' AND b::text NOT ILIKE '%solo_handle%' AND b::text NOT ILIKE '%batonly%'
    AND b::text NOT ILIKE '%dddddddd-0000%');
END $$;
SELECT pg_temp.fails('anon still cannot read the table', $s$SELECT count(*) FROM public.market_source_days$s$);
SELECT pg_temp.fails('anon still cannot write the board', $s$SELECT public.record_market_source_day()$s$);
RESET ROLE;
SELECT pg_temp.ok('the writer and the reader are still definers with a pinned search_path that PUBLIC cannot run',
  (SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc
   WHERE proname IN ('record_market_source_day', 'market_sources_read'))
  AND NOT has_function_privilege('public', 'public.record_market_source_day()', 'execute')
  AND NOT has_function_privilege('public', 'public.market_sources_read()', 'execute'));
