-- Which houses the live board reads is data, not a list inside a function.
--
-- market_pulse_live_houses() hard-coded the houses (collecting-cars, pcarmarket, cars-and-bids), so each new live-bid
-- reader had to edit the same lines of the same function. live_board_houses holds one row per house: its slug, the
-- name the board shows, how to recognise its lots (the platform_source slug, or a listing-URL host pattern for lots
-- written without one) and whether the board reads it. A reader's migration inserts its row; the function and the
-- page need no edit. The six-hour reader-freshness gate stays in the function: a house whose newest write is older
-- is held off and named, whatever its row says.
-- Bonhams starts disabled: its open lots carry no bid (catalog sales) until its reader captures one.
-- Contract: supabase/sql/test_market_pulse_live_houses.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.live_board_houses (
  house text PRIMARY KEY,
  label text NOT NULL,
  host_pattern text,
  enabled boolean NOT NULL DEFAULT false,
  note text
);
COMMENT ON TABLE public.live_board_houses IS
  'The houses the live auctions board reads (market_pulse_live_houses). enabled = a live-bid reader writes their open '
  'lots with a current bid; host_pattern recognises lots written without platform_source by their listing URL.';
ALTER TABLE public.live_board_houses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_board_houses_read ON public.live_board_houses;
CREATE POLICY live_board_houses_read ON public.live_board_houses FOR SELECT USING (true);
REVOKE ALL ON public.live_board_houses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.live_board_houses TO anon, authenticated, service_role;

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note) VALUES
  ('collecting-cars', 'Collecting Cars', '^https?://([a-z0-9-]+\.)*collectingcars\.com/', true, 'sync-live-auctions-houses, every five minutes'),
  ('pcarmarket', 'PCarMarket', '^https?://([a-z0-9-]+\.)*pcarmarket\.com/', true, 'sync-live-auctions-houses, every five minutes'),
  ('cars-and-bids', 'Cars & Bids', '^https?://([a-z0-9-]+\.)*carsandbids\.com/', true, 'reader switched off 2026-10-18; held off by the freshness gate until it writes again'),
  ('bonhams', 'Bonhams', '^https?://([a-z0-9-]+\.)*bonhams\.com/', false, 'open lots are catalog sales with no bid; enable when the reader captures a current bid')
ON CONFLICT (house) DO NOTHING;

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
           v.listing_url, v.title, h.house, h.label,
           COALESCE(NULLIF(upper(v.origin_metadata->>'currency'), ''), 'USD') AS currency
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    JOIN LATERAL (
      SELECT lh.house, lh.label FROM public.live_board_houses lh
      WHERE lh.enabled AND (v.platform_source = lh.house OR v.listing_url ~* lh.host_pattern)
      ORDER BY (v.listing_url ~* lh.host_pattern) DESC NULLS LAST LIMIT 1
    ) h ON true
    WHERE v.is_public AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_status = 'auction_live'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  ),
  houses AS (
    SELECT house, max(label) AS label, count(*) AS lots, max(updated_at) AS read_at,
           max(updated_at) > now() - interval '6 hours' AS on_board
    FROM open_lots GROUP BY house
  )
  SELECT jsonb_build_object(
    'columns', jsonb_build_array(
      'id', 'year', 'make', 'model', 'current_bid', 'ends_at', 'updated_at', 'listed_at',
      'image_url', 'no_reserve', 'listing_url', 'title', 'house', 'currency'),
    'houses', COALESCE((SELECT jsonb_agg(jsonb_build_object('house', house, 'label', label, 'lots', lots, 'read_at', read_at, 'on_board', on_board)
                                         ORDER BY on_board DESC, lots DESC) FROM houses), '[]'::jsonb),
    'auctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               o.id, o.year, o.make, o.model, o.current_bid, o.ends_at, o.updated_at, o.listed_at,
               o.image_url, o.no_reserve, o.listing_url, o.title, o.house, o.currency)
             ORDER BY o.ends_at)
      FROM open_lots o JOIN houses hs USING (house) WHERE hs.on_board), '[]'::jsonb)
  );
$function$;
COMMENT ON FUNCTION public.market_pulse_live_houses() IS
  'Open lots of the houses enabled in live_board_houses (every house but BaT), in the live board''s row shape plus '
  'house and currency; houses lists each with its label and newest write. market_pulse_live is the BaT board and is unchanged.';

COMMIT;
