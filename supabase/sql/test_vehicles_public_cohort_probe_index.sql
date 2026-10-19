-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_cohort_probe -f this-file.sql
-- Proves the covering partial index of migration 20261014053500 serves the two cohort lookups the popup and valuation readers
-- make over public vehicles, and changes no answer. The lookups: (1) make + a model-year range + a word-boundary model regex
-- + not a part; (2) make + one model year + a list of lower-cased model names. Both name is_public and deleted_at IS NULL, as
-- every cohort reader does. Before the migration their plans read the heap row of every public vehicle of that make and years;
-- after it they are index-only scans on idx_vehicles_public_cohort_probe. The ids returned must be identical, a private,
-- deleted or part vehicle must never be among them, and the index must not hold a private or deleted vehicle.
-- A re-run is a no-op, and a leftover INVALID index stops the migration with a message.
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

-- The columns the lookups touch and the indexes production already has on them.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text, listing_kind text,
  is_public boolean, deleted_at timestamptz, filler text DEFAULT repeat('x', 200));
CREATE INDEX idx_vehicles_year ON public.vehicles (year);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles (lower(make), lower(model));
CREATE INDEX idx_vehicles_lower_make_public ON public.vehicles (lower(make)) WHERE is_public = true;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;

-- The cohort: Chevrolet Blazers 1976-1980 and the vehicles that must stay out of it.
-- ALLOW_RAW_TESTIMONY_WRITE (disposable test database)
INSERT INTO public.vehicles (id, year, make, model, listing_kind, is_public, deleted_at) VALUES
 ('b0000000-0000-0000-0000-000000000001', 1977, 'Chevrolet', 'K5 Blazer',           NULL, true, NULL),
 ('b0000000-0000-0000-0000-000000000002', 1976, 'CHEVROLET', 'Blazer',              NULL, true, NULL),
 ('b0000000-0000-0000-0000-000000000003', 1980, 'chevrolet', 'k-5 Blazer Cheyenne', NULL, true, NULL),
 ('b0000000-0000-0000-0000-000000000004', 1978, 'Chevrolet', 'Full Size Blazer',    'vehicle', true, NULL),
 ('b0000000-0000-0000-0000-000000000005', 1979, 'Chevrolet', 'K5',                  NULL, true, NULL),
 -- never returned
 ('b1000000-0000-0000-0000-000000000001', 1977, 'Chevrolet', 'K5 Blazer', NULL, false, NULL),                -- private
 ('b1000000-0000-0000-0000-000000000002', 1977, 'Chevrolet', 'K5 Blazer', NULL, true, '2026-01-01'),         -- deleted
 ('b1000000-0000-0000-0000-000000000003', 1977, 'Chevrolet', 'K5 Blazer', 'non_vehicle_item', true, NULL), -- a part
 ('b1000000-0000-0000-0000-000000000004', 1977, 'Chevrolet', 'Trailblazer', NULL, true, NULL),             -- word boundary
 ('b1000000-0000-0000-0000-000000000005', 1975, 'Chevrolet', 'Blazer', NULL, true, NULL),                    -- before the range
 ('b1000000-0000-0000-0000-000000000006', 1981, 'Chevrolet', 'Blazer', NULL, true, NULL),                    -- after the range
 ('b1000000-0000-0000-0000-000000000007', 1977, 'Ford', 'Blazer', NULL, true, NULL),                         -- other make
 ('b1000000-0000-0000-0000-000000000008', 1977, 'Chevrolet', NULL, NULL, true, NULL),                        -- no model
 ('b1000000-0000-0000-0000-000000000009', 1977, 'Chevrolet', 'Blazer', NULL, NULL, NULL);                    -- is_public unknown
-- Ford 1966 Mustangs for the exact-model lookup.
INSERT INTO public.vehicles (id, year, make, model, is_public, deleted_at) VALUES
 ('f0000000-0000-0000-0000-000000000001', 1966, 'Ford', 'Mustang', true, NULL),
 ('f0000000-0000-0000-0000-000000000002', 1966, 'FORD', 'MUSTANG', true, NULL),
 ('f0000000-0000-0000-0000-000000000003', 1966, 'Ford', 'Mustang', false, NULL),
 ('f0000000-0000-0000-0000-000000000004', 1966, 'Ford', 'Mustang', true, '2026-01-01'),
 ('f0000000-0000-0000-0000-000000000005', 1967, 'Ford', 'Mustang', true, NULL),
 ('f0000000-0000-0000-0000-000000000006', 1966, 'Ford', 'Mustang GT', true, NULL);
-- The bulk that makes the heap scan expensive: 60,000 Chevrolets and 30,000 Fords across years and models, 70% public.
INSERT INTO public.vehicles (year, make, model, is_public, deleted_at, listing_kind)
  SELECT 1960 + (g % 30), 'Chevrolet',
         (ARRAY['Corvette','Camaro','Chevelle','C10','Impala','Bel Air','Nova','El Camino','Suburban','Monte Carlo'])[1 + g % 10],
         (g % 10) < 7, CASE WHEN g % 50 = 0 THEN now() END, CASE WHEN g % 97 = 0 THEN 'non_vehicle_item' END
  FROM generate_series(1, 60000) g;
INSERT INTO public.vehicles (year, make, model, is_public, deleted_at)
  SELECT 1960 + (g % 30), 'Ford', (ARRAY['Thunderbird','Fairlane','Galaxie','Falcon','F100','Bronco','Ranchero'])[1 + g % 7],
         (g % 10) < 7, CASE WHEN g % 50 = 0 THEN now() END
  FROM generate_series(1, 30000) g;
-- Mustangs among the Fords, most of them public: a big (ford, mustang) group spread over the years, as in production, so the
-- year is what narrows the exact-model lookup.
INSERT INTO public.vehicles (year, make, model, is_public, deleted_at)
  SELECT 1964 + (g % 10), 'Ford', 'Mustang', (g % 10) < 8, CASE WHEN g % 40 = 0 THEN now() END
  FROM generate_series(1, 6000) g;
-- Blazers among the bulk, public and not, so the regex has a few thousand rows to read past.
INSERT INTO public.vehicles (year, make, model, is_public, deleted_at)
  SELECT 1976 + (g % 5), 'Chevrolet', (ARRAY['Blazer','K5 Blazer','Blazer Silverado','Trailblazer'])[1 + g % 4], (g % 10) < 8, CASE WHEN g % 40 = 0 THEN now() END
  FROM generate_series(1, 3000) g;
VACUUM (ANALYZE) public.vehicles;

-- The two lookups, as text so the plans and the answers can be taken before and after.
CREATE FUNCTION public.t_cohort_regex() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}') FROM public.vehicles v
   WHERE lower(v.make) = lower('CHEVROLET') AND v.year BETWEEN 1976 AND 1980 AND lower(v.model) ~ E'\\y(blazer|full size blazer|k 5 blazer|k\\-5|k5|k5 blazer)\\y'
     AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' AND v.is_public AND v.deleted_at IS NULL $$;
CREATE FUNCTION public.t_cohort_exact() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}') FROM public.vehicles v
   WHERE lower(v.make) = lower('Ford') AND v.year = 1966 AND lower(v.model) = ANY (ARRAY['mustang'])
     AND v.is_public AND v.deleted_at IS NULL $$;
CREATE FUNCTION public.t_plan(p_which text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE j json;
BEGIN
  IF p_which = 'regex' THEN
    EXPLAIN (FORMAT JSON) SELECT v.id FROM public.vehicles v
     WHERE lower(v.make) = lower('CHEVROLET') AND v.year BETWEEN 1976 AND 1980 AND lower(v.model) ~ E'\\y(blazer|full size blazer|k 5 blazer|k\\-5|k5|k5 blazer)\\y'
       AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item' AND v.is_public AND v.deleted_at IS NULL INTO j;
  ELSE
    EXPLAIN (FORMAT JSON) SELECT v.id FROM public.vehicles v
     WHERE lower(v.make) = lower('Ford') AND v.year = 1966 AND lower(v.model) = ANY (ARRAY['mustang'])
       AND v.is_public AND v.deleted_at IS NULL INTO j;
  END IF;
  RETURN j::text;
END $$;

-- 1. Before: the answers, and a plan that reads the heap.
CREATE TABLE public.t_before AS SELECT public.t_cohort_regex() AS regex_ids, public.t_cohort_exact() AS exact_ids;
SELECT public.t_assert(cardinality((SELECT regex_ids FROM public.t_before)) = (SELECT count(*) FROM public.vehicles
    WHERE make ILIKE 'chevrolet' AND year BETWEEN 1976 AND 1980 AND model ~* '(^|[^a-z0-9])(blazer|k5|k-5)([^a-z0-9]|$)'
      AND listing_kind IS DISTINCT FROM 'non_vehicle_item' AND is_public AND deleted_at IS NULL)
  AND cardinality((SELECT regex_ids FROM public.t_before)) > 1000,
  'before: the regex cohort is the public, undeleted Blazers of those years (checked with another expression), well over a thousand of them');
SELECT public.t_assert(cardinality((SELECT exact_ids FROM public.t_before)) = (SELECT count(*) FROM public.vehicles
    WHERE make ILIKE 'ford' AND year = 1966 AND model ILIKE 'mustang' AND is_public AND deleted_at IS NULL)
  AND (SELECT exact_ids FROM public.t_before) @> ARRAY['f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002']::uuid[]
  AND NOT (SELECT exact_ids FROM public.t_before) && ARRAY['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004',
        'f0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000006']::uuid[],
  'before: the public, undeleted Ford 1966 Mustangs (checked with another expression), the seeded private, deleted, other-year and GT rows out');
SELECT public.t_assert(public.t_plan('regex') NOT LIKE '%idx_vehicles_public_cohort_probe%' AND public.t_plan('exact') NOT LIKE '%idx_vehicles_public_cohort_probe%'
  AND public.t_plan('regex') NOT LIKE '%Index Only Scan%', 'before: no index-only scan, no new index');

-- 2. The migration (CREATE INDEX CONCURRENTLY: run outside a transaction block, as psql -f does).
\ir ../migrations/20261014053500_vehicles_public_cohort_probe_index.sql
VACUUM (ANALYZE) public.vehicles;

-- 3. After: valid, covering, partial, and holding public undeleted vehicles only.
SELECT public.t_assert((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = 'public.idx_vehicles_public_cohort_probe'::regclass), 'after: the index is valid and ready');
SELECT public.t_assert(pg_get_indexdef('public.idx_vehicles_public_cohort_probe'::regclass) LIKE '%(lower(make), year) INCLUDE (id, make, model, listing_kind)%'
  AND pg_get_indexdef('public.idx_vehicles_public_cohort_probe'::regclass) LIKE '%WHERE%is_public%deleted_at IS NULL%', 'after: keys, covered columns and predicate as designed');
-- Asked of the index alone (a full index-only scan) and of the heap alone: the same population, public and undeleted.
CREATE FUNCTION public.t_public_count_by_index() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  SET LOCAL enable_seqscan = off; SET LOCAL enable_bitmapscan = off; SET LOCAL enable_indexscan = off;
  SELECT count(*) INTO n FROM public.vehicles WHERE is_public AND deleted_at IS NULL;
  RETURN n;
END $$;
CREATE FUNCTION public.t_public_count_by_heap() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  SET LOCAL enable_indexonlyscan = off; SET LOCAL enable_bitmapscan = off; SET LOCAL enable_indexscan = off;
  SELECT count(*) INTO n FROM public.vehicles WHERE is_public AND deleted_at IS NULL;
  RETURN n;
END $$;
SELECT public.t_assert(public.t_public_count_by_index() = public.t_public_count_by_heap() AND public.t_public_count_by_heap() > 60000,
  'after: the index holds exactly the public, undeleted vehicles (full index-only count = heap count)');

-- 4. The same ids, and the plans are index-only scans on the new index.
SELECT public.t_assert(public.t_cohort_regex() = (SELECT regex_ids FROM public.t_before) AND public.t_cohort_exact() = (SELECT exact_ids FROM public.t_before),
  'after: identical ids for both lookups');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM unnest(public.t_cohort_regex() || public.t_cohort_exact()) u(id) JOIN public.vehicles v ON v.id = u.id
    WHERE NOT coalesce(v.is_public, false) OR v.deleted_at IS NOT NULL OR v.listing_kind = 'non_vehicle_item'),
  'after: no private, deleted, unknown-visibility or part vehicle among the answers');
SELECT public.t_assert(public.t_plan('regex') LIKE '%Index Only Scan%' AND public.t_plan('regex') LIKE '%idx_vehicles_public_cohort_probe%',
  'after: the regex cohort lookup is an index-only scan on the new index');
SELECT public.t_assert(public.t_plan('exact') LIKE '%Index Only Scan%' AND public.t_plan('exact') LIKE '%idx_vehicles_public_cohort_probe%',
  'after: the exact-model lookup is an index-only scan on the new index');
-- The answers without the index agree: take the index out of play and ask again.
SET enable_indexonlyscan = off; SET enable_indexscan = off;
SELECT public.t_assert(public.t_cohort_regex() = (SELECT regex_ids FROM public.t_before) AND public.t_cohort_exact() = (SELECT exact_ids FROM public.t_before),
  'after: the heap plan gives the same ids as the index-only plan');
RESET enable_indexonlyscan; RESET enable_indexscan;

-- 5. A second run is a no-op.
\ir ../migrations/20261014053500_vehicles_public_cohort_probe_index.sql
SELECT public.t_assert((SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_vehicles_public_cohort_probe') = 1, 're-run: still one index');

-- 6. A leftover INVALID index stops the migration with a message.
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_vehicles_public_cohort_probe'::regclass;
\echo 'Expected: the INVALID index ERROR below.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014053500_vehicles_public_cohort_probe_index.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT NOT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vehicles_public_cohort_probe'::regclass), 'an INVALID index is reported, not skipped');
SELECT 'vehicles public cohort probe index contract: PASS' AS result;
