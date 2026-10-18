-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_market_position_browse -f this-file.sql
-- Proves that after 20261014203000_market_position_browse_facets.sql mv_market_position keeps every column and value
-- it had (market_position() answers the same), carries per-make facets equal to a direct count over the make's
-- public vehicles (top 20 models, top 10 sources, eras, photos), refreshes CONCURRENTLY, and that browse_stats
-- answers a canonical make from it, with its population and date, while a name without a fold row keeps the live
-- aggregate unchanged. Starts from the live fold, market_position() and browse_stats() as read on 2026-10-14
-- (helpers/*_live_20261014.sql). The seeds are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.mv_market_position') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;

-- The columns the fold and browse_stats read, with production's types (the fold's deparse, and so its hash guard,
-- depends on them).
SET ROLE owp_table_owner;
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, display_name text, canonical_name text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_public boolean, canonical_make_id uuid, make text, model text, year integer, source text, era text,
  primary_image_url text, sale_price integer, sold_price integer, canonical_sold_price numeric,
  sale_status text, auction_status text, bat_watchers integer
);
-- Seeds: Porsche (60 rows, 54 public: 23 models, 12 sources, 2 eras), Ford (8 public), and a raw make with no
-- canonical make (Obscura, 3 public).
INSERT INTO public.canonical_makes VALUES
 ('a0000000-0000-0000-0000-000000000001', 'Porsche', 'porsche'),
 ('a0000000-0000-0000-0000-000000000002', 'Ford', 'ford');
INSERT INTO public.vehicles (is_public, canonical_make_id, make, model, year, source, era, primary_image_url,
  sale_price, sold_price, canonical_sold_price, sale_status, bat_watchers)
SELECT i % 10 <> 0, 'a0000000-0000-0000-0000-000000000001', 'Porsche',
  CASE WHEN i <= 24 THEN '911' WHEN i <= 36 THEN '356' WHEN i <= 40 THEN '912'
       ELSE 'M' || lpad((i - 40)::text, 2, '0') END,
  1950 + i % 40,
  CASE WHEN i <= 20 THEN 'bat' WHEN i <= 30 THEN 'mecum' WHEN i <= 32 THEN NULL
       ELSE 's' || lpad(((i - 33) % 10 + 1)::text, 2, '0') END,
  CASE WHEN i % 3 = 0 THEN 'air-cooled' WHEN i % 3 = 1 THEN 'water-cooled' END,
  CASE WHEN i % 2 = 0 THEN 'https://img.example/' || i END,
  CASE WHEN i % 4 = 0 THEN 40000 + i * 100 END,
  CASE WHEN i % 5 = 0 THEN 30000 + i * 100 END,
  CASE WHEN i % 7 = 0 THEN 20000 + i * 100 END,
  CASE WHEN i % 6 = 0 THEN 'sold' END,
  CASE WHEN i % 4 = 1 THEN i END
FROM generate_series(1, 60) i;
INSERT INTO public.vehicles (is_public, canonical_make_id, make, model, year, source, sold_price)
SELECT true, 'a0000000-0000-0000-0000-000000000002', 'Ford', 'Bronco', 1970 + i, 'bat', 25000 + i
FROM generate_series(1, 8) i;
INSERT INTO public.vehicles (is_public, canonical_make_id, make, model, year, source, sold_price, primary_image_url)
SELECT true, NULL, 'Obscura', 'Roadster', 1930 + i, 'barnfinds', CASE WHEN i = 1 THEN 9000 END, CASE WHEN i < 3 THEN 'https://img.example/o' || i END
FROM generate_series(1, 3) i;
\ir helpers/mv_market_position_live_20261014.sql
\ir helpers/market_position_live_20261014.sql
\ir helpers/browse_stats_live_20261014.sql
GRANT SELECT ON public.mv_market_position TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;

-- 1. Before: the live fold deparses to production's hash; record market_position() and the fallback answer.
SELECT public.t_assert(encode(sha256(convert_to(pg_get_viewdef('public.mv_market_position'::regclass), 'UTF8')), 'base64')
  = 'FUJLg2PUd+m3EverI9QR5l2Wjyfcn3IK7Q0dHXIQ1Q0=', 'the rebuilt live fold deparses to production''s hash');
CREATE TABLE public.t_before_position AS SELECT * FROM public.market_position('make', 120);
CREATE TABLE public.t_before_browse AS
  SELECT public.browse_stats('Obscura') AS obscura, public.browse_stats(NULL) AS everything, public.browse_stats('Porsche') AS porsche;
GRANT SELECT ON public.t_before_browse TO anon;
SELECT public.t_assert((SELECT (porsche->>'total')::int FROM public.t_before_browse) = 54, 'before: the live aggregate counts 54 public Porsches');

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014203000_market_position_browse_facets.sql
\ir ../migrations/20261014203000_market_position_browse_facets.sql
RESET ROLE;

-- 3. The fold: every old column and value as before, the new columns, the unique index, SELECT-only grants.
SELECT public.t_assert((SELECT string_agg(attname::text, ',' ORDER BY attnum) FROM pg_attribute
  WHERE attrelid = 'public.mv_market_position'::regclass AND attnum > 0 AND NOT attisdropped)
  = 'dim,name,volume,sell_through,demand,avg_year,median_price,total_value,p25,p50,p75,price_n,watch_sum,watch_n,auction_med,market_med,with_images,by_model,by_source,by_era,folded_at',
  'the fold keeps its columns in order and adds five');
SELECT public.t_assert(NOT EXISTS (SELECT * FROM public.market_position('make', 120) EXCEPT SELECT * FROM public.t_before_position)
  AND NOT EXISTS (SELECT * FROM public.t_before_position EXCEPT SELECT * FROM public.market_position('make', 120)),
  'market_position() answers exactly as before');
SELECT public.t_assert(EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'mv_market_position' AND indexname = 'mv_market_position_pk'
  AND indexdef LIKE '%UNIQUE%(dim, name)%'), 'the unique index the CONCURRENTLY refresh needs is back');
SELECT public.t_assert(has_table_privilege('anon', 'public.mv_market_position', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.mv_market_position', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'the fold grants SELECT only');
SELECT public.t_assert(to_regclass('public.mv_market_position_next') IS NULL, 'no build leftover');

-- 4. The facets equal a direct count over the canonical make's public vehicles.
CREATE TABLE public.t_porsche AS
  SELECT v.* FROM public.vehicles v JOIN public.canonical_makes mk ON mk.id = v.canonical_make_id
  WHERE v.is_public AND mk.display_name = 'Porsche';
SELECT public.t_assert(f.volume = 54 AND f.with_images = (SELECT count(*) FROM public.t_porsche WHERE primary_image_url IS NOT NULL),
  'volume and photos match the vehicles') FROM public.mv_market_position f WHERE f.dim = 'make' AND f.name = 'Porsche';
SELECT public.t_assert(f.by_model = (SELECT jsonb_agg(jsonb_build_object('model', model, 'count', n) ORDER BY n DESC, model)
    FROM (SELECT model, count(*) n FROM public.t_porsche WHERE model IS NOT NULL GROUP BY model ORDER BY count(*) DESC, model LIMIT 20) m)
  AND jsonb_array_length(f.by_model) = 20 AND f.by_model->0 = '{"model": "911", "count": 22}'::jsonb,
  'by_model: the top 20 of 23 models, by count then name') FROM public.mv_market_position f WHERE f.dim = 'make' AND f.name = 'Porsche';
SELECT public.t_assert(f.by_source = (SELECT jsonb_agg(jsonb_build_object('source', source, 'count', n) ORDER BY n DESC, source)
    FROM (SELECT source, count(*) n FROM public.t_porsche WHERE source IS NOT NULL GROUP BY source ORDER BY count(*) DESC, source LIMIT 10) s)
  AND jsonb_array_length(f.by_source) = 10, 'by_source: the top 10 of 12 sources')
FROM public.mv_market_position f WHERE f.dim = 'make' AND f.name = 'Porsche';
SELECT public.t_assert(f.by_era = (SELECT jsonb_agg(jsonb_build_object('era', era, 'count', n) ORDER BY n DESC, era)
    FROM (SELECT era, count(*) n FROM public.t_porsche WHERE era IS NOT NULL GROUP BY era) e), 'by_era: every era')
FROM public.mv_market_position f WHERE f.dim = 'make' AND f.name = 'Porsche';

-- 5. browse_stats: a canonical make answers from the fold, any case, with its population and date; a name with no
--    fold row and the all-makes call answer exactly as before.
SET ROLE anon;
SELECT public.t_assert(b->>'total' = '54' AND b->'by_model' = f.by_model AND b->'by_source' = f.by_source AND b->'by_era' = f.by_era
  AND (b->>'with_images')::int = f.with_images AND (b->>'with_price')::int = f.price_n
  AND (b->>'avg_price')::numeric = round(f.total_value::numeric / f.price_n, 2)
  AND (b->>'as_of')::timestamptz = f.folded_at AND b->>'population' LIKE '%canonical make Porsche%',
  'browse_stats(''porsche'') is the fold row, with its population and date')
FROM (SELECT public.browse_stats('porsche') b) x, public.mv_market_position f WHERE f.dim = 'make' AND f.name = 'Porsche';
SELECT public.t_assert(public.browse_stats('Obscura') = (SELECT obscura FROM public.t_before_browse), 'a raw make with no fold row: the live aggregate, unchanged');
SELECT public.t_assert(public.browse_stats(NULL) = (SELECT everything FROM public.t_before_browse), 'the all-makes call: unchanged');
SELECT public.t_assert(public.browse_stats('Unresolved') IS NOT NULL AND public.browse_stats('Unresolved')->>'population' IS NULL,
  'the Unresolved bucket is never answered as a make');
RESET ROLE;

-- 6. The nightly refresh path: CONCURRENTLY works, and a new public Porsche shows up after it.
INSERT INTO public.vehicles (is_public, canonical_make_id, make, model, source) VALUES (true, 'a0000000-0000-0000-0000-000000000001', 'Porsche', '911', 'bat');
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_position;
SELECT public.t_assert((public.browse_stats('Porsche')->>'total')::int = 55
  AND public.browse_stats('Porsche')->'by_model'->0 = '{"model": "911", "count": 23}'::jsonb, 'after a refresh the fold counts the new vehicle');

-- 7. Drift stops the migration, and it changes nothing: a fold that is neither the 2026-10-14 read nor this one.
SET ROLE owp_table_owner;
DROP MATERIALIZED VIEW public.mv_market_position;
CREATE MATERIALIZED VIEW public.mv_market_position AS
  SELECT 'make'::text AS dim, 'X'::text AS name, 1::bigint AS volume, 0 AS sell_through, 0 AS demand, 0 AS avg_year,
    0::bigint AS median_price, 0::bigint AS total_value, 0::bigint AS p25, 0::bigint AS p50, 0::bigint AS p75, 0 AS price_n,
    0::bigint AS watch_sum, 0 AS watch_n, 0::bigint AS auction_med, 0::bigint AS market_med;
\set ON_ERROR_STOP off
\ir ../migrations/20261014203000_market_position_browse_facets.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT count(*) FROM public.mv_market_position) = 1 AND to_regclass('public.mv_market_position_next') IS NULL,
  'drift: the migration changed nothing');
RESET ROLE;

SELECT 'market position browse facets contract: all checks passed' AS result;
