-- A house is held off the board when its reader stops, not when its lots go quiet.
--
-- market_pulse_live_houses gated each house on its newest vehicles.updated_at (six hours). The shared upsert writes a
-- row only when its status, end, bid or image changes, so a small house read every five minutes could go six quiet hours
-- overnight and drop off the board while open. The gate is now a successful read in the last 30 minutes
-- (live_auction_sources.last_successful_sync for the house's slug), or a lot write in the last six hours where the
-- house has no such record. Cars & Bids (last read 2026-02-18, reader off) stays held off.
-- Guarded on the live body's sha256. Contract: supabase/sql/test_market_pulse_live_houses.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text; src text;
BEGIN
  SELECT prosrc, encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO src, cur
    FROM pg_proc WHERE oid = 'public.market_pulse_live_houses()'::regprocedure;
  IF src LIKE '%last_successful_sync%' THEN RETURN; END IF; -- already applied
  IF cur IS DISTINCT FROM 'kE1FJ1npOvRw0cbugaNJXiW07mR9PbtOAV9z6ewACHI=' THEN
    RAISE EXCEPTION 'market_pulse_live_houses drifted from the body this migration edits (sha256 %)', cur;
  END IF;
END $guard$;

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
    -- On the board while its reader runs: a successful read in the last 30 minutes (live_auction_sources, one row per
    -- house, slug = the house), or, for a house with no such record, a lot write in the last six hours. A quiet sale
    -- writes nothing when no bid moves, so lot writes alone would hide a house the reader is reading every five minutes.
    SELECT o.house, max(o.label) AS label, count(*) AS lots, max(o.updated_at) AS read_at,
           COALESCE(max(src.last_successful_sync) > now() - interval '30 minutes', false)
             OR max(o.updated_at) > now() - interval '6 hours' AS on_board
    FROM open_lots o
    LEFT JOIN public.live_auction_sources src ON src.slug = o.house
    GROUP BY o.house
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
COMMIT;
