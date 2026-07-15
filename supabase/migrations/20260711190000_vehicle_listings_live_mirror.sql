-- vehicle_listings as the realtime mirror for EXTERNAL live auctions (BaT first).
-- Why (2026-07-11, BAT-LIVE-INGEST):
--   * The /live floor (nuke_frontend/src/live/useLiveFloor.ts) subscribes to
--     postgres_changes INSERTs on vehicle_listings — but the table was never in the
--     supabase_realtime publication and nothing external ever wrote to it (7 test rows).
--   * sync-live-auctions upserts live auction state into `vehicles` via
--     upsert_live_auction_vehicles(); this adds the sibling mirror RPC for
--     vehicle_listings so bid / end-time / status land in the realtime table.
-- No new table is created (platform-hygiene rule): we extend the existing one.

-- 1) External mirror rows have no Nuke seller. NULL is the honest value
--    (facts are sacred — never attribute a BaT listing to a Nuke user).
--    Native flows always set seller_id; RLS write policies key on
--    seller_id = auth.uid(), so NULL-seller rows stay service-role-only for writes.
ALTER TABLE public.vehicle_listings ALTER COLUMN seller_id DROP NOT NULL;

-- 2) Idempotency key for the mirror: one row per external listing URL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicle_listings_external_listing_url
  ON public.vehicle_listings ((metadata->>'listing_url'))
  WHERE (metadata->>'listing_url') IS NOT NULL;

-- 3) The mirror upsert. Same p_rows payload as upsert_live_auction_vehicles()
--    (built once in sync-live-auctions). Resolves vehicle_id from vehicles by
--    listing_url (the vehicles upsert runs first in the same invocation).
--    list_price_cents = 0 means "auction, no list price"; the live money value is
--    current_high_bid_cents. last_bid_time = when WE observed the bid change
--    (observation time, not BaT's bid timestamp — that lands in Phase-2 extraction).
CREATE OR REPLACE FUNCTION public.upsert_live_auction_listings(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE n integer := 0;
BEGIN
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
    (nullif(r->>'sale_price','')::numeric * 100)::bigint,
    nullif(r->'origin_metadata'->>'bid_count','')::int,
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

  -- Time-based closeout of mirror rows only (never touches native seller listings).
  UPDATE vehicle_listings
  SET status = 'expired', updated_at = now()
  WHERE metadata->>'source' = 'sync-live-auctions'
    AND status = 'active'
    AND auction_end_time < now();

  RETURN n;
END
$function$;

REVOKE ALL ON FUNCTION public.upsert_live_auction_listings(jsonb) FROM PUBLIC, anon, authenticated;

-- 4) Realtime: the /live floor's postgres_changes subscription needs the table in
--    the supabase_realtime publication (it never was — INSERT events never fired).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vehicle_listings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_listings;
  END IF;
END $$;
