-- Isolated PostgreSQL 17 contract for 20261018170000_canonical_make_family_join_and_aliases.sql.
-- Synthetic rows only; never production.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;

CREATE TABLE public.canonical_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  short_name text,
  aliases text[] DEFAULT '{}'
);

CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  canonical_model text NOT NULL,
  year_start integer,
  year_end integer,
  aliases text[] DEFAULT '{}'
);

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer,
  make text,
  model text,
  canonical_make_id uuid REFERENCES public.canonical_makes(id),
  listing_title text,
  listing_url text,
  discovery_url text,
  primary_image_url text,
  images text[],
  vin text,
  mileage integer,
  sale_date date,
  bat_sale_date date,
  is_public boolean DEFAULT true,
  deleted_at timestamptz,
  listing_kind text
);

CREATE TABLE public.mv_treemap_outcomes (
  id uuid PRIMARY KEY,
  brand_name text,
  model text,
  year integer,
  source_name text,
  outcome text,
  sale_basis text,
  sold_amount numeric,
  bat_bids integer,
  bat_watchers integer
);

CREATE TABLE public.mv_treemap_sale_brands (
  name text PRIMARY KEY,
  count bigint
);

CREATE TABLE public.treemap_refreshes (
  id bigserial PRIMARY KEY,
  refreshed_at timestamptz DEFAULT now(),
  seconds numeric,
  note text,
  populations jsonb
);

CREATE MATERIALIZED VIEW public.mv_vehicle_name_dictionary AS
SELECT lower(make) AS make_l,
       lower(coalesce(model, '')) AS model_l,
       lower(make || ' ' || coalesce(model, '')) AS name_l,
       count(*) AS vehicles
FROM public.vehicles
WHERE is_public = true AND make IS NOT NULL
GROUP BY 1, 2, 3;

CREATE MATERIALIZED VIEW public.mv_model_family_names AS
WITH make_alias AS (
  SELECT DISTINCT ON (a.k) a.k, a.canonical_name
  FROM (
    SELECT regexp_replace(lower(x.x), '[^a-z0-9]', '', 'g') AS k, cm.canonical_name
    FROM public.canonical_makes cm,
         LATERAL unnest(array_cat(ARRAY[cm.canonical_name, cm.display_name, cm.short_name], coalesce(cm.aliases, '{}'::text[]))) x(x)
    WHERE x.x IS NOT NULL AND btrim(x.x) <> ''
  ) a
  WHERE a.k <> ''
  ORDER BY a.k, a.canonical_name
),
fam AS (
  SELECT regexp_replace(lower(coalesce(ma.canonical_name, m.make)), '[^a-z0-9]', '', 'g') AS make_key,
         m.canonical_model, m.id, m.year_start, m.year_end, m.aliases
  FROM public.canonical_models m
  LEFT JOIN make_alias ma ON ma.k = regexp_replace(lower(m.make), '[^a-z0-9]', '', 'g')
),
family AS (
  SELECT fam.make_key,
         lower(fam.canonical_model) AS family_l,
         min(fam.canonical_model) AS family,
         (array_agg(fam.id ORDER BY fam.id))[1] AS family_id,
         CASE WHEN bool_or(fam.year_start IS NULL) THEN NULL::integer ELSE min(fam.year_start) END AS year_start,
         CASE WHEN bool_or(fam.year_end IS NULL) THEN NULL::integer ELSE max(fam.year_end) END AS year_end
  FROM fam
  GROUP BY fam.make_key, lower(fam.canonical_model)
),
phrase AS (
  SELECT DISTINCT ON (f.make_key, a.phrase)
         f.make_key, a.phrase, fy.family_id, fy.family, fy.year_start, fy.year_end
  FROM fam f
  CROSS JOIN LATERAL (
    SELECT btrim(regexp_replace(lower(x.x), '[^a-z0-9]+', ' ', 'g')) AS phrase
    FROM unnest(array_append(coalesce(f.aliases, '{}'::text[]), f.canonical_model)) x(x)
  ) a
  JOIN family fy ON fy.make_key = f.make_key AND fy.family_l = lower(f.canonical_model)
  WHERE a.phrase <> ''
  ORDER BY f.make_key, a.phrase, (btrim(regexp_replace(fy.family_l, '[^a-z0-9]+', ' ', 'g')) = a.phrase) DESC, length(fy.family), fy.family, fy.family_id
),
names AS (
  SELECT d.make_l, d.model_l, d.vehicles, ma.canonical_name,
         regexp_replace(lower(coalesce(ma.canonical_name, d.make_l)), '[^a-z0-9]', '', 'g') AS make_key,
         string_to_array(btrim(regexp_replace(d.model_l, '[^a-z0-9]+', ' ', 'g')), ' ') AS t
  FROM public.mv_vehicle_name_dictionary d
  LEFT JOIN make_alias ma ON ma.k = regexp_replace(d.make_l, '[^a-z0-9]', '', 'g')
),
grams AS (
  SELECT nm.make_l, nm.model_l, nm.make_key, w.n, w.i,
         array_to_string(nm.t[w.i:w.i + w.n - 1], ' ') AS g
  FROM names nm
  CROSS JOIN LATERAL (
    SELECT n.n, i.i
    FROM generate_series(1, least(4, cardinality(nm.t))) n(n),
         LATERAL generate_series(1, cardinality(nm.t) - n.n + 1) i(i)
  ) w
  WHERE nm.make_key <> '' AND nm.t <> '{""}'::text[]
),
hit AS (
  SELECT DISTINCT ON (g.make_l, g.model_l)
         g.make_l, g.model_l, p.family_id, p.family, p.year_start, p.year_end, g.g AS matched
  FROM grams g
  JOIN phrase p ON p.make_key = g.make_key AND p.phrase = g.g
  ORDER BY g.make_l, g.model_l, g.n DESC, g.i
)
SELECT nm.make_l, nm.model_l, nm.vehicles, nm.canonical_name AS make,
       h.family_id, h.family, h.matched, h.year_start, h.year_end
FROM names nm
LEFT JOIN hit h ON h.make_l = nm.make_l AND h.model_l = nm.model_l;

CREATE MATERIALIZED VIEW public.mv_family_market AS
SELECT 'Meyers'::text AS brand, 'other'::text AS family_key, NULL::text AS family,
       'manx'::text AS model_key, 'Manx'::text AS model,
       0::bigint AS sold, 0::bigint AS sold_any, 0::bigint AS offered, 0::bigint AS usd,
       0::bigint AS bat_dated, 0::bigint AS bat_sold_12m, 0::bigint AS bat_sold_prior_12m,
       0::bigint AS bat_usd_12m, 0::bigint AS bat_usd_prior_12m, now() AS as_of
WHERE false;

CREATE OR REPLACE FUNCTION public.treemap_populations()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'measure', 'confirmed_sale_v1',
    'confirmed_sales_with_amount', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE sold_amount > 0)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.treemap_populations() TO anon, authenticated, service_role;

-- Seed canonical makes & models
INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000001', 'MEYERS', 'Meyers', '{}'),
  ('00000000-0000-4000-a000-000000000002', 'LAND ROVER', 'Land Rover', ARRAY['land rover']),
  ('00000000-0000-4000-a000-000000000003', 'DODGE', 'Dodge', ARRAY['dodge']),
  ('00000000-0000-4000-a000-000000000004', 'CHEVROLET', 'Chevrolet', ARRAY['chevrolet']);

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Meyers', 'Manx', NULL, NULL, ARRAY['manx']),
  ('00000000-0000-4000-b000-000000000002', 'Land Rover', 'Range Rover', NULL, NULL, ARRAY['range rover']),
  ('00000000-0000-4000-b000-000000000003', 'Dodge', 'D-Series', NULL, NULL, ARRAY['d100']),
  ('00000000-0000-4000-b000-000000000004', 'Chevrolet', 'Styleline', 1949, 1952, ARRAY['styleline']);

-- Seed vehicles where raw make is 'Meyers Manx' or 'Range', plus Dodge Pickup and 1931 Chevrolet Styleline
INSERT INTO public.vehicles (id, year, make, model, canonical_make_id, sale_date, is_public) VALUES
  ('00000000-0000-4000-c000-000000000001', 1967, 'Meyers Manx', 'Manx', '00000000-0000-4000-a000-000000000001', current_date - 10, true),
  ('00000000-0000-4000-c000-000000000002', 1968, 'Meyers Manx', 'Manx', '00000000-0000-4000-a000-000000000001', current_date - 20, true),
  ('00000000-0000-4000-c000-000000000003', 1969, 'Meyers Manx', 'Manx', '00000000-0000-4000-a000-000000000001', current_date - 30, true),
  ('00000000-0000-4000-c000-000000000004', 2016, 'Range', 'Rover Supercharged', '00000000-0000-4000-a000-000000000002', current_date - 15, true),
  ('00000000-0000-4000-c000-000000000005', 2017, 'Range', 'Rover Supercharged', '00000000-0000-4000-a000-000000000002', current_date - 25, true),
  ('00000000-0000-4000-c000-000000000006', 2018, 'Range', 'Rover Supercharged', '00000000-0000-4000-a000-000000000002', current_date - 35, true),
  ('00000000-0000-4000-c000-000000000007', 1955, 'Dodge', 'Pickup', '00000000-0000-4000-a000-000000000003', current_date - 40, true),
  ('00000000-0000-4000-c000-000000000008', 1956, 'Dodge', 'Pickup', '00000000-0000-4000-a000-000000000003', current_date - 50, true),
  ('00000000-0000-4000-c000-000000000009', 1957, 'Dodge', 'Pickup', '00000000-0000-4000-a000-000000000003', current_date - 60, true),
  ('00000000-0000-4000-c000-000000000010', 1931, 'Chevrolet', 'Styleline', '00000000-0000-4000-a000-000000000004', current_date - 70, true),
  ('00000000-0000-4000-c000-000000000011', 1950, 'Chevrolet', 'Styleline', '00000000-0000-4000-a000-000000000004', current_date - 80, true),
  ('00000000-0000-4000-c000-000000000012', 1951, 'Chevrolet', 'Styleline', '00000000-0000-4000-a000-000000000004', current_date - 90, true);

INSERT INTO public.mv_treemap_outcomes (id, brand_name, model, year, source_name, outcome, sale_basis, sold_amount)
SELECT id,
       CASE
         WHEN make = 'Meyers Manx' THEN 'Meyers'
         WHEN make = 'Range' THEN 'Land Rover'
         ELSE make
       END,
       model,
       year,
       'Bring a Trailer',
       'sold',
       'hammer',
       35000
FROM public.vehicles;

INSERT INTO public.mv_treemap_sale_brands (name, count) VALUES ('Meyers', 3), ('Land Rover', 3), ('Dodge', 3), ('Chevrolet', 3);
INSERT INTO public.treemap_refreshes (note, populations) VALUES ('seed', '{}'::jsonb);

\ir ../migrations/20261018170000_canonical_make_family_join_and_aliases.sql

-- Simulate dependent views existing before 20261018173000 runs
CREATE OR REPLACE VIEW public.v_market_house_coverage AS
SELECT source AS house, count(*) AS dated_sold FROM public.mv_family_sales GROUP BY 1;

CREATE OR REPLACE VIEW public.v_market_measurement_coverage AS
SELECT 'key'::text AS layer, sum(sold)::bigint AS numerator FROM public.mv_family_market;

\ir ../migrations/20261018173000_apply_canonical_make_family_join_with_views.sql
\ir ../migrations/20261018173000_apply_canonical_make_family_join_with_views.sql

DO $assert$
BEGIN
  -- 1. Meyers Manx (raw make 'Meyers Manx', brand_name 'Meyers') keys to 'Manx' family
  IF NOT EXISTS (
    SELECT 1 FROM public.mv_family_market
    WHERE brand = 'Meyers' AND family = 'Manx' AND family_key <> 'other' AND sold = 3
  ) THEN
    RAISE EXCEPTION 'Expected Meyers Manx (3 sales) to key to family Manx in mv_family_market';
  END IF;

  -- 2. Range Rover Supercharged (raw make 'Range', brand_name 'Land Rover') keys to 'Range Rover' family
  IF NOT EXISTS (
    SELECT 1 FROM public.mv_family_market
    WHERE brand = 'Land Rover' AND family = 'Range Rover' AND family_key <> 'other' AND sold = 3
  ) THEN
    RAISE EXCEPTION 'Expected Land Rover Rover Supercharged (3 sales) to key to Range Rover in mv_family_market';
  END IF;

  -- 3. Dodge Pickup keys to D-Series
  IF NOT EXISTS (
    SELECT 1 FROM public.mv_family_market
    WHERE brand = 'Dodge' AND family = 'D-Series' AND family_key <> 'other' AND sold = 3
  ) THEN
    RAISE EXCEPTION 'Expected Dodge Pickup (3 sales) to key to D-Series in mv_family_market';
  END IF;

  -- 4. Chevrolet Styleline (including 1931 row) keys to Styleline without falling into other
  IF NOT EXISTS (
    SELECT 1 FROM public.mv_family_market
    WHERE brand = 'Chevrolet' AND family = 'Styleline' AND family_key <> 'other' AND sold = 3
  ) THEN
    RAISE EXCEPTION 'Expected all 3 Chevrolet Styleline sales to key to Styleline in mv_family_market';
  END IF;

  -- 5. mv_family_sales keys all 12 rows to their named families (zero 'other')
  IF (SELECT count(*) FROM public.mv_family_sales WHERE family_key <> 'other') <> 12 THEN
    RAISE EXCEPTION 'Expected all 12 sales in mv_family_sales to be keyed to named families';
  END IF;

  -- 6. treemap_years resolves canonical make aliases (e.g. Meyers -> Manx)
  IF (SELECT sum(count) FROM public.treemap_years(NULL, 'Meyers', 'Manx')) <> 3 THEN
    RAISE EXCEPTION 'Expected treemap_years(NULL, Meyers, Manx) to return 3 sales';
  END IF;

  -- 7. treemap_populations() is revoked from anon and authenticated, and treemap_refreshes.populations is updated
  IF has_function_privilege('anon', 'public.treemap_populations()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Expected anon not to have EXECUTE privilege on treemap_populations()';
  END IF;

  IF (SELECT (populations ->> 'confirmed_sales_with_amount')::int FROM public.treemap_refreshes ORDER BY id DESC LIMIT 1) <> 12 THEN
    RAISE EXCEPTION 'Expected latest treemap_refreshes.populations to be updated to 12 confirmed sales';
  END IF;
END $assert$;

SELECT 'test_canonical_make_family_join: PASS' AS result;
