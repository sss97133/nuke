-- Hardening pass on the live-auction sync RPCs (2026-07-11, BAT-LIVE-INGEST).
-- Root causes found in the first end-to-end run (1,094 live BaT auctions):
--   1. BaT's auctionsCurrentInitialData sends current_bid: false for no-bid lots.
--      'false'::int aborted a whole 500-row chunk of upsert_live_auction_vehicles
--      (594/1094 landed). Casts are now regex-guarded: non-numeric => NULL (unknown).
--   2. sync-live-auctions' JS vehicle_events upsert used bare
--      ON CONFLICT (vehicle_id,source_platform,source_url), which cannot match the
--      PARTIAL unique index idx_vehicle_events_dedup_url
--      (WHERE source_url IS NOT NULL AND source_listing_id IS NULL) — it errored on
--      every run ("no unique or exclusion constraint matching the ON CONFLICT
--      specification"). The events ensure/update now lives here with the matching
--      partial-index predicate, so bid snapshots + prediction reads stay fresh.

-- Safe numeric read: BaT booleans/garbage become NULL (mark unknown, never invent).
CREATE OR REPLACE FUNCTION public._jsonb_numeric(p jsonb, k text)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN (p->>k) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (p->>k)::numeric END $$;

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
    auction_end_date, sale_price, primary_image_url, platform_source,
    origin_metadata, is_public, updated_at
  )
  SELECT
    r->>'listing_url',
    r->>'title',
    _jsonb_numeric(r, 'year')::int,
    r->>'make',
    r->>'model',
    coalesce(r->>'auction_status','active'),
    coalesce(r->>'sale_status','auction_live'),
    r->>'auction_end_date',
    _jsonb_numeric(r, 'sale_price')::int,
    nullif(r->>'primary_image_url',''),
    r->>'platform_source',
    coalesce(r->'origin_metadata','{}'::jsonb),
    true,
    coalesce(nullif(r->>'updated_at','')::timestamptz, now())
  FROM jsonb_array_elements(p_rows) r
  WHERE coalesce(r->>'listing_url','') <> ''
  ON CONFLICT (listing_url) WHERE (deleted_at IS NULL AND listing_url IS NOT NULL AND listing_url <> '')
  DO UPDATE SET
    auction_status   = excluded.auction_status,
    sale_status      = excluded.sale_status,
    auction_end_date = excluded.auction_end_date,
    sale_price       = excluded.sale_price,
    primary_image_url = coalesce(excluded.primary_image_url, v.primary_image_url),
    origin_metadata  = excluded.origin_metadata,
    updated_at       = excluded.updated_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

CREATE OR REPLACE FUNCTION public.upsert_live_auction_listings(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer := 0;
BEGIN
  -- 1) Mirror live auction state into vehicle_listings (realtime floor feed).
  INSERT INTO vehicle_listings AS vl (
    vehicle_id, seller_id, list_price_cents, sale_type, status,
    auction_end_time, current_high_bid_cents, bid_count, metadata, updated_at
  )
  SELECT
    v.id,
    NULL,
    0,
    'auction',
    'active',
    nullif(r->>'auction_end_date','')::timestamptz,
    (_jsonb_numeric(r, 'sale_price') * 100)::bigint,
    _jsonb_numeric(r->'origin_metadata', 'bid_count')::int,
    jsonb_build_object(
      'source', 'sync-live-auctions',
      'platform', r->>'platform_source',
      'listing_url', r->>'listing_url',
      'external_id', r->'origin_metadata'->>'external_id',
      'no_reserve', r->'origin_metadata'->'no_reserve',
      'title', r->>'title',
      'thumbnail_url', r->'origin_metadata'->>'thumbnail_url',
      'observed_at', now()
    ),
    now()
  FROM jsonb_array_elements(p_rows) r
  JOIN LATERAL (
    SELECT id FROM vehicles
    WHERE listing_url = r->>'listing_url' AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  ) v ON true
  WHERE coalesce(r->>'listing_url','') <> ''
  ON CONFLICT ((metadata->>'listing_url')) WHERE (metadata->>'listing_url') IS NOT NULL
  DO UPDATE SET
    current_high_bid_cents = excluded.current_high_bid_cents,
    bid_count        = coalesce(excluded.bid_count, vl.bid_count),
    auction_end_time = excluded.auction_end_time,
    status           = 'active',
    last_bid_time    = CASE
      WHEN excluded.current_high_bid_cents IS DISTINCT FROM vl.current_high_bid_cents
        THEN now()
      ELSE vl.last_bid_time END,
    metadata         = vl.metadata || excluded.metadata,
    updated_at       = now();
  GET DIAGNOSTICS n = ROW_COUNT;

  -- 2) Ensure a vehicle_events row per live auction (bid snapshots + prediction
  --    engine read from here). ON CONFLICT must carry the partial-index predicate.
  INSERT INTO vehicle_events AS ve (
    vehicle_id, source_platform, source_url, event_type, event_status,
    current_price, bid_count, ended_at, updated_at
  )
  SELECT
    v.id,
    CASE WHEN r->>'platform_source' = 'bringatrailer' THEN 'bat' ELSE r->>'platform_source' END,
    r->>'listing_url',
    'auction',
    'active',
    _jsonb_numeric(r, 'sale_price'),
    _jsonb_numeric(r->'origin_metadata', 'bid_count')::int,
    nullif(r->>'auction_end_date','')::timestamptz,
    now()
  FROM jsonb_array_elements(p_rows) r
  JOIN LATERAL (
    SELECT id FROM vehicles
    WHERE listing_url = r->>'listing_url' AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  ) v ON true
  WHERE coalesce(r->>'listing_url','') <> ''
  ON CONFLICT (vehicle_id, source_platform, source_url)
    WHERE (source_url IS NOT NULL AND source_listing_id IS NULL)
  DO UPDATE SET
    current_price = coalesce(excluded.current_price, ve.current_price),
    bid_count     = coalesce(excluded.bid_count, ve.bid_count),
    event_status  = 'active',
    ended_at      = excluded.ended_at,
    updated_at    = now();

  -- 3) Time-based closeout of mirror rows only (never touches native seller listings).
  UPDATE vehicle_listings
  SET status = 'expired', updated_at = now()
  WHERE metadata->>'source' = 'sync-live-auctions'
    AND status = 'active'
    AND auction_end_time < now();

  RETURN n;
END
$function$;

REVOKE ALL ON FUNCTION public._jsonb_numeric(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_live_auction_listings(jsonb) FROM PUBLIC, anon, authenticated;
