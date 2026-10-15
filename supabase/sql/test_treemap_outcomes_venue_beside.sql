-- Isolated PostgreSQL 17 contract for 20261016153000_treemap_outcomes_venue_beside.sql. Synthetic rows only; never production.
-- Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_venue_beside && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_venue_beside -f supabase/sql/test_treemap_outcomes_venue_beside.sql
-- A stand-in chain with the live names and shapes (the fold with the 20261014063000 CASE, two aggregates, a brand fold,
-- a family fold, a second-level fold reading both, an unbuilt year-price fold) is copied twice by the migration.
-- Covered: the copies exist unfilled beside an untouched live chain; same columns, indexes (renamed), grants and
-- comments; each copy reads only copies; the fill goes one view per call in dependency order, skips the two windows,
-- and stops at 'all filled'; the filled fold equals the live one except houses gained where the live one had none;
-- the job is scheduled once under a 20 min limit. Not covered: pg_cron itself, lock waits, production's definitions
-- (the migration copies them at apply time and refuses a chain it was not written for).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES ($1, $2, $3) RETURNING jobid $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, display_name text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, make text, model text, year integer, auction_source text, canonical_platform text,
  sale_status text, auction_outcome text, reserve_status text, sale_price integer, winning_bid integer,
  bat_sold_price numeric, sold_price integer, bat_bids integer, bat_watchers integer, listing_url text, discovery_url text,
  notes text, import_metadata jsonb, created_at timestamptz DEFAULT now(), is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, canonical_make_id uuid, sale_date date, bat_sale_date date);
CREATE FUNCTION public.vehicle_sale_basis(text, text, text, text, text, numeric, text, jsonb, timestamptz) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN $1 = 'sold' THEN 'stand-in' END $$;

INSERT INTO public.vehicles (id, make, model, year, auction_source, canonical_platform, sale_status, sale_price, sale_date) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Porsche', '911', 1973, 'bat', 'bat', 'sold', 90000, '2025-01-01'),
  ('00000000-0000-0000-0000-000000000002', 'Porsche', '911', 1974, 'cars_and_bids', 'cars-and-bids', 'sold', 70000, '2025-02-01'),
  ('00000000-0000-0000-0000-000000000003', 'Ford', 'Mustang', 1967, 'barrett-jackson', 'barrett-jackson', 'sold', 60000, '2025-03-01'),
  ('00000000-0000-0000-0000-000000000004', 'Ford', 'Mustang', 1968, NULL, 'barrett-jackson', 'sold', 55000, '2025-03-02'),
  ('00000000-0000-0000-0000-000000000005', 'Ferrari', '275', 1966, 'rm-sothebys', 'rm-sothebys', 'sold', 900000, '2025-04-01'),
  ('00000000-0000-0000-0000-000000000006', 'Chevrolet', 'Corvette', 1963, 'mecum', 'mecum', 'sold', 80000, '2025-05-01'),
  ('00000000-0000-0000-0000-000000000007', 'Chevrolet', 'Corvette', 1964, 'craigslist', 'craigslist', 'sold', 30000, '2025-05-02'),
  ('00000000-0000-0000-0000-000000000008', 'Chevrolet', 'Corvette', 1965, 'mecum', 'mecum', 'not_sold', NULL, NULL),
  ('00000000-0000-0000-0000-000000000009', 'Porsche', '911', 1975, 'Cars & Bids', NULL, 'sold', 65000, '2025-06-01');

-- The live fold as 20261014063000 created it (the CASE verbatim), its indexes, grants and comment.
CREATE MATERIALIZED VIEW public.mv_treemap_outcomes AS
SELECT s.id, s.brand_name, s.model, s.year,
       CASE
         WHEN lower(s.auction_source) = ANY (ARRAY['bat', 'bringatrailer', 'bring a trailer']) THEN 'Bring a Trailer'
         WHEN lower(s.auction_source) = ANY (ARRAY['gooding', 'gooding & co']) THEN 'Gooding & Co'
         WHEN lower(s.auction_source) = ANY (ARRAY['rm sothebys', 'rm sotheby''s']) THEN 'RM Sotheby''s'
         WHEN lower(s.auction_source) = ANY (ARRAY['cars & bids', 'cars-and-bids']) THEN 'Cars & Bids'
         WHEN lower(s.auction_source) = 'mecum' THEN 'Mecum'
         WHEN lower(s.auction_source) = 'bonhams' THEN 'Bonhams'
         WHEN lower(s.auction_source) = 'broad arrow' THEN 'Broad Arrow'
         WHEN lower(s.auction_source) = ANY (ARRAY['collecting_cars', 'collecting cars']) THEN 'Collecting Cars'
         WHEN lower(s.auction_source) = 'sbx cars' THEN 'SBX Cars'
         WHEN lower(s.auction_source) = 'pcarmarket' THEN 'PCarMarket'
         WHEN lower(s.auction_source) = 'classic.com' THEN 'Classic.com'
       END AS source_name,
       CASE WHEN s.sale_basis IS NOT NULL THEN 'sold' ELSE 'not_sold' END AS outcome,
       s.sale_basis,
       CASE WHEN s.sale_basis IS NOT NULL
            THEN COALESCE(NULLIF(s.sale_price, 0)::numeric, NULLIF(s.winning_bid, 0)::numeric,
                          NULLIF(s.bat_sold_price, 0)::numeric, NULLIF(s.sold_price, 0)::numeric)
       END AS sold_amount,
       s.bat_bids, s.bat_watchers
FROM (
  SELECT v.id, COALESCE(cm.display_name, initcap(v.make)) AS brand_name, v.model, v.year, v.auction_source,
         v.sale_status, v.auction_outcome, v.reserve_status,
         v.sale_price, v.winning_bid, v.bat_sold_price, v.sold_price, v.bat_bids, v.bat_watchers,
         public.vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url, v.discovery_url,
                                   v.sale_price::numeric, v.notes, v.import_metadata, v.created_at) AS sale_basis
  FROM public.vehicles v
  LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
  WHERE v.is_public IS TRUE AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND v.make IS NOT NULL
    AND (cm.id IS NOT NULL
         OR (length(v.make) > 2 AND v.make !~* '^[0-9]' AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'))
  OFFSET 0
) s
WHERE s.sale_basis IS NOT NULL OR s.sale_status IN ('not_sold', 'unsold', 'bid_to')
   OR s.reserve_status = 'reserve_not_met' OR s.auction_outcome IN ('reserve_not_met', 'no_sale');
CREATE UNIQUE INDEX mv_treemap_outcomes_id ON public.mv_treemap_outcomes (id);
CREATE INDEX mv_treemap_outcomes_cell ON public.mv_treemap_outcomes (lower(brand_name), lower(model), year);
REVOKE ALL ON public.mv_treemap_outcomes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mv_treemap_outcomes TO anon, authenticated;
GRANT ALL ON public.mv_treemap_outcomes TO service_role;
COMMENT ON MATERIALIZED VIEW public.mv_treemap_outcomes IS 'The market map''s fold (stand-in).';

-- Stand-ins for the dependents, with the live names, parents and grant shapes.
CREATE MATERIALIZED VIEW public.mv_model_family_names AS
  SELECT DISTINCT lower(make) AS make_l, lower(model) AS model_l, md5(lower(make) || lower(model)) AS family_id FROM public.vehicles;
CREATE MATERIALIZED VIEW public.mv_treemap_sale_brands AS
  SELECT o.brand_name AS name, count(*) FILTER (WHERE o.sold_amount > 0) AS count FROM public.mv_treemap_outcomes o GROUP BY 1;
CREATE UNIQUE INDEX mv_treemap_sale_brands_name ON public.mv_treemap_sale_brands (name);
CREATE MATERIALIZED VIEW public.mv_treemap_sale_models AS
  SELECT o.brand_name, o.model AS name, count(*) AS count FROM public.mv_treemap_outcomes o GROUP BY 1, 2;
CREATE UNIQUE INDEX mv_treemap_sale_models_brand_name ON public.mv_treemap_sale_models (brand_name, name);
CREATE MATERIALIZED VIEW public.mv_brand_market AS
  SELECT o.brand_name AS name, count(*) AS sold FROM public.mv_treemap_outcomes o JOIN public.vehicles v ON v.id = o.id GROUP BY 1;
CREATE UNIQUE INDEX mv_brand_market_name ON public.mv_brand_market (name);
CREATE MATERIALIZED VIEW public.mv_family_market AS
  SELECT o.brand_name AS brand, n.family_id AS family_key, o.model AS model_key, count(*) FILTER (WHERE o.source_name = 'Bring a Trailer') AS bat
  FROM public.mv_treemap_outcomes o LEFT JOIN public.mv_model_family_names n ON n.make_l = lower(o.brand_name) AND n.model_l = lower(o.model)
  GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX mv_family_market_key ON public.mv_family_market (brand, family_key, model_key);
CREATE MATERIALIZED VIEW public.mv_family_sales AS
  WITH named AS (SELECT DISTINCT mv_family_market.brand, mv_family_market.family_key FROM mv_family_market)
  SELECT o.id AS vehicle_id, o.brand_name AS brand, n.family_key, o.source_name AS source, o.sold_amount AS usd, v.sale_date
  FROM public.mv_treemap_outcomes o JOIN public.vehicles v ON v.id = o.id
  JOIN named n ON n.brand = o.brand_name
  WHERE o.sold_amount > 0;
CREATE UNIQUE INDEX mv_family_sales_vehicle ON public.mv_family_sales (vehicle_id, family_key);
CREATE INDEX mv_family_sales_family_date ON public.mv_family_sales (brand, family_key, sale_date DESC);
CREATE MATERIALIZED VIEW public.mv_family_year_prices AS
  SELECT o.year, coalesce(o.source_name, 'Other') AS source, count(*) AS n FROM public.mv_treemap_outcomes o GROUP BY 1, 2 WITH NO DATA;
CREATE UNIQUE INDEX mv_family_year_prices_key ON public.mv_family_year_prices (year, source);
REVOKE ALL ON public.mv_family_year_prices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mv_family_year_prices TO anon, authenticated;
GRANT ALL ON public.mv_family_year_prices TO service_role;
DO $$ DECLARE v text; BEGIN
  FOREACH v IN ARRAY ARRAY['mv_treemap_sale_brands', 'mv_treemap_sale_models'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', v);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v);
  END LOOP;
  FOREACH v IN ARRAY ARRAY['mv_brand_market', 'mv_family_market', 'mv_family_sales'] LOOP
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', v);
    EXECUTE format('COMMENT ON MATERIALIZED VIEW public.%I IS %L', v, v || ' (stand-in)');
  END LOOP;
END $$;

\ir ../migrations/20261016150000_market_venue_label.sql
\ir ../migrations/20261016153000_treemap_outcomes_venue_beside.sql
\ir ../migrations/20261016153000_treemap_outcomes_venue_beside.sql

CREATE TEMP TABLE chain (v text, ord int);
INSERT INTO chain VALUES ('mv_treemap_outcomes', 1), ('mv_treemap_sale_brands', 2), ('mv_treemap_sale_models', 3),
  ('mv_brand_market', 4), ('mv_family_market', 5), ('mv_family_sales', 6), ('mv_family_year_prices', 7);

SELECT pg_temp.ok('seven copies exist unfilled; the live chain is untouched (filled, but for the unbuilt year-price fold)',
  (SELECT bool_and(c2.relkind = 'm' AND NOT c2.relispopulated AND (c1.relispopulated OR v = 'mv_family_year_prices'))
   FROM chain JOIN pg_class c1 ON c1.oid = format('public.%I', v)::regclass
              JOIN pg_class c2 ON c2.oid = format('public.%I', v || '_v2')::regclass)
  AND (SELECT count(*) FROM pg_class WHERE relname LIKE 'mv\_%\_v2' AND relkind = 'm') = 7);

SELECT pg_temp.ok('each copy has its live view''s columns, in order, with the same types',
  (SELECT bool_and(a1 IS NOT DISTINCT FROM a2) FROM (
     SELECT v,
       (SELECT array_agg(attname || ' ' || format_type(atttypid, atttypmod) ORDER BY attnum) FROM pg_attribute
         WHERE attrelid = format('public.%I', v)::regclass AND attnum > 0 AND NOT attisdropped) a1,
       (SELECT array_agg(attname || ' ' || format_type(atttypid, atttypmod) ORDER BY attnum) FROM pg_attribute
         WHERE attrelid = format('public.%I', v || '_v2')::regclass AND attnum > 0 AND NOT attisdropped) a2
     FROM chain) t));

SELECT pg_temp.ok('each copy has its live view''s indexes, named <index>_v2, unique where the live one is',
  (SELECT bool_and(d1 IS NOT DISTINCT FROM d2) FROM (
     SELECT v,
       (SELECT array_agg(replace(pg_get_indexdef(indexrelid), ic.relname || ' ON public.' || v || ' ', '_ ON _ ') ORDER BY ic.relname)
          FROM pg_index JOIN pg_class ic ON ic.oid = indexrelid WHERE indrelid = format('public.%I', v)::regclass) d1,
       (SELECT array_agg(replace(pg_get_indexdef(indexrelid), ic.relname || ' ON public.' || v || '_v2 ', '_ ON _ ') ORDER BY ic.relname)
          FROM pg_index JOIN pg_class ic ON ic.oid = indexrelid WHERE indrelid = format('public.%I', v || '_v2')::regclass
           AND ic.relname LIKE '%\_v2') d2
     FROM chain) t));

SELECT pg_temp.ok('each copy grants what its live view grants, to the same roles, and nothing more',
  (SELECT bool_and(g1 IS NOT DISTINCT FROM g2) FROM (
     SELECT v,
       (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY 1) FROM pg_class c, aclexplode(c.relacl) a
         WHERE c.oid = format('public.%I', v)::regclass AND a.grantee <> c.relowner) g1,
       (SELECT array_agg(a.grantee::regrole::text || ':' || a.privilege_type ORDER BY 1) FROM pg_class c, aclexplode(c.relacl) a
         WHERE c.oid = format('public.%I', v || '_v2')::regclass AND a.grantee <> c.relowner) g2
     FROM chain) t)
  AND has_table_privilege('anon', 'public.mv_treemap_outcomes_v2', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.mv_treemap_outcomes_v2', 'INSERT'));

SELECT pg_temp.ok('each copy carries its live view''s comment; the fold''s names the label rule',
  (SELECT bool_and(obj_description(format('public.%I', v || '_v2')::regclass, 'pg_class')
                   LIKE coalesce(obj_description(format('public.%I', v)::regclass, 'pg_class'), '') || '%') FROM chain)
  AND obj_description('public.mv_treemap_outcomes_v2'::regclass, 'pg_class') LIKE '%market_venue_label%');

SELECT pg_temp.ok('each copy reads copies, never a live view of the chain',
  (SELECT count(*) = 0 FROM pg_class c
     JOIN pg_rewrite r ON r.ev_class = c.oid
     JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass
     JOIN pg_class p ON p.oid = d.refobjid
   WHERE c.relname LIKE '%\_v2' AND p.relname IN (SELECT v FROM chain))
  AND (SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
       WHERE r.ev_class = 'public.mv_family_sales_v2'::regclass
         AND d.refobjid IN ('public.mv_family_market_v2'::regclass, 'public.mv_treemap_outcomes_v2'::regclass)) > 0);

SELECT pg_temp.ok('the fill skips the map''s window and the year-price window',
  public.market_venue_v2_fill('2026-10-16 09:30:00+00') LIKE 'skipped:%'
  AND public.market_venue_v2_fill('2026-10-16 18:45:00+00') LIKE 'skipped:%'
  AND NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_treemap_outcomes_v2'::regclass));

CREATE TEMP TABLE fills (n int, said text);
DO $$ BEGIN
  FOR i IN 1..7 LOOP INSERT INTO fills VALUES (i, public.market_venue_v2_fill('2026-10-15 15:00:00+00')); END LOOP;
  FOR i IN 8..9 LOOP INSERT INTO fills VALUES (i, public.market_venue_v2_fill('2026-10-15 20:00:00+00')); END LOOP;
END $$;
SELECT pg_temp.ok('one view per call, parents first; the year-price copy waits for 19:30Z, then all filled',
  (SELECT array_agg(split_part(said, ' ', 2) ORDER BY n) FROM fills WHERE n <= 6)
    = ARRAY['mv_treemap_outcomes_v2', 'mv_treemap_sale_brands_v2', 'mv_treemap_sale_models_v2', 'mv_brand_market_v2',
            'mv_family_market_v2', 'mv_family_sales_v2']
  AND (SELECT said FROM fills WHERE n = 7) LIKE 'waiting: mv_family_year_prices_v2%'
  AND (SELECT said FROM fills WHERE n = 8) LIKE 'filled mv_family_year_prices_v2 in %'
  AND (SELECT said FROM fills WHERE n = 9) = 'all filled'
  AND (SELECT count(*) FROM public.mv_family_year_prices_v2 WHERE source = 'Cars & Bids') > 0);

SELECT pg_temp.ok('the copy holds the same rows; only houses differ, and only where the live fold had none',
  (SELECT count(*) FROM public.mv_treemap_outcomes) = (SELECT count(*) FROM public.mv_treemap_outcomes_v2)
  AND NOT EXISTS (
    SELECT 1 FROM public.mv_treemap_outcomes a FULL JOIN public.mv_treemap_outcomes_v2 b USING (id)
    WHERE a.id IS NULL OR b.id IS NULL
       OR (a.brand_name, a.model, a.year, a.outcome, a.sale_basis, a.sold_amount, a.bat_bids, a.bat_watchers)
          IS DISTINCT FROM (b.brand_name, b.model, b.year, b.outcome, b.sale_basis, b.sold_amount, b.bat_bids, b.bat_watchers)
       OR (a.source_name IS NOT NULL AND a.source_name IS DISTINCT FROM b.source_name)));

SELECT pg_temp.ok('Cars & Bids, Barrett-Jackson (also from canonical_platform) and RM gain their house; others keep theirs',
  (SELECT jsonb_object_agg(right(id::text, 1), source_name) FROM public.mv_treemap_outcomes_v2)
  = '{"1": "Bring a Trailer", "2": "Cars & Bids", "3": "Barrett-Jackson", "4": "Barrett-Jackson", "5": "RM Sotheby''s",
      "6": "Mecum", "7": null, "8": "Mecum", "9": "Cars & Bids"}'::jsonb
  AND (SELECT count(*) FROM public.mv_treemap_outcomes WHERE source_name IS NULL) = 5);

SELECT pg_temp.ok('the family fold copy carries the new houses through',
  (SELECT array_agg(DISTINCT source ORDER BY source) FROM public.mv_family_sales_v2 WHERE source IS NOT NULL)
  = ARRAY['Barrett-Jackson', 'Bring a Trailer', 'Cars & Bids', 'Mecum', 'RM Sotheby''s']);

SELECT pg_temp.ok('the fill job is scheduled once, every 10 minutes, under a 20 min limit',
  (SELECT count(*) FROM cron.job WHERE jobname = 'market-venue-v2-fill' AND schedule = '*/10 * * * *'
     AND command LIKE '%statement_timeout = ''20min''%' AND command LIKE '%market_venue_v2_fill()%') = 1);

SELECT pg_temp.ok('only the owner and service paths may run the fill',
  NOT has_function_privilege('anon', 'public.market_venue_v2_fill(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.market_venue_v2_fill(timestamptz)', 'EXECUTE'));
