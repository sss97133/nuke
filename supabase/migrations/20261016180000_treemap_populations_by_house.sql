-- The map's population receipt says how its confirmed sales split by house: treemap_populations().by_house.
--
-- The owner, 2026-10-15: "why is our site overly bat oriented... is supposed to be all the markets not just one". The
-- map's head states one total ("282,317 sold"). skylar-83 will put a line beside it, "BaT 58% · Mecum 20% · ... · 3,532
-- venue unrecorded", read from the receipt treemap_refresh_all writes to treemap_refreshes.populations at each refresh,
-- so it costs visitors nothing and carries the map's own clock. by_house is an array, largest first, of
-- {house, sales, amount}: house is mv_treemap_outcomes.source_name (market_venue_label, 20261016150000; null = venue
-- unrecorded), sales = confirmed sales with an amount (the map's area population), amount = their sum, nominal with no
-- currency on the row, as the map's tiles. Everything else in the receipt is unchanged. Guarded on the live hash.
-- Contract: supabase/sql/test_treemap_populations_by_house.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc
  WHERE oid = 'public.treemap_populations()'::regprocedure;
  IF v IS DISTINCT FROM 'h/Rf/lQy+mEq88bosEyQDjJbLVAKRoO1IyHYJQYFFso=' AND v IS DISTINCT FROM 'mauC+h9iZHq1zpojd8dnl9ZBdrfFfx6cxJSWz4gCIjk=' THEN
    RAISE EXCEPTION 'treemap_populations is not the 20261014063000 definition this extends (sha256 %)', v;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.treemap_populations()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'measure', 'confirmed_sale_v1',
    'public_records', (SELECT count(*) FROM public.vehicles v
                        WHERE v.is_public IS TRUE AND v.deleted_at IS NULL
                          AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
    'known_outcomes', (SELECT count(*) FROM public.mv_treemap_outcomes),
    'confirmed_sales', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE outcome = 'sold'),
    'confirmed_sales_with_amount', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE sold_amount > 0),
    'mapped_makes', (SELECT count(*) FROM public.mv_treemap_sale_brands),
    'mapped_sales', (SELECT COALESCE(sum(count), 0) FROM public.mv_treemap_sale_brands),
    'make_floor', 5,
    'median_floor', 5,
    'by_house', (SELECT COALESCE(jsonb_agg(jsonb_build_object('house', h.house, 'sales', h.sales, 'amount', h.amount)
                                           ORDER BY h.sales DESC, h.house NULLS LAST), '[]'::jsonb)
                 FROM (SELECT o.source_name AS house, count(*) AS sales, sum(o.sold_amount) AS amount
                       FROM public.mv_treemap_outcomes o
                       WHERE o.outcome = 'sold' AND o.sold_amount > 0
                       GROUP BY o.source_name) h));
$function$;

COMMIT;
