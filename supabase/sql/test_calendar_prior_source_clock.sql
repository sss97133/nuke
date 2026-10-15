-- Execute the effective calendar reader, including later full replacements,
-- against synthetic source/admission clocks. AuctionCalendar.test.tsx checks
-- that every full reader replacement migration is included in this contract.
-- The shared db-contracts runner discovers this file and gives it a fresh PG17 database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'dm_refinement_calendar_prior_source_clock'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable calendar_prior_source_clock PG17 database';
  END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I', r);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz,
  year integer, make text, model text, primary_image_url text, vin text,
  listing_kind text, provenance_metadata jsonb
);
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles,
  source_platform text, source_url text, metadata jsonb DEFAULT '{}'::jsonb,
  event_status text, ended_at timestamptz, sold_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  current_price numeric, final_price numeric, extraction_method text,
  reader_visible boolean DEFAULT true
);
CREATE INDEX ON public.vehicle_events(vehicle_id);
CREATE TABLE public.observation_sources(id uuid PRIMARY KEY, slug text);
CREATE TABLE public.source_census(
  source_id uuid, census_at timestamptz, census_method text, by_category jsonb, raw_response jsonb
);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicles ON public.vehicles FOR SELECT TO anon
  USING (is_public IS TRUE AND deleted_at IS NULL);
CREATE POLICY public_events ON public.vehicle_events FOR SELECT TO anon
  USING (reader_visible AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id));
GRANT SELECT ON public.vehicles, public.vehicle_events TO anon;

INSERT INTO public.vehicles(id, is_public, deleted_at, year, make, model) VALUES
  (md5('dated')::uuid, true, NULL, 1970, 'Synthetic', 'Dated'),
  (md5('undated')::uuid, true, NULL, 1971, 'Synthetic', 'Undated'),
  (md5('private')::uuid, false, NULL, 1972, 'Synthetic', 'Private'),
  (md5('deleted')::uuid, true, now(), 1973, 'Synthetic', 'Deleted');
INSERT INTO public.vehicles(id, is_public, year, make, model, listing_kind)
VALUES (md5('road-art')::uuid, true, 1974, 'Synthetic', 'Road art', 'non_vehicle_item');
INSERT INTO public.observation_sources VALUES (md5('gooding-source')::uuid, 'gooding');
INSERT INTO public.source_census VALUES
  (md5('gooding-source')::uuid, now() - interval '1 hour', 'house_roster_facet',
   '{"synthetic-sale":10,"unlanded-sale":20,"unplaced-sale":5}'::jsonb,
   jsonb_build_object('sales', jsonb_build_object('unlanded-sale', jsonb_build_object(
     'name', 'Unlanded sale', 'starts_on', (current_date + 20)::text, 'ends_on', (current_date + 21)::text))));
INSERT INTO public.vehicle_events(id, vehicle_id, source_platform, source_url, event_status,
  ended_at, created_at, updated_at, metadata)
SELECT md5('next-' || model)::uuid, id, 'gooding', 'https://example.test/next-' || model,
  'pending', date_trunc('day', now()) + interval '10 days', now() - interval '2 days', now() - interval '1 hour',
  '{"sale_key":"synthetic-sale","auction_name":"Synthetic sale","lot_number":"1"}'::jsonb
FROM public.vehicles;
INSERT INTO public.vehicle_events(id, vehicle_id, source_platform, source_url, event_status,
  ended_at, sold_at, created_at, updated_at, final_price, extraction_method, reader_visible) VALUES
  -- Reproduces the failed public case without production identifiers: an old orphan
  -- row supplies an amount/status and an admission clock, but no source occurrence date.
  (md5('unknown-clock')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/unknown-clock', 'sold',
   NULL, NULL, now() - interval '1 day', now(), 25000, 'orphan-backfill-v1', true),
  (md5('ended-clock')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/ended-clock', 'sold',
   now() - interval '2 days', now() - interval '3 days', now() - interval '1 hour', now(), 15000, 'source', true),
  (md5('sold-clock')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/sold-clock', 'sold',
   NULL, now() - interval '4 days', now() - interval '1 hour', now(), 10000, 'source', true),
  -- Source time still controls prior eligibility when it exists; admission is not
  -- allowed to pull a future occurrence into the earlier-record list.
  (md5('future-event')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/future-event', 'sold',
   now() + interval '2 days', NULL, now() - interval '9 days', now(), 9000, 'source', true),
  (md5('future-admission')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/future-admission', 'sold',
   NULL, NULL, now() + interval '1 day', now(), 8000, 'source', true),
  (md5('all-clocks-missing')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/all-clocks-missing', 'sold',
   NULL, NULL, NULL, now(), 7000, 'source', true),
  (md5('private-prior')::uuid, md5('dated')::uuid, 'gooding', 'https://example.test/private-prior', 'sold',
   now() - interval '1 hour', NULL, now() - interval '1 hour', now(), 6000, 'source', false),
  -- An otherwise eligible vehicle with only an undated historical presentation
  -- must still be counted as having an earlier retained record.
  (md5('only-undated')::uuid, md5('undated')::uuid, 'gooding', 'https://example.test/only-undated', 'active',
   NULL, NULL, now() - interval '1 day', now(), NULL, 'source', true);

-- Keep the actual lineage in order: the approved first correction was later
-- overwritten by the roster expansion. Only testing the old correction missed it.
\ir ../migrations/20261015050000_auction_calendar_read.sql
\ir ../migrations/20261015070000_auction_calendar_read_updated_at.sql
\ir ../migrations/20261015111500_calendar_prior_source_clock.sql
\ir ../migrations/20261015130000_auction_calendar_read_listed.sql
CREATE TEMP TABLE reader_permissions AS
  SELECT oid, proowner, proacl, prosecdef, proconfig, provolatile
  FROM pg_proc WHERE oid IN ('public.auction_calendar_read(integer,text,text,integer,integer)'::regprocedure,
                            'public.house_roster_census()'::regprocedure);
SET ROLE anon;
CREATE TEMP TABLE prior_before AS
  SELECT public.auction_calendar_read(200, 'gooding', 'synthetic-sale') AS j;
RESET ROLE;
DO $$ DECLARE prior jsonb; BEGIN
  SELECT p INTO prior FROM prior_before b,
    LATERAL jsonb_array_elements(b.j#>'{roster,rows}') r,
    LATERAL jsonb_array_elements(r->'prior') p
  WHERE p->>'url' = 'https://example.test/unknown-clock';
  IF prior->>'on' IS DISTINCT FROM (now() - interval '1 day')::date::text THEN
    RAISE EXCEPTION 'Baseline must reproduce admission-as-occurrence defect: %', prior;
  END IF;
END $$;

\ir ../migrations/20261015170000_calendar_source_clock_after_roster.sql
-- Applying it twice must be harmless, including function permissions.
\ir ../migrations/20261015170000_calendar_source_clock_after_roster.sql
SET ROLE anon;
CREATE TEMP TABLE prior_after AS
  SELECT public.auction_calendar_read(200, 'gooding', 'synthetic-sale') AS j;
RESET ROLE;
DO $$
DECLARE before_j jsonb; after_j jsonb; r jsonb; p jsonb; dated_priors jsonb;
BEGIN
  SELECT j INTO before_j FROM prior_before;
  SELECT j INTO after_j FROM prior_after;
  IF after_j#>>'{population,lots}' <> '2' OR after_j#>>'{population,seen_before}' <> '2' THEN
    RAISE EXCEPTION 'Preserve public eligibility and undated earlier-record counts: %', after_j->'population';
  END IF;
  IF after_j#>>'{population,listed}' <> '35' OR after_j#>>'{population,sales}' <> '3'
    OR (SELECT s->>'lots_listed' FROM jsonb_array_elements(after_j->'sales') s
        WHERE s->>'sale_key' = 'synthetic-sale') IS DISTINCT FROM '10'
    OR (SELECT s->>'lots' FROM jsonb_array_elements(after_j->'sales') s
        WHERE s->>'sale_key' = 'unlanded-sale') IS DISTINCT FROM '0'
    OR after_j#>>'{unplaced,0,sale_key}' IS DISTINCT FROM 'unplaced-sale' THEN
    RAISE EXCEPTION 'Roster/census expansion must survive the source-date correction: %', after_j;
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(after_j#>'{roster,rows}') LOOP
    IF r->>'vehicle_id' = md5('dated')::uuid::text THEN dated_priors := r->'prior'; END IF;
    FOR p IN SELECT * FROM jsonb_array_elements(r->'prior') LOOP
      CASE p->>'url'
        WHEN 'https://example.test/unknown-clock', 'https://example.test/only-undated' THEN
          IF p->'on' IS DISTINCT FROM 'null'::jsonb THEN
            RAISE EXCEPTION 'Unknown source occurrence must stay null: %', p;
          END IF;
        WHEN 'https://example.test/ended-clock' THEN
          IF p->>'on' IS DISTINCT FROM (now() - interval '2 days')::date::text THEN
            RAISE EXCEPTION 'Preserve existing ended_at priority: %', p;
          END IF;
        WHEN 'https://example.test/sold-clock' THEN
          IF p->>'on' IS DISTINCT FROM (now() - interval '4 days')::date::text THEN
            RAISE EXCEPTION 'Use known sold_at when ended_at is absent: %', p;
          END IF;
        ELSE RAISE EXCEPTION 'Future, inaccessible or wholly undated prior leaked: %', p;
      END CASE;
    END LOOP;
  END LOOP;
  IF jsonb_array_length(dated_priors) <> 3
    OR dated_priors#>>'{0,url}' <> 'https://example.test/unknown-clock'
    OR dated_priors#>>'{1,url}' <> 'https://example.test/ended-clock'
    OR dated_priors#>>'{2,url}' <> 'https://example.test/sold-clock' THEN
    RAISE EXCEPTION 'Prior eligibility and existing admission/source ordering changed: %', dated_priors;
  END IF;
  -- Only the displayed prior.on values and the request clock may change. This
  -- preserves the bounded roster, counts, amounts, status and knowledge clocks.
  IF (SELECT jsonb_agg(q.value - 'prior' ORDER BY q.value->>'event_id') FROM jsonb_array_elements(before_j#>'{roster,rows}') q)
     IS DISTINCT FROM
     (SELECT jsonb_agg(q.value - 'prior' ORDER BY q.value->>'event_id') FROM jsonb_array_elements(after_j#>'{roster,rows}') q)
    OR (before_j - 'as_of' - 'roster') IS DISTINCT FROM (after_j - 'as_of' - 'roster')
    OR (SELECT jsonb_agg(prior_row.value - 'on' ORDER BY prior_row.value->>'url') FROM jsonb_array_elements(before_j#>'{roster,rows}') q,
         LATERAL jsonb_array_elements(q.value->'prior') prior_row)
       IS DISTINCT FROM
       (SELECT jsonb_agg(prior_row.value - 'on' ORDER BY prior_row.value->>'url') FROM jsonb_array_elements(after_j#>'{roster,rows}') q,
         LATERAL jsonb_array_elements(q.value->'prior') prior_row) THEN
    RAISE EXCEPTION 'Patch changed output beyond prior source dates';
  END IF;
  IF EXISTS (SELECT 1 FROM reader_permissions b CROSS JOIN pg_proc a
    WHERE a.oid = b.oid
      AND (a.proowner, a.proacl, a.prosecdef, a.proconfig, a.provolatile)
          IS DISTINCT FROM (b.proowner, b.proacl, b.prosecdef, b.proconfig, b.provolatile)) THEN
    RAISE EXCEPTION 'Reader permissions, owner or execution properties changed';
  END IF;
  RAISE NOTICE 'PASS: unknown/known clocks, prior retention/order, future/privacy exclusions, exact output boundary and permissions';
END $$;
