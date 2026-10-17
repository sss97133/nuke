-- upsert_live_auction_vehicles: the live list never re-lives a closed lot.
--
-- WHY (2026-10-16): of 178 BaT lots closed in the 30 h to 00:1xZ 10-16 (skylar-83's model-32 cohort), 51 carry a
-- vehicles high_bid / sale_price below the lot's final in auction_events (median 9.7% short; 34 reserve-not-met, 17
-- sold); since 2026-09-01, 83 of 6,877 BaT sold / reserve-not-met lots whose vehicles row is that listing (43 sold,
-- 40 RNM, median 9.7%). For 63 of the 83 the final had reached vehicles: extract-bat-core's closing read wrote it
-- through correct_vehicle_sale_provenance_batch (e.g. a 1969 Corvette high_bid 350,000 -> 430,000 at 17:26:57Z
-- 10-15). Then sync-live-auctions (cron 488, every 15 min) read BaT's /auctions/ list, which still showed the lot
-- active with an older bid, and this upsert wrote that bid, the scheduled end and sale_status 'auction_live' back
-- over it. A later pass emptied sale_price (the auction_live branch below), and end_live_auctions_absent set
-- 'ended'. The signature: vehicles.auction_end_date is the round scheduled end (17:20:00) and the corrected close
-- (17:25:12) is gone. A sold lot so ends up 'ended', no sale price, its bid stale.
--
-- CHANGE: the DO UPDATE skips a row whose listing already has a result on record in auction_events (sold,
-- reserve_not_met or cancelled for the same vehicle and URL: idx_auction_events_vehicle_source_url). Every other
-- path is unchanged, the body otherwise as live on 2026-10-16 (md5 c38056ed216069f111461fce6120553e, refused if it
-- has moved). Live lots and new rows are written as before.
-- Contract: supabase/sql/test_live_auction_upsert_closed_lots.sql (PG17). Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.upsert_live_auction_vehicles(jsonb)'::regprocedure)) NOT IN
     ('c38056ed216069f111461fce6120553e', '7f28f01f7b33da433e48a758ecec22b8') THEN -- gitleaks:allow (function-definition fingerprints, not secrets)
    RAISE EXCEPTION 'upsert_live_auction_vehicles has another body than the one this migration replaces; review first';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.upsert_live_auction_vehicles(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer;
BEGIN
  INSERT INTO vehicles AS v (
    listing_url, title, year, make, model, auction_status, sale_status, auction_end_date, high_bid,
    primary_image_url, platform_source, origin_metadata, is_public, updated_at
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
    nullif(r->>'sale_price','')::int,          -- the payload calls BaT's current bid 'sale_price'; it is a bid
    nullif(r->>'primary_image_url',''),
    r->>'platform_source',
    coalesce(r->'origin_metadata','{}'::jsonb),
    (nullif(r->>'year','') IS NOT NULL),       -- real cars have a year; signs/parts don't
    coalesce(nullif(r->>'updated_at','')::timestamptz, now())
  FROM jsonb_array_elements(p_rows) r
  WHERE coalesce(r->>'listing_url','') <> ''
  ORDER BY r->>'listing_url', coalesce(nullif(r->>'updated_at','')::timestamptz, now()) DESC
  ON CONFLICT (listing_url) WHERE (deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '')
  DO UPDATE SET
    auction_status = excluded.auction_status,
    sale_status = excluded.sale_status,
    auction_end_date = excluded.auction_end_date,
    high_bid = excluded.high_bid,
    sale_price = CASE WHEN v.sale_status = 'auction_live' THEN NULL ELSE v.sale_price END,
    primary_image_url = coalesce(excluded.primary_image_url, v.primary_image_url),
    -- a missing make, a garbage make (is_garbage_make: digits, a year, a title descriptor such as
    -- 'Coyote-Powered') or a naive title split ('Aston' / 'Martin V12 …') stored by the old sync is replaced by
    -- the parsed identity the payload now carries when that is a real make; a real make is never rewritten
    -- (2026-09-27, extends 20260927110000)
    make = CASE WHEN (v.make IS NULL OR is_garbage_make(v.make) OR v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC'))
                 AND excluded.make IS NOT NULL AND NOT is_garbage_make(excluded.make) AND excluded.make IS DISTINCT FROM v.make THEN excluded.make ELSE v.make END,
    model = CASE WHEN (v.make IS NULL OR is_garbage_make(v.make) OR v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC'))
                  AND excluded.make IS NOT NULL AND NOT is_garbage_make(excluded.make) AND excluded.make IS DISTINCT FROM v.make THEN excluded.model ELSE v.model END,
    origin_metadata = excluded.origin_metadata,
    updated_at = excluded.updated_at
  -- touch a row only when something a reader sees changed: every write runs the vehicles trigger chain
  WHERE (v.sale_status IS DISTINCT FROM excluded.sale_status
     OR v.auction_status IS DISTINCT FROM excluded.auction_status
     OR v.auction_end_date IS DISTINCT FROM excluded.auction_end_date
     OR v.high_bid IS DISTINCT FROM excluded.high_bid
     OR (v.sale_status = 'auction_live' AND v.sale_price IS NOT NULL)
     OR (v.primary_image_url IS NULL AND excluded.primary_image_url IS NOT NULL)
     OR ((v.make IS NULL OR is_garbage_make(v.make) OR v.make IN ('Alfa','Mercedes','Land','Aston','Rolls','Austin','De','AM','El','AC'))
         AND excluded.make IS NOT NULL AND NOT is_garbage_make(excluded.make) AND excluded.make IS DISTINCT FROM v.make))
    -- a lot whose result is on record is closed: the live list never re-lives it or rewrites its bid and end
    -- (its final is the settlement's and the correction writer's; 2026-10-16, header)
    AND NOT EXISTS (SELECT 1 FROM auction_events a
                    WHERE a.vehicle_id = v.id
                      AND a.source_url IN (rtrim(v.listing_url, '/'), rtrim(v.listing_url, '/') || '/')
                      AND a.outcome IN ('sold', 'reserve_not_met', 'cancelled'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

COMMENT ON FUNCTION public.upsert_live_auction_vehicles(jsonb) IS
  'sync-live-auctions upsert of live auctions into vehicles. The current bid is written to high_bid (a bid is never a sale_price). A conflicting row is updated only when status, end date, bid or first image changed, or an old bid still sits in sale_price, and never once its listing has a result on record in auction_events (sold, reserve_not_met, cancelled; 2026-10-16).';

COMMIT;
