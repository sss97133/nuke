-- Sale rule, part 2 of 2 — populate the new valuation feed and swap both read models in.
-- Session cb179857, 2026-09-27. Completes 20260927160000_sale_is_status_platform_aware.sql.
--
-- WHAT HAPPENED (CI run 36328918526, 15:16–15:19Z): 20260927160000 applied through its step 4 —
-- vehicle_sale_basis() and the new trg_resolve_canonical_columns() are live (function md5 prefix 17b20ebe, was
-- da0a86ff), clean_vehicle_prices__next is built (499,506 rows, 5 indexes) — then stopped where it was designed
-- to stop: REFRESH MATERIALIZED VIEW vehicle_valuation_feed__next hit the 120 s statement timeout. Nothing was
-- swapped; the old feed kept serving. (The read-only SELECT measured 24.4 s warm; the CI refresh ran cold and was
-- planned before autovacuum had analyzed clean_vehicle_prices__next, 15:17:32Z.)
--
-- THIS FILE: the refresh with the budget prod already grants this exact work — cron 447 refresh-feed-mv runs
-- "SET statement_timeout = '600s'; REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed" — then the
-- unchanged atomic swap from 20260927160000 step 5 (its guards included), with statement_timeout back at 120 s.
-- Locks while refreshing: ACCESS EXCLUSIVE on vehicle_valuation_feed__next only (nothing reads it) and ACCESS SHARE
-- on the source tables, which never blocks reads or writes; no other DDL is pushed while this runs (one push at a
-- time). The swap renames need ACCESS EXCLUSIVE on the two live matviews: lock_timeout 10 s makes it fail rather
-- than queue readers behind it. If anything here fails, nothing is swapped and the old objects keep serving.

SET statement_timeout = '600s';
ANALYZE public.clean_vehicle_prices__next;
REFRESH MATERIALIZED VIEW public.vehicle_valuation_feed__next;
ANALYZE public.vehicle_valuation_feed__next;
SET statement_timeout = '120s';
SET lock_timeout = '10s';


-- --------------------------------------------------------------------------------------------
-- 5. atomic swap, old objects kept
-- --------------------------------------------------------------------------------------------
BEGIN;

-- refuse to swap an empty feed
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_valuation_feed__next;
  IF n < 100000 THEN
    RAISE EXCEPTION 'vehicle_valuation_feed__next holds % rows (live feed had 428,072 on 2026-09-27); refresh it before swapping', n;
  END IF;
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

ALTER MATERIALIZED VIEW public.vehicle_valuation_feed RENAME TO vehicle_valuation_feed_superseded_20260927;
ALTER INDEX public.idx_vvf_vehicle_id    RENAME TO idx_vvf_superseded_20260927_vehicle_id;
ALTER INDEX public.idx_vvf_created       RENAME TO idx_vvf_superseded_20260927_created;
ALTER INDEX public.idx_vvf_display_price RENAME TO idx_vvf_superseded_20260927_display_price;
ALTER INDEX public.idx_vvf_feed_rank     RENAME TO idx_vvf_superseded_20260927_feed_rank;
ALTER INDEX public.idx_vvf_feed_rank_vid RENAME TO idx_vvf_superseded_20260927_feed_rank_vid;
ALTER INDEX public.idx_vvf_has_photos    RENAME TO idx_vvf_superseded_20260927_has_photos;
ALTER INDEX public.idx_vvf_make          RENAME TO idx_vvf_superseded_20260927_make;
ALTER INDEX public.idx_vvf_source        RENAME TO idx_vvf_superseded_20260927_source;
ALTER INDEX public.idx_vvf_updated       RENAME TO idx_vvf_superseded_20260927_updated;
ALTER INDEX public.idx_vvf_vehicle_type  RENAME TO idx_vvf_superseded_20260927_vehicle_type;
ALTER INDEX public.idx_vvf_year          RENAME TO idx_vvf_superseded_20260927_year;

ALTER MATERIALIZED VIEW public.vehicle_valuation_feed__next RENAME TO vehicle_valuation_feed;
ALTER INDEX public.idx_vvf__next_vehicle_id    RENAME TO idx_vvf_vehicle_id;
ALTER INDEX public.idx_vvf__next_created       RENAME TO idx_vvf_created;
ALTER INDEX public.idx_vvf__next_display_price RENAME TO idx_vvf_display_price;
ALTER INDEX public.idx_vvf__next_feed_rank     RENAME TO idx_vvf_feed_rank;
ALTER INDEX public.idx_vvf__next_feed_rank_vid RENAME TO idx_vvf_feed_rank_vid;
ALTER INDEX public.idx_vvf__next_has_photos    RENAME TO idx_vvf_has_photos;
ALTER INDEX public.idx_vvf__next_make          RENAME TO idx_vvf_make;
ALTER INDEX public.idx_vvf__next_source        RENAME TO idx_vvf_source;
ALTER INDEX public.idx_vvf__next_updated       RENAME TO idx_vvf_updated;
ALTER INDEX public.idx_vvf__next_vehicle_type  RENAME TO idx_vvf_vehicle_type;
ALTER INDEX public.idx_vvf__next_year          RENAME TO idx_vvf_year;

-- nothing else may still hang off the superseded objects (the superseded feed hanging off the
-- superseded prices view is expected; anything else means a new dependent appeared since
-- 2026-09-27 and must be re-pointed by hand — RAISE, do not guess)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT dep.relname, dep.relkind
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class dep ON dep.oid = rw.ev_class
    WHERE d.refobjid IN ('public.clean_vehicle_prices_superseded_20260927'::regclass,
                         'public.vehicle_valuation_feed_superseded_20260927'::regclass)
      AND dep.oid NOT IN ('public.clean_vehicle_prices_superseded_20260927'::regclass,
                          'public.vehicle_valuation_feed_superseded_20260927'::regclass)
  LOOP
    RAISE EXCEPTION 'sale-rule swap: %.% (relkind %) still depends on a superseded matview; re-point it by hand and re-run', 'public', r.relname, r.relkind;
  END LOOP;
END $$;

COMMENT ON MATERIALIZED VIEW public.clean_vehicle_prices IS
  'Resolved best_price per vehicle, excluding outliers and unreasonable values. is_sold = vehicle_sale_basis(...) IS NOT NULL since 2026-09-27 (a status, or a cited pre-cutover platform marker; is_sold_basis says which). A price alone is a bid, an ask or an estimate. Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY clean_vehicle_prices';
COMMENT ON MATERIALIZED VIEW public.clean_vehicle_prices_superseded_20260927 IS
  'SUPERSEDED 2026-09-27 by the platform-aware sale rule (held migration 20260927030000). Kept for verification; drop by hand once the swap is confirmed. Nothing should read this.';
COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed IS
  'Feed read model. Rebuilt 2026-09-27 to follow the clean_vehicle_prices swap (same definition; is_sold now comes from vehicle_sale_basis). Refresh with: REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed';
COMMENT ON MATERIALIZED VIEW public.vehicle_valuation_feed_superseded_20260927 IS
  'SUPERSEDED 2026-09-27 (depended by OID on the superseded clean_vehicle_prices). Kept for verification; drop by hand after the swap is confirmed. Nothing should read this.';

COMMIT;

RESET lock_timeout;

-- Make PostgREST see the swapped objects immediately.
NOTIFY pgrst, 'reload schema';

-- POST-APPLY: the eight read-only checks at the foot of 20260927160000 (canonical names → new objects, 5 + 11
-- indexes, sold population by basis, no unsold-marked row flagged sold, feed depends on the new prices view, the
-- predicate on four fixed inputs, CONCURRENTLY refresh works, no lock waiters).
