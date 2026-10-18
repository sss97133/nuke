-- The homepage's live board: every auction on Bring a Trailer's live page, read in one call.
--
-- Measured 2026-09-27 ~16:50Z (read-only):
--   * sync-live-auctions (cron 488, every 15 min) upserts BaT's live page into vehicles with
--     sale_status = 'auction_live', auction_end_date, origin_metadata.no_reserve and the current bid.
--     Since 20260927195000 (17:04Z) the current bid lands in high_bid (a sale_price now needs a sold
--     status); rows the sync has not rewritten yet still carry it in sale_price, hence the COALESCE.
--     1,331 rows carry that status; 1,330 end in the future (ended auctions lose it), 1,272 are public.
--   * nuke.ag shows "LIVE 3": its live floor reads vehicle_listings, which has not been written since
--     2026-07-12 (upsert_live_auction_listings has failed on every sync; 15:45Z today:
--     "function resolve_platform_slug(text) does not exist"). The 3 are January rows.
--   * Reading the live set from vehicles takes 25.7 s (bitmap over 244,599 BaT rows) or 5.7 s with a
--     30-day created_at bound. There is no index on sale_status or auction_end_date.
--
-- 1. A partial index over the live rows only (about 1,300 entries). CONCURRENTLY: no lock on writers.
--    vehicles heap is 2.4 GB; the build reads it twice (~30 s at the measured ~190 MB/s).
-- 2. market_pulse_live(): SECURITY INVOKER, so the table rules decide what a caller sees (anonymous
--    callers get public vehicles only). Returns the sync time and one compact row per live auction,
--    ending soonest first. Counts and totals are computed from these rows by the page.
--    Row: [vehicle_id, year, make, model, current_bid, ends_at, updated_at, listed_at,
--          image_url, no_reserve, listing_url, title]
--    title is the listing's own title as BaT publishes it (vehicles.title, filled on all 1,326 live rows);
--    make is null on some lots (wheels, replicas), so the page names a lot by its title.
--    updated_at is vehicles.updated_at: the last write to the row by any process, not only a bid change.

SET statement_timeout = '120s';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vehicles_auction_live
  ON public.vehicles (auction_end_date)
  WHERE sale_status = 'auction_live';

-- An interrupted concurrent build leaves an INVALID index that IF NOT EXISTS would then skip.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'public.idx_vehicles_auction_live'::regclass AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION 'idx_vehicles_auction_live is INVALID; DROP INDEX CONCURRENTLY public.idx_vehicles_auction_live and re-run';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.market_pulse_live()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path = public
AS $function$
  WITH live AS (
    SELECT v.id,
           v.year,
           COALESCE(cm.canonical_name, v.make) AS make,
           v.model,
           COALESCE(v.high_bid, v.sale_price) AS current_bid,
           v.auction_end_date::timestamptz AS ends_at,
           v.updated_at,
           v.created_at AS listed_at,
           v.primary_image_url AS image_url,
           COALESCE((v.origin_metadata->>'no_reserve')::boolean, false) AS no_reserve,
           v.listing_url,
           v.title
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    WHERE v.sale_status = 'auction_live'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  )
  SELECT jsonb_build_object(
    'synced_at', (SELECT max(updated_at) FROM live),
    'source', 'Bring a Trailer live auctions page, read every 15 minutes by sync-live-auctions',
    'auctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               id, year, make, model, current_bid, ends_at, updated_at, listed_at,
               image_url, no_reserve, listing_url, title)
             ORDER BY ends_at)
      FROM live), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.market_pulse_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live() TO anon, authenticated, service_role;

RESET statement_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only):
--   SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_vehicles_auction_live'::regclass;  -- true
--   EXPLAIN ANALYZE SELECT public.market_pulse_live();                                                  -- index scan, well under 1 s
--   curl -sS -X POST "$SUPA/rest/v1/rpc/market_pulse_live" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H "Content-Type: application/json" -d '{}' | jq '{synced_at, n: (.auctions | length)}'                 -- ~1,270 rows
