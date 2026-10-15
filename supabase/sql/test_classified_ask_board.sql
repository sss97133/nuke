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
-- lenses ignored, the same for anon) and the hash guard that lets the newer migration apply again.
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

-- The live read policies.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_location_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true);
CREATE POLICY vehicle_events_public_read ON public.vehicle_events FOR SELECT USING (true);
CREATE POLICY vlo_public_read ON public.vehicle_location_observations FOR SELECT
  USING (confidence >= 0.50 AND source_type <> 'sighting');
GRANT SELECT ON public.vehicles, public.vehicle_events, public.vehicle_location_observations TO anon, authenticated;

-- Stub of the production scorer: Chevrolet scores 70, everything else 10.
CREATE FUNCTION public.compute_taste_score(p_title text, p_parsed_year integer, p_parsed_make text, p_parsed_model text,
  p_location text DEFAULT NULL) RETURNS smallint LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN lower(p_parsed_make) = 'chevrolet' THEN 70 ELSE 10 END::smallint $$;

\ir ../migrations/20261013233000_classified_ask_board.sql
\ir ../migrations/20261013233000_classified_ask_board.sql
\ir ../migrations/20261015070000_classified_ask_board_listed_at.sql
\ir ../migrations/20261015070000_classified_ask_board_listed_at.sql
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
     '{"listing_posted_at":"2026-10-13T16:03:45.000Z"}'),
  ('00000000-0000-4000-8000-000000000002', 'craigslist', 'https://www.craigslist.org/view/d/b/2', 12500, now() - interval '3 hours', '{"listing_posted_at":"soon"}'),
  ('00000000-0000-4000-8000-000000000003', 'craigslist', 'https://www.craigslist.org/view/d/c/3', 13500, now() - interval '30 minutes', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'ksl', 'https://www.ksl.com/listing/4', NULL, now() - interval '5 hours',
     '{"listing_posted_at":"2099-01-01T00:00:00Z"}'),
  ('00000000-0000-4000-8000-000000000005', 'craigslist', 'https://www.craigslist.org/view/d/e/5', 9000, now() - interval '1 hour', '{}'),
  ('00000000-0000-4000-8000-000000000006', 'craigslist', 'https://www.craigslist.org/view/d/f/6', 9000, now() - interval '1 hour', '{}'),
  ('00000000-0000-4000-8000-000000000007', 'facebook_marketplace', 'https://www.facebook.com/marketplace/item/7/', 22000, now() - interval '30 hours', '{}'),
  ('00000000-0000-4000-8000-000000000008', 'bat', 'https://bringatrailer.com/listing/x/', 40000, now() - interval '1 hour', '{}'),
  ('00000000-0000-4000-8000-000000000009', 'craigslist', 'https://www.craigslist.org/view/d/i/9', 4500, now() - interval '4 hours', '{}'),
  ('00000000-0000-4000-8000-000000000010', 'craigslist', 'https://www.craigslist.org/view/d/j/10', 300, now() - interval '1 hour', '{}');
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_url, observed_at, city, region_code, latitude, longitude, confidence) VALUES
  ('00000000-0000-4000-8000-000000000001', 'listing', 'https://www.craigslist.org/view/d/a/1', now() - interval '2 hours', 'Old', 'AZ', 10, 10, 0.8),
  ('00000000-0000-4000-8000-000000000001', 'listing', 'https://www.craigslist.org/view/d/a/1', now() - interval '1 hour', 'Phoenix', 'AZ', 33.448376, -112.074036, 0.8),
  ('00000000-0000-4000-8000-000000000002', 'listing', 'https://www.craigslist.org/view/d/b/2', now(), 'St George', 'UT', 37.0965, -113.5684, 0.8),
  ('00000000-0000-4000-8000-000000000002', 'listing', 'https://other.example/elsewhere', now(), 'Elsewhere', 'ME', 44.0, -70.0, 0.8),
  ('00000000-0000-4000-8000-000000000003', 'listing', 'https://www.craigslist.org/view/d/c/3', now(), 'Las Vegas', 'NV', 36.1699, -115.1398, 0.8),
  ('00000000-0000-4000-8000-000000000009', 'listing', 'https://www.craigslist.org/view/d/i/9', now(), 'Hidden', 'CA', 34.05, -118.24, 0.3);

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
  PERFORM pg_temp.ok('anon: the same newest arrival', (b->>'newest_at')::timestamptz
    = (SELECT created_at FROM public.vehicle_events WHERE vehicle_id = '00000000-0000-4000-8000-000000000003'));
  PERFORM pg_temp.ok('anon: a low-confidence place stays hidden', (b->'population'->>'with_point')::int = 3
    AND (SELECT r->'city' = 'null'::jsonb FROM jsonb_array_elements(b->'rows') r WHERE r->>'model' = 'pickup'));
END $$;
RESET ROLE;
