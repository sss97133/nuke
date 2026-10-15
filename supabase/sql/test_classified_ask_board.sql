-- Isolated PostgreSQL 17 contract for 20261013233000_classified_ask_board.sql (new classified asks with the near-me,
-- band and tier lenses) and 20261015070000_classified_ask_board_listed_at.sql (newest first by when a listing went up,
-- and the newest listing time). Synthetic rows only; never production. Run from the repo root in an empty disposable
-- dm_ask_board_* database:
--   createdb dm_ask_board_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_ask_board_ci -f supabase/sql/test_classified_ask_board.sql
-- Fixtures: vehicle_events, vehicles and vehicle_location_observations keep only the columns the function reads, with
-- the live types (read 2026-10-13) and the live read policies. compute_taste_score is a stub with the live signature;
-- the real scorer is applied in production and is not in the repo.
-- Covered: the migration applies and applies again; the window, one row per vehicle (newest event), the exclusions
-- (private, deleted, non-vehicle, auction sources, outside the window); the population block; the tiers; distance and
-- the nearest sort; radius, tier and band filters; the point's rounding; argument errors; the ACL and a read as anon,
-- where a low-confidence location row stays hidden; listed_at (the post time, never later than the first sighting, else
-- the first sighting) and the order by it; newest_at (the newest visible listing: private and auction rows excluded,
-- lenses ignored, the same for anon) and the hash guard that lets the newer migration apply again; and
-- (20261015080000_classified_ask_board_listing_odometer.sql) what the listing says about its miles, odometer and title:
-- broken wins over rolled over, the title is lower-cased, an observation of another vehicle is not read, and an owner's
-- private correction stays hidden from anon (the live garage_correction_private_read policy); and
-- (20261017030000_classified_ask_board_position.sql) the family and position: sales and asks at or below the ask, the
-- listing's own ask taken out of the asks, thin families without a band, years outside the family and names without a
-- family unplaced, newest_seen_at, merit from the active exit model by hand, the merit sort, no imputation, an unknown
-- feature, and the same position for anon.
-- Not covered: the real taste scorer; the live query's cost (measured on production with the same plan shape:
-- 54 ms warm, 638 ms cold over 374 asks, 2026-10-13).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_ask_board_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicle_events') IS NOT NULL
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_ask_board_* PostgreSQL 17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, drivetrain text, body_style text, mileage integer,
  primary_image_url text, location text, is_public boolean, deleted_at timestamptz, listing_kind text);
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text, source_url text,
  current_price numeric, created_at timestamptz, metadata jsonb DEFAULT '{}'::jsonb);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, source_type text NOT NULL,
  source_url text, observed_at timestamptz NOT NULL DEFAULT now(), city text, region_code text,
  latitude double precision, longitude double precision, confidence real);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, structured_data jsonb, extraction_method text, submitted_by_user_id uuid);
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

-- The live read policies.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_location_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true);
CREATE POLICY vehicle_events_public_read ON public.vehicle_events FOR SELECT USING (true);
CREATE POLICY vlo_public_read ON public.vehicle_location_observations FOR SELECT
  USING (confidence >= 0.50 AND source_type <> 'sighting');
GRANT SELECT ON public.vehicles, public.vehicle_events, public.vehicle_location_observations TO anon, authenticated;
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY garage_correction_private_read ON public.vehicle_observations FOR SELECT TO anon, authenticated
  USING (extraction_method IS DISTINCT FROM 'garage_owner_correction_v1' OR submitted_by_user_id = auth.uid());
GRANT SELECT ON public.vehicle_observations TO anon, authenticated;

-- Stub of the production scorer: Chevrolet scores 70, everything else 10.
CREATE FUNCTION public.compute_taste_score(p_title text, p_parsed_year integer, p_parsed_make text, p_parsed_model text,
  p_location text DEFAULT NULL) RETURNS smallint LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN lower(p_parsed_make) = 'chevrolet' THEN 70 ELSE 10 END::smallint $$;

\ir ../migrations/20261013233000_classified_ask_board.sql
\ir ../migrations/20261013233000_classified_ask_board.sql
\ir ../migrations/20261015070000_classified_ask_board_listed_at.sql
\ir ../migrations/20261015070000_classified_ask_board_listed_at.sql
\ir ../migrations/20261015080000_classified_ask_board_listing_odometer.sql
\ir ../migrations/20261015080000_classified_ask_board_listing_odometer.sql

-- The family key, the family price fold and the exit models (20261017030000 reads them), as tables with the columns it
-- reads and the live grants.
CREATE TABLE public.mv_model_family_names (make_l text, model_l text, vehicles bigint, make text, family_id uuid,
  family text, matched text, year_start integer, year_end integer, PRIMARY KEY (make_l, model_l));
CREATE TABLE public.mv_family_year_prices (family_id uuid, year integer, basis text, year_from integer, year_to integer,
  n integer, offered integer, conflicts integer, thin boolean, p10 integer, p25 integer, p50 integer, p75 integer,
  p90 integer, prices integer[], dated integer, first_on date, last_on date, n_24m integer, by_source jsonb,
  as_of timestamptz, n_miles integer NOT NULL DEFAULT 0, miles integer[] NOT NULL DEFAULT '{}', miles_p50 integer,
  venues jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (family_id, year, basis));
CREATE TABLE public.listing_exit_models (version text PRIMARY KEY, active boolean NOT NULL DEFAULT false,
  horizon_days integer NOT NULL, label text NOT NULL, intercept double precision NOT NULL, features jsonb NOT NULL,
  base_rate double precision NOT NULL, trained_on jsonb NOT NULL, evaluated_on jsonb NOT NULL, receipt text NOT NULL,
  trained_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.mv_model_family_names, public.mv_family_year_prices, public.listing_exit_models TO anon, authenticated;
\ir ../migrations/20261017030000_classified_ask_board_position.sql
\ir ../migrations/20261017030000_classified_ask_board_position.sql
RESET ROLE;

-- Vehicles: 1 Blazer (Phoenix), 2 H3T (St George), 3 M1010 (Las Vegas), 4 Ford (no price, no place),
-- 5 private, 6 deleted, 7 seen 30 h ago, 8 an auction source, 9 a low-confidence place, 10 a non-vehicle item.
INSERT INTO public.vehicles (id, year, make, model, is_public, deleted_at, listing_kind) VALUES
  ('00000000-0000-4000-8000-000000000001', 1984, 'Chevrolet', 'blazer', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000002', 2009, 'Hummer', 'h3t', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000003', 1984, 'Chevrolet', 'm1010', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000004', 1979, 'Ford', 'f250', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000005', 1970, 'Chevrolet', 'c10', false, NULL, NULL),
  ('00000000-0000-4000-8000-000000000006', 1971, 'Chevrolet', 'c10', true, now(), NULL),
  ('00000000-0000-4000-8000-000000000007', 1972, 'GMC', 'jimmy', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000008', 1973, 'Chevrolet', 'k5', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000009', 1985, 'Toyota', 'pickup', true, NULL, NULL),
  ('00000000-0000-4000-8000-000000000010', 1990, 'Chevrolet', 'parts', true, NULL, 'non_vehicle_item');
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, current_price, created_at, metadata) VALUES
  ('00000000-0000-4000-8000-000000000001', 'craigslist', 'https://www.craigslist.org/view/d/a/1', 17500, now() - interval '2 hours', '{}'),
  ('00000000-0000-4000-8000-000000000001', 'craigslist', 'https://www.craigslist.org/view/d/a/1', 18800, now() - interval '1 hour',
     '{"listing_posted_at":"2026-10-13T16:03:45.000Z","observation_id":"00000000-0000-4000-9000-000000000001"}'),
  ('00000000-0000-4000-8000-000000000002', 'craigslist', 'https://www.craigslist.org/view/d/b/2', 12500, now() - interval '3 hours',
     '{"listing_posted_at":"soon","observation_id":"00000000-0000-4000-9000-000000000002"}'),
  ('00000000-0000-4000-8000-000000000003', 'craigslist', 'https://www.craigslist.org/view/d/c/3', 13500, now() - interval '30 minutes',
     '{"observation_id":"00000000-0000-4000-9000-000000000003"}'),
  ('00000000-0000-4000-8000-000000000004', 'ksl', 'https://www.ksl.com/listing/4', NULL, now() - interval '5 hours',
     '{"listing_posted_at":"2099-01-01T00:00:00Z","observation_id":"00000000-0000-4000-9000-000000000001"}'),
  ('00000000-0000-4000-8000-000000000005', 'craigslist', 'https://www.craigslist.org/view/d/e/5', 9000, now() - interval '1 hour', '{}'),
  ('00000000-0000-4000-8000-000000000006', 'craigslist', 'https://www.craigslist.org/view/d/f/6', 9000, now() - interval '1 hour', '{}'),
  ('00000000-0000-4000-8000-000000000007', 'facebook_marketplace', 'https://www.facebook.com/marketplace/item/7/', 22000, now() - interval '30 hours', '{}'),
  ('00000000-0000-4000-8000-000000000008', 'bat', 'https://bringatrailer.com/listing/x/', 40000, now() - interval '1 hour', '{}'),
  ('00000000-0000-4000-8000-000000000009', 'craigslist', 'https://www.craigslist.org/view/d/i/9', 4500, now() - interval '4 hours',
     '{"observation_id":"00000000-0000-4000-9000-000000000009"}'),
  ('00000000-0000-4000-8000-000000000010', 'craigslist', 'https://www.craigslist.org/view/d/j/10', 300, now() - interval '1 hour', '{}');
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_url, observed_at, city, region_code, latitude, longitude, confidence) VALUES
  ('00000000-0000-4000-8000-000000000001', 'listing', 'https://www.craigslist.org/view/d/a/1', now() - interval '2 hours', 'Old', 'AZ', 10, 10, 0.8),
  ('00000000-0000-4000-8000-000000000001', 'listing', 'https://www.craigslist.org/view/d/a/1', now() - interval '1 hour', 'Phoenix', 'AZ', 33.448376, -112.074036, 0.8),
  ('00000000-0000-4000-8000-000000000002', 'listing', 'https://www.craigslist.org/view/d/b/2', now(), 'St George', 'UT', 37.0965, -113.5684, 0.8),
  ('00000000-0000-4000-8000-000000000002', 'listing', 'https://other.example/elsewhere', now(), 'Elsewhere', 'ME', 44.0, -70.0, 0.8),
  ('00000000-0000-4000-8000-000000000003', 'listing', 'https://www.craigslist.org/view/d/c/3', now(), 'Las Vegas', 'NV', 36.1699, -115.1398, 0.8),
  ('00000000-0000-4000-8000-000000000009', 'listing', 'https://www.craigslist.org/view/d/i/9', now(), 'Hidden', 'CA', 34.05, -118.24, 0.3);
-- What each listing says: the Blazer clean at 88,000; the H3T rolled over with a salvage title; the M1010 broken (and
-- rolled over: broken wins); the pickup's only observation is an owner's private correction. The F250's event points
-- at the Blazer's observation, which is not about the F250.
INSERT INTO public.vehicle_observations (id, vehicle_id, structured_data, extraction_method) VALUES
  ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-8000-000000000001', '{"mileage":"88000","title_status":"clean","condition":" Like New "}', 'listing_v1'),
  ('00000000-0000-4000-9000-000000000002', '00000000-0000-4000-8000-000000000002', '{"mileage":"123456","odometer_rolled_over":true,"title_status":" Salvage "}', 'listing_v1'),
  ('00000000-0000-4000-9000-000000000003', '00000000-0000-4000-8000-000000000003', '{"mileage":"10","odometer_broken":true,"odometer_rolled_over":true}', 'listing_v1'),
  ('00000000-0000-4000-9000-000000000009', '00000000-0000-4000-8000-000000000009', '{"mileage":"5","odometer_broken":true}', 'garage_owner_correction_v1');

-- newest_at: the newest listing the caller can see. A private vehicle and an auction source arrive later and do not
-- count; the newest visible listing is the M1010's (no post time, so its first sighting). The F250's post time is later
-- than its first sighting and is not believed.
INSERT INTO public.vehicle_events (vehicle_id, source_platform, source_url, current_price, created_at, metadata) VALUES
  ('00000000-0000-4000-8000-000000000005', 'craigslist', 'https://www.craigslist.org/view/d/e/5b', 9100, now() - interval '5 minutes', '{}'),
  ('00000000-0000-4000-8000-000000000008', 'bat', 'https://bringatrailer.com/listing/y/', 41000, now() - interval '1 minute', '{}');
SELECT pg_temp.ok('newest_at is the newest visible arrival',
  (public.classified_ask_board()->>'newest_at')::timestamptz
    = (SELECT created_at FROM public.vehicle_events WHERE vehicle_id = '00000000-0000-4000-8000-000000000003'));
SELECT pg_temp.ok('newest_at ignores the lenses',
  (public.classified_ask_board(p_tier => 'under_5k')->>'newest_at')::timestamptz
    = (SELECT created_at FROM public.vehicle_events WHERE vehicle_id = '00000000-0000-4000-8000-000000000003')
  AND (public.classified_ask_board(p_tier => 'under_5k')->>'matching')::int = 1);
SELECT pg_temp.ok('listed_at is the post time when it precedes the first sighting',
  (SELECT (r->>'listed_at')::timestamptz = '2026-10-13T16:03:45Z'::timestamptz
   FROM jsonb_array_elements(public.classified_ask_board()->'rows') r WHERE r->>'model' = 'blazer'));
SELECT pg_temp.ok('a post time after the first sighting falls back to the first sighting',
  (SELECT (r->>'listed_at')::timestamptz = (SELECT created_at FROM public.vehicle_events WHERE vehicle_id = '00000000-0000-4000-8000-000000000004')
     AND (r->>'posted_at')::timestamptz = '2099-01-01T00:00:00Z'::timestamptz
   FROM jsonb_array_elements(public.classified_ask_board()->'rows') r WHERE r->>'model' = 'f250'));
SELECT pg_temp.ok('an unknown post time falls back to the first sighting',
  (SELECT (r->>'listed_at')::timestamptz = (r->>'first_seen_at')::timestamptz
   FROM jsonb_array_elements(public.classified_ask_board()->'rows') r WHERE r->>'model' = 'h3t'));

DO $$
DECLARE b jsonb := public.classified_ask_board();
  r jsonb;
BEGIN
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'm1010';
  PERFORM pg_temp.ok('a disclosed broken odometer travels with the row, over rolled over',
    r->>'odometer' = 'broken' AND (r->>'listing_mileage')::int = 10
    AND r->>'observation_id' = '00000000-0000-4000-9000-000000000003');
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'h3t';
  PERFORM pg_temp.ok('rolled over, and the title as stated, lower-cased',
    r->>'odometer' = 'rolled_over' AND r->>'title_status' = 'salvage' AND (r->>'listing_mileage')::int = 123456);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'blazer';
  PERFORM pg_temp.ok('a clean listing: its miles and title, no odometer flag',
    r->'odometer' = 'null'::jsonb AND r->>'title_status' = 'clean' AND (r->>'listing_mileage')::int = 88000);
  PERFORM pg_temp.ok('the seller''s declared condition, as stated, lower-cased (20261017030000)', r->>'condition' = 'like new');
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'f250';
  PERFORM pg_temp.ok('an observation of another vehicle is not read',
    r->'listing_mileage' = 'null'::jsonb AND r->'odometer' = 'null'::jsonb AND r->'title_status' = 'null'::jsonb
    AND r->'condition' = 'null'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'pickup';
  PERFORM pg_temp.ok('as owner, the private correction is readable', r->>'odometer' = 'broken');
END $$;

-- Las Vegas, as a caller would pass it.
\set lat 36.1699
\set lng -115.1398

DO $$
DECLARE b jsonb := public.classified_ask_board();
BEGIN
  PERFORM pg_temp.ok('default window: four public classified vehicles', (b->'population'->>'asks')::int = 5);
  PERFORM pg_temp.ok('priced', (b->'population'->>'priced')::int = 4);
  PERFORM pg_temp.ok('with a point (as owner: the low-confidence row is visible)', (b->'population'->>'with_point')::int = 4);
  PERFORM pg_temp.ok('in the band (stub: Chevrolet)', (b->'population'->>'in_band')::int = 2);
  PERFORM pg_temp.ok('by source', b->'population'->'by_source' = '{"craigslist":4,"ksl":1}'::jsonb);
  PERFORM pg_temp.ok('by tier', b->'population'->'by_tier' = '{"under_5k":1,"5k_15k":2,"15k_40k":1,"unpriced":1}'::jsonb);
  PERFORM pg_temp.ok('band cutoff returned', (b->>'band_min_taste')::int = 60);
  PERFORM pg_temp.ok('window returned', (b->>'window_hours')::int = 24);
  PERFORM pg_temp.ok('newest listed first (the Blazer went up on 10-13 and was seen again today)',
    (SELECT array_agg(r->>'model' ORDER BY o) FROM jsonb_array_elements(b->'rows') WITH ORDINALITY x(r, o))
    = ARRAY['m1010', 'h3t', 'pickup', 'f250', 'blazer']);
  PERFORM pg_temp.ok('one row per vehicle: the newest event and its place',
    (SELECT r->>'asking_price' = '18800' AND r->>'city' = 'Phoenix' AND r->>'posted_at' IS NOT NULL
     FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'blazer'));
  PERFORM pg_temp.ok('a malformed posted_at is null, not an error',
    (SELECT r->'posted_at' = 'null'::jsonb FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'h3t'));
  PERFORM pg_temp.ok('the place is the one for this post, not another URL',
    (SELECT r->>'city' = 'St George' FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'h3t'));
  PERFORM pg_temp.ok('point rounded to 0.01 degree',
    (SELECT (r->>'lat')::numeric = 33.45 AND (r->>'lng')::numeric = -112.07 FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'blazer'));
  PERFORM pg_temp.ok('no distance without a point', (SELECT bool_and(r->'distance_mi' = 'null'::jsonb) FROM jsonb_array_elements(b->'rows') r));
  PERFORM pg_temp.ok('unpriced has no tier', (SELECT r->'tier' = 'null'::jsonb FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'f250'));
END $$;

DO $$
DECLARE b jsonb := public.classified_ask_board(p_lat => 36.1699, p_lng => -115.1398, p_sort => 'nearest');
BEGIN
  PERFORM pg_temp.ok('nearest first, no place last', (SELECT array_agg(r->>'model' ORDER BY o) FROM jsonb_array_elements(b->'rows') WITH ORDINALITY x(r, o))
    = ARRAY['m1010', 'h3t', 'pickup', 'blazer', 'f250']);
  PERFORM pg_temp.ok('distances in miles',
    (SELECT (r->>'distance_mi')::int = 0 FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'm1010')
    AND (SELECT (r->>'distance_mi')::int BETWEEN 100 AND 120 FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'h3t')
    AND (SELECT (r->>'distance_mi')::int BETWEEN 240 AND 270 FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'blazer'));
END $$;

SELECT pg_temp.ok('radius 150 mi', (public.classified_ask_board(p_lat => 36.1699, p_lng => -115.1398, p_radius_mi => 150)->>'matching')::int = 2);
SELECT pg_temp.ok('tier filter', (public.classified_ask_board(p_tier => '5k_15k')->>'matching')::int = 2);
SELECT pg_temp.ok('band filter', (public.classified_ask_board(p_min_taste => 60)->>'matching')::int = 2);
SELECT pg_temp.ok('population ignores filters', (public.classified_ask_board(p_tier => '5k_15k')->'population'->>'asks')::int = 5);
SELECT pg_temp.ok('48 h window adds the 30 h old ask', (public.classified_ask_board(p_hours => 48)->'population'->>'asks')::int = 6);
SELECT pg_temp.ok('window clamped to 168 h', (public.classified_ask_board(p_hours => 10000)->>'window_hours')::int = 168);
SELECT pg_temp.ok('price sort, cheapest first',
  (public.classified_ask_board(p_sort => 'price')->'rows'->0->>'model') = 'pickup');
SELECT pg_temp.ok('band sort', (public.classified_ask_board(p_sort => 'band')->'rows'->0->>'make') = 'Chevrolet');
SELECT pg_temp.ok('page size and offset',
  jsonb_array_length(public.classified_ask_board(p_limit => 2)->'rows') = 2
  AND (public.classified_ask_board(p_limit => 2, p_offset => 2)->'rows'->0->>'model') = 'pickup');

-- 20261017030000: what each listing is and where its ask sits.
-- Families: the Blazer (1969..1994), the H3T (2009..2010), the Toyota pickup (1979..1995); the F250's family starts in
-- 1999, so a 1979 F250 is not claimed; the M1010 has no family.
INSERT INTO public.mv_model_family_names (make_l, model_l, vehicles, make, family_id, family, matched, year_start, year_end) VALUES
  ('chevrolet', 'blazer', 1, 'Chevrolet', '00000000-0000-4000-c000-000000000001', 'Blazer', 'blazer', 1969, 1994),
  ('hummer', 'h3t', 1, 'Hummer', '00000000-0000-4000-c000-000000000002', 'H3T', 'h3t', 2009, 2010),
  ('toyota', 'pickup', 1, 'Toyota', '00000000-0000-4000-c000-000000000003', 'Pickup', 'pickup', 1979, 1995),
  ('ford', 'f250', 1, 'Ford', '00000000-0000-4000-c000-000000000004', 'F-250', 'f250', 1999, NULL),
  ('chevrolet', 'm1010', 1, 'Chevrolet', NULL, NULL, NULL, NULL, NULL);
-- Blazer 1984: 20 recorded sales at 5,000 .. 100,000 (1983..1985); 12 asks at 10,000 .. 32,000 including this Blazer's
-- own 18,800, from a refresh dated tomorrow (so today's listing is in it and is taken out). H3T 2009: 6 sales (thin).
-- Pickup 1985: exactly 10 sales at 1,000 .. 10,000. A sold row for the F250 that must not be read.
INSERT INTO public.mv_family_year_prices (family_id, year, basis, year_from, year_to, n, offered, conflicts, thin, p25, p50, p75,
  prices, dated, first_on, last_on, n_24m, by_source, as_of) VALUES
  ('00000000-0000-4000-c000-000000000001', 1984, 'sold', 1983, 1985, 20, 25, 2, false, 28750, 52500, 76250,
   (SELECT array_agg(g * 5000 ORDER BY g) FROM generate_series(1, 20) g), 18, '2014-01-24', '2026-09-30', 7,
   '{"Bring a Trailer": 14, "Mecum": 6}', now()),
  ('00000000-0000-4000-c000-000000000001', 1984, 'asked', 1984, 1984, 12, NULL, NULL, false, 15500, 19400, 25500,
   ARRAY[10000,12000,14000,16000,18000,18800,20000,22000,24000,26000,28000,30000], 12, '2026-03-01', '2026-10-14', 12,
   '{"Craigslist": 3, "Facebook Marketplace": 9}', now() + interval '1 day'),
  ('00000000-0000-4000-c000-000000000002', 2009, 'sold', 2004, 2014, 6, 6, 0, true, NULL, NULL, NULL,
   ARRAY[20000,21000,22000,23000,24000,25000], 6, '2022-01-01', '2026-01-01', 2, '{"Bring a Trailer": 6}', now()),
  ('00000000-0000-4000-c000-000000000003', 1985, 'sold', 1985, 1985, 10, 10, 0, false, 3250, 5500, 7750,
   (SELECT array_agg(g * 1000 ORDER BY g) FROM generate_series(1, 10) g), 10, '2020-01-01', '2026-01-01', 4,
   '{"Bring a Trailer": 10}', now()),
  ('00000000-0000-4000-c000-000000000004', 1979, 'sold', 1979, 1979, 10, 10, 0, false, 1, 1, 1,
   ARRAY[1,1,1,1,1,1,1,1,1,1], 10, NULL, NULL, 0, '{}', now());
-- Odometers (20261015160000): the Blazer's 20 sales read 10,000 .. 200,000 (median 100,000) and its asks 3 readings;
-- the H3T's sales 12 readings, but the H3T discloses a rolled-over odometer.
-- (fixture table, not testimony)
UPDATE public.mv_family_year_prices SET n_miles = 20, miles_p50 = 100000,
  miles = (SELECT array_agg(g * 10000 ORDER BY g) FROM generate_series(1, 20) g)
  WHERE family_id = '00000000-0000-4000-c000-000000000001' AND basis = 'sold';
UPDATE public.mv_family_year_prices SET n_miles = 3, miles = ARRAY[50000, 90000, 150000]
  WHERE family_id = '00000000-0000-4000-c000-000000000001' AND basis = 'asked';
-- Venues (20261015215000): the Blazer's sales by source with their medians.
UPDATE public.mv_family_year_prices SET venues = '{"Bring a Trailer": {"n": 14, "p50": 60000}, "Mecum": {"n": 6, "p50": 35000}}'
  WHERE family_id = '00000000-0000-4000-c000-000000000001' AND basis = 'sold';
UPDATE public.mv_family_year_prices SET n_miles = 12, miles_p50 = 60000,
  miles = (SELECT array_agg(g * 10000 ORDER BY g) FROM generate_series(1, 12) g)
  WHERE family_id = '00000000-0000-4000-c000-000000000002' AND basis = 'sold';

DO $$
DECLARE b jsonb := public.classified_ask_board();
  r jsonb;
BEGIN
  PERFORM pg_temp.ok('population: 3 keyed (Blazer, H3T, pickup), 2 placed among sales, 1 among asks, none with merit',
    (b->'population'->>'keyed')::int = 3 AND (b->'population'->>'positioned_sold')::int = 2
    AND (b->'population'->>'positioned_asked')::int = 1 AND (b->'population'->>'with_merit')::int = 0
    AND b->'merit_model' = 'null'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'blazer';
  PERFORM pg_temp.ok('Blazer: family, 3 of 20 recorded 1983-85 sales at or below 18,800, the sold band and its venues',
    r->'position'->>'family' = 'Blazer' AND (r->'position'->'sold'->>'n')::int = 20
    AND (r->'position'->'sold'->>'at_or_below')::int = 3 AND (r->'position'->'sold'->>'year_from')::int = 1983
    AND (r->'position'->'sold'->>'p50')::int = 52500 AND (r->'position'->'sold'->>'conflicts')::int = 2
    AND r->'position'->'sold'->'by_source' = '{"Bring a Trailer": 14, "Mecum": 6}'::jsonb);
  PERFORM pg_temp.ok('Blazer: its own ask is taken out of the asks: 5 of 11 at or below',
    (r->'position'->'asked'->>'n')::int = 11 AND (r->'position'->'asked'->>'at_or_below')::int = 5
    AND (r->'position'->'asked'->>'thin')::boolean IS FALSE);
  PERFORM pg_temp.ok('Blazer: no merit without an active model', r->'merit' = 'null'::jsonb);
  PERFORM pg_temp.ok('Blazer venues travel with the sold position',
    r->'position'->'sold'->'venues' = '{"Bring a Trailer": {"n": 14, "p50": 60000}, "Mecum": {"n": 6, "p50": 35000}}'::jsonb
    AND r->'position'->'asked'->'venues' = '{}'::jsonb);
  PERFORM pg_temp.ok('Blazer miles: its stated 88,000 sits above 8 of 20 recorded sales'' readings (median 100,000); 3 ask readings place nothing',
    (r->>'read_miles')::int = 88000 AND r->'position'->'sold'->'miles' = '{"n": 20, "p50": 100000, "at_or_below": 8}'::jsonb
    AND r->'position'->'asked'->'miles' = '{"n": 3, "p50": null, "at_or_below": null}'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'h3t';
  PERFORM pg_temp.ok('H3T miles: a disclosed rolled-over odometer places nothing, though 12 readings exist',
    r->'read_miles' = 'null'::jsonb AND r->'position'->'sold'->'miles'->'at_or_below' = 'null'::jsonb
    AND (r->'position'->'sold'->'miles'->>'n')::int = 12);
  PERFORM pg_temp.ok('H3T: 6 recorded sales are thin: no band, no at_or_below; no asks',
    (r->'position'->'sold'->>'thin')::boolean AND r->'position'->'sold'->'at_or_below' = 'null'::jsonb
    AND (r->'position'->'sold'->>'n')::int = 6 AND r->'position'->'asked' = 'null'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'pickup';
  PERFORM pg_temp.ok('pickup: exactly 10 sales place it: 4 at or below 4,500',
    (r->'position'->'sold'->>'at_or_below')::int = 4);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'f250';
  PERFORM pg_temp.ok('a 1979 F250 is outside its family''s years: no position', r->'position' = 'null'::jsonb);
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'm1010';
  PERFORM pg_temp.ok('a name without a family: no position', r->'position' = 'null'::jsonb);
  PERFORM pg_temp.ok('newest_seen_at is the newest first sighting (capture time)',
    (b->>'newest_seen_at')::timestamptz = (SELECT created_at FROM public.vehicle_events
                                           WHERE vehicle_id = '00000000-0000-4000-8000-000000000003'));
  SELECT x INTO r FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'blazer';
  PERFORM pg_temp.ok('share: asks when there are 10 (Blazer 5 of 11), else sales (pickup 4 of 10)',
    (r->'position'->>'share')::numeric = 0.455 AND r->'position'->>'basis' = 'asked'
    AND (SELECT (x->'position'->>'share')::numeric = 0.4 AND x->'position'->>'basis' = 'sold'
         FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'pickup'));
  PERFORM pg_temp.ok('position sort: lowest share first, unplaced rows after, newest first among them',
    (SELECT array_agg(x->>'model' ORDER BY o) FROM jsonb_array_elements(public.classified_ask_board(p_sort => 'position')->'rows')
       WITH ORDINALITY y(x, o)) = ARRAY['pickup', 'blazer', 'm1010', 'h3t', 'f250']);
  PERFORM pg_temp.ok('merit sort with no model keeps newest first',
    (SELECT array_agg(x->>'model' ORDER BY o) FROM jsonb_array_elements(public.classified_ask_board(p_sort => 'merit')->'rows')
       WITH ORDINALITY y(x, o))
    = (SELECT array_agg(x->>'model' ORDER BY o) FROM jsonb_array_elements(b->'rows') WITH ORDINALITY y(x, o)));
END $$;

-- An active model on two features: logit = -3 + 1 * ln(p50 / ask) + 0.5 * ln(n) (coef 1 over sd 2). Blazer: -3 +
-- ln(52500/18800) + 0.5 ln 20 = -0.4752, chance 0.383; pickup: -3 + ln(5500/4500) + 0.5 ln 10 = -1.6480, chance 0.161.
INSERT INTO public.listing_exit_models (version, active, horizon_days, label, intercept, features, base_rate, trained_on, evaluated_on, receipt)
VALUES ('test_v1', true, 7, 'gone within 7 days of first sight', -3,
  '[{"name": "log_sold_p50_over_ask", "mean": 0, "sd": 1, "coef": 1}, {"name": "log_sold_n", "mean": 0, "sd": 2, "coef": 1}]',
  0.07, '{}', '{}', 'test');
DO $$
DECLARE b jsonb := public.classified_ask_board(p_sort => 'merit');
BEGIN
  PERFORM pg_temp.ok('merit: the model''s chance per placed row, by hand (Blazer 0.383, pickup 0.161); the model is named',
    (SELECT (x->'merit'->>'exit7')::numeric FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'blazer') = 0.383
    AND (SELECT (x->'merit'->>'exit7')::numeric FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'pickup') = 0.161
    AND b->'merit_model'->>'version' = 'test_v1' AND (b->'population'->>'with_merit')::int = 2);
  PERFORM pg_temp.ok('merit sort: highest chance first, rows without merit after, newest first among them',
    (SELECT array_agg(x->>'model' ORDER BY o) FROM jsonb_array_elements(b->'rows') WITH ORDINALITY y(x, o))
    = ARRAY['blazer', 'pickup', 'm1010', 'h3t', 'f250']);
  PERFORM pg_temp.ok('merit is not imputed: the thin H3T has none',
    (SELECT x->'merit' = 'null'::jsonb FROM jsonb_array_elements(b->'rows') x WHERE x->>'model' = 'h3t'));
END $$;
-- A model naming a feature the board does not compute gives no merit at all.
UPDATE public.listing_exit_models SET active = false WHERE version = 'test_v1';
INSERT INTO public.listing_exit_models (version, active, horizon_days, label, intercept, features, base_rate, trained_on, evaluated_on, receipt)
VALUES ('test_v2', true, 7, 'l', 0, '[{"name": "colour", "mean": 0, "sd": 1, "coef": 1}]', 0.07, '{}', '{}', 'test');
SELECT pg_temp.ok('an unknown feature: no merit on any row',
  (public.classified_ask_board()->'population'->>'with_merit')::int = 0);
UPDATE public.listing_exit_models SET active = false WHERE version = 'test_v2';

DO $$
DECLARE bad text[] := ARRAY[
  'SELECT public.classified_ask_board(p_lat => 36)',
  'SELECT public.classified_ask_board(p_lat => 95, p_lng => 0)',
  'SELECT public.classified_ask_board(p_radius_mi => 50)',
  'SELECT public.classified_ask_board(p_lat => 36, p_lng => -115, p_radius_mi => 0)',
  'SELECT public.classified_ask_board(p_tier => ''cheap'')',
  'SELECT public.classified_ask_board(p_sort => ''nearest'')',
  'SELECT public.classified_ask_board(p_sort => ''random'')'];
  q text;
BEGIN
  FOREACH q IN ARRAY bad LOOP
    BEGIN
      EXECUTE q;
      RAISE EXCEPTION 'Contract failed: accepted %', q;
    EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS refused %', q;
    END;
  END LOOP;
END $$;

SELECT pg_temp.ok('PUBLIC cannot execute', NOT has_function_privilege('public',
  'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)', 'execute'));
SELECT pg_temp.ok('anon, authenticated and service_role can',
  has_function_privilege('anon', 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)', 'execute')
  AND has_function_privilege('authenticated', 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)', 'execute')
  AND has_function_privilege('service_role', 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)', 'execute'));
SELECT pg_temp.ok('security invoker', NOT prosecdef) FROM pg_proc WHERE proname = 'classified_ask_board';

GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean) TO anon;
SET ROLE anon;
DO $$
DECLARE b jsonb := public.classified_ask_board();
BEGIN
  PERFORM pg_temp.ok('anon: same asks', (b->'population'->>'asks')::int = 5);
  PERFORM pg_temp.ok('anon: a seller''s broken-odometer disclosure is public',
    (SELECT r->>'odometer' = 'broken' FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'm1010'));
  PERFORM pg_temp.ok('anon: an owner''s private correction stays hidden',
    (SELECT r->'odometer' = 'null'::jsonb AND r->'listing_mileage' = 'null'::jsonb FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'pickup'));
  PERFORM pg_temp.ok('anon: the same newest arrival', (b->>'newest_at')::timestamptz
    = (SELECT created_at FROM public.vehicle_events WHERE vehicle_id = '00000000-0000-4000-8000-000000000003'));
  PERFORM pg_temp.ok('anon: a low-confidence place stays hidden', (b->'population'->>'with_point')::int = 3
    AND (SELECT r->'city' = 'null'::jsonb FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'pickup'));
  PERFORM pg_temp.ok('anon: the same position (family, sales and asks)',
    (SELECT (r->'position'->'sold'->>'at_or_below')::int = 3 AND (r->'position'->'asked'->>'at_or_below')::int = 5
     FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'blazer'));
END $$;
RESET ROLE;
