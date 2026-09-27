-- Live auctions: BaT's current bid is a bid (high_bid), never sale_price.
-- Session cb179857, 2026-09-27. Fixes a regression from lock 1 (20260927170000_sale_price_requires_sold_status,
-- applied 16:11Z): upsert_live_auction_vehicles wrote the current bid into sale_price on every sync, the guard
-- refuses a sale_price > 0 without a sold status (BEFORE INSERT fires for every proposed row of an
-- INSERT … ON CONFLICT), and the whole upsert fails. Measured: sync-live-auctions logged "Upserting 1332 auctions"
-- at 16:45Z and 17:00Z with no error line (the function drops it), and only 197 of 1,330 auction_live rows moved
-- after 16:12Z — none of them by the sync. Live bids and newly listed BaT auctions froze at the 16:00Z run.
--
-- Change (this function only; the edge function's payload keeps its 'sale_price' key):
--   * the incoming bid lands in high_bid on insert and on update;
--   * a row that was already live has its old bid cleared out of sale_price (NULL claims nothing);
--   * any other row keeps its sale_price untouched (a relisted car's earlier sale stays as it was).
-- Both paths pass the guard: sale_price is NULL or unchanged. Readers of the live bid move to high_bid
-- (ActiveAuctionsPanel in the same commit reads high_bid first, sale_price as the fallback for old rows).

SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.upsert_live_auction_vehicles(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  INSERT INTO vehicles AS v (
    listing_url, title, year, make, model, auction_status, sale_status,
    auction_end_date, high_bid, primary_image_url, platform_source,
    origin_metadata, is_public, updated_at
  )
  SELECT DISTINCT ON (r->>'listing_url')
    r->>'listing_url',
    r->>'title',
    nullif(r->>'year','')::int,
    r->>'make',
    r->>'model',
    coalesce(r->>'auction_status','active'),
    coalesce(r->>'sale_status','auction_live'),
    r->>'auction_end_date',
    nullif(r->>'sale_price','')::int,        -- the payload calls BaT's current bid 'sale_price'; it is a bid
    nullif(r->>'primary_image_url',''),
    r->>'platform_source',
    coalesce(r->'origin_metadata','{}'::jsonb),
    (nullif(r->>'year','') IS NOT NULL),   -- real cars have a year; signs/parts don't
    coalesce(nullif(r->>'updated_at','')::timestamptz, now())
  FROM jsonb_array_elements(p_rows) r
  WHERE coalesce(r->>'listing_url','') <> ''
  ORDER BY r->>'listing_url', coalesce(nullif(r->>'updated_at','')::timestamptz, now()) DESC
  ON CONFLICT (listing_url) WHERE (deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '')
  DO UPDATE SET
    auction_status   = excluded.auction_status,
    sale_status      = excluded.sale_status,
    auction_end_date = excluded.auction_end_date,
    high_bid         = excluded.high_bid,
    sale_price       = CASE WHEN v.sale_status = 'auction_live' THEN NULL ELSE v.sale_price END,
    primary_image_url = coalesce(excluded.primary_image_url, v.primary_image_url),
    origin_metadata  = excluded.origin_metadata,
    updated_at       = excluded.updated_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

COMMENT ON FUNCTION public.upsert_live_auction_vehicles(jsonb) IS
  'sync-live-auctions upsert of live auctions into vehicles. The current bid is written to high_bid (2026-09-27: a bid is never a sale_price; lock 1 refuses one). Rows that were already live have their old bid cleared from sale_price; other rows keep sale_price as it was.';

RESET statement_timeout;

-- POST-APPLY (read-only), after the next */15 sync:
--   SELECT count(*) live, count(*) FILTER (WHERE high_bid > 0) with_high_bid, count(*) FILTER (WHERE sale_price > 0) with_sale_price,
--          max(updated_at) last_update
--   FROM vehicles WHERE deleted_at IS NULL AND sale_status = 'auction_live';
--   -> with_high_bid ≈ live minus no-bid lots, with_sale_price → 0, last_update = the sync's time.
