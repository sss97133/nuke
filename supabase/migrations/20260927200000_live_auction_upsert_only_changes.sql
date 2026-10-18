-- Live sync, part 2: write only what changed, in chunks that fit the 60 s service statement limit.
-- Session cb179857, 2026-09-27. After 8967ac5e8 restored the July RPC path, each 500-row chunk of
-- upsert_live_auction_vehicles hit "canceling statement due to statement timeout" at 60 s (17:21:17Z,
-- 17:22:17Z): the DO UPDATE rewrote every live row on every run (origin_metadata.last_sync always changes),
-- and each vehicles write runs the ~38-trigger chain (≈0.1–0.2 s per row under today's load).
-- Now a conflicting row is updated only when a field a reader sees changed (status, end date, bid, a stale
-- bid left in sale_price, a first image). Steady state ≈ the lots whose bid moved in 15 min. The edge
-- function sends 100 rows per call (was 500) in the same commit.

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
    updated_at       = excluded.updated_at
  -- touch a row only when something a reader sees changed: every write runs the vehicles trigger chain
  WHERE v.sale_status      IS DISTINCT FROM excluded.sale_status
     OR v.auction_status   IS DISTINCT FROM excluded.auction_status
     OR v.auction_end_date IS DISTINCT FROM excluded.auction_end_date
     OR v.high_bid         IS DISTINCT FROM excluded.high_bid
     OR (v.sale_status = 'auction_live' AND v.sale_price IS NOT NULL)
     OR (v.primary_image_url IS NULL AND excluded.primary_image_url IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

COMMENT ON FUNCTION public.upsert_live_auction_vehicles(jsonb) IS
  'sync-live-auctions upsert of live auctions into vehicles. The current bid is written to high_bid (a bid is never a sale_price; lock 1 refuses one). A conflicting row is updated only when status, end date, bid or first image changed, or an old bid still sits in sale_price (2026-09-27).';

RESET statement_timeout;
