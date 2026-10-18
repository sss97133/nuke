-- Empty disposable PG17 dm_refinement_* database only; synthetic rows.
-- Contract for 20261019070000_family_sales_truncation_contract.sql: treemap_family_sales returns one jsonb
-- {n, returned, truncated, window_from, rows}, rows newest first as [vehicle_id, sale_date, usd, source, year, model];
-- a limit below the window's count returns the newest rows and says it held back the rest (the shape the web
-- parseFamilySales and the iOS FamilySalesData.parse read).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- The columns the reader reads, as plain tables.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, model text, vin text, primary_image_url text, trim text, series text,
  body_style text, listing_title text, title text);
CREATE TABLE public.mv_family_market (brand text, family_key text, family text);
CREATE TABLE public.mv_family_sales (vehicle_id uuid, brand text, family_key text, sale_date date, usd numeric, source text,
  year integer, model text, vin text, primary_image_url text);

INSERT INTO public.mv_family_market VALUES ('Porsche', '911', '911');
INSERT INTO public.vehicles (id, model, vin, primary_image_url)
  SELECT ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, '911', 'WP0ZZZ9' || lpad(i::text, 10, '0'), NULL
  FROM generate_series(1, 6) i;
INSERT INTO public.mv_family_sales VALUES
  ('00000000-0000-4000-8000-000000000001', 'Porsche', '911', current_date - 5,    120000, 'Bring a Trailer', 1973, '911', 'WP0ZZZ90000000001', NULL),
  ('00000000-0000-4000-8000-000000000002', 'Porsche', '911', current_date - 30,   250000, 'Mecum',           1967, '911', 'WP0ZZZ90000000002', NULL),
  ('00000000-0000-4000-8000-000000000003', 'Porsche', '911', current_date - 400,   60000, 'Bonhams',         1985, '911', 'WP0ZZZ90000000003', NULL),
  ('00000000-0000-4000-8000-000000000004', 'Porsche', '911', current_date - 900,   80000, 'Mecum',           1972, '911', 'WP0ZZZ90000000004', NULL),
  ('00000000-0000-4000-8000-000000000005', 'Porsche', '911', current_date - 1500,  45000, 'Bring a Trailer', 1979, '911', 'WP0ZZZ90000000005', NULL),
  ('00000000-0000-4000-8000-000000000006', 'Porsche', '911', current_date - 2200,  99000, 'Mecum',           1970, '911', 'WP0ZZZ90000000006', NULL); -- outside five years

\ir ../migrations/20261019070000_family_sales_truncation_contract.sql
\ir ../migrations/20261019070000_family_sales_truncation_contract.sql

CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN ASSERT ok IS TRUE, label; END $$;

CREATE TEMP TABLE full_read AS SELECT public.treemap_family_sales('Porsche', '911', 15000) AS j;
SELECT pg_temp.check((SELECT jsonb_typeof(j) = 'object' AND (j->>'n')::int = 5 AND (j->>'returned')::int = 5
  AND (j->>'truncated')::boolean = false AND (j->>'window_from')::date = current_date - 1825 FROM full_read),
  'one object: five sales in the window, all returned, not truncated');
SELECT pg_temp.check((SELECT array_agg(right(e->>0, 1) ORDER BY o) FROM full_read, jsonb_array_elements(j->'rows') WITH ORDINALITY a(e, o))
  = ARRAY['1', '2', '3', '4', '5'], 'rows newest first, the 2,200-day-old sale left out');
SELECT pg_temp.check((SELECT jsonb_array_length(e) = 6 FROM full_read, jsonb_array_elements(j->'rows') e LIMIT 1),
  'a row is [vehicle_id, sale_date, usd, source, year, model]');

-- Over the cap: the newest rows come back and the read says the window holds more.
CREATE TEMP TABLE capped AS SELECT public.treemap_family_sales('Porsche', '911', 2) AS j;
SELECT pg_temp.check((SELECT (j->>'n')::int = 5 AND (j->>'returned')::int = 2 AND (j->>'truncated')::boolean
  AND jsonb_array_length(j->'rows') = 2 AND right(j->'rows'->0->>0, 1) = '1' AND right(j->'rows'->1->>0, 1) = '2' FROM capped),
  'a limit below the window returns the newest two and says three were held back');
SELECT pg_temp.check((SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j->'rows') e WHERE right(e->>0, 1) = '2' AND (e->>2)::numeric <> 250000) FROM capped)
  AND (SELECT j->'rows'->0->>3 = 'Bring a Trailer' FROM capped), 'the cap keeps the newest, not the most expensive');

SELECT pg_temp.check((SELECT (j->>'n')::int = 0 AND j->'rows' = '[]'::jsonb AND (j->>'truncated')::boolean = false
  FROM (SELECT public.treemap_family_sales('Porsche', 'no-such-family', 100) j) x), 'an empty family returns n 0 and no rows');
SELECT pg_temp.check(has_function_privilege('anon', 'public.treemap_family_sales(text,text,integer)', 'execute'), 'anon can read');

SELECT 'treemap_family_sales truncation contract passed' AS result;
