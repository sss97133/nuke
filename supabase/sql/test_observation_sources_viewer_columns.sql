-- Contract for 20261126011500_observation_sources_viewer_columns (empty disposable PG17).
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixture rows in an empty disposable PG17 database only (stub tables, not production).
-- The table holds the live 26 columns, the live policy and the live grants. After the migration: authenticated reads the
-- 24 viewer columns (rows as before, joins as the pages embed them) and gets 42501 on notes, trust_factors
-- and select *; anon reads the viewer columns (0 rows, no policy) and nothing else; the guard refuses
-- an unclassed column; a re-run changes nothing; a grant that lets an internal column through fails the check; the
-- revert restores table-level SELECT.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.observation_sources') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE public.observation_sources (
  id uuid PRIMARY KEY, slug text UNIQUE, display_name text, category text, base_url text, url_patterns text[],
  base_trust_score numeric, trust_factors jsonb DEFAULT '{}', supported_observations text[], requires_auth boolean,
  rate_limit_per_hour int, makes_covered text[], years_covered int4range, regions_covered text[], notes text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), business_id uuid, tier int,
  decay_half_life_days int, veracity numeric, consecration numeric, market_slug text, species text, species_set text[],
  species_evidence jsonb);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, source_id uuid);
ALTER TABLE public.observation_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated_read_observation_sources ON public.observation_sources FOR SELECT TO authenticated USING (true);
GRANT SELECT, REFERENCES, TRIGGER ON public.observation_sources TO anon, authenticated;
GRANT SELECT ON public.vehicle_observations TO anon, authenticated;
INSERT INTO public.observation_sources (id, slug, display_name, notes, trust_factors, species_evidence) VALUES
  ('00000000-0000-0000-0000-00000000b001', 'fixture-house', 'Fixture House', 'internal fixture note', '{"thesis": "x"}', '{"seen": "x"}'),
  ('00000000-0000-0000-0000-00000000b002', 'fixture-dealer', 'Fixture Dealer', NULL, '{}', NULL);
INSERT INTO public.vehicle_observations VALUES ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000b001');

-- What a role can read, column by column: the check every case below uses.
CREATE FUNCTION pg_temp.readable(p_role text) RETURNS text[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(attname::text ORDER BY attname) FILTER (WHERE has_column_privilege(p_role, 'public.observation_sources', attname, 'SELECT')), '{}')
  FROM pg_attribute WHERE attrelid = 'public.observation_sources'::regclass AND attnum > 0 AND NOT attisdropped $f$;
CREATE FUNCTION pg_temp.check_withheld() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF cardinality(pg_temp.readable(r)) <> 24 OR pg_temp.readable(r) && ARRAY['notes', 'trust_factors'] THEN
      RETURN format('%s reads %s columns: %s', r, cardinality(pg_temp.readable(r)), pg_temp.readable(r));
    END IF;
  END LOOP;
  RETURN NULL;
END $f$;
-- One read as a role, by dynamic SQL (a fresh plan per role); 42501 is returned, not raised.
CREATE FUNCTION pg_temp.try(p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  EXECUTE p_sql INTO n;
  RESET ROLE;
  RETURN n::text;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN '42501';
END $f$;

DO $$ BEGIN
  IF pg_temp.check_withheld() IS NULL THEN RAISE EXCEPTION 'FAIL fixture: the internal columns are already withheld'; END IF;
  IF pg_temp.try('authenticated', 'SELECT count(notes) FROM public.observation_sources') <> '1' THEN
    RAISE EXCEPTION 'FAIL fixture: a signed-in reader should read notes before the migration';
  END IF;
  RAISE NOTICE 'PASS before: a signed-in reader reads notes on 1 of 2 rows (the leak)';
END $$;

-- The guard refuses an unclassed column.
ALTER TABLE public.observation_sources ADD COLUMN fixture_unclassed text;
\set ON_ERROR_STOP off
\ir ../migrations/20261126011500_observation_sources_viewer_columns.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT has_table_privilege('authenticated', 'public.observation_sources', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL guard: grants changed with an unclassed column present';
  END IF;
  RAISE NOTICE 'PASS guard refuses a column nobody has classed';
END $$;
ALTER TABLE public.observation_sources DROP COLUMN fixture_unclassed;

\ir ../migrations/20261126011500_observation_sources_viewer_columns.sql
\ir ../migrations/20261126011500_observation_sources_viewer_columns.sql

DO $$
DECLARE c text; v text; bad text := pg_temp.check_withheld();
BEGIN
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL grants: %', bad; END IF;
  RAISE NOTICE 'PASS anon and authenticated each read exactly the 24 viewer columns (applied twice)';
  FOREACH c IN ARRAY ARRAY['notes', 'trust_factors', '*'] LOOP
    v := pg_temp.try('authenticated', format('SELECT count(*) FROM (SELECT %s FROM public.observation_sources) x',
                                            CASE c WHEN '*' THEN '*' ELSE quote_ident(c) END));
    IF v <> '42501' THEN RAISE EXCEPTION 'FAIL: a signed-in reader selected % (%)', c, v; END IF;
  END LOOP;
  RAISE NOTICE 'PASS a signed-in reader gets 42501 on notes, trust_factors and select *';
  v := pg_temp.try('authenticated', 'SELECT count(*) FROM (SELECT id, slug, display_name, category, base_url, url_patterns, base_trust_score, supported_observations, requires_auth, rate_limit_per_hour, makes_covered, years_covered, regions_covered, created_at, updated_at, business_id, tier, decay_half_life_days, veracity, consecration, market_slug, species, species_set, species_evidence FROM public.observation_sources) x');
  IF v <> '2' THEN RAISE EXCEPTION 'FAIL: the image page''s 24-column read returned %', v; END IF;
  v := pg_temp.try('authenticated', 'SELECT count(s.display_name) FROM public.vehicle_observations o LEFT JOIN public.observation_sources s ON s.id = o.source_id');
  IF v <> '1' THEN RAISE EXCEPTION 'FAIL: the pages'' (display_name, slug) embed returned %', v; END IF;
  v := pg_temp.try('authenticated', 'SELECT count(*) FROM public.observation_sources');
  IF v <> '2' THEN RAISE EXCEPTION 'FAIL: a signed-in count(*) returned %', v; END IF;
  RAISE NOTICE 'PASS a signed-in reader keeps both rows through the 24-column read, the embed and count(*)';
  v := pg_temp.try('anon', 'SELECT count(id) FROM public.observation_sources');
  IF v <> '0' THEN RAISE EXCEPTION 'FAIL: anon read % rows (no policy, want 0 and no error)', v; END IF;
  IF pg_temp.try('anon', 'SELECT count(notes) FROM public.observation_sources') <> '42501' THEN
    RAISE EXCEPTION 'FAIL: anon selected notes';
  END IF;
  RAISE NOTICE 'PASS anon reads viewer columns (0 rows, no error) and gets 42501 on notes';
END $$;

-- Mutant: a grant that lets one internal column through must fail the check.
GRANT SELECT (trust_factors) ON public.observation_sources TO authenticated;
DO $$ BEGIN
  IF pg_temp.check_withheld() IS NULL THEN RAISE EXCEPTION 'FAIL mutant survived: trust_factors granted, check passed'; END IF;
  RAISE NOTICE 'PASS mutant killed: %', pg_temp.check_withheld();
END $$;
REVOKE SELECT (trust_factors) ON public.observation_sources FROM authenticated;

\ir revert_20261126011500_observation_sources_viewer_columns.sql
DO $$ BEGIN
  IF NOT has_table_privilege('authenticated', 'public.observation_sources', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.observation_sources', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL revert: table-level SELECT not restored';
  END IF;
  RAISE NOTICE 'PASS revert restores table-level SELECT';
END $$;
