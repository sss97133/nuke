-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_archive_history -f this-file.sql
-- Proves migration 20261021030000: hero_finds() stops returning hidden or deleted vehicles in all three blocks, and
-- get_comps_scored(...) dates a vehicle-record comp by its sale date. The functions start as production had them on
-- 2026-10-20 (helpers/archive_history_readers_live_20261020.sql, checked by md5), the leak is shown on them, the
-- migration is applied, and the same reads are repeated. Security, search settings and grants must not change.
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

-- The shapes the two readers touch.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, trim text, vin text, deal_score numeric, heat_score numeric,
  primary_image_url text, sale_price integer, asking_price numeric, current_value numeric, mileage integer, color text,
  location text, listing_url text, engine_type text, transmission text, drivetrain text, body_style text,
  sale_date date, bat_sale_date date, is_public boolean DEFAULT true, deleted_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.auction_comments (id bigserial PRIMARY KEY, vehicle_id uuid, posted_at timestamptz);
CREATE TABLE public.vehicle_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_platform text, created_at timestamptz DEFAULT now());
CREATE TABLE public.auction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, winning_bid numeric, outcome text, source_url text, source text,
  auction_end_date timestamptz);
CREATE FUNCTION public.classify_transmission(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.extract_cylinder_count(text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::integer $$;
CREATE FUNCTION public.extract_engine_config(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.classify_drivetrain(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::text $$;

\ir helpers/archive_history_readers_live_20261020.sql
GRANT EXECUTE ON FUNCTION public.hero_finds() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_comps_scored(text, text, integer, integer, text, text, text, integer, text, text, numeric, numeric, uuid, integer) TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(
  md5(pg_get_functiondef('public.hero_finds()'::regprocedure)) = 'cc927539cc82926473880e16b6a4c9f6'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.get_comps_scored(text,text,integer,integer,text,text,text,integer,text,text,numeric,numeric,uuid,integer)'::regprocedure)) = '2f3fe5d084c5379c5ba2feae50a294c5',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- Three vehicles alike in every way the finds read, created today with a rare model and a price over $10,000:
-- P is public, H is hidden (an archive-only vehicle after set_vehicle_visibility), D is deleted.
INSERT INTO public.vehicles (id, year, make, model, deal_score, heat_score, asking_price, is_public, deleted_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 1965, 'Shelby', 'Cobra P', 80, 1, 50000, true, NULL),
  ('00000000-0000-0000-0000-0000000000a2', 1965, 'Shelby', 'Cobra H', 80, 1, 50000, false, NULL),
  ('00000000-0000-0000-0000-0000000000a3', 1965, 'Shelby', 'Cobra D', 80, 1, 50000, true, now());
INSERT INTO public.vehicle_events (vehicle_id, source_platform)
SELECT v.id, p FROM public.vehicles v, unnest(ARRAY['ebay_motors', 'bat']) p;

-- Vehicle-record comps: a 2010 archive sale (hidden) and a public sale with only bat_sale_date.
INSERT INTO public.vehicles (id, year, make, model, sale_price, sale_date, bat_sale_date, is_public) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 1965, 'Ford', 'Mustang', 4999, '2010-04-29', NULL, false),
  ('00000000-0000-0000-0000-0000000000c2', 1966, 'Ford', 'Mustang', 30000, NULL, '2024-03-02', true),
  ('00000000-0000-0000-0000-0000000000c3', 1967, 'Ford', 'Mustang', 25000, NULL, NULL, true);

CREATE FUNCTION public.t_finds(p_block text) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(right(e ->> 'id', 2) ORDER BY e ->> 'id'), '{}') FROM jsonb_array_elements(public.hero_finds() -> p_block) e WHERE e ->> 'make' = 'Shelby' $$;
CREATE FUNCTION public.t_comp_dates() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(right(c.vehicle_id::text, 2), c.sold_date)
  FROM public.get_comps_scored('Ford', 'Mustang', 1966, 5) c WHERE c.source_type = 'vehicle_record' $$;

-- 1. On the live bodies: hidden and deleted vehicles are finds, and vehicle-record comps are undated.
SELECT public.t_assert(public.t_finds('rare_finds') = ARRAY['a1', 'a2', 'a3'], 'before: rare_finds holds hidden and deleted rows');
SELECT public.t_assert(public.t_finds('multi_platform') = ARRAY['a1', 'a2', 'a3'], 'before: multi_platform holds hidden and deleted rows');
SELECT public.t_assert(public.t_finds('multi_signal') = ARRAY['a1', 'a2', 'a3'], 'before: multi_signal holds hidden and deleted rows');
SELECT public.t_assert(public.t_comp_dates() = '{"c1": null, "c2": null, "c3": null}'::jsonb, 'before: vehicle-record comps are undated');

-- 2. The migration.
\ir ../migrations/20261021030000_archive_history_readers_public_and_dated.sql

-- 3. Only the public, undeleted vehicle is a find, in every block.
SELECT public.t_assert(public.t_finds('rare_finds') = ARRAY['a1'], 'after: rare_finds is public rows only');
SELECT public.t_assert(public.t_finds('multi_platform') = ARRAY['a1'], 'after: multi_platform is public rows only');
SELECT public.t_assert(public.t_finds('multi_signal') = ARRAY['a1'], 'after: multi_signal is public rows only');

-- 4. Each vehicle-record comp carries its own sale date; a sale with no date stays undated; the hidden 2010 sale is
--    still a comp, dated 2010.
SELECT public.t_assert(public.t_comp_dates() =
  '{"c1": "2010-04-29T00:00:00+00:00", "c2": "2024-03-02T00:00:00+00:00", "c3": null}'::jsonb,
  format('after: comps dated by sale date (got %s)', public.t_comp_dates()));
SELECT public.t_assert((SELECT sold_date FROM public.get_comps_scored('Ford', 'Mustang', 1966, 5) LIMIT 1) IS NOT NULL,
  'after: dated comps sort ahead of the undated one at equal similarity');

-- 5. Security, settings and grants are as they were.
SELECT public.t_assert(p.prosecdef AND p.proconfig = ARRAY['statement_timeout=10s']
  AND has_function_privilege('anon', p.oid, 'EXECUTE'), format('%s keeps SECURITY DEFINER, its timeout and anon EXECUTE', p.proname))
FROM pg_proc p WHERE p.proname IN ('hero_finds', 'get_comps_scored') AND p.pronamespace = 'public'::regnamespace;

-- 6. A re-run is a no-op.
\ir ../migrations/20261021030000_archive_history_readers_public_and_dated.sql
SELECT public.t_assert(public.t_finds('rare_finds') = ARRAY['a1'], 'rerun: unchanged');

\echo 'test_archive_history_readers: PASS'
