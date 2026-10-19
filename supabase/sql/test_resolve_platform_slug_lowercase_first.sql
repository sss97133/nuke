-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- Contract for 20261015023000_resolve_platform_slug_lowercase_first.sql: the platform resolver behind
-- vehicles.canonical_platform keeps its alias lookup, and its fallback lowercases before it strips characters, so a
-- capital letter is no longer deleted ('Affordable Classics' resolved to 'ffordable-lassics' before). The function keeps
-- its signature, volatility and parallel safety, and the migration applies twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- The two columns the resolver reads.
CREATE TABLE public.source_alias_mapping(raw_value text PRIMARY KEY, canonical_slug text NOT NULL);
INSERT INTO public.source_alias_mapping VALUES ('bringatrailer', 'bat'), ('facebook_marketplace', 'facebook-marketplace');
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- The live body before the migration (read from pg_get_functiondef on 2026-10-14), to show the defect it repairs.
CREATE FUNCTION public.resolve_platform_slug(raw text) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $f$
  SELECT COALESCE(
    (SELECT canonical_slug FROM source_alias_mapping WHERE raw_value = raw),
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(raw, '[_\s]+', '-', 'g'), '[^a-z0-9-]', '', 'g')))
  );
$f$;
SELECT pg_temp.ok('before: the fallback deletes capitals',
  public.resolve_platform_slug('Affordable Classics') = 'ffordable-lassics');

\ir ../migrations/20261015023000_resolve_platform_slug_lowercase_first.sql
-- A second application is a no-op that passes the migration's own assertions.
\ir ../migrations/20261015023000_resolve_platform_slug_lowercase_first.sql

SELECT pg_temp.ok('fallback keeps capital letters as lowercase',
  public.resolve_platform_slug('Affordable Classics') = 'affordable-classics');
SELECT pg_temp.ok('fallback turns spaces and underscores into one hyphen and trims the edges',
  public.resolve_platform_slug('  Worldwide_Vintage  Autos ') = 'worldwide-vintage-autos');
SELECT pg_temp.ok('fallback drops punctuation after lowercasing',
  public.resolve_platform_slug('L''Art de l''Automobile') = 'lart-de-lautomobile');
SELECT pg_temp.ok('an already-clean slug is unchanged', public.resolve_platform_slug('cars-and-bids') = 'cars-and-bids');
SELECT pg_temp.ok('alias lookup wins over the fallback', public.resolve_platform_slug('bringatrailer') = 'bat');
SELECT pg_temp.ok('alias lookup is exact', public.resolve_platform_slug('facebook_marketplace') = 'facebook-marketplace');
SELECT pg_temp.ok('NULL stays NULL', public.resolve_platform_slug(NULL) IS NULL);
SELECT pg_temp.ok('signature, volatility and parallel safety are kept',
  (SELECT count(*) = 1 AND bool_and(p.provolatile = 's' AND p.proparallel = 's' AND p.prorettype = 'text'::regtype)
     FROM pg_proc p WHERE p.oid = 'public.resolve_platform_slug(text)'::regprocedure));
SELECT pg_temp.ok('the function carries its comment',
  obj_description('public.resolve_platform_slug(text)'::regprocedure, 'pg_proc') LIKE '%Lowercase-first since 20261015023000%');
