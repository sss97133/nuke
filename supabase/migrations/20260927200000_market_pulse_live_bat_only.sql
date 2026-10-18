-- The homepage live board: Bring a Trailer only.
--
-- Review of the board against BaT's live page (2026-09-27, measured): 1 Collecting Cars auction appeared
-- on a board labelled Bring a Trailer, because market_pulse_live() did not filter by platform.
-- -> platform_source = 'bringatrailer'. Everything else is unchanged, including SECURITY INVOKER: the
-- vehicles table rule still decides what a caller sees.
-- Row: [vehicle_id, year, make, model, current_bid, ends_at, updated_at, listed_at,
--       image_url, no_reserve, listing_url, title]

SET statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.market_pulse_live()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path = public
AS $function$
  WITH live AS (
    SELECT v.id,
           v.year,
           COALESCE(cm.canonical_name, v.make) AS make,
           v.model,
           COALESCE(v.high_bid, v.sale_price) AS current_bid,
           v.auction_end_date::timestamptz AS ends_at,
           v.updated_at,
           v.created_at AS listed_at,
           v.primary_image_url AS image_url,
           COALESCE((v.origin_metadata->>'no_reserve')::boolean, false) AS no_reserve,
           v.listing_url,
           v.title
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    WHERE v.sale_status = 'auction_live'
      AND v.platform_source = 'bringatrailer'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  )
  SELECT jsonb_build_object(
    'synced_at', (SELECT max(updated_at) FROM live),
    'source', 'Bring a Trailer live auctions page, read every 15 minutes by sync-live-auctions',
    'auctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               id, year, make, model, current_bid, ends_at, updated_at, listed_at,
               image_url, no_reserve, listing_url, title)
             ORDER BY ends_at)
      FROM live), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.market_pulse_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live() TO anon, authenticated, service_role;

RESET statement_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only):
--   curl -sS -X POST "$SUPA/rest/v1/rpc/market_pulse_live" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H "Content-Type: application/json" -d '{}' | jq '.auctions | length'   -- no Collecting Cars row
