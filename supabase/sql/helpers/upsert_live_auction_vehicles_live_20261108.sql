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
    auction_end_date = coalesce(excluded.auction_end_date, v.auction_end_date),
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
    origin_metadata = coalesce(v.origin_metadata, '{}'::jsonb) || excluded.origin_metadata,
    updated_at = excluded.updated_at
  -- touch a row only when something a reader sees changed: every write runs the vehicles trigger chain
  WHERE (v.sale_status IS DISTINCT FROM excluded.sale_status
     OR v.auction_status IS DISTINCT FROM excluded.auction_status
     OR (excluded.auction_end_date IS NOT NULL AND v.auction_end_date IS DISTINCT FROM excluded.auction_end_date)
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
