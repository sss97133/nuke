-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_mv_market_pulse -f this-file.sql
-- Proves 20261125140000_mv_market_pulse_public_test.sql: the market pulse matview stops counting a deleted car (and
-- still excludes a private one) in its dimensions, medians and images; it is rebuilt with its unique (dim, name)
-- index, so REFRESH ... CONCURRENTLY still runs; grants are anon, authenticated and service_role SELECT as before; and
-- market_pulse reads it as anon. It starts from production's definition (pg_get_viewdef, 2026-11-25, embedded below).
-- Rows are a disposable database's rows, never testimony.
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

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text);
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text, canonical_model text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean DEFAULT true, deleted_at timestamptz, year integer,
  mileage integer, sale_price integer, sale_date date, city text, state text, primary_image_url text, sold_price integer,
  normalized_model text, bat_watchers integer, canonical_make_id uuid REFERENCES public.canonical_makes(id), color_family text,
  canonical_platform text, canonical_sold_price numeric);

INSERT INTO public.canonical_makes VALUES ('c0000000-0000-0000-0000-000000000001', 'chevrolet', 'Chevrolet');
INSERT INTO public.canonical_models (make, canonical_model) VALUES ('chevrolet', 'K10');
-- Three 1978 Chevrolet K10s: public, private, deleted (public flag still true). The deleted one carries the highest
-- price, so before the fix it moves the median and supplies the make's image.
INSERT INTO public.vehicles (id, is_public, deleted_at, year, mileage, sale_price, sale_date, city, state, primary_image_url,
  normalized_model, canonical_make_id, color_family, canonical_platform) VALUES
  ('a0000000-0000-0000-0000-000000000001', true,  NULL,         1978, 50000, 10, '2025-06-02', 'Las Vegas', 'NV', 'https://x.invalid/pub.jpg',  'K10', 'c0000000-0000-0000-0000-000000000001', 'red', 'bat'),
  ('a0000000-0000-0000-0000-000000000002', false, NULL,         1978, 50000, 20, '2025-06-02', 'Las Vegas', 'NV', 'https://x.invalid/priv.jpg', 'K10', 'c0000000-0000-0000-0000-000000000001', 'red', 'bat'),
  ('a0000000-0000-0000-0000-000000000003', true,  '2026-11-01', 1978, 50000, 30, '2025-06-02', 'Las Vegas', 'NV', 'https://x.invalid/del.jpg',  'K10', 'c0000000-0000-0000-0000-000000000001', 'red', 'bat');

-- Production's matview, index, grants and reader, 2026-11-25.
CREATE MATERIALIZED VIEW public.mv_market_pulse AS
 WITH pairs AS (
         SELECT DISTINCT mk.id AS make_id,
            cm.canonical_model
           FROM (canonical_models cm
             JOIN canonical_makes mk ON (((lower(cm.make) = lower(mk.canonical_name)) OR (lower(cm.make) = lower(mk.display_name)))))
        ), v AS (
         SELECT COALESCE(mk.display_name, mk.canonical_name) AS canon_make,
                CASE
                    WHEN (p.canonical_model IS NOT NULL) THEN ((COALESCE(mk.display_name, mk.canonical_name) || ' '::text) || veh.normalized_model)
                    ELSE NULL::text
                END AS canon_model,
            veh.year,
            veh.city,
            veh.state,
            veh.sale_date,
            veh.color_family,
            veh.mileage,
            veh.bat_watchers AS watchers,
            COALESCE((veh.sale_price)::numeric, (veh.sold_price)::numeric, veh.canonical_sold_price) AS price,
            veh.primary_image_url AS img,
                CASE
                    WHEN (veh.canonical_platform = ANY (ARRAY['bat'::text, 'cars-and-bids'::text, 'barrett-jackson'::text, 'mecum'::text, 'bonhams'::text, 'classiccars-com'::text, 'gooding'::text, 'rm-sothebys'::text, 'broad-arrow'::text])) THEN 0
                    ELSE 1
                END AS plat_rank
           FROM ((vehicles veh
             LEFT JOIN canonical_makes mk ON ((mk.id = veh.canonical_make_id)))
             LEFT JOIN pairs p ON (((p.make_id = veh.canonical_make_id) AND (p.canonical_model = veh.normalized_model))))
          WHERE veh.is_public
        )
 SELECT dim,
    name,
    count,
    median_price,
    image_url
   FROM ( SELECT 'make'::text AS dim,
            COALESCE(v.canon_make, 'Unresolved'::text) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          GROUP BY COALESCE(v.canon_make, 'Unresolved'::text)
        UNION ALL
         SELECT 'model'::text AS dim,
            COALESCE(v.canon_model, 'Unresolved'::text) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          GROUP BY COALESCE(v.canon_model, 'Unresolved'::text)
        UNION ALL
         SELECT 'year'::text AS dim,
            (v.year)::text AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE ((v.year >= 1885) AND (v.year <= 2027))
          GROUP BY (v.year)::text
        UNION ALL
         SELECT 'metro'::text AS dim,
            ((v.city || ', '::text) || v.state) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE ((v.city IS NOT NULL) AND (v.state IS NOT NULL))
          GROUP BY ((v.city || ', '::text) || v.state)
        UNION ALL
         SELECT 'dow'::text AS dim,
            to_char((v.sale_date)::timestamp with time zone, 'Dy'::text) AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.sale_date IS NOT NULL)
          GROUP BY (to_char((v.sale_date)::timestamp with time zone, 'Dy'::text))
        UNION ALL
         SELECT 'color'::text AS dim,
            v.color_family AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.color_family IS NOT NULL)
          GROUP BY v.color_family
        UNION ALL
         SELECT 'price'::text AS dim,
                CASE
                    WHEN (v.price IS NULL) THEN NULL::text
                    WHEN (v.price < (10000)::numeric) THEN '<$10k'::text
                    WHEN (v.price < (25000)::numeric) THEN '$10-25k'::text
                    WHEN (v.price < (50000)::numeric) THEN '$25-50k'::text
                    WHEN (v.price < (100000)::numeric) THEN '$50-100k'::text
                    WHEN (v.price < (250000)::numeric) THEN '$100-250k'::text
                    WHEN (v.price < (1000000)::numeric) THEN '$250k-1M'::text
                    ELSE '$1M+'::text
                END AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.price IS NOT NULL)
          GROUP BY
                CASE
                    WHEN (v.price IS NULL) THEN NULL::text
                    WHEN (v.price < (10000)::numeric) THEN '<$10k'::text
                    WHEN (v.price < (25000)::numeric) THEN '$10-25k'::text
                    WHEN (v.price < (50000)::numeric) THEN '$25-50k'::text
                    WHEN (v.price < (100000)::numeric) THEN '$50-100k'::text
                    WHEN (v.price < (250000)::numeric) THEN '$100-250k'::text
                    WHEN (v.price < (1000000)::numeric) THEN '$250k-1M'::text
                    ELSE '$1M+'::text
                END
        UNION ALL
         SELECT 'mileage'::text AS dim,
                CASE
                    WHEN (v.mileage IS NULL) THEN NULL::text
                    WHEN (v.mileage < 1000) THEN 'Under 1k mi'::text
                    WHEN (v.mileage < 10000) THEN '1-10k mi'::text
                    WHEN (v.mileage < 50000) THEN '10-50k mi'::text
                    WHEN (v.mileage < 100000) THEN '50-100k mi'::text
                    WHEN (v.mileage < 150000) THEN '100-150k mi'::text
                    ELSE '150k+ mi'::text
                END AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE ((v.mileage IS NOT NULL) AND (v.mileage >= 0))
          GROUP BY
                CASE
                    WHEN (v.mileage IS NULL) THEN NULL::text
                    WHEN (v.mileage < 1000) THEN 'Under 1k mi'::text
                    WHEN (v.mileage < 10000) THEN '1-10k mi'::text
                    WHEN (v.mileage < 50000) THEN '10-50k mi'::text
                    WHEN (v.mileage < 100000) THEN '50-100k mi'::text
                    WHEN (v.mileage < 150000) THEN '100-150k mi'::text
                    ELSE '150k+ mi'::text
                END
        UNION ALL
         SELECT 'popularity'::text AS dim,
                CASE
                    WHEN (v.watchers IS NULL) THEN NULL::text
                    WHEN (v.watchers >= 500) THEN '500+ watching'::text
                    WHEN (v.watchers >= 200) THEN '200-499 watching'::text
                    WHEN (v.watchers >= 100) THEN '100-199 watching'::text
                    WHEN (v.watchers >= 50) THEN '50-99 watching'::text
                    WHEN (v.watchers >= 10) THEN '10-49 watching'::text
                    ELSE 'Under 10 watching'::text
                END AS name,
            count(*) AS count,
            (percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((v.price)::double precision)))::bigint AS median_price,
            (array_agg(v.img ORDER BY v.plat_rank, v.price DESC NULLS LAST) FILTER (WHERE ((v.img IS NOT NULL) AND (v.img <> ''::text))))[1] AS image_url
           FROM v
          WHERE (v.watchers IS NOT NULL)
          GROUP BY
                CASE
                    WHEN (v.watchers IS NULL) THEN NULL::text
                    WHEN (v.watchers >= 500) THEN '500+ watching'::text
                    WHEN (v.watchers >= 200) THEN '200-499 watching'::text
                    WHEN (v.watchers >= 100) THEN '100-199 watching'::text
                    WHEN (v.watchers >= 50) THEN '50-99 watching'::text
                    WHEN (v.watchers >= 10) THEN '10-49 watching'::text
                    ELSE 'Under 10 watching'::text
                END) s
  WHERE ((name IS NOT NULL) AND (name <> ''::text));
CREATE UNIQUE INDEX mv_market_pulse_pk ON public.mv_market_pulse USING btree (dim, name);
GRANT SELECT ON public.mv_market_pulse TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.market_pulse(p_dimension text, p_limit integer DEFAULT 30)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, image_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$   SELECT name, count, count AS value, median_price, image_url   FROM mv_market_pulse WHERE dim = p_dimension ORDER BY count DESC LIMIT p_limit; $function$;
GRANT EXECUTE ON FUNCTION public.market_pulse(text, integer) TO anon, authenticated, service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon;

-- Before: the deleted car is counted and supplies the image.
SET ROLE anon;
SELECT t_assert((SELECT count FROM market_pulse('make', 5) WHERE name = 'Chevrolet') = 2
  AND (SELECT image_url FROM market_pulse('make', 5) WHERE name = 'Chevrolet') = 'https://x.invalid/del.jpg',
  'before: the deleted car is counted (2, the private one is not) and its photo is the make''s image');
RESET ROLE;

\ir ../migrations/20261125140000_mv_market_pulse_public_test.sql
\ir ../migrations/20261125140000_mv_market_pulse_public_test.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert(to_regclass('public.mv_market_pulse_next') IS NULL
  AND (SELECT relkind FROM pg_class WHERE oid = 'public.mv_market_pulse'::regclass) = 'm'
  AND (SELECT indexdef FROM pg_indexes WHERE tablename = 'mv_market_pulse') = 'CREATE UNIQUE INDEX mv_market_pulse_pk ON public.mv_market_pulse USING btree (dim, name)',
  'swapped in (applied twice): one matview mv_market_pulse with its unique (dim, name) index, no _next left');
SELECT t_assert((SELECT relacl::text FROM pg_class WHERE oid = 'public.mv_market_pulse'::regclass)
  = format('{%1$s=arwdDxtm/%1$s,anon=r/%1$s,authenticated=r/%1$s,service_role=r/%1$s}', current_user),
  'grants: anon, authenticated and service_role SELECT only, as production');
SELECT t_assert(pg_get_viewdef('public.mv_market_pulse'::regclass) LIKE '%WHERE (veh.is_public AND (veh.deleted_at IS NULL))%',
  'definition states is_public AND deleted_at IS NULL');
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_pulse;
SELECT t_assert(true, 'REFRESH MATERIALIZED VIEW CONCURRENTLY runs (the nightly job''s statement)');

SET ROLE anon;
SELECT t_assert((SELECT count FROM market_pulse('make', 5) WHERE name = 'Chevrolet') = 1
  AND (SELECT median_price FROM market_pulse('make', 5) WHERE name = 'Chevrolet') = 10
  AND (SELECT image_url FROM market_pulse('make', 5) WHERE name = 'Chevrolet') = 'https://x.invalid/pub.jpg',
  'after: only the public car is counted, priced and pictured (anon through market_pulse)');
SELECT t_assert((SELECT max(count) FROM public.mv_market_pulse) = 1, 'after: no dimension counts the deleted or the private car (anon SELECT on the matview)');
RESET ROLE;
