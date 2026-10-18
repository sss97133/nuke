-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_deal_cohort -f this-file.sql
-- Proves that deal_cohort_bat_sales (20261014113000) returns, for anon, exactly the public rows the deal page's old
-- cohort read returned (make in its four casings, model ilike '%token%', year range, undeleted, BaT URL), ordered by
-- id; that it adds only other casings of the make; that % _ and \ in the token are literal; that private and deleted
-- vehicles never appear, whoever asks; the 21 columns and nothing else; that the plan reads the trigram index; and
-- the grants. The seeds are synthetic rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cohort_owner') THEN CREATE ROLE cohort_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, cohort_owner;
GRANT CREATE ON SCHEMA public TO cohort_owner;

SET ROLE cohort_owner;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, "trim" text, sale_price integer, sale_status text,
  auction_outcome text, sale_date date, listing_url text, bat_auction_url text, discovery_url text,
  bat_sold_price numeric(10,2), high_bid integer, mileage integer, transmission text, engine_size text,
  engine_type text, bat_listing_title text, title text, primary_image_url text, purchase_price numeric,
  is_public boolean, deleted_at timestamptz, user_id uuid
);
-- the production index, its expression and predicate as live
CREATE INDEX idx_vehicles_make_model_trgm ON public.vehicles USING gin ((((lower(make) || ' '::text) || lower(model))) gin_trgm_ops)
  WHERE ((is_public = true) AND (year IS NOT NULL) AND (make IS NOT NULL) AND (model IS NOT NULL));
-- 12,000 synthetic vehicles: the four casings the old read asked for plus odd ones, models that contain the token
-- and models that do not, BaT and other URLs, private, deleted and undated rows.
INSERT INTO public.vehicles (id, year, make, model, "trim", sale_price, listing_url, bat_sold_price, purchase_price, is_public, deleted_at, user_id)
SELECT md5('c' || g)::uuid,
       CASE WHEN g % 97 = 0 THEN NULL ELSE 1960 + g % 40 END,
       (ARRAY['Chevrolet', 'CHEVROLET', 'chevrolet', 'Chevrolet', 'cHEVROLET', 'Chevrolet Truck', 'GMC', 'BMW', 'Bmw', 'bmw', 'Ford'])[1 + g % 11],
       (ARRAY['K5 Blazer', 'Blazer', 'S-10 Blazer', 'Camaro', 'M3', 'M30', 'x_y', 'xzy', '50% Off', 'Jimmy', 'Mustang', NULL])[1 + (g / 11) % 12],
       'trim ' || g,
       CASE WHEN g % 5 = 0 THEN NULL ELSE 10000 + g END,
       CASE WHEN g % 3 = 0 THEN 'https://craigslist.example.test/' || g
            WHEN g % 3 = 1 THEN 'https://bringatrailer.com/listing/lot-' || g
            ELSE 'https://www.BringATrailer.com/listing/lot-' || g END,
       CASE WHEN g % 4 = 0 THEN NULL ELSE 9000 + g END,
       50000 + g,
       g % 13 <> 0,
       CASE WHEN g % 17 = 0 THEN timestamptz '2026-01-01' END,
       CASE WHEN g % 13 = 0 THEN '20000000-0000-0000-0000-000000000001'::uuid END
FROM generate_series(1, 12000) g;
ANALYZE public.vehicles;
-- as on production since 20261014093000: the API roles read every column but the owner's purchase facts
GRANT SELECT (id, year, make, model, "trim", sale_price, sale_status, auction_outcome, sale_date, listing_url, bat_auction_url,
  discovery_url, bat_sold_price, high_bid, mileage, transmission, engine_size, engine_type, bat_listing_title, title,
  primary_image_url, is_public, deleted_at, user_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT ON public.vehicles TO service_role;
-- 1. Apply the migration as the owner, twice.
\ir ../migrations/20261014113000_deal_cohort_bat_sales_reader.sql
\ir ../migrations/20261014113000_deal_cohort_bat_sales_reader.sql
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;

-- The old read, as anon saw it: public rows, the four casings useDealRead sent, model ilike '%token%'.
CREATE FUNCTION public.t_old(p_make text, p_model text, y1 int, y2 int) RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}') FROM public.vehicles v
  WHERE v.is_public = true
    AND v.make IN (p_make, upper(p_make), lower(p_make), upper(left(p_make, 1)) || lower(substr(p_make, 2)))
    AND v.model ILIKE '%' || p_model || '%' AND v.year >= y1 AND v.year <= y2
    AND v.deleted_at IS NULL AND v.listing_url ILIKE '%bringatrailer.com%'
$$;
CREATE FUNCTION public.t_new(p_make text, p_model text, y1 int, y2 int) RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(r.id ORDER BY r.ordinality), '{}') FROM public.deal_cohort_bat_sales(p_make, p_model, y1, y2) WITH ORDINALITY AS r
$$;
GRANT EXECUTE ON FUNCTION public.t_old(text, text, int, int), public.t_new(text, text, int, int) TO anon, authenticated;

-- 2. As anon: the old population, plus only the make's other casings, in id order.
SET ROLE anon;
DO $$
DECLARE c record; o uuid[]; n uuid[]; extra uuid[];
BEGIN
  FOR c IN SELECT * FROM (VALUES ('Chevrolet', 'Blazer', 1969, 1994), ('Chevrolet', 'K5 Blazer', 1960, 1999),
                                 ('BMW', 'M3', 1960, 1999), ('bmw', 'm3', 1970, 1990), ('Chevrolet', 'Camaro', 1967, 1969),
                                 ('Ford', 'Mustang', 1960, 1999), ('GMC', 'Jimmy', 1960, 1999), ('Chevrolet', 'Nomodel', 1960, 1999))
             AS t(mk, md, y1, y2) LOOP
    o := public.t_old(c.mk, c.md, c.y1, c.y2);
    n := public.t_new(c.mk, c.md, c.y1, c.y2);
    PERFORM public.t_assert(n @> o, format('%s %s: every row the old read returned', c.mk, c.md));
    PERFORM public.t_assert(n = coalesce((SELECT array_agg(x ORDER BY x) FROM unnest(n) x), '{}'), format('%s %s: ordered by id', c.mk, c.md));
    SELECT coalesce(array_agg(x), '{}') INTO extra FROM unnest(n) x WHERE x <> ALL (o);
    PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = ANY (extra)
        AND v.make IN (c.mk, upper(c.mk), lower(c.mk), upper(left(c.mk, 1)) || lower(substr(c.mk, 2)))),
      format('%s %s: the only additions are other casings of the make', c.mk, c.md));
  END LOOP;
END $$;
SELECT public.t_assert(cardinality(public.t_old('Chevrolet', 'Blazer', 1969, 1994)) > 100, 'the Blazer cohort is not empty');
SELECT public.t_assert(cardinality(public.t_new('Chevrolet', 'Blazer', 1969, 1994)) - cardinality(public.t_old('Chevrolet', 'Blazer', 1969, 1994))
  = (SELECT count(*) FROM public.vehicles v WHERE v.make = 'cHEVROLET' AND v.is_public AND v.model ILIKE '%blazer%' AND v.year BETWEEN 1969 AND 1994
       AND v.deleted_at IS NULL AND v.listing_url ILIKE '%bringatrailer.com%'), 'the Blazer additions are exactly the cHEVROLET rows');
-- "Chevrolet Truck" is another make, never a casing
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('Chevrolet', 'Blazer', 1960, 1999) r JOIN public.vehicles v USING (id) WHERE v.make = 'Chevrolet Truck'),
  'another make that starts with the name is left out');
-- 3. The token is literal: x_y matches x_y, not xzy; 50% matches the percent sign
SELECT public.t_assert((SELECT bool_and(v.model = 'x_y') FROM public.deal_cohort_bat_sales('Chevrolet', 'x_y', 1960, 1999) r JOIN public.vehicles v USING (id))
  AND EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('Chevrolet', 'x_y', 1960, 1999)), 'an underscore in the token is literal');
SELECT public.t_assert((SELECT bool_and(v.model = '50% Off') FROM public.deal_cohort_bat_sales('Chevrolet', '50%', 1960, 1999) r JOIN public.vehicles v USING (id))
  AND EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('Chevrolet', '50%', 1960, 1999)), 'a percent sign in the token is literal');
-- 4. Empty or missing arguments read nothing
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('', 'Blazer', 1960, 1999))
  AND NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('Chevrolet', ' ', 1960, 1999))
  AND NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales(NULL, 'Blazer', 1960, 1999))
  AND NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('Chevrolet', 'Blazer', NULL, 1999)), 'empty arguments read nothing');
RESET ROLE;

-- 5. Private, deleted and undated vehicles never appear, also for their owner and the service role
SET ROLE authenticated;
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('Chevrolet', 'Blazer', 1900, 2100) r JOIN public.vehicles v USING (id)
  WHERE NOT v.is_public OR v.deleted_at IS NOT NULL OR v.year IS NULL), 'signed in: public, undeleted, dated rows only');
RESET ROLE;
SET ROLE service_role;
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.deal_cohort_bat_sales('BMW', 'M3', 1900, 2100) r JOIN public.vehicles v USING (id)
  WHERE NOT v.is_public OR v.deleted_at IS NOT NULL), 'service role: public, undeleted rows only');
RESET ROLE;

-- 6. The 21 columns the deal page reads, nothing else of the row
SELECT public.t_assert((SELECT array_agg(a.attname::text ORDER BY a.attnum)
  FROM pg_proc p, unnest(p.proargnames) WITH ORDINALITY AS a(attname, attnum)
  WHERE p.proname = 'deal_cohort_bat_sales' AND a.attnum > 4)
  = ARRAY['id', 'year', 'make', 'model', 'trim', 'sale_price', 'sale_status', 'auction_outcome', 'sale_date', 'listing_url',
          'bat_auction_url', 'discovery_url', 'bat_sold_price', 'high_bid', 'mileage', 'transmission', 'engine_size',
          'engine_type', 'bat_listing_title', 'title', 'primary_image_url'], 'the 21 columns the deal page reads (VehicleCompRow)');

-- 7. The statement it runs reads the trigram index
SET enable_seqscan = off;
DO $$
DECLARE plan jsonb;
BEGIN
  EXECUTE $q$EXPLAIN (FORMAT JSON) SELECT v.id FROM public.vehicles v
    WHERE v.is_public = true AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL
      AND ((lower(v.make) || ' '::text) || lower(v.model)) LIKE '%blazer%'
      AND lower(v.make) = 'chevrolet' AND lower(v.model) LIKE '%blazer%' AND v.year >= 1969 AND v.year <= 1994
      AND v.deleted_at IS NULL AND v.listing_url ILIKE '%bringatrailer.com%' ORDER BY v.id$q$ INTO plan;
  PERFORM public.t_assert(plan::text LIKE '%"Index Name": "idx_vehicles_make_model_trgm"%', 'the cohort reads idx_vehicles_make_model_trgm');
END $$;
RESET enable_seqscan;

-- 8. Grants
SELECT public.t_assert(has_function_privilege('anon', 'public.deal_cohort_bat_sales(text,text,integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.deal_cohort_bat_sales(text,text,integer,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.deal_cohort_bat_sales(text,text,integer,integer)', 'EXECUTE'), 'the API roles execute');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.proname = 'deal_cohort_bat_sales' AND a.grantee = 0), 'PUBLIC does not execute');
SELECT public.t_assert((SELECT prosecdef FROM pg_proc WHERE proname = 'deal_cohort_bat_sales'), 'SECURITY DEFINER');

SELECT 'deal_cohort_bat_sales contract: all checks passed' AS result;
