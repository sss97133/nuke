-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_hero_indexes -f this-file.sql
-- Proves 20261125150000_vehicles_hero_indexes.sql: both partial indexes are built valid; an INVALID leftover from a
-- failed build is dropped and rebuilt; and the planner reads hero_heat's hot list and make aggregate and hero_deals'
-- set (the predicates of 20261125134500) through them instead of scanning vehicles. Rows are a disposable database's.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text,
  is_public boolean DEFAULT true, deleted_at timestamptz, listing_kind text, heat_score numeric, deal_score numeric,
  is_for_sale boolean, primary_image_url text, filler text);
-- 200,000 cars: 4% with a heat score, 1.3% with a deal score, of which some are for sale; a share private, deleted or non-vehicle.
INSERT INTO public.vehicles (year, make, model, is_public, deleted_at, listing_kind, heat_score, deal_score, is_for_sale, filler)
SELECT 1960 + g % 40, 'make' || (g % 50), 'model', g % 10 <> 0, CASE WHEN g % 17 = 0 THEN now() END,
       CASE WHEN g % 23 = 0 THEN 'non_vehicle_item' ELSE 'vehicle' END,
       CASE WHEN g % 50 IN (0, 1) THEN (g % 997) + 1 END, CASE WHEN g % 150 IN (0, 3) THEN (g % 89) + 1 END,
       g % 300 IN (0, 3) OR g % 7 = 0,
       repeat('x', 200)
  FROM generate_series(1, 200000) g;
ANALYZE public.vehicles;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- The plan of a query as one text, for "uses index X / scans vehicles" checks.
CREATE FUNCTION public.t_plan(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; s text := ''; BEGIN
  FOR r IN EXECUTE 'EXPLAIN ' || q LOOP s := s || r."QUERY PLAN" || E'\n'; END LOOP; RETURN s; END $$;

-- The three reads, with the predicates 20261125134500 gives them.
\set q_hot 'SELECT v.id FROM vehicles v WHERE v.heat_score IS NOT NULL AND v.heat_score > 0 AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'' ORDER BY v.heat_score DESC LIMIT 30'
\set q_make 'SELECT COALESCE(v.make, ''Unknown''), SUM(v.heat_score), count(*) FROM vehicles v WHERE v.heat_score IS NOT NULL AND v.heat_score > 0 AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'' GROUP BY v.make'
\set q_deals 'SELECT v.id FROM vehicles v WHERE v.deal_score IS NOT NULL AND v.deal_score > 0 AND v.is_for_sale = true AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM ''non_vehicle_item'''

SELECT t_assert(t_plan(:'q_hot') LIKE '%Seq Scan on vehicles%' AND t_plan(:'q_deals') LIKE '%Seq Scan on vehicles%',
  'before: the hot list and the deals set scan vehicles');

\ir ../migrations/20261125150000_vehicles_hero_indexes.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname IN ('idx_vehicles_hero_heat', 'idx_vehicles_hero_deals') AND i.indisvalid) = 2,
  'both indexes built and valid');
SELECT t_assert((SELECT reltuples FROM pg_class WHERE relname = 'idx_vehicles_hero_heat')
    = (SELECT count(*) FROM public.vehicles WHERE heat_score > 0 AND is_public AND deleted_at IS NULL
          AND listing_kind IS DISTINCT FROM 'non_vehicle_item')
  AND (SELECT reltuples FROM pg_class WHERE relname = 'idx_vehicles_hero_deals')
    = (SELECT count(*) FROM public.vehicles WHERE deal_score > 0 AND is_for_sale AND is_public AND deleted_at IS NULL
          AND listing_kind IS DISTINCT FROM 'non_vehicle_item'),
  'each index holds exactly the cars its reader may show (public, not deleted, a vehicle, score > 0)');
SELECT t_assert((SELECT reltuples FROM pg_class WHERE relname = 'idx_vehicles_hero_heat') > 1000
  AND (SELECT reltuples FROM pg_class WHERE relname = 'idx_vehicles_hero_deals') > 100, 'the fixture puts cars in both indexes');
ANALYZE public.vehicles;
SELECT t_assert(t_plan(:'q_hot') LIKE '%idx_vehicles_hero_heat%' AND t_plan(:'q_hot') NOT LIKE '%Seq Scan%',
  'after: the hot list reads idx_vehicles_hero_heat, no scan of vehicles');
SELECT t_assert(t_plan(:'q_make') LIKE '%idx_vehicles_hero_heat%' AND t_plan(:'q_make') NOT LIKE '%Seq Scan%',
  'after: the make aggregate reads idx_vehicles_hero_heat, no scan of vehicles');
SELECT t_assert(t_plan(:'q_deals') LIKE '%idx_vehicles_hero_deals%' AND t_plan(:'q_deals') NOT LIKE '%Seq Scan%',
  'after: the deals set reads idx_vehicles_hero_deals, no scan of vehicles');
SELECT t_assert(pg_get_indexdef('public.idx_vehicles_hero_heat'::regclass) LIKE '%(heat_score DESC) INCLUDE (make)%'
  AND pg_get_indexdef('public.idx_vehicles_hero_deals'::regclass) LIKE '%(deal_score DESC)%',
  'keys: heat_score DESC with make carried for the make aggregate; deal_score DESC');

-- A failed build leaves an INVALID index; a re-run drops and rebuilds it.
UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public.idx_vehicles_hero_heat'::regclass;
\ir ../migrations/20261125150000_vehicles_hero_indexes.sql
RESET statement_timeout; RESET lock_timeout;
SELECT t_assert((SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname IN ('idx_vehicles_hero_heat', 'idx_vehicles_hero_deals') AND i.indisvalid) = 2
  AND (SELECT count(*) FROM pg_class WHERE relname LIKE 'idx_vehicles_hero_%') = 2,
  're-run: the INVALID leftover is dropped and rebuilt valid; still two indexes');
