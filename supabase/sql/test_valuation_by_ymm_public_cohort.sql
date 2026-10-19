-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_valuation_cohort -f this-file.sql
-- Proves the valuation_by_ymm read-path change (migration 20261014054000) leaves every document as it was.
-- The live reader found a registered cohort by listing cohort_members() (private and deleted vehicles included) and fetching
-- each by primary key, then probed vehicle_events and bat_listings vehicle by vehicle. The migration reads the registered cohort
-- with cohort_members_public() and the native rows with `vehicle_id = ANY (members)`. The documents must be identical, minus the
-- three statement-time stamps, for: a registered cohort, the same with a subject vehicle, known-at mode, another currency, a
-- cohort with no scope, make-and-year only, year NULL, an unknown model, and invalid arguments; a private, deleted, part,
-- other-year, other-make or word-collision vehicle must never be a member, an eligible sale or a native presentation. The
-- function stays SECURITY DEFINER with its search_path, TimeZone, 10 s timeout and grants. The migration needs the public cohort
-- readers (migration 20261014052500) and stops without them. A re-run is a no-op, and a drifted function is left as found.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
SET TimeZone = 'UTC';
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- The shapes the reader touches.
CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text, canonical_model text, aliases text[], year_start integer, year_end integer);
CREATE TABLE public.make_model_profiles (
  subject_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_make text, canonical_model text, grain text, year integer,
  year_start integer, year_end integer, canonical_model_id uuid REFERENCES public.canonical_models(id));
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true, deleted_at timestamptz,
  listing_kind text, origin_metadata jsonb, body_style text, engine_type text, transmission text, condition_rating integer,
  primary_image_url text, sale_status text, auction_outcome text, reserve_status text, sale_price numeric, bat_sold_price numeric,
  sold_price numeric, winning_bid numeric, high_bid numeric, asking_price numeric, sale_date date, bat_sale_date date,
  listing_updated_at timestamptz, listing_posted_at timestamptz, nuke_estimate numeric, nuke_estimate_confidence integer,
  valuation_calculated_at timestamptz, canonical_outcome text, canonical_platform text, listing_url text, bat_auction_url text,
  platform_url text, discovery_url text, notes text, import_metadata jsonb, created_at timestamptz DEFAULT now(), auction_end_date text);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles (lower(make), lower(model));
CREATE INDEX idx_vehicles_year ON public.vehicles (year);
CREATE TABLE public.listing_page_snapshots (
  id uuid PRIMARY KEY, listing_url text, fetched_at timestamptz, success boolean, http_status integer, html text, platform text,
  metadata jsonb, html_sha256 text, created_at timestamptz NOT NULL, html_storage_path text);
CREATE INDEX ON public.listing_page_snapshots (platform, listing_url, fetched_at DESC);
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text UNIQUE);
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles, source_platform text, source_url text, source_listing_id text,
  event_type text, event_status text, final_price numeric, sold_at timestamptz, ended_at timestamptz, created_at timestamptz,
  updated_at timestamptz, extracted_at timestamptz);
CREATE INDEX idx_vehicle_events_vehicle ON public.vehicle_events (vehicle_id);
CREATE TABLE public.bat_listings (
  id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles, bat_listing_url text, listing_status text, sale_date date, auction_end_date date);
CREATE INDEX idx_bat_listings_vehicle ON public.bat_listings (vehicle_id);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles, source_id uuid REFERENCES public.observation_sources, kind text,
  observed_at timestamptz, ingested_at timestamptz DEFAULT now(), is_superseded boolean DEFAULT false, superseded_at timestamptz,
  source_url text, source_identifier text, raw_source_ref text, extraction_method text, extractor_id uuid, structured_data jsonb,
  content_hash text, source_snapshot_id uuid, source_vehicle_event_id uuid REFERENCES public.vehicle_events, extraction_metadata jsonb);
CREATE INDEX idx_vo_vehicle_source_kind ON public.vehicle_observations (vehicle_id, source_id, kind);
INSERT INTO public.observation_sources VALUES ('22222222-2222-2222-2222-222222222222', 'bat');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

-- The functions as production has them on 2026-10-14, then the public cohort readers the migration requires.
\ir helpers/valuation_by_ymm_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.valuation_by_ymm(integer, text, text, timestamptz, timestamptz, timestamptz, text, numeric, uuid, text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(
  md5(pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure)) = '2233821a149cde9b85152107e3f86ccb'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.cohort_members(uuid)'::regprocedure)) = 'a2550afffab3f758943cbea0c188235f'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.vehicle_price_facts(uuid[])'::regprocedure)) = '32bef56e17986c4de7942d948ebde45f'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)'::regprocedure)) = '4a648fbaef6ff2f41fb44226a8a68b08',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- 0. Without the public cohort readers the migration stops, and leaves the function as found.
\echo 'Expected: the missing-readers ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014054000_valuation_by_ymm_public_cohort.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(md5(pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure)) = '2233821a149cde9b85152107e3f86ccb',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'without the readers the function is left as found');
\ir helpers/cohort_public_readers_20261014.sql

-- The registry: Synthetic Coupe 1970 (a year scope; the model words are the canonical model and its alias), and nothing for the
-- Wagon, so that one is read by exact make, year and model.
-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.canonical_models VALUES ('00000000-0000-0000-0000-0000000000c1', 'Synthetic', 'Coupe', ARRAY['sport coupe'], 1960, 1990);
INSERT INTO public.make_model_profiles (subject_id, canonical_make, canonical_model, grain, year, canonical_model_id) VALUES
 ('11111111-1111-1111-1111-111111111111', 'SYNTHETIC', 'Coupe', 'year', 1970, '00000000-0000-0000-0000-0000000000c1');

-- One qualified BaT sale per call: a vehicle row, its stored page with the sale tuple and a matching hash.
CREATE FUNCTION public.t_sale(p_n integer, p_year integer, p_make text, p_model text, p_public boolean DEFAULT true,
  p_deleted boolean DEFAULT false, p_kind text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE vid uuid := md5('vehicle-' || p_n)::uuid; sid uuid := md5('snapshot-' || p_n)::uuid;
  url text := 'https://bringatrailer.com/listing/synthetic-' || p_n || '/';
  amount numeric := 10000 + p_n * 500; sale_day date := date '2025-01-01' + p_n * 3;
  html text;
BEGIN
  html := 'Sold for <strong>USD $' || amount || '</strong> <span>on ' || to_char(sale_day, 'FMMM/FMDD/YY');
  INSERT INTO public.listing_page_snapshots (id, listing_url, fetched_at, success, http_status, html, platform, metadata, html_sha256, created_at)
  VALUES (sid, url, '2025-06-16T00:00:00Z', true, 200, html, 'bat',
    jsonb_build_object('vehicle_id', vid::text, 'vehicle_matched', true, 'parsed_at', '2025-06-16T12:00:00Z'),
    encode(sha256(convert_to(html, 'UTF8')), 'hex'), '2025-06-16T06:00:00Z');
  INSERT INTO public.vehicles (id, year, make, model, sale_status, sale_price, sale_date, listing_url, canonical_platform, is_public,
    deleted_at, listing_kind, body_style, origin_metadata)
  VALUES (vid, p_year, p_make, p_model, 'sold', amount, sale_day, url, 'bat', p_public,
    CASE WHEN p_deleted THEN now() END, p_kind, 'Coupe',
    jsonb_build_object('bat_snapshot_parsed', jsonb_build_object('snapshot_id', sid::text, 'parsed_at', '2025-06-16T12:00:00Z',
      'sale_currency', 'USD', 'sale_status', 'sold', 'sale_price', amount::text, 'sale_date', to_char(sale_day, 'FMMM/FMDD/YY'))));
  RETURN vid;
END $$;
-- Registered cohort (Synthetic Coupe 1970): twelve public qualified sales over several spellings of the model, case and make.
SELECT public.t_sale(n, 1970, CASE WHEN n % 3 = 0 THEN 'SYNTHETIC' WHEN n % 3 = 1 THEN 'Synthetic' ELSE 'synthetic' END,
  CASE n % 4 WHEN 0 THEN 'Coupe' WHEN 1 THEN 'Coupe Deluxe' WHEN 2 THEN 'Sport Coupe' ELSE 'COUPE' END) FROM generate_series(1, 12) n;
-- Never members of it: private, deleted, a part, another year, another make, no word match, a word collision, no model.
SELECT public.t_sale(21, 1970, 'Synthetic', 'Coupe', false);
SELECT public.t_sale(22, 1970, 'Synthetic', 'Coupe', true, true);
SELECT public.t_sale(23, 1970, 'Synthetic', 'Coupe', true, false, 'non_vehicle_item');
SELECT public.t_sale(24, 1971, 'Synthetic', 'Coupe');
SELECT public.t_sale(25, 1970, 'Other', 'Coupe');
SELECT public.t_sale(26, 1970, 'Synthetic', 'Hardtop');
SELECT public.t_sale(27, 1970, 'Synthetic', 'Recoupe');
SELECT public.t_sale(28, 1970, 'Synthetic', NULL);
-- No scope: Synthetic Wagon 1972 (read by exact make, year and model), with a private one.
SELECT public.t_sale(n, 1972, 'Synthetic', CASE WHEN n % 2 = 0 THEN 'Wagon' ELSE 'wagon' END) FROM generate_series(31, 36) n;
SELECT public.t_sale(37, 1972, 'Synthetic', 'Wagon', false);
-- Native rows. Events: a BaT presentation of a member, a Mecum one (public source context only), one on the private vehicle, one
-- on a vehicle outside the cohort. Listings: a BaT listing of a member, one of the private vehicle.
INSERT INTO public.vehicle_events (id, vehicle_id, source_platform, source_url, source_listing_id, event_type, event_status, final_price, sold_at, created_at) VALUES
 (md5('event-1')::uuid, md5('vehicle-1')::uuid, 'bat',   'https://bringatrailer.com/listing/synthetic-1/', 'https://bringatrailer.com/listing/synthetic-1/', 'auction', 'sold', 10500, '2025-01-04', '2025-06-16'),
 (md5('event-2')::uuid, md5('vehicle-2')::uuid, 'mecum', 'https://www.mecum.com/lots/10002/synthetic-coupe/', NULL, 'auction', 'sold', 120000, '2014-01-24', '2025-06-16'),
 (md5('event-3')::uuid, md5('vehicle-21')::uuid, 'bat',  'https://bringatrailer.com/listing/private-1/', NULL, 'auction', 'sold', 77777, '2025-02-04', '2025-06-16'),
 (md5('event-4')::uuid, md5('vehicle-24')::uuid, 'bat',  'https://bringatrailer.com/listing/other-year/', NULL, 'auction', 'sold', 88888, '2025-02-05', '2025-06-16'),
 (md5('event-5')::uuid, md5('vehicle-22')::uuid, 'bat',  'https://bringatrailer.com/listing/deleted-1/', NULL, 'auction', 'sold', 66666, '2025-02-06', '2025-06-16'),
 (md5('event-6')::uuid, md5('vehicle-31')::uuid, 'bat',  'https://bringatrailer.com/listing/synthetic-31/', 'https://bringatrailer.com/listing/synthetic-31/', 'auction', 'sold', 15500, '2025-04-04', '2025-06-16');
INSERT INTO public.bat_listings (id, vehicle_id, bat_listing_url, listing_status, sale_date) VALUES
 (md5('listing-1')::uuid, md5('vehicle-4')::uuid,  'http://www.bringatrailer.com/listing/synthetic-4/?utm_source=test', 'sold', '2025-01-13'),
 (md5('listing-2')::uuid, md5('vehicle-21')::uuid, 'https://bringatrailer.com/listing/private-1/', 'sold', '2025-02-04'),
 (md5('listing-3')::uuid, md5('vehicle-33')::uuid, 'https://bringatrailer.com/listing/synthetic-33/', 'sold', '2025-04-10');
ANALYZE;

-- The calls the Valuation page and its links make, and the odd ones: the same arguments before and after.
CREATE TABLE public.t_calls (label text PRIMARY KEY, args text);
INSERT INTO public.t_calls VALUES
 ('registered',        $$1970, 'Synthetic', 'Coupe', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 5000, NULL, 'retrospective'$$),
 ('registered_price',  $$1970, 'SYNTHETIC', 'coupe', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 14000, NULL, 'retrospective'$$),
 ('subject',           $$1970, 'Synthetic', 'Coupe', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 5000, '3f0b0b7f-f6d5-5ab9-52d9-0fb0a6b0c001'::uuid, 'retrospective'$$),
 ('known_at',          $$1970, 'Synthetic', 'Coupe', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', '2026-01-03T00:00:00Z', 'USD', 5000, NULL, 'known_at'$$),
 ('euro',              $$1970, 'Synthetic', 'Coupe', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'EUR', 5000, NULL, 'retrospective'$$),
 ('narrow_window',     $$1970, 'Synthetic', 'Coupe', '2025-02-01T00:00:00Z', '2025-01-10T00:00:00Z', NULL, 'USD', 5000, NULL, 'retrospective'$$),
 ('fallback_wagon',    $$1972, 'Synthetic', 'Wagon', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 12000, NULL, 'retrospective'$$),
 ('make_year_only',    $$1970, 'Synthetic', NULL, '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 5000, NULL, 'retrospective'$$),
 ('year_null',         $$NULL, 'Synthetic', 'Wagon', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 5000, NULL, 'retrospective'$$),
 ('unknown_model',     $$1970, 'Synthetic', 'Roadster', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 5000, NULL, 'retrospective'$$),
 ('invalid_make',      $$1970, '', 'Coupe', NULL, NULL, NULL, 'USD', 5000, NULL, 'retrospective'$$),
 ('invalid_currency',  $$1970, 'Synthetic', 'Coupe', NULL, NULL, NULL, 'JPY', 5000, NULL, 'retrospective'$$);
-- The subject call excludes vehicle 1's listing as the subject's own: use its real id.
UPDATE public.t_calls SET args = replace(args, '3f0b0b7f-f6d5-5ab9-52d9-0fb0a6b0c001', md5('vehicle-1')) WHERE label = 'subject';

CREATE TABLE public.t_docs (phase text, label text, doc jsonb, PRIMARY KEY (phase, label));
GRANT SELECT, INSERT ON public.t_docs TO anon;
GRANT SELECT ON public.t_calls TO anon;
CREATE PROCEDURE public.t_capture(p_phase text) LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  SET LOCAL ROLE anon;
  FOR c IN SELECT label, args FROM public.t_calls ORDER BY label LOOP
    EXECUTE format('INSERT INTO public.t_docs SELECT %L, %L, public.valuation_by_ymm(%s)', p_phase, c.label, c.args);
  END LOOP;
  RESET ROLE;
END $$;
-- The stamps the reader takes from the statement clock are not part of the answer.
CREATE FUNCTION public.t_norm(d jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(d::text, '"(computed_at|observed_at|evidence_as_of)": "[^"]*"', '"\1": "X"', 'g') $$;

BEGIN; CALL public.t_capture('before'); COMMIT;
-- The capture is not two empty answers: the registered cohort has its twelve sales, the wagon its six, errors are errors.
SELECT public.t_assert(
  (SELECT (doc#>>'{stats,sold_count}')::int FROM public.t_docs WHERE phase = 'before' AND label = 'registered') = 12
  AND (SELECT (doc#>>'{stats,sold_count}')::int FROM public.t_docs WHERE phase = 'before' AND label = 'fallback_wagon') = 6
  AND (SELECT doc#>>'{receipt,cohort,basis}' FROM public.t_docs WHERE phase = 'before' AND label = 'registered') = 'registered_same_year_model_context'
  AND (SELECT doc ? 'error' FROM public.t_docs WHERE phase = 'before' AND label = 'invalid_make'),
  'before: twelve registered sales, six wagon sales, a refusal for a missing make');
SELECT public.t_assert(
  (SELECT (doc#>>'{receipt,coverage,native_vehicle_event_presentations}')::int FROM public.t_docs WHERE phase = 'before' AND label = 'registered') = 1
  AND (SELECT (doc#>>'{receipt,coverage,native_bat_listing_presentations}')::int FROM public.t_docs WHERE phase = 'before' AND label = 'registered') = 1,
  'before: one BaT event and one BaT listing among the members (the private, deleted and other-year ones are not)');

-- 1. The migration.
\ir ../migrations/20261014054000_valuation_by_ymm_public_cohort.sql

-- 2. After: the same documents.
BEGIN; CALL public.t_capture('after'); COMMIT;
SELECT public.t_assert((SELECT count(*) FROM public.t_docs WHERE phase = 'after') = (SELECT count(*) FROM public.t_calls)
  AND NOT EXISTS (SELECT 1 FROM public.t_docs b JOIN public.t_docs a ON a.label = b.label AND a.phase = 'after'
                   WHERE b.phase = 'before' AND public.t_norm(a.doc) IS DISTINCT FROM public.t_norm(b.doc)),
  'after: identical documents for every call, minus the statement-time stamps');
-- ...and they say what they should.
SELECT public.t_assert(
  NOT EXISTS (SELECT 1 FROM public.t_docs t, jsonb_array_elements(t.doc#>'{receipt,eligible}') e
    WHERE t.phase = 'after' AND (e->>'vehicleId') IN (md5('vehicle-21'), md5('vehicle-22'), md5('vehicle-23'), md5('vehicle-24'), md5('vehicle-25'),
      md5('vehicle-26'), md5('vehicle-27'), md5('vehicle-28'), md5('vehicle-37')))
  AND NOT EXISTS (SELECT 1 FROM public.t_docs t, jsonb_array_elements(t.doc->'comparables') e
    WHERE t.phase = 'after' AND (e->>'vehicle_id') IN (md5('vehicle-21'), md5('vehicle-22'), md5('vehicle-23'), md5('vehicle-24'), md5('vehicle-25'),
      md5('vehicle-26'), md5('vehicle-27'), md5('vehicle-28'), md5('vehicle-37'))),
  'after: no private, deleted, part, other-year, other-make, word-collision, unmodeled or private-wagon vehicle is an eligible sale or a comparable');
SELECT public.t_assert(
  (SELECT (doc#>>'{stats,sold_count}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'registered') = 12
  AND (SELECT (doc#>>'{receipt,coverage,member_rows}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'registered') = 12
  AND (SELECT (doc#>>'{receipt,coverage,native_vehicle_event_presentations}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'registered') = 1
  AND (SELECT (doc#>>'{receipt,coverage,native_bat_listing_presentations}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'registered') = 1
  AND (SELECT (doc#>>'{stats,sold_count}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'fallback_wagon') = 6
  AND (SELECT (doc#>>'{receipt,coverage,native_vehicle_event_presentations}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'fallback_wagon') = 1,
  'after: twelve members, their one BaT event and one BaT listing; six wagons and their one event');
SELECT public.t_assert(
  (SELECT doc#>>'{source_context,presentation_count}' FROM public.t_docs WHERE phase = 'after' AND label = 'registered')
  = (SELECT doc#>>'{source_context,presentation_count}' FROM public.t_docs WHERE phase = 'before' AND label = 'registered')
  AND (SELECT (doc#>>'{source_context,presentation_count}')::int FROM public.t_docs WHERE phase = 'after' AND label = 'registered') = 3
  AND (SELECT doc#>'{source_context}' FROM public.t_docs WHERE phase = 'after' AND label = 'registered')::text NOT LIKE '%private-1%'
  AND (SELECT doc#>'{source_context}' FROM public.t_docs WHERE phase = 'after' AND label = 'registered')::text NOT LIKE '%other-year%'
  AND (SELECT doc#>'{source_context}' FROM public.t_docs WHERE phase = 'after' AND label = 'registered')::text NOT LIKE '%deleted-1%',
  'after: the public source context counts three presentations (BaT event, Mecum event, BaT listing) and names no private, deleted or other-year page');

-- 3. Attributes and rights are as they were.
SELECT public.t_assert((SELECT prosecdef AND provolatile = 's' AND proconfig::text LIKE '%search_path=public, pg_temp%' AND proconfig::text LIKE '%TimeZone=UTC%'
    AND proconfig::text LIKE '%statement_timeout=10s%' FROM pg_proc
    WHERE oid = 'public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure),
  'after: SECURITY DEFINER, stable, search_path, TimeZone and the 10 s timeout');
SELECT public.t_assert(has_function_privilege('anon', 'public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)', 'execute'),
  'after: anon still executes it');
SELECT public.t_assert(pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure) NOT LIKE '%public.cohort_members(%'
  AND pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure) LIKE '%cohort_members_public%'
  AND pg_get_functiondef('public.valuation_by_ymm(integer,text,text,timestamptz,timestamptz,timestamptz,text,numeric,uuid,text)'::regprocedure) NOT LIKE '%FROM cars c JOIN public.vehicle_events%',
  'after: the registered cohort comes from the public reader and the native rows are not joined member by member');

-- 4. A second run is a no-op that passes the guard.
\ir ../migrations/20261014054000_valuation_by_ymm_public_cohort.sql
SELECT public.t_assert(public.t_norm(public.valuation_by_ymm(1970, 'Synthetic', 'Coupe', '2026-01-01T00:00:00Z', '2024-01-01T00:00:00Z', NULL, 'USD', 5000, NULL, 'retrospective'))
  = (SELECT public.t_norm(doc) FROM public.t_docs WHERE phase = 'after' AND label = 'registered'), 'a re-run leaves the answer alone');

-- 5. A drifted source stops the migration and is left as found.
CREATE OR REPLACE FUNCTION public.valuation_by_ymm(p_year integer DEFAULT NULL, p_make text DEFAULT NULL, p_model text DEFAULT NULL,
  p_event_before timestamptz DEFAULT NULL, p_event_from timestamptz DEFAULT NULL, p_evidence_as_of timestamptz DEFAULT NULL,
  p_currency text DEFAULT 'USD', p_price numeric DEFAULT NULL, p_subject_vehicle_id uuid DEFAULT NULL, p_knowledge_mode text DEFAULT 'retrospective')
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' SET "TimeZone" TO 'UTC' SET statement_timeout TO '10s'
 AS $f$ SELECT '{"drifted": true}'::jsonb $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014054000_valuation_by_ymm_public_cohort.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(public.valuation_by_ymm(1970, 'Synthetic', 'Coupe') = '{"drifted": true}'::jsonb, 'a drifted function is not replaced');
SELECT 'valuation_by_ymm public-cohort contract: PASS' AS result;
