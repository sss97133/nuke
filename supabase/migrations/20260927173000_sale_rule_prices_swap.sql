-- Sale rule, part 3 — swap in the new clean_vehicle_prices alone; the feed rebuild becomes its own job.
-- Session cb179857, 2026-09-27.
--
-- MEASURED: the refresh of vehicle_valuation_feed__next does not finish in 600 s (CI run 36329429813, cancelled
-- 15:34:45Z after ANALYZE of the new prices view; nothing swapped). The 24.4 s figure used to size it was a warm
-- read-only SELECT; the real refresh is slower by more than 25x. The live feed has not refreshed since 2026-04-10
-- (cron 447 refresh-feed-mv, 600 s, is paused), so the feed is a separate problem: it gets its own measured fix.
--
-- What does not have to wait: the readers of is_sold read clean_vehicle_prices directly —
-- calculate-market-indexes (SQBDY-50, CLSC-100: "AND is_sold = true"), compute-vehicle-valuation, extract-bat-core.
-- clean_vehicle_prices__next (built by 20260927160000: 499,506 rows, 5 indexes, is_sold = vehicle_sale_basis(...))
-- is swapped in under the canonical name. The frozen feed keeps reading the superseded prices view it was built on
-- (it depends on it by OID), so the feed is unchanged by this file.
--
-- Guards: refuse if the new view is short, or if anything other than vehicle_valuation_feed depends on the old one.
-- Renames need ACCESS EXCLUSIVE on clean_vehicle_prices; lock_timeout 10 s makes it fail rather than queue readers.

SET statement_timeout = '120s';
SET lock_timeout = '10s';

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.clean_vehicle_prices__next;
  IF n < 400000 THEN
    RAISE EXCEPTION 'clean_vehicle_prices__next holds % rows (499,506 when built 2026-09-27 15:17Z); rebuild before swapping', n;
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT dep.relname, dep.relkind
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class dep ON dep.oid = rw.ev_class
    WHERE d.refobjid = 'public.clean_vehicle_prices'::regclass
      AND dep.oid <> d.refobjid
      AND dep.relname <> 'vehicle_valuation_feed'
  LOOP
    RAISE EXCEPTION 'prices swap: public.% (relkind %) depends on clean_vehicle_prices; re-point it by hand and re-run', r.relname, r.relkind;
  END LOOP;
END $$;

ALTER MATERIALIZED VIEW public.clean_vehicle_prices RENAME TO clean_vehicle_prices_superseded_20260927;
ALTER INDEX public.clean_vehicle_prices_vehicle_id_idx            RENAME TO clean_vehicle_prices_superseded_20260927_vehicle_id_idx;
ALTER INDEX public.clean_vehicle_prices_updated_at_idx            RENAME TO clean_vehicle_prices_superseded_20260927_updated_at_idx;
ALTER INDEX public.idx_clean_vehicle_prices_make                  RENAME TO idx_clean_vehicle_prices_superseded_20260927_make;
ALTER INDEX public.idx_clean_vehicle_prices_year                  RENAME TO idx_clean_vehicle_prices_superseded_20260927_year;
ALTER INDEX public.idx_clean_vehicle_prices_lower_make_year_price RENAME TO idx_clean_vehicle_prices_superseded_20260927_lower_make_year_price;

ALTER MATERIALIZED VIEW public.clean_vehicle_prices__next RENAME TO clean_vehicle_prices;
ALTER INDEX public.clean_vehicle_prices__next_vehicle_id_idx            RENAME TO clean_vehicle_prices_vehicle_id_idx;
ALTER INDEX public.clean_vehicle_prices__next_updated_at_idx            RENAME TO clean_vehicle_prices_updated_at_idx;
ALTER INDEX public.idx_clean_vehicle_prices__next_make                  RENAME TO idx_clean_vehicle_prices_make;
ALTER INDEX public.idx_clean_vehicle_prices__next_year                  RENAME TO idx_clean_vehicle_prices_year;
ALTER INDEX public.idx_clean_vehicle_prices__next_lower_make_year_price RENAME TO idx_clean_vehicle_prices_lower_make_year_price;

COMMENT ON MATERIALIZED VIEW public.clean_vehicle_prices IS
  'Resolved best_price per vehicle, excluding outliers and unreasonable values. is_sold = vehicle_sale_basis(...) IS NOT NULL since 2026-09-27 (a status, or a cited pre-cutover platform marker; is_sold_basis says which). A price alone is a bid, an ask or an estimate. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY clean_vehicle_prices';
COMMENT ON MATERIALIZED VIEW public.clean_vehicle_prices_superseded_20260927 IS
  'SUPERSEDED 2026-09-27 by the platform-aware sale rule. Still the base of vehicle_valuation_feed (frozen since 2026-04-10) until the feed is rebuilt; nothing else should read it. Drop by hand after the feed rebuild.';

COMMIT;

RESET lock_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only):
--   SELECT relname FROM pg_class WHERE relname LIKE 'clean_vehicle_prices%' ORDER BY 1;  -- clean_vehicle_prices, _superseded_20260927
--   SELECT count(*) FROM pg_indexes WHERE tablename = 'clean_vehicle_prices';            -- 5
--   SELECT is_sold_basis, count(*) FROM clean_vehicle_prices GROUP BY 1 ORDER BY 2 DESC;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.clean_vehicle_prices;                 -- works (unique index)
