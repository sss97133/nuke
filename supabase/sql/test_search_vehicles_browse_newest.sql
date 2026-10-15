-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_search_browse -f this-file.sql
-- Proves that 20261014111500_search_vehicles_browse_newest_from_index.sql returns the same rows and totals as the
-- live search_vehicles_browse for every sort, direction, filter and page tried, that p_include_total => false returns
-- the same rows with no total, that the one documented difference (a row without created_at leaves a created_at
-- sort) holds, that the newest page plans on idx_vehicles_created_at with no count, and the grants. Starts from the
-- live definition (helpers/search_vehicles_browse_live_20261014.sql). The seeds are synthetic rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'browse_owner') THEN CREATE ROLE browse_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, browse_owner;
GRANT CREATE ON SCHEMA public TO browse_owner;

SET ROLE browse_owner;
-- vehicles with the columns the reader uses, and the two indexes its plans can take
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, vin text, status text, source text, sold_price integer,
  primary_image_url text, era text, body_style text, exterior_color text, created_at timestamptz DEFAULT now(),
  is_public boolean, canonical_vehicle_type text
);
CREATE INDEX idx_vehicles_created_at ON public.vehicles USING btree (created_at);
CREATE INDEX idx_vehicles_lower_make_public ON public.vehicles USING btree (lower(make)) WHERE (is_public = true);
-- 20,000 synthetic vehicles: makes in several casings, ties on year, make, price and status, prices and images
-- missing on some, private rows and non-vehicle types the reader must leave out, unique created_at.
INSERT INTO public.vehicles
SELECT md5('v' || g)::uuid,
       1950 + (g % 60),
       (ARRAY['Porsche', 'porsche', 'Chevrolet', 'CHEVROLET', 'Ford', 'Lancia', 'GMC', 'BMW'])[1 + g % 8],
       (ARRAY['911', '356', 'K5 Blazer', 'Camaro', 'Mustang', 'Delta', 'Jimmy', 'M3', '911'])[1 + (g / 8) % 9],
       'VIN' || g,
       (ARRAY['active', 'sold', 'pending', NULL])[1 + g % 4],
       (ARRAY['bat', 'craigslist', 'mecum', NULL, 'bat'])[1 + g % 5],
       CASE WHEN g % 3 = 0 THEN NULL ELSE 5000 + (g * 37) % 150000 END,
       CASE WHEN g % 4 = 1 THEN NULL ELSE 'https://img.example.test/' || g || '.jpg' END,
       (ARRAY['classic', 'modern', 'malaise', NULL])[1 + g % 4],
       (ARRAY['coupe', 'Coupe', 'SUV', 'pickup', NULL])[1 + g % 5],
       (ARRAY['red', 'Red', 'black', NULL])[1 + g % 4],
       timestamptz '2026-01-01' + g * interval '1 minute',
       g % 10 <> 0,
       (ARRAY['CAR', 'TRUCK', NULL, 'MOTORCYCLE', 'SUV', 'BOAT', 'VAN', 'MINIVAN'])[1 + g % 8]
FROM generate_series(1, 20000) g;
ANALYZE public.vehicles;
\ir helpers/search_vehicles_browse_live_20261014.sql
-- A copy of the live reader under another name, to compare with after the migration replaces it
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer)'::regprocedure),
    'FUNCTION public.search_vehicles_browse(', 'FUNCTION public.search_vehicles_browse_live(');
END $$;
-- 1. Apply the migration as the owner, twice (the second run recreates the same function).
\ir ../migrations/20261014111500_search_vehicles_browse_newest_from_index.sql
\ir ../migrations/20261014111500_search_vehicles_browse_newest_from_index.sql
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
-- One page as ordered jsonb. p carries any of the reader's arguments by name; absent ones are NULL, which the reader
-- reads exactly as its defaults (it coalesces sort, page and size).
CREATE FUNCTION public.t_page(p_fn text, p jsonb, p_extra text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  EXECUTE format($f$SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ord' ORDER BY t.ord), '[]'::jsonb) FROM %s(
      p_make => $1, p_model => $2, p_year_min => $3, p_year_max => $4, p_price_min => $5, p_price_max => $6,
      p_status => $7, p_source => $8, p_era => $9, p_body_style => $10, p_has_image => $11, p_has_price => $12,
      p_color => $13, p_sort_by => $14, p_sort_dir => $15, p_page => $16, p_page_size => $17%s)
    WITH ORDINALITY AS t(id, year, make, model, vin, status, source, sold_price, primary_image_url, era, body_style,
      total_count, ord)$f$, p_fn, p_extra)
  INTO r
  USING p->>'make', p->>'model', (p->>'year_min')::int, (p->>'year_max')::int, (p->>'price_min')::numeric,
        (p->>'price_max')::numeric, p->>'status', p->>'source', p->>'era', p->>'body_style', (p->>'has_image')::boolean,
        (p->>'has_price')::boolean, p->>'color', p->>'sort_by', p->>'sort_dir', (p->>'page')::int, (p->>'page_size')::int;
  RETURN r;
END $$;

-- 2. Every sort x direction x filter x page: the new reader returns what the live one returns, totals included.
CREATE TABLE public.t_calls AS
SELECT row_number() OVER () AS n, s.sort || d.dir || f.filt || pg.pg AS p
FROM (VALUES (jsonb_build_object('sort_by', 'year')), (jsonb_build_object('sort_by', 'make')),
             (jsonb_build_object('sort_by', 'sold_price')), (jsonb_build_object('sort_by', 'created_at')),
             (jsonb_build_object('sort_by', 'newest')), (jsonb_build_object('sort_by', 'status')),
             (jsonb_build_object('sort_by', 'bogus')), ('{}'::jsonb)) s(sort)
CROSS JOIN (VALUES (jsonb_build_object('sort_dir', 'asc')), (jsonb_build_object('sort_dir', 'desc')), ('{}'::jsonb)) d(dir)
CROSS JOIN (VALUES ('{}'::jsonb), ('{"make": "Porsche"}'), ('{"make": "porsche", "model": "911"}'),
                   ('{"year_min": 1960, "year_max": 1979}'), ('{"price_min": 20000, "price_max": 80000}'),
                   ('{"has_image": true}'), ('{"has_price": true}'), ('{"status": "active"}'), ('{"source": "bat"}'),
                   ('{"era": "classic"}'), ('{"body_style": "coupe"}'), ('{"color": "red"}'),
                   ('{"make": "Lancia", "has_image": true}'), ('{"make": "Nomake"}')) f(filt)
CROSS JOIN (VALUES ('{"page": 1, "page_size": 60}'::jsonb), ('{"page": 3, "page_size": 50}'), ('{}'::jsonb)) pg(pg);
SELECT public.t_assert((SELECT count(*) FROM public.t_calls) = 1008, '1,008 calls in the matrix');
DO $$
DECLARE c record; a jsonb; b jsonb; n_rows bigint := 0;
BEGIN
  FOR c IN SELECT * FROM public.t_calls ORDER BY n LOOP
    a := public.t_page('public.search_vehicles_browse_live', c.p);
    b := public.t_page('public.search_vehicles_browse', c.p);
    IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'FAIL: call % (%) differs from the live reader', c.n, c.p; END IF;
    n_rows := n_rows + jsonb_array_length(a);
  END LOOP;
  PERFORM public.t_assert(n_rows > 30000, format('the matrix returned rows (%s)', n_rows));
END $$;

-- 3. p_include_total => false: the same rows, total_count NULL.
DO $$
DECLARE c record; a jsonb; b jsonb;
BEGIN
  FOR c IN SELECT * FROM public.t_calls WHERE n % 7 = 0 ORDER BY n LOOP
    a := public.t_page('public.search_vehicles_browse_live', c.p);
    b := public.t_page('public.search_vehicles_browse', c.p, ', p_include_total => false');
    IF (SELECT coalesce(jsonb_agg(e - 'total_count'), '[]') FROM jsonb_array_elements(a) e)
       IS DISTINCT FROM (SELECT coalesce(jsonb_agg(e - 'total_count'), '[]') FROM jsonb_array_elements(b) e) THEN
      RAISE EXCEPTION 'FAIL: call % (%) without the total returns other rows', c.n, c.p;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(b) e WHERE e->'total_count' <> 'null'::jsonb) THEN
      RAISE EXCEPTION 'FAIL: call % (%) without the total still counts', c.n, c.p;
    END IF;
  END LOOP;
END $$;
SELECT public.t_assert((SELECT bool_and(e->>'total_count' IS NOT NULL)
  FROM jsonb_array_elements(public.t_page('public.search_vehicles_browse', '{"sort_by": "newest"}', ', p_include_total => true')) e),
  'p_include_total => true counts');

-- 4. The documented difference: a public row without created_at is listed last by the live reader's created_at
--    sorts and left out by the new one; every other row and the other sorts are unchanged.
INSERT INTO public.vehicles (id, year, make, model, status, sold_price, primary_image_url, is_public, canonical_vehicle_type, created_at)
VALUES ('00000000-0000-0000-0000-0000000000aa', 1972, 'Nomake', 'Undated', 'active', 1000, 'https://img.example.test/u.jpg', true, 'CAR', NULL);
SELECT public.t_assert((public.t_page('public.search_vehicles_browse_live', '{"make": "Nomake", "sort_by": "newest"}') -> 0 ->> 'id') = '00000000-0000-0000-0000-0000000000aa',
  'live: the undated row is listed by a created_at sort');
SELECT public.t_assert(public.t_page('public.search_vehicles_browse', '{"make": "Nomake", "sort_by": "newest"}') = '[]'::jsonb,
  'new: the undated row is left out of a created_at sort');
SELECT public.t_assert(public.t_page('public.search_vehicles_browse', '{"make": "Nomake", "sort_by": "year"}')
  = public.t_page('public.search_vehicles_browse_live', '{"make": "Nomake", "sort_by": "year"}'), 'the undated row in a year sort is unchanged');
SELECT public.t_assert((SELECT jsonb_agg(e) FROM jsonb_array_elements(public.t_page('public.search_vehicles_browse_live', '{"sort_by": "newest", "sort_dir": "asc", "page": 1, "page_size": 100}')) e
                         WHERE e->>'id' <> '00000000-0000-0000-0000-0000000000aa')
  IS NOT DISTINCT FROM (SELECT jsonb_agg(e - 'total_count' || jsonb_build_object('total_count', (e->>'total_count')::bigint + 1))
                         FROM jsonb_array_elements(public.t_page('public.search_vehicles_browse', '{"sort_by": "newest", "sort_dir": "asc", "page": 1, "page_size": 100}')) e),
  'apart from the undated row, the first page of an ascending created_at sort is the same (its total is one lower)');
DELETE FROM public.vehicles WHERE id = '00000000-0000-0000-0000-0000000000aa';

-- 5. The /live page (newest 60 with an image, no total) as the reader writes it: an index walk, no sort, no count.
SET enable_seqscan = off;  -- the plan must exist; on this small table the planner may prefer a scan
DO $$
DECLARE plan jsonb;
BEGIN
  EXECUTE $q$EXPLAIN (FORMAT JSON) SELECT v.id, v.year, v.make, v.model, v.vin, v.status, v.source,
            v.sold_price, v.primary_image_url, v.era, v.body_style,
            NULL::bigint AS total_count
     FROM vehicles v
     WHERE v.is_public = true AND (v.canonical_vehicle_type IS NULL OR v.canonical_vehicle_type IN ('CAR','TRUCK','SUV','VAN','MINIVAN')) AND v.primary_image_url IS NOT NULL AND v.created_at IS NOT NULL
     ORDER BY v.created_at DESC
     OFFSET 0 LIMIT 60$q$ INTO plan;
  PERFORM public.t_assert(plan::text LIKE '%"Scan Direction": "Backward"%' AND plan::text LIKE '%"Index Name": "idx_vehicles_created_at"%',
    'newest page walks idx_vehicles_created_at backward');
  PERFORM public.t_assert(plan::text NOT LIKE '%"Sort"%' AND plan::text NOT LIKE '%WindowAgg%', 'newest page has no sort and no count');
END $$;
RESET enable_seqscan;

-- 6. Grants: the API roles execute; PUBLIC does not; one form of the function exists.
SELECT public.t_assert((SELECT count(*) FROM pg_proc WHERE proname = 'search_vehicles_browse' AND pronamespace = 'public'::regnamespace) = 1, 'one search_vehicles_browse');
SELECT public.t_assert(has_function_privilege('anon', 'public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)', 'EXECUTE'),
  'anon, authenticated and service_role execute');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'search_vehicles_browse' AND a.grantee = 0),
  'PUBLIC does not execute');
SELECT public.t_assert((SELECT prosecdef FROM pg_proc WHERE proname = 'search_vehicles_browse' AND pronamespace = 'public'::regnamespace), 'still SECURITY DEFINER');

-- 7. A drifted live function stops the migration and leaves it as found.
SET ROLE browse_owner;
DROP FUNCTION public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean);
\ir helpers/search_vehicles_browse_live_20261014.sql
CREATE OR REPLACE FUNCTION public.search_vehicles_browse(p_make text DEFAULT NULL::text, p_model text DEFAULT NULL::text, p_year_min integer DEFAULT NULL::integer, p_year_max integer DEFAULT NULL::integer, p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_era text DEFAULT NULL::text, p_body_style text DEFAULT NULL::text, p_has_image boolean DEFAULT NULL::boolean, p_has_price boolean DEFAULT NULL::boolean, p_color text DEFAULT NULL::text, p_sort_by text DEFAULT 'year'::text, p_sort_dir text DEFAULT 'desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS TABLE(id uuid, year integer, make text, model text, vin text, status text, source text, sold_price integer, primary_image_url text, era text, body_style text, total_count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN RETURN; END; $function$;
\set ON_ERROR_STOP off
\ir ../migrations/20261014111500_search_vehicles_browse_newest_from_index.sql
\set ON_ERROR_STOP on
RESET ROLE;
SELECT public.t_assert(to_regprocedure('public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer)') IS NOT NULL
  AND to_regprocedure('public.search_vehicles_browse(text,text,integer,integer,numeric,numeric,text,text,text,text,boolean,boolean,text,text,text,integer,integer,boolean)') IS NULL,
  'drift: the migration changed nothing');

SELECT 'search_vehicles_browse newest contract: all checks passed' AS result;
