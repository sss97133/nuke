-- Keep the BaT live pull's updates on the same page, and keep auction_events vacuumed.
--
-- The live pull rewrites this week's auction_events rows many times an hour (bids, comments, watchers). With no
-- free space on a page, an update moves the row to another page, so a week of rows scatters: on 2026-10-15 an
-- index scan of 10-08..10-15 read 1,326 rows from 6,452 pages (4.86 pages per row), against 0.27 for a settled
-- week, and the public Sold reader (get_market_trends, 5 s limit) failed most cold reads (skylar-83, 11:26Z).
-- The table had 436,154 live / 76,667 dead tuples and had never been autovacuumed since the 09-29 restart
-- (default 0.2 scale factor = ~87k dead tuples before a run).
--
-- fillfactor 85 leaves room on new pages for HOT updates; it applies to pages written from now on.
-- Lower scale factors make autovacuum run at ~2% churn so dead tuples are pruned and pages regain room.
-- Storage parameters only: SHARE UPDATE EXCLUSIVE lock (does not block reads or writes), no rewrite.
-- Revert: ALTER TABLE public.auction_events RESET (fillfactor, autovacuum_vacuum_scale_factor,
--   autovacuum_analyze_scale_factor, autovacuum_vacuum_insert_scale_factor);
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.auction_events SET (
  fillfactor = 85,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02
);

DO $$
DECLARE o text[];
BEGIN
  SELECT reloptions INTO o FROM pg_class WHERE oid = 'public.auction_events'::regclass;
  IF NOT ('fillfactor=85' = ANY (o)) THEN
    RAISE EXCEPTION 'auction_events fillfactor not set: %', o;
  END IF;
END $$;
