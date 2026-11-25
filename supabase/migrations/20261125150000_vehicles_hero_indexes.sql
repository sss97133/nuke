-- vehicles_hero_indexes_v1: partial indexes for hero_heat's hot list and make aggregate, and for hero_deals.
--
-- WHY. hero_heat (top_hot, make_heat) and hero_deals read vehicles by heat_score / deal_score with no index, a parallel
-- seq scan of the 2.4 GB heap, and both answer anon 500 after 10.1-10.3 s (2026-11-25). Their predicates, as
-- 20261125134500 states them: score > 0 AND is_public AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM
-- 'non_vehicle_item' (hero_deals also is_for_sale). These partial indexes carry exactly those predicates.
--   idx_vehicles_hero_heat  (heat_score DESC) INCLUDE (make): top_hot reads the first 30 entries; make_heat sums by make
--                           from the index (planner estimate about 66k rows).
--   idx_vehicles_hero_deals (deal_score DESC): about 1.7k rows (planner estimate).
--
-- HOW. Autocommit on purpose (as 20261108130400): CREATE INDEX CONCURRENTLY cannot run in a transaction and blocks no
-- writer. Each build is two scans of the 2.4 GB heap, bounded at 120 s like 20261108130400. A build that fails leaves an
-- INVALID index; a re-run drops it first. Merged only in a window when v_job_health shows the fewest lots near close.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_hero_heat, public.idx_vehicles_hero_deals.
SET lock_timeout = '8s';
SET statement_timeout = '120s';

SELECT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'idx_vehicles_hero_heat' AND NOT i.indisvalid) AS hero_heat_invalid,
       EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'idx_vehicles_hero_deals' AND NOT i.indisvalid) AS hero_deals_invalid \gset
\if :hero_heat_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_hero_heat;
\endif
\if :hero_deals_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_hero_deals;
\endif

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_hero_heat
  ON public.vehicles (heat_score DESC) INCLUDE (make)
  WHERE heat_score > 0 AND is_public AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_hero_deals
  ON public.vehicles (deal_score DESC)
  WHERE deal_score > 0 AND is_for_sale AND is_public AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item';
