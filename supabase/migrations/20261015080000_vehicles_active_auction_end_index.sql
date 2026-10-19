-- 20261015080000_vehicles_active_auction_end_index.sql
--
-- vehicles: partial index on auction_end_date for the rows still marked active. sync-live-auctions ends expired auctions with
--   UPDATE vehicles SET auction_status = 'ended', sale_status = 'not_sold'
--   WHERE auction_status = 'active' AND platform_source <> 'bringatrailer' AND auction_end_date < now() AND auction_end_date IS NOT NULL
-- (PostgREST: .eq("auction_status","active").neq("platform_source",..).lt("auction_end_date",..)).
--
-- MEASURED (prod, pg_stat_statements read 2026-10-15 after the 03:00Z restart): 3 calls, mean 18.5 s, max 19.0 s, 3 rows
-- updated in all, 908,642 shared blocks read (about 300,000 per call, 2.3 GB): a sequential scan of the 1,016,765-row heap.
-- No index carries auction_status or auction_end_date except idx_vehicles_auction_live, which is partial on
-- sale_status = 'auction_live' and does not answer this predicate.
--
-- WHAT: idx_vehicles_active_auction_end btree (auction_end_date) WHERE auction_status = 'active' AND auction_end_date IS NOT NULL.
-- The statement then reads only active rows past their end. Writes: an entry only for rows while they are active.
-- Build: CONCURRENTLY, so writers to vehicles are not blocked; an interrupted build leaves an INVALID index that the
-- conditional drop clears on a re-run, and the assertion fails the deploy rather than accept one. No BEGIN around the build:
-- the deploy applies this file with psql -f in autocommit.
SET statement_timeout = '900s';
SET lock_timeout = '180s';

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_active_auction_end') AND NOT indisvalid) AS bad \gset
\if :bad
DROP INDEX CONCURRENTLY IF EXISTS public.idx_vehicles_active_auction_end;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_active_auction_end
  ON public.vehicles (auction_end_date)
  WHERE auction_status = 'active' AND auction_end_date IS NOT NULL;

DO $assert$
DECLARE
  def text;
BEGIN
  IF NOT coalesce((SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass('public.idx_vehicles_active_auction_end')), false) THEN
    RAISE EXCEPTION 'idx_vehicles_active_auction_end is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_vehicles_active_auction_end and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_vehicles_active_auction_end'));
  IF def NOT LIKE '% USING btree (auction_end_date) WHERE %auction_status%active%' THEN
    RAISE EXCEPTION 'idx_vehicles_active_auction_end exists with another definition: %', def;
  END IF;
END
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_vehicles_active_auction_end IS
'Expired-auction cleanup in sync-live-auctions: auction_status = ''active'' and auction_end_date in the past. Without it the update was a sequential scan of the vehicles heap (mean 18.5 s, 3 calls after the 2026-10-15 03:00Z restart). Built CONCURRENTLY 2026-10-15.';
RESET lock_timeout;
RESET statement_timeout;
