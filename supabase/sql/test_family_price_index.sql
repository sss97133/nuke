-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_price_index -f this-file.sql
-- Contract for 20261018050000_family_price_index.sql. Synthetic rows only; never production.
--   * the migration applies twice;
--   * family_price_index and family_price_change: RLS on, no direct read for anon or authenticated, read-only for service_role;
--   * record_family_price_index() is service_role only (not PUBLIC, anon or authenticated), a definer with a pinned search_path;
--   * a first write lands the change row and the series; a second write REPLACES the family's rows (it never adds to them) and
--     leaves every other family alone;
--   * a refusal changes nothing: a fitted_at more than 5 minutes ahead of the database clock, a fitted_at older than the stored
--     fit, a verdict its own interval contradicts, a malformed period or chip, a payload that is not an object;
--   * family_price_index_read() is anon: one jsonb with the change, the series oldest first (a 120-period series comes back whole,
--     far under 1,000 rows), live counts for a family that was never fitted, the floor, and a stale flag after 72 hours;
--   * the job's reads (candidates, inputs, features, pairs) are service_role only and bounded: 50+ sales, the 'other' bucket, unpriced,
--     future-dated and pre-2016 rows left out, a limit that reports truncation, the matview alone for the family's sales (no read of
--     vehicles), 2,000 vehicle ids at most for their mileage, transmission and title, repeat sales only for cars that sold twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.family_price_index') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS % (%)', label, SQLERRM; RETURN; END;
  RAISE EXCEPTION 'Contract failed: % (statement succeeded)', label;
END $$;
-- a refusal must name its reason, and the stored rows must be what they were
CREATE FUNCTION pg_temp.refuses(label text, payload jsonb, reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before text; after text;
BEGIN
  SELECT coalesce(string_agg(format('%s|%s|%s|%s', brand, family_key, verdict, fitted_at), ';' ORDER BY brand, family_key), '') ||
         '#' || (SELECT count(*) FROM public.family_price_index)::text INTO before FROM public.family_price_change;
  BEGIN
    PERFORM public.record_family_price_index(payload);
  EXCEPTION WHEN OTHERS THEN
    IF position(reason IN SQLERRM) = 0 THEN RAISE EXCEPTION 'Contract failed: % (refused, but for another reason: %)', label, SQLERRM; END IF;
    SELECT coalesce(string_agg(format('%s|%s|%s|%s', brand, family_key, verdict, fitted_at), ';' ORDER BY brand, family_key), '') ||
           '#' || (SELECT count(*) FROM public.family_price_index)::text INTO after FROM public.family_price_change;
    IF after IS DISTINCT FROM before THEN RAISE EXCEPTION 'Contract failed: % (refused, but it changed rows)', label; END IF;
    RAISE NOTICE 'PASS % (%)', label, SQLERRM; RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % (the writer accepted it)', label;
END $$;
-- a series of n periods ending with the latest complete month or quarter
CREATE FUNCTION pg_temp.series(kind text, n integer, base numeric DEFAULT 100000) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'period_start', d, 'index_usd', round(base * (1 + 0.01 * i)), 'lo_usd', round(base * (1 + 0.01 * i) * 0.9),
           'hi_usd', round(base * (1 + 0.01 * i) * 1.1), 'n', 10 + i, 'raw_median_usd', round(base * (1 + 0.02 * i))) ORDER BY d), '[]'::jsonb)
  FROM (SELECT i, (date_trunc(kind, current_date) - (n - i) * (CASE kind WHEN 'month' THEN interval '1 month' ELSE interval '3 months' END))::date AS d
        FROM generate_series(1, n) i) x
$$;
CREATE FUNCTION pg_temp.payload(brand text, fk text, fitted timestamptz, verdict text, change numeric, lo numeric, hi numeric, kind text, series jsonb,
                                chips jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('brand', brand, 'family_key', fk, 'fitted_at', fitted, 'period_kind', kind, 'series', series,
    'change', jsonb_build_object('change_12m', change, 'lo', lo, 'hi', hi, 'n_last12', 90, 'n_prior12', 46, 'verdict', verdict,
      'method', 'hedonic_v1', 'ref_car', '{"basis": "sales in the last 12 months", "n": 121}'::jsonb, 'pairs', 23, 'rs_change', 0.52,
      'rs_lo', 0.03, 'rs_hi', 1.11, 'chips', chips))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(text, boolean), pg_temp.fails(text, text), pg_temp.refuses(text, jsonb, text), pg_temp.series(text, integer, numeric),
  pg_temp.payload(text, text, timestamptz, text, numeric, numeric, numeric, text, jsonb, jsonb) TO anon, authenticated, service_role;

-- the reads, with the columns the migration uses and their live types (2026-10-16)
CREATE TABLE public.mv_family_sales (vehicle_id uuid, brand text, family_key text, model text, year integer, source text, usd bigint, sale_date date);
CREATE TABLE public.mv_family_market (brand text, family_key text, family text, model_key text, model text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, mileage integer, transmission text, bat_listing_title text, listing_title text, title text);
CREATE TABLE public.auction_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source text, auction_end_date timestamptz,
  outcome text, winning_bid numeric);

-- Ferrari / f430: 80 priced sales (30 in the last year, 30 the year before, 20 older), plus rows each rule must leave out
INSERT INTO public.mv_family_market VALUES ('Ferrari', 'f430', 'F430', 'f430', 'F430'), ('Ferrari', 'other', NULL, 'x', 'x'),
  ('Ford', 'mustang', 'Mustang', 'mustang', 'Mustang');
INSERT INTO public.vehicles (id, mileage, transmission, bat_listing_title, listing_title, title)
SELECT ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 1000 * g, CASE WHEN g % 3 = 0 THEN '6-Speed Manual' ELSE '6-Speed F1 Automated' END,
       CASE WHEN g % 2 = 0 THEN g || 'k-Mile 2007 Ferrari F430 Spider' END, g || '-listing title', 'plain title ' || g
FROM generate_series(1, 120) g;
INSERT INTO public.vehicles (id, mileage, transmission, bat_listing_title, listing_title, title)
VALUES ('00000000-0000-0000-0000-000000000200', NULL, NULL, NULL, NULL, 'only the plain title');
INSERT INTO public.mv_family_sales (vehicle_id, brand, family_key, model, year, source, usd, sale_date)
SELECT ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'Ferrari', 'f430', 'F430 Spider', 2005 + g % 5,
       CASE WHEN g % 4 = 0 THEN 'Mecum' ELSE 'Bring a Trailer' END, 100000 + 1000 * g,
       CASE WHEN g <= 30 THEN current_date - g * 11            -- last 365 days: 11 .. 330 days ago
            WHEN g <= 60 THEN current_date - 365 - (g - 30) * 11   -- the 365 before
            ELSE current_date - 800 - (g - 60) * 30 END       -- older
FROM generate_series(1, 80) g;
INSERT INTO public.mv_family_sales (vehicle_id, brand, family_key, model, year, source, usd, sale_date) VALUES
  ('00000000-0000-0000-0000-000000000101', 'Ferrari', 'f430', 'F430', 2006, 'Bring a Trailer', 400, current_date - 10),                 -- under $500: unpriced
  ('00000000-0000-0000-0000-000000000102', 'Ferrari', 'f430', 'F430', 2006, 'Bring a Trailer', 90000, current_date + 30),              -- future-dated
  ('00000000-0000-0000-0000-000000000103', 'Ferrari', 'f430', 'F430', 2006, 'Bring a Trailer', 90000, date '2015-12-31'),             -- before 2016
  ('00000000-0000-0000-0000-000000000104', 'Ferrari', 'other', 'Dino', 1972, 'Mecum', 300000, current_date - 20);                     -- the leftover bucket
-- Ford / mustang: 55 sales; Ford / small: 10 sales (under the candidates' 50)
INSERT INTO public.mv_family_sales (vehicle_id, brand, family_key, model, year, source, usd, sale_date)
SELECT gen_random_uuid(), 'Ford', 'mustang', 'Mustang GT', 1990 + g % 20, 'Bring a Trailer', 20000 + 100 * g, current_date - g * 6 FROM generate_series(1, 55) g;
INSERT INTO public.mv_family_sales (vehicle_id, brand, family_key, model, year, source, usd, sale_date)
SELECT gen_random_uuid(), 'Ford', 'small', 'Pinto', 1975, 'Mecum', 5000, current_date - g FROM generate_series(1, 10) g;
-- repeat sales: vehicle 1 sold twice (BaT, a year apart), vehicle 2 three times (one a duplicate row), vehicle 3 once, vehicle 4 twice but one unsold, vehicle 5 twice, one undated
INSERT INTO public.auction_events (vehicle_id, source, auction_end_date, outcome, winning_bid) VALUES
  ('00000000-0000-0000-0000-000000000001', 'bat', current_date - 800, 'sold', 90000),
  ('00000000-0000-0000-0000-000000000001', 'bat', current_date - 20, 'sold', 120000),
  ('00000000-0000-0000-0000-000000000002', 'bat', current_date - 900, 'sold', 80000),
  ('00000000-0000-0000-0000-000000000002', 'bat', current_date - 400, 'sold', 95000),
  ('00000000-0000-0000-0000-000000000002', 'mecum', current_date - 30, 'sold', 110000),
  ('00000000-0000-0000-0000-000000000003', 'bat', current_date - 50, 'sold', 100000),
  ('00000000-0000-0000-0000-000000000004', 'bat', current_date - 500, 'sold', 70000),
  ('00000000-0000-0000-0000-000000000004', 'bat', current_date - 60, 'reserve_not_met', 99000),
  ('00000000-0000-0000-0000-000000000005', 'bat', current_date - 700, 'sold', 60000),
  ('00000000-0000-0000-0000-000000000005', 'bat', NULL, 'sold', 70000),
  ('00000000-0000-0000-0000-000000000006', 'bat', current_date - 700, 'sold', 300),                                                   -- under $500
  ('00000000-0000-0000-0000-000000000006', 'bat', current_date - 100, 'sold', 80000),
  ('00000000-0000-0000-0000-000000000007', 'bat', date '2015-06-01', 'sold', 40000),                                                -- before 2016
  ('00000000-0000-0000-0000-000000000007', 'bat', current_date - 100, 'sold', 80000);

\ir ../migrations/20261018050000_family_price_index.sql
\ir ../migrations/20261018050000_family_price_index.sql

-- ---------------------------------------------------------------------------------------------------------------- grants
SELECT pg_temp.ok('RLS is on for both tables',
  (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.family_price_index'::regclass, 'public.family_price_change'::regclass)));
SELECT pg_temp.ok('anon and authenticated read neither table; service_role reads and does not write them',
  NOT has_table_privilege('anon', 'public.family_price_index', 'select') AND NOT has_table_privilege('anon', 'public.family_price_change', 'select')
  AND NOT has_table_privilege('authenticated', 'public.family_price_index', 'select') AND NOT has_table_privilege('authenticated', 'public.family_price_change', 'select')
  AND has_table_privilege('service_role', 'public.family_price_index', 'select') AND has_table_privilege('service_role', 'public.family_price_change', 'select')
  AND NOT has_table_privilege('service_role', 'public.family_price_index', 'insert') AND NOT has_table_privilege('service_role', 'public.family_price_change', 'update')
  AND NOT has_table_privilege('service_role', 'public.family_price_index', 'delete'));
SELECT pg_temp.ok('the writer and the job''s four reads: service_role only',
  (SELECT bool_and(has_function_privilege('service_role', f, 'execute') AND NOT has_function_privilege('anon', f, 'execute')
                   AND NOT has_function_privilege('authenticated', f, 'execute') AND NOT has_function_privilege('public', f, 'execute'))
   FROM unnest(ARRAY['public.record_family_price_index(jsonb)', 'public.family_price_index_candidates()',
                     'public.family_price_index_inputs(text,text,integer)', 'public.family_price_index_features(uuid[])',
                     'public.family_price_index_pairs(text,text,integer)']) f));
SELECT pg_temp.ok('the reader: anon, authenticated and service_role, not PUBLIC',
  has_function_privilege('anon', 'public.family_price_index_read(text,text)', 'execute')
  AND has_function_privilege('authenticated', 'public.family_price_index_read(text,text)', 'execute')
  AND has_function_privilege('service_role', 'public.family_price_index_read(text,text)', 'execute')
  AND NOT has_function_privilege('public', 'public.family_price_index_read(text,text)', 'execute'));
SELECT pg_temp.ok('all six functions are definers with a pinned search_path',
  (SELECT count(*) = 6 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']) FROM pg_proc p
   WHERE p.proname IN ('record_family_price_index', 'family_price_index_read', 'family_price_index_candidates', 'family_price_index_inputs',
                       'family_price_index_features', 'family_price_index_pairs')));

-- ---------------------------------------------------------------------------------------------------------------- the reader, nothing written yet
SET ROLE anon;
DO $$
DECLARE r jsonb := public.family_price_index_read('Ferrari', 'f430');
BEGIN
  PERFORM pg_temp.ok('a family never fitted: change null, no series, no period kind, not stale, fitted_at null',
    r->'change' = 'null'::jsonb AND r->'series' = '[]'::jsonb AND r->'period_kind' = 'null'::jsonb AND r->'fitted_at' = 'null'::jsonb
    AND r->'stale' = 'false'::jsonb);
  PERFORM pg_temp.ok('its live counts say why: 30 in the last year, 30 the year before, 80 priced sales since 2016 (not the unpriced, future or pre-2016 rows)',
    r->'counts' = '{"n_last12": 30, "n_prior12": 30, "n_total": 80}'::jsonb);
  PERFORM pg_temp.ok('the floor is in the answer',
    r->'floor' = '{"sales_each_year": 30, "sales_total": 150, "flat_within": 0.05, "chip_sales_each_year": 15}'::jsonb);
  PERFORM pg_temp.ok('an unknown family reads as zero counts, not an error',
    public.family_price_index_read('Nobody', 'nothing')->'counts' = '{"n_last12": 0, "n_prior12": 0, "n_total": 0}'::jsonb);
END $$;
SELECT pg_temp.fails('anon cannot read the change table', $s$SELECT count(*) FROM public.family_price_change$s$);
SELECT pg_temp.fails('anon cannot read the index table', $s$SELECT count(*) FROM public.family_price_index$s$);
SELECT pg_temp.fails('anon cannot write', $s$SELECT public.record_family_price_index('{}'::jsonb)$s$);
RESET ROLE;
SET ROLE authenticated;
SELECT pg_temp.fails('authenticated cannot write', $s$SELECT public.record_family_price_index('{}'::jsonb)$s$);
SELECT pg_temp.fails('authenticated cannot read the job''s inputs', $s$SELECT public.family_price_index_inputs('Ferrari', 'f430')$s$);
SELECT pg_temp.fails('authenticated cannot read the job''s features', $s$SELECT public.family_price_index_features(ARRAY['00000000-0000-0000-0000-000000000001']::uuid[])$s$);
RESET ROLE;

-- ---------------------------------------------------------------------------------------------------------------- the writer
SET ROLE service_role;
SELECT pg_temp.ok('a first write: six quarters, three chips, one change row',
  (public.record_family_price_index(pg_temp.payload('Ferrari', 'f430', now() - interval '1 hour', 'up', 0.297, 0.205, 0.396, 'quarter',
     pg_temp.series('quarter', 6),
     '[{"kind":"body_gearbox","key":"spider|auto","label":"Spider · F1","change":0.34,"lo":0.19,"hi":0.52,"n_last12":39,"n_prior12":17,"verdict":"up"},
       {"kind":"body_gearbox","key":"coupe|manual","label":"Coupe · manual","change":null,"lo":null,"hi":null,"n_last12":4,"n_prior12":7,"verdict":"too few to tell"},
       {"kind":"body_gearbox","key":"coupe|auto","label":"Coupe · F1","change":0.05,"lo":-0.20,"hi":0.36,"n_last12":14,"n_prior12":8,"verdict":"too few to tell"}]'::jsonb))
   ->>'series_written')::int = 6);
SELECT pg_temp.ok('a neighbouring family is written too (Mustang, monthly)',
  (public.record_family_price_index(pg_temp.payload('Ford', 'mustang', now() - interval '30 minutes', 'flat', 0.012, -0.015, 0.039, 'month',
     pg_temp.series('month', 24, 30000))))->>'series_written' = '24');
RESET ROLE;
SELECT pg_temp.ok('the rows are there: 6 + 24 index rows, 2 change rows, the writer''s timestamp on every row',
  (SELECT count(*) FROM public.family_price_index) = 30 AND (SELECT count(*) FROM public.family_price_change) = 2
  AND (SELECT count(DISTINCT fitted_at) FROM public.family_price_index WHERE family_key = 'f430') = 1);

SET ROLE anon;
DO $$
DECLARE r jsonb := public.family_price_index_read('Ferrari', 'f430'); s jsonb; c jsonb;
BEGIN
  PERFORM pg_temp.ok('the reader returns the change row: estimate, range, sales, verdict, method, reference car, repeat-sale check',
    (r#>>'{change,change_12m}')::numeric = 0.297 AND (r#>>'{change,lo}')::numeric = 0.205 AND (r#>>'{change,hi}')::numeric = 0.396
    AND (r#>>'{change,n_last12}')::int = 90 AND (r#>>'{change,n_prior12}')::int = 46 AND r#>>'{change,verdict}' = 'up'
    AND r#>>'{change,method}' = 'hedonic_v1' AND (r#>>'{change,ref_car,n}')::int = 121
    AND (r#>>'{change,pairs}')::int = 23 AND (r#>>'{change,rs_change}')::numeric = 0.52 AND (r#>>'{change,rs_lo}')::numeric = 0.03
    AND (r#>>'{change,rs_hi}')::numeric = 1.11);
  PERFORM pg_temp.ok('three chips come back whole, a thin one with a null change',
    jsonb_array_length(r#>'{change,chips}') = 3 AND r#>'{change,chips,1,change}' = 'null'::jsonb AND r#>>'{change,chips,1,verdict}' = 'too few to tell'
    AND r#>>'{change,chips,0,label}' = 'Spider · F1');
  PERFORM pg_temp.ok('the series: quarters, oldest first, each with its range, its sales and its plain median',
    r->>'period_kind' = 'quarter' AND jsonb_array_length(r->'series') = 6
    AND (SELECT array_agg(x->>'period_start' ORDER BY ord) = array_agg(x->>'period_start' ORDER BY x->>'period_start')
         FROM jsonb_array_elements(r->'series') WITH ORDINALITY e(x, ord))
    AND (r#>>'{series,0,index_usd}')::numeric = 101000 AND (r#>>'{series,0,lo_usd}')::numeric = 90900 AND (r#>>'{series,0,hi_usd}')::numeric = 111100
    AND (r#>>'{series,0,n}')::int = 11 AND (r#>>'{series,0,raw_median_usd}')::numeric = 102000
    AND (SELECT bool_and(x ? 'period_start' AND x ? 'index_usd' AND x ? 'lo_usd' AND x ? 'hi_usd' AND x ? 'n' AND x ? 'raw_median_usd')
         FROM jsonb_array_elements(r->'series') x));
  PERFORM pg_temp.ok('fitted and fresh: fitted_at set, not stale; the neighbour reads its own monthly rows',
    r->>'fitted_at' IS NOT NULL AND r->'stale' = 'false'::jsonb
    AND public.family_price_index_read('Ford', 'mustang')->>'period_kind' = 'month'
    AND jsonb_array_length(public.family_price_index_read('Ford', 'mustang')->'series') = 24
    AND public.family_price_index_read('Ford', 'mustang')#>>'{change,verdict}' = 'flat');
END $$;
RESET ROLE;

-- a second write replaces: three monthly periods, a different verdict, no chips
SET ROLE service_role;
SELECT pg_temp.ok('a second write reports the six rows it replaced and the three it wrote',
  (SELECT r->>'series_replaced' = '6' AND r->>'series_written' = '3' AND r->>'verdict' = 'flat'
   FROM (SELECT public.record_family_price_index(pg_temp.payload('Ferrari', 'f430', now() - interval '10 minutes', 'flat', 0.01, -0.02, 0.04, 'month',
     pg_temp.series('month', 3))) r) x));
RESET ROLE;
SELECT pg_temp.ok('it replaced, never added: three index rows for the family, all month, none of the old quarters; the neighbour untouched',
  (SELECT count(*) = 3 AND bool_and(period_kind = 'month') FROM public.family_price_index WHERE family_key = 'f430')
  AND (SELECT count(*) = 24 FROM public.family_price_index WHERE family_key = 'mustang')
  AND (SELECT count(*) = 1 FROM public.family_price_change WHERE family_key = 'f430'));
SELECT pg_temp.ok('the change row is the new one: flat, no chips, the new timestamp',
  (SELECT verdict = 'flat' AND jsonb_array_length(chips) = 0 AND change_12m = 0.01 AND fitted_at > now() - interval '20 minutes'
   FROM public.family_price_change WHERE family_key = 'f430'));
SET ROLE service_role;
SELECT pg_temp.ok('a write with no series clears the family''s old rows (the family is read, nothing to draw)',
  (public.record_family_price_index(jsonb_build_object('brand', 'Ferrari', 'family_key', 'f430', 'fitted_at', now() - interval '5 minutes',
     'change', jsonb_build_object('change_12m', 0.03, 'lo', -0.09, 'hi', 0.16, 'n_last12', 40, 'n_prior12', 35, 'verdict', 'too few to tell', 'method', 'hedonic_v1'))))
  ->>'series_written' = '0');
RESET ROLE;
SELECT pg_temp.ok('and the reader says so: a change with a verdict, an empty series, no period kind',
  (SELECT r#>>'{change,verdict}' = 'too few to tell' AND r->'series' = '[]'::jsonb AND r->'period_kind' = 'null'::jsonb
          AND r#>'{change,chips}' = '[]'::jsonb AND r#>'{change,ref_car}' = '{}'::jsonb
   FROM (SELECT public.family_price_index_read('Ferrari', 'f430') r) x));

-- ---------------------------------------------------------------------------------------------------------------- refusals
SET ROLE service_role;
SELECT pg_temp.refuses('a fitted_at a day ahead of the database clock',
  pg_temp.payload('Ferrari', 'f430', now() + interval '1 day', 'flat', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3)), 'is in the future');
SELECT pg_temp.refuses('a fitted_at ten minutes ahead',
  pg_temp.payload('Ferrari', 'f430', now() + interval '10 minutes', 'flat', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3)), 'is in the future');
SELECT pg_temp.ok('a fitted_at one minute ahead (clock skew) is accepted',
  (public.record_family_price_index(pg_temp.payload('Ferrari', 'f430', now() + interval '1 minute', 'flat', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3))))
  ->>'series_written' = '3');
SELECT pg_temp.refuses('a fitted_at older than the stored fit',
  pg_temp.payload('Ferrari', 'f430', now() - interval '2 days', 'flat', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3)), 'is older than the stored fit');
SELECT pg_temp.refuses('no fitted_at', pg_temp.payload('Ferrari', 'f430', now(), 'flat', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3)) - 'fitted_at', 'fitted_at is required');
SELECT pg_temp.refuses('a fitted_at that is not a time',
  jsonb_set(pg_temp.payload('Ferrari', 'f430', now(), 'flat', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3)), '{fitted_at}', '"soon"'), 'fitted_at is required');
SELECT pg_temp.refuses('verdict up with a range that holds zero',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.04, -0.02, 0.10, 'month', pg_temp.series('month', 3)), 'verdict up needs a range above zero');
SELECT pg_temp.refuses('verdict down with a range that holds zero',
  pg_temp.payload('Ferrari', 'f430', now(), 'down', -0.04, -0.10, 0.02, 'month', pg_temp.series('month', 3)), 'verdict down needs a range below zero');
SELECT pg_temp.refuses('verdict flat with a range wider than +-5 points',
  pg_temp.payload('Ferrari', 'f430', now(), 'flat', 0.0, -0.09, 0.09, 'month', pg_temp.series('month', 3)), 'verdict flat needs a range that holds zero');
SELECT pg_temp.refuses('verdict flat with a range above zero',
  pg_temp.payload('Ferrari', 'f430', now(), 'flat', 0.03, 0.01, 0.05, 'month', pg_temp.series('month', 3)), 'verdict flat needs a range that holds zero');
SELECT pg_temp.refuses('verdict too few to tell with a narrow range',
  pg_temp.payload('Ferrari', 'f430', now(), 'too few to tell', 0.0, -0.02, 0.02, 'month', pg_temp.series('month', 3)), 'verdict too few to tell needs a range');
SELECT pg_temp.refuses('verdict too few to tell with a range above zero',
  pg_temp.payload('Ferrari', 'f430', now(), 'too few to tell', 0.2, 0.01, 0.5, 'month', pg_temp.series('month', 3)), 'verdict too few to tell needs a range');
SELECT pg_temp.refuses('a verdict that is not one of the four',
  pg_temp.payload('Ferrari', 'f430', now(), 'maybe', 0.01, -0.02, 0.04, 'month', pg_temp.series('month', 3)), 'verdict must be');
SELECT pg_temp.refuses('a range that does not hold its estimate',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.50, 0.10, 0.20, 'month', pg_temp.series('month', 3)), 'range must hold the estimate');
SELECT pg_temp.refuses('an estimate with no range',
  jsonb_set(pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 3)), '{change,lo}', 'null'), 'all numbers or all null');
SELECT pg_temp.refuses('up with no estimate at all',
  jsonb_set(jsonb_set(jsonb_set(pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 3)), '{change,change_12m}', 'null'),
    '{change,lo}', 'null'), '{change,hi}', 'null'), 'needs change_12m, lo and hi');
SELECT pg_temp.refuses('the repeat-sale range that does not hold its estimate',
  jsonb_set(pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 3)), '{change,rs_change}', '2.5'), 'repeat-sale range must hold');
SELECT pg_temp.refuses('negative pairs',
  jsonb_set(pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 3)), '{change,pairs}', '-3'), 'pairs must be');
SELECT pg_temp.refuses('a period that is not the first day of its quarter',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'quarter',
    jsonb_build_array(jsonb_build_object('period_start', (date_trunc('quarter', current_date) - interval '3 months')::date + 14, 'index_usd', 100, 'lo_usd', 90, 'hi_usd', 110, 'n', 5, 'raw_median_usd', 100))),
  'is not the first day of a quarter');
SELECT pg_temp.refuses('a period that is not the first day of its month',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month',
    jsonb_build_array(jsonb_build_object('period_start', (date_trunc('month', current_date) - interval '1 month')::date + 3, 'index_usd', 100, 'lo_usd', 90, 'hi_usd', 110, 'n', 5, 'raw_median_usd', 100))),
  'is not the first day of a month');
SELECT pg_temp.refuses('the same period twice',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2) || pg_temp.series('month', 2)), 'appears twice');
SELECT pg_temp.refuses('a period in the future',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month',
    jsonb_build_array(jsonb_build_object('period_start', (date_trunc('month', current_date) + interval '2 months')::date, 'index_usd', 100, 'lo_usd', 90, 'hi_usd', 110, 'n', 5, 'raw_median_usd', 100))),
  'is in the future');
SELECT pg_temp.refuses('a series with no period kind',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, NULL, pg_temp.series('month', 2)), 'period_kind must be month or quarter');
SELECT pg_temp.refuses('a period kind of week',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'week', pg_temp.series('month', 2)), 'period_kind must be month or quarter');
SELECT pg_temp.refuses('an index above its range',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month',
    jsonb_build_array(jsonb_build_object('period_start', (date_trunc('month', current_date) - interval '1 month')::date, 'index_usd', 200, 'lo_usd', 90, 'hi_usd', 110, 'n', 5, 'raw_median_usd', 100))),
  'needs 0 < lo_usd <= index_usd <= hi_usd');
SELECT pg_temp.refuses('a negative n in a period',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month',
    jsonb_build_array(jsonb_build_object('period_start', (date_trunc('month', current_date) - interval '1 month')::date, 'index_usd', 100, 'lo_usd', 90, 'hi_usd', 110, 'n', -1, 'raw_median_usd', 100))),
  'needs 0 < lo_usd <= index_usd <= hi_usd');
SELECT pg_temp.refuses('a plain median of zero',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month',
    jsonb_build_array(jsonb_build_object('period_start', (date_trunc('month', current_date) - interval '1 month')::date, 'index_usd', 100, 'lo_usd', 90, 'hi_usd', 110, 'n', 5, 'raw_median_usd', 0))),
  'needs 0 < lo_usd <= index_usd <= hi_usd');
SELECT pg_temp.refuses('131 periods', pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 131)), 'at most 130 periods');
SELECT pg_temp.ok('130 periods are accepted',
  (public.record_family_price_index(pg_temp.payload('Ford', 'mustang', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 130, 30000))))->>'series_written' = '130');
SELECT pg_temp.ok('and the reader returns all of them (far under 1,000 rows)',
  jsonb_array_length(public.family_price_index_read('Ford', 'mustang')->'series') = 130);
SELECT pg_temp.refuses('a chip with no label',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2),
    '[{"kind":"generation","key":"c8","change":0.1,"lo":0.0,"hi":0.2,"n_last12":20,"n_prior12":20,"verdict":"up"}]'::jsonb), 'a chip needs kind, key, label');
SELECT pg_temp.refuses('a chip with a verdict that is not one of the four',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2),
    '[{"kind":"generation","key":"c8","label":"C8","change":0.1,"lo":0.0,"hi":0.2,"n_last12":20,"n_prior12":20,"verdict":"great"}]'::jsonb), 'a chip needs kind, key, label');
SELECT pg_temp.refuses('a chip whose range does not hold its estimate',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2),
    '[{"kind":"generation","key":"c8","label":"C8","change":0.5,"lo":0.0,"hi":0.2,"n_last12":20,"n_prior12":20,"verdict":"up"}]'::jsonb), 'a chip''s range must hold its estimate');
SELECT pg_temp.refuses('31 chips',
  pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2),
    (SELECT jsonb_agg(jsonb_build_object('kind', 'variant', 'key', 'v' || i, 'label', 'V' || i, 'change', NULL, 'lo', NULL, 'hi', NULL, 'n_last12', 1, 'n_prior12', 1, 'verdict', 'too few to tell'))
     FROM generate_series(1, 31) i)), 'at most 30');
SELECT pg_temp.refuses('the "other" bucket', pg_temp.payload('Ferrari', 'other', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2)), 'not a family');
SELECT pg_temp.refuses('no brand', pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2)) - 'brand', 'brand and family_key are required');
SELECT pg_temp.refuses('a payload that is an array', '[1,2]'::jsonb, 'must be a json object');
SELECT pg_temp.refuses('a payload with no change object', pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2)) - 'change', 'change is required');
SELECT pg_temp.refuses('whole-number n_last12 only',
  jsonb_set(pg_temp.payload('Ferrari', 'f430', now(), 'up', 0.30, 0.10, 0.40, 'month', pg_temp.series('month', 2)), '{change,n_last12}', '90.5'), 'must be whole numbers');
RESET ROLE;

-- ---------------------------------------------------------------------------------------------------------------- stale
UPDATE public.family_price_change SET fitted_at = now() - interval '80 hours' WHERE family_key = 'mustang';
UPDATE public.family_price_index SET fitted_at = now() - interval '80 hours' WHERE family_key = 'mustang';
SET ROLE anon;
SELECT pg_temp.ok('a fit over 72 hours old reads as stale; a recent one does not',
  public.family_price_index_read('Ford', 'mustang')->'stale' = 'true'::jsonb AND public.family_price_index_read('Ferrari', 'f430')->'stale' = 'false'::jsonb);
RESET ROLE;

-- ---------------------------------------------------------------------------------------------------------------- the job's reads
SET ROLE service_role;
DO $$
DECLARE c jsonb := public.family_price_index_candidates(); r jsonb;
BEGIN
  PERFORM pg_temp.ok('candidates: the families with 50+ priced sales, biggest first, each with its name and window counts',
    c->'columns' = '["brand","family_key","family","n_total","n_last12","n_prior12"]'::jsonb
    AND c->'rows' = '[["Ferrari","f430","F430",80,30,30],["Ford","mustang","Mustang",55,55,0]]'::jsonb);
  PERFORM pg_temp.ok('candidates: today and the start of the window are named',
    (c->>'today')::date = current_date AND (c->>'since')::date = date '2016-01-01');
  r := public.family_price_index_inputs('Ferrari', 'f430');
  PERFORM pg_temp.ok('inputs: 80 priced rows, none returned short, the matview''s columns in order, newest first',
    (r->>'n')::int = 80 AND (r->>'returned')::int = 80 AND r->'truncated' = 'false'::jsonb AND (r->>'today')::date = current_date
    AND r->'columns' = '["vehicle_id","model","year","source","usd","sale_date"]'::jsonb
    AND jsonb_array_length(r->'rows') = 80
    AND (SELECT array_agg(x->>5 ORDER BY ord) = array_agg(x->>5 ORDER BY x->>5 DESC) FROM jsonb_array_elements(r->'rows') WITH ORDINALITY e(x, ord)));
  PERFORM pg_temp.ok('inputs: the sale''s own fields (model, year, source, price, date), and no vehicle fields',
    (SELECT jsonb_array_length(x) = 6 AND x->>1 = 'F430 Spider' AND x->>3 IN ('Mecum', 'Bring a Trailer') AND (x->>4)::numeric = 101000
     FROM jsonb_array_elements(r->'rows') x WHERE x->>0 = '00000000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.ok('inputs: not the $400 sale, the future-dated one, the 2015 one or the "other" bucket',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE (x->>4)::numeric < 500 OR (x->>5)::date > current_date OR (x->>5)::date < date '2016-01-01'
                OR x->>0 IN ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000104')));
  r := public.family_price_index_inputs('Ferrari', 'f430', 10);
  PERFORM pg_temp.ok('inputs: a limit of 10 returns the 10 newest and says it truncated',
    (r->>'n')::int = 80 AND (r->>'returned')::int = 10 AND r->'truncated' = 'true'::jsonb AND jsonb_array_length(r->'rows') = 10);
  PERFORM pg_temp.ok('inputs: the "other" bucket and an unknown family return nothing',
    jsonb_array_length(public.family_price_index_inputs('Ferrari', 'other')->'rows') = 0
    AND jsonb_array_length(public.family_price_index_inputs('Nobody', 'nothing')->'rows') = 0);
  r := public.family_price_index_features(ARRAY['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
                                                  '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000ff']::uuid[]);
  PERFORM pg_temp.ok('features: two vehicles found (the repeated id once, the id with no vehicle left out), columns in order',
    (r->>'requested')::int = 4 AND (r->>'returned')::int = 2 AND r->'truncated' = 'false'::jsonb
    AND r->'columns' = '["vehicle_id","mileage","transmission","title"]'::jsonb AND jsonb_array_length(r->'rows') = 2);
  PERFORM pg_temp.ok('features: mileage and transmission ride along; the title is the BaT title when there is one, else the listing title',
    (SELECT x->>1 = '2000' AND x->>2 = '6-Speed F1 Automated' AND x->>3 = '2k-Mile 2007 Ferrari F430 Spider' FROM jsonb_array_elements(r->'rows') x WHERE x->>0 = '00000000-0000-0000-0000-000000000002')
    AND (SELECT x->>1 = '1000' AND x->>2 = '6-Speed F1 Automated' AND x->>3 = '1-listing title' FROM jsonb_array_elements(r->'rows') x WHERE x->>0 = '00000000-0000-0000-0000-000000000001'));
  PERFORM pg_temp.ok('features: the title falls back to the plain title when the others are empty',
    (SELECT x->>3 = 'only the plain title' AND x->1 = 'null'::jsonb AND x->2 = 'null'::jsonb
     FROM jsonb_array_elements(public.family_price_index_features(ARRAY['00000000-0000-0000-0000-000000000200']::uuid[])->'rows') x));
  r := public.family_price_index_features((SELECT array_agg(('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid) FROM generate_series(1, 2500) g));
  PERFORM pg_temp.ok('features: 2,500 ids ask for more than 2,000: 2,000 at most come back and it says it truncated',
    (r->>'requested')::int = 2500 AND r->'truncated' = 'true'::jsonb AND (r->>'returned')::int <= 130 AND jsonb_array_length(r->'rows') = (r->>'returned')::int);
  PERFORM pg_temp.ok('features: no ids, no rows',
    public.family_price_index_features('{}'::uuid[])->'rows' = '[]'::jsonb AND (public.family_price_index_features('{}'::uuid[])->>'requested')::int = 0);
  r := public.family_price_index_pairs('Ferrari', 'f430');
  PERFORM pg_temp.ok('pairs: only cars that sold twice, as dated sold events with a bid of 500 or more, from 2016 on, in order',
    r->'columns' = '["vehicle_id","sale_date","usd","source"]'::jsonb AND (r->>'n_vehicles')::int = 2 AND (r->>'returned')::int = 5
    AND (SELECT array_agg(x->>0 || '/' || (x->>2) ORDER BY ord) = ARRAY['00000000-0000-0000-0000-000000000001/90000', '00000000-0000-0000-0000-000000000001/120000',
           '00000000-0000-0000-0000-000000000002/80000', '00000000-0000-0000-0000-000000000002/95000', '00000000-0000-0000-0000-000000000002/110000']
        FROM jsonb_array_elements(r->'rows') WITH ORDINALITY e(x, ord)));
  PERFORM pg_temp.ok('pairs: a limit of 3 cuts the rows, the vehicle count stays',
    (public.family_price_index_pairs('Ferrari', 'f430', 3)->>'returned')::int = 3 AND (public.family_price_index_pairs('Ferrari', 'f430', 3)->>'n_vehicles')::int = 2);
  PERFORM pg_temp.ok('pairs: a family with none returns an empty list',
    public.family_price_index_pairs('Ford', 'mustang')->'rows' = '[]'::jsonb);
END $$;
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.fails('anon cannot read the candidates', $s$SELECT public.family_price_index_candidates()$s$);
SELECT pg_temp.fails('anon cannot read the inputs', $s$SELECT public.family_price_index_inputs('Ferrari', 'f430')$s$);
SELECT pg_temp.fails('anon cannot read the features', $s$SELECT public.family_price_index_features(ARRAY['00000000-0000-0000-0000-000000000001']::uuid[])$s$);
SELECT pg_temp.fails('anon cannot read the pairs', $s$SELECT public.family_price_index_pairs('Ferrari', 'f430')$s$);
RESET ROLE;
