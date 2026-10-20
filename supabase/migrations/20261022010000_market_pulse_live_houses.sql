-- The live board reads every house with a running live-bid reader, not Bring a Trailer alone.
--
-- market_pulse_live() stays the BaT board, byte for byte: the phone, the family-horizon movers and the treemap read
-- its snapshot as live BaT dollars. market_pulse_live_houses() is the same lots for the other houses, in the board's
-- own row shape, for the web to place beside BaT's:
--   * Collecting Cars and PCarMarket (sync-live-auctions-houses, every five minutes) and Cars & Bids (its reader,
--     cars-and-bids-15m, is switched off: its lots drop off the board once the house's newest write is six hours
--     old, and 'houses' names the house with that write time instead of showing two-day-old bids as live).
--   * Bonhams has no live bid (its lots carry an estimate and no bid); it stays on the auction calendar.
--   * Each lot carries its currency as the house records it (Collecting Cars lists EUR, GBP, AUD, NZD and USD; no
--     rate table exists, so the web never adds them into a dollar figure).
-- The house is read from the listing URL first: a lot written without platform_source (39 of 441 on 2026-10-20)
-- still belongs to the house its link names.
-- Contract: supabase/sql/test_market_pulse_live_houses.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_pulse_live_houses()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH open_lots AS (
    SELECT v.id, v.year, COALESCE(cm.canonical_name, v.make) AS make, v.model,
           COALESCE(v.high_bid, v.sale_price) AS current_bid,
           v.auction_end_date::timestamptz AS ends_at, v.updated_at, v.created_at AS listed_at,
           v.primary_image_url AS image_url,
           COALESCE((v.origin_metadata->>'no_reserve')::boolean, false) AS no_reserve,
           v.listing_url, v.title, h.house,
           COALESCE(NULLIF(upper(v.origin_metadata->>'currency'), ''), 'USD') AS currency
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    CROSS JOIN LATERAL (SELECT CASE
      WHEN v.listing_url ~* '^https?://([a-z0-9-]+\.)*collectingcars\.com/' THEN 'collecting-cars'
      WHEN v.listing_url ~* '^https?://([a-z0-9-]+\.)*pcarmarket\.com/' THEN 'pcarmarket'
      WHEN v.listing_url ~* '^https?://([a-z0-9-]+\.)*carsandbids\.com/' THEN 'cars-and-bids'
      ELSE v.platform_source END AS house) h
    WHERE v.is_public AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_status = 'auction_live'
      AND h.house IN ('collecting-cars', 'pcarmarket', 'cars-and-bids')
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  ),
  houses AS (
    SELECT house, count(*) AS lots, max(updated_at) AS read_at,
           max(updated_at) > now() - interval '6 hours' AS on_board
    FROM open_lots GROUP BY house
  )
  SELECT jsonb_build_object(
    'columns', jsonb_build_array(
      'id', 'year', 'make', 'model', 'current_bid', 'ends_at', 'updated_at', 'listed_at',
      'image_url', 'no_reserve', 'listing_url', 'title', 'house', 'currency'),
    'houses', COALESCE((SELECT jsonb_agg(jsonb_build_object('house', house, 'lots', lots, 'read_at', read_at, 'on_board', on_board)
                                         ORDER BY on_board DESC, lots DESC) FROM houses), '[]'::jsonb),
    'auctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               o.id, o.year, o.make, o.model, o.current_bid, o.ends_at, o.updated_at, o.listed_at,
               o.image_url, o.no_reserve, o.listing_url, o.title, o.house, o.currency)
             ORDER BY o.ends_at)
      FROM open_lots o JOIN houses hs USING (house) WHERE hs.on_board), '[]'::jsonb)
  );
$function$;
REVOKE ALL ON FUNCTION public.market_pulse_live_houses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live_houses() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.market_pulse_live_houses() IS
  'Open lots of the non-BaT houses with a live-bid reader (Collecting Cars, PCarMarket, Cars & Bids while its reader '
  'runs), in the live board''s row shape plus house and currency; houses lists each house with its newest write. '
  'market_pulse_live is the BaT board and is unchanged.';

COMMIT;
