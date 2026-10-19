-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_priced_sales -f this-file.sql
-- Proves the two partial indexes of migration 20261014052000 serve get_model_price_history's own statement and change
-- nothing it answers. The function reads public, undeleted, priced, dated vehicles of a make and model (two arms:
-- model, and normalized_model) inside a year window, newest sale first. Before the migration the plan reads every row of
-- the make and model in those years and drops the unsold ones from the heap; after it the plan is a BitmapOr of the two
-- new indexes, each carrying the function's predicate. The answer must be identical for every call, and a private,
-- deleted, unsold, undated or non-vehicle row must never appear in it. A re-run is a no-op, and a leftover INVALID index
-- stops the migration with a message.
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon;

-- The columns the reader touches, and the indexes production already has on them.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text, normalized_model text,
  is_public boolean, deleted_at timestamptz, sale_price integer, sale_date date, sale_status text, auction_outcome text,
  canonical_platform text, platform_source text, listing_url text, discovery_url text, notes text, import_metadata jsonb,
  created_at timestamptz DEFAULT now(), listing_kind text);
CREATE INDEX idx_vehicles_year ON public.vehicles (year);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles (lower(make), lower(model));
CREATE INDEX idx_vehicles_lower_make_normalized_model ON public.vehicles (lower(make), lower(normalized_model));

-- The functions as production has them on 2026-10-14.
\ir helpers/get_model_price_history_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.get_model_price_history(text, text, integer, integer, integer) TO anon;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(md5(pg_get_functiondef('public.get_model_price_history(text,text,integer,integer,integer)'::regprocedure)) = 'a658400e5f10d1ddcc020b20f4ec31d1'  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  AND md5(pg_get_functiondef('public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)'::regprocedure)) = '4a648fbaef6ff2f41fb44226a8a68b08',  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
  'the fixture is the live source');

-- The cohort: Ford Mustang. Ten rows the reader must return, one per kind of match; twelve it must not.
-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.vehicles (id, year, make, model, normalized_model, is_public, deleted_at, sale_price, sale_date, sale_status, listing_kind) VALUES
 -- returned: both arms, arm one only (no normalized_model), arm two only (model differs), case differences, window edges
 ('f0000000-0000-0000-0000-000000000001', 1965, 'Ford', 'Mustang',           'Mustang', true, NULL, 21000, '2024-03-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000002', 1966, 'Ford', 'Mustang',           NULL,      true, NULL, 24000, '2024-04-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000003', 1967, 'Ford', 'Mustang Fastback',  'Mustang', true, NULL, 52000, '2024-05-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000004', 1967, 'FORD', 'MUSTANG',           'mustang', true, NULL, 31000, '2024-06-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000005', 1963, 'ford', 'mustang',           'Mustang', true, NULL, 12000, '2024-02-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000006', 1969, 'Ford', 'Mustang Mach 1',   'Mustang', true, NULL, 61000, '2024-07-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000007', 1966, 'Ford', 'Mustang',           'Mustang', true, NULL, 27000, '2023-12-01', 'sold', 'vehicle'),
 ('f0000000-0000-0000-0000-000000000008', 1964, 'Ford', 'Mustang',           NULL,      true, NULL, 18000, '2023-11-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-000000000009', 1968, 'Ford', 'Mustang GT',        'Mustang', true, NULL, 45000, '2023-10-01', 'sold', NULL),
 ('f0000000-0000-0000-0000-00000000000a', 1965, 'Ford', 'Mustang',           'Mustang', true, NULL, 22000, '2023-09-01', 'sold', NULL),
 -- never returned
 ('f1000000-0000-0000-0000-000000000001', 1966, 'Ford', 'Mustang', 'Mustang', false, NULL, 99000, '2024-08-01', 'sold', NULL),            -- private
 ('f1000000-0000-0000-0000-000000000002', 1966, 'Ford', 'Mustang', 'Mustang', true, '2025-01-01', 99000, '2024-08-02', 'sold', NULL),     -- deleted
 ('f1000000-0000-0000-0000-000000000003', 1966, 'Ford', 'Mustang', 'Mustang', true, NULL, NULL,  '2024-08-03', 'sold', NULL),             -- no price
 ('f1000000-0000-0000-0000-000000000004', 1966, 'Ford', 'Mustang', 'Mustang', true, NULL, 0,     '2024-08-04', 'sold', NULL),             -- zero price
 ('f1000000-0000-0000-0000-000000000005', 1966, 'Ford', 'Mustang', 'Mustang', true, NULL, 99000, NULL,         'sold', NULL),             -- undated
 ('f1000000-0000-0000-0000-000000000006', 1966, 'Ford', 'Mustang', 'Mustang', true, NULL, 99000, '2024-08-06', 'sold', 'non_vehicle_item'), -- not a vehicle
 ('f1000000-0000-0000-0000-000000000007', 1966, 'Ford', 'Mustang', 'Mustang', true, NULL, 99000, '2024-08-07', 'not_sold', NULL),         -- no sale proven
 ('f1000000-0000-0000-0000-000000000008', 1980, 'Ford', 'Mustang', 'Mustang', true, NULL, 99000, '2024-08-08', 'sold', NULL),             -- outside 1963-1969
 ('f1000000-0000-0000-0000-000000000009', 1966, 'Mercury', 'Mustang', 'Mustang', true, NULL, 99000, '2024-08-09', 'sold', NULL),         -- another make
 ('f1000000-0000-0000-0000-00000000000a', 1966, 'Ford', 'Mustang II', 'Mustang II', true, NULL, 99000, '2024-08-10', 'sold', NULL),       -- another model
 ('f1000000-0000-0000-0000-00000000000b', 1966, 'Ford', 'Mustang', 'Mustang', NULL, NULL, 99000, '2024-08-11', 'sold', NULL),             -- is_public unknown
 ('f1000000-0000-0000-0000-00000000000c', 1966, 'Ford', 'Mustang', 'Mustang', true, NULL, 99000, '2024-08-12', 'available', NULL);        -- listed, not sold
-- The bulk that makes the old plan expensive: 40,000 more Mustang rows that fail the predicate (private or unpriced) and 600
-- that meet it but were never sold, in separate runs of pages, plus 30,000 other vehicles, a quarter of them public, priced
-- and dated, and 20,000 other Fords in the window (the make alone is not selective, as in production). The old plan visits
-- every page of the Mustangs in the window; the new one only the 600 and the ten.
INSERT INTO public.vehicles (year, make, model, normalized_model, is_public, sale_price, sale_date, sale_status)
  SELECT 1963 + (g % 7), 'Ford', 'Mustang', 'Mustang',
         (g % 2) = 0, CASE WHEN g % 2 = 0 THEN NULL ELSE 20000 + g END, date '2022-01-01' + (g % 700), 'available'
  FROM generate_series(1, 40000) g;
INSERT INTO public.vehicles (year, make, model, normalized_model, is_public, sale_price, sale_date, sale_status)
  SELECT 1963 + (g % 7), 'Ford', 'Mustang', 'Mustang', true, 20000 + g, date '2022-01-01' + (g % 700), 'available'
  FROM generate_series(1, 600) g;
INSERT INTO public.vehicles (year, make, model, normalized_model, is_public, sale_price, sale_date, sale_status)
  SELECT 1963 + (g % 7), 'Ford', (ARRAY['Thunderbird','Fairlane','Galaxie','Falcon'])[1 + g % 4],
         (ARRAY['Thunderbird','Fairlane','Galaxie','Falcon'])[1 + g % 4],
         true, 15000 + g, date '2021-01-01' + (g % 900), 'sold'
  FROM generate_series(1, 20000) g;
INSERT INTO public.vehicles (year, make, model, normalized_model, is_public, sale_price, sale_date, sale_status)
  SELECT 1950 + (g % 70), (ARRAY['Toyota','Honda','BMW','Porsche','Chevrolet'])[1 + g % 5],
         (ARRAY['Corolla','Civic','M3','911','C10','Camry','Accord','X5','Cayenne','Blazer'])[1 + g % 10],
         (ARRAY['Corolla','Civic','M3','911','C10','Camry','Accord','X5','Cayenne','Blazer'])[1 + g % 10],
         true, CASE WHEN g % 4 = 0 THEN 10000 + g END, CASE WHEN g % 4 = 0 THEN date '2021-01-01' + (g % 900) END, 'sold'
  FROM generate_series(1, 30000) g;
ANALYZE public.vehicles;

-- 1. Before: what the function answers, for several calls (including a case-folded make, a limit, no year bounds, no match).
CREATE TABLE public.t_before (call text PRIMARY KEY, result jsonb);
INSERT INTO public.t_before
  SELECT 'window',  public.get_model_price_history('Ford', 'Mustang', 300, 1963, 1969) UNION ALL
  SELECT 'case',    public.get_model_price_history('fORD', 'mUSTANG', 300, 1963, 1969) UNION ALL
  SELECT 'limit3',  public.get_model_price_history('Ford', 'Mustang', 3, 1963, 1969) UNION ALL
  SELECT 'nobound', public.get_model_price_history('Ford', 'Mustang', 500, NULL, NULL) UNION ALL
  SELECT 'narrow',  public.get_model_price_history('Ford', 'Mustang', 300, 1966, 1966) UNION ALL
  SELECT 'none',    public.get_model_price_history('Nonexistent', 'Model', 300, NULL, NULL);
SELECT public.t_assert((SELECT jsonb_array_length(result) FROM public.t_before WHERE call = 'window') = 10
  AND (SELECT jsonb_array_length(result) FROM public.t_before WHERE call = 'limit3') = 3
  AND (SELECT jsonb_array_length(result) FROM public.t_before WHERE call = 'none') = 0,
  'before: the window holds the ten sales it should, the limit applies, no match is []');

-- The plan of the function's own statement before the indexes: they do not exist, so it cannot use them.
CREATE FUNCTION public.t_plan(p_make text, p_model text, p_min integer, p_max integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE j json;
BEGIN
  EXECUTE format($q$ EXPLAIN (FORMAT JSON) SELECT id, year, model, sale_date, sale_price FROM vehicles
    WHERE is_public AND lower(make) = lower(%L) AND (lower(model) = lower(%L) OR lower(normalized_model) = lower(%L))
      AND year >= %s AND year <= %s AND sale_price > 0 AND sale_date IS NOT NULL AND deleted_at IS NULL
      AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND vehicle_sale_basis(sale_status, auction_outcome, canonical_platform, listing_url, discovery_url,
                             sale_price::numeric, notes, import_metadata, created_at) IS NOT NULL
    ORDER BY sale_date DESC LIMIT 300 $q$, p_make, p_model, p_model, p_min, p_max) INTO j;
  RETURN j::text;
END $$;
SELECT public.t_assert(public.t_plan('Ford', 'Mustang', 1963, 1969) NOT LIKE '%idx_vehicles_priced_sales%', 'before: the new indexes are not in the plan');

-- 2. The migration (CREATE INDEX CONCURRENTLY: run outside a transaction block, as psql -f does).
\ir ../migrations/20261014052000_vehicles_priced_sales_partial_indexes.sql

-- 3. After: both indexes exist, are valid and ready, and carry the function's predicate.
SELECT public.t_assert((SELECT count(*) FROM pg_index i WHERE i.indexrelid IN
    ('public.idx_vehicles_priced_sales_make_model'::regclass, 'public.idx_vehicles_priced_sales_make_normalized_model'::regclass)
    AND i.indisvalid AND i.indisready) = 2, 'after: both indexes are valid and ready');
SELECT public.t_assert(pg_get_indexdef('public.idx_vehicles_priced_sales_make_model'::regclass) LIKE '%lower(make), lower(model), year)%'
  AND pg_get_indexdef('public.idx_vehicles_priced_sales_make_normalized_model'::regclass) LIKE '%lower(make), lower(normalized_model), year)%'
  AND pg_get_indexdef('public.idx_vehicles_priced_sales_make_model'::regclass) LIKE '%WHERE%is_public%deleted_at IS NULL%sale_price > 0%sale_date IS NOT NULL%'
  AND pg_get_indexdef('public.idx_vehicles_priced_sales_make_normalized_model'::regclass) LIKE '%WHERE%is_public%deleted_at IS NULL%sale_price > 0%sale_date IS NOT NULL%',
  'after: keys and predicate as designed');
ANALYZE public.vehicles;

-- 4. The same answers, to the digit; and nothing that should stay out is in them.
CREATE TABLE public.t_after (call text PRIMARY KEY, result jsonb);
INSERT INTO public.t_after
  SELECT 'window',  public.get_model_price_history('Ford', 'Mustang', 300, 1963, 1969) UNION ALL
  SELECT 'case',    public.get_model_price_history('fORD', 'mUSTANG', 300, 1963, 1969) UNION ALL
  SELECT 'limit3',  public.get_model_price_history('Ford', 'Mustang', 3, 1963, 1969) UNION ALL
  SELECT 'nobound', public.get_model_price_history('Ford', 'Mustang', 500, NULL, NULL) UNION ALL
  SELECT 'narrow',  public.get_model_price_history('Ford', 'Mustang', 300, 1966, 1966) UNION ALL
  SELECT 'none',    public.get_model_price_history('Nonexistent', 'Model', 300, NULL, NULL);
SELECT public.t_assert(NOT EXISTS (SELECT * FROM public.t_before b JOIN public.t_after a USING (call) WHERE a.result IS DISTINCT FROM b.result)
  AND (SELECT count(*) FROM public.t_after) = 6, 'after: identical answers for every call');
SELECT public.t_assert((SELECT array_agg(e->>'vehicle_id' ORDER BY e->>'vehicle_id') FROM public.t_after, jsonb_array_elements(result) e WHERE call = 'window')
  = ARRAY['f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003',
          'f0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000006',
          'f0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000009',
          'f0000000-0000-0000-0000-00000000000a'],
  'after: exactly the ten public, priced, dated, sold Mustangs in the window');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.t_after, jsonb_array_elements(result) e
    WHERE call <> 'nobound' AND (e->>'vehicle_id') LIKE 'f1000000%'),
  'after: no private, deleted, unpriced, undated, non-vehicle, unsold, out-of-window or other-make row appears');
SELECT public.t_assert((SELECT array_agg(e->>'vehicle_id' ORDER BY e->>'vehicle_id') FROM public.t_after, jsonb_array_elements(result) e
    WHERE call = 'nobound' AND (e->>'vehicle_id') LIKE 'f1000000%') = ARRAY['f1000000-0000-0000-0000-000000000008'],
  'after: without year bounds the 1980 Mustang joins the window, and still no private, deleted, unpriced, undated, non-vehicle or unsold row');
SELECT public.t_assert((SELECT (result->0->>'date') FROM public.t_after WHERE call = 'window') = '2023-09-01'
  AND (SELECT (result->-1->>'date') FROM public.t_after WHERE call = 'window') = '2024-07-01', 'after: oldest sale first, as before');
SET ROLE anon;
SELECT public.t_assert(jsonb_array_length(public.get_model_price_history('Ford', 'Mustang', 300, 1963, 1969)) = 10, 'anon still reads it');
RESET ROLE;

-- 5. The statement is served by the new indexes: a BitmapOr of the two.
SELECT public.t_assert(public.t_plan('Ford', 'Mustang', 1963, 1969) LIKE '%idx_vehicles_priced_sales_make_model%'
  AND public.t_plan('Ford', 'Mustang', 1963, 1969) LIKE '%idx_vehicles_priced_sales_make_normalized_model%',
  'after: the plan uses both new indexes');

-- 6. A second run is a no-op.
\ir ../migrations/20261014052000_vehicles_priced_sales_partial_indexes.sql
SELECT public.t_assert((SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_vehicles_priced_sales%') = 2, 're-run: still two indexes');

-- 7. A leftover INVALID index stops the migration with a message.
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_vehicles_priced_sales_make_model'::regclass;
\echo 'Expected: the INVALID index ERROR below.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014052000_vehicles_priced_sales_partial_indexes.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT NOT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vehicles_priced_sales_make_model'::regclass),
  'an INVALID index is reported, not skipped');
SELECT 'vehicles priced-sales indexes contract: PASS' AS result;
