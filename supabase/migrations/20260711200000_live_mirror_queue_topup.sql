-- Live lot observed => mirror row + vehicle_events + deep-extraction queued.
-- Adds step 3 to upsert_live_auction_listings: enqueue new BaT live lots into
-- bat_extraction_queue (ending-soonest = higher priority; claim RPC orders
-- priority DESC). Idempotent on bat_url. (2026-07-11, BAT-LIVE-INGEST Phase 2)
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

  -- 2) Ensure a vehicle_events row per live auction (bid snapshots + predictions).
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

  -- 3) Queue new BaT live lots for deep extraction (extract-bat-core via
  --    process-bat-extraction-queue). Free fetch path; no Firecrawl.
  INSERT INTO bat_extraction_queue (vehicle_id, bat_url, status, priority)
  SELECT
    v.id,
    r->>'listing_url',
    'pending',
    CASE WHEN nullif(r->>'auction_end_date','')::timestamptz < now() + interval '6 hours' THEN 900
         WHEN nullif(r->>'auction_end_date','')::timestamptz < now() + interval '24 hours' THEN 800
         WHEN nullif(r->>'auction_end_date','')::timestamptz < now() + interval '3 days' THEN 700
         ELSE 600 END
  FROM jsonb_array_elements(p_rows) r
  JOIN LATERAL (
    SELECT id FROM vehicles
    WHERE listing_url = r->>'listing_url' AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  ) v ON true
  WHERE r->>'platform_source' = 'bringatrailer'
    AND coalesce(r->>'listing_url','') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM bat_extraction_queue q WHERE q.bat_url = r->>'listing_url'
    );

  -- 4) Time-based closeout of mirror rows only (never touches native seller listings).
  UPDATE vehicle_listings
  SET status = 'expired', updated_at = now()
  WHERE metadata->>'source' = 'sync-live-auctions'
    AND status = 'active'
    AND auction_end_time < now();

  RETURN n;
END
$function$;

REVOKE ALL ON FUNCTION public.upsert_live_auction_listings(jsonb) FROM PUBLIC, anon, authenticated;
