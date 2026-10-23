-- shadow_sale_prices_snap: dated-comp gap. 105,714 snapped sold rows (bat 47,835, mecum 30,637, B-J 27,242) have
-- auction_events.auction_end_date NULL, so they cannot be point-in-time comps, and the comp extract that
-- concat_ws'd NULL columns silently dropped them (and 7,559 BaT targets with them).
-- Additive: sold_at_filled + sold_at_source with explicit provenance; sold_at itself is untouched.
-- Priority (for sold_at NULL rows): bat_listings end/sale date (price-matched, BaT only)
--           > vehicles.bat_sale_date (BaT only) > vehicles.sale_date when the vehicle has exactly one snapped sale.
-- Revert: supabase/sql/revert_20261025142000_snap_sold_at_fallback.sql
ALTER TABLE public.shadow_sale_prices_snap
  ADD COLUMN IF NOT EXISTS sold_at_filled timestamptz,
  ADD COLUMN IF NOT EXISTS sold_at_source text,
  ADD COLUMN IF NOT EXISTS sold_at_run_id uuid;
CREATE INDEX IF NOT EXISTS shadow_sale_prices_snap_vehicle ON public.shadow_sale_prices_snap (vehicle_id);
-- Readers use coalesce(sold_at, sold_at_filled); only rows with sold_at NULL are filled.

CREATE OR REPLACE FUNCTION public.fill_snap_sold_at(p_lo text, p_hi text, p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public SET statement_timeout = '150s' AS $f$
DECLARE n int;
BEGIN
  EXECUTE format($q$
    UPDATE shadow_sale_prices_snap s SET
      sold_at_filled = x.d, sold_at_source = x.src, sold_at_run_id = %L::uuid
    FROM (
      SELECT s2.auction_event_id,
        CASE WHEN bl.d IS NOT NULL THEN bl.d::timestamptz
             WHEN s2.platform = 'bat' AND v.bat_sale_date IS NOT NULL THEN v.bat_sale_date::timestamptz
             WHEN v.sale_date IS NOT NULL AND (SELECT count(*) FROM shadow_sale_prices_snap s3 WHERE s3.vehicle_id = s2.vehicle_id) = 1 THEN v.sale_date::timestamptz END d,
        CASE WHEN bl.d IS NOT NULL THEN 'bat_listings.auction_end_date|sale_date'
             WHEN s2.platform = 'bat' AND v.bat_sale_date IS NOT NULL THEN 'vehicles.bat_sale_date'
             WHEN v.sale_date IS NOT NULL AND (SELECT count(*) FROM shadow_sale_prices_snap s3 WHERE s3.vehicle_id = s2.vehicle_id) = 1 THEN 'vehicles.sale_date(single_sale)' END src
      FROM shadow_sale_prices_snap s2
      JOIN vehicles v ON v.id = s2.vehicle_id
      LEFT JOIN LATERAL (SELECT coalesce(b.auction_end_date, b.sale_date) d FROM bat_listings b
                         WHERE s2.platform = 'bat' AND s2.sold_at IS NULL AND b.vehicle_id = s2.vehicle_id
                           AND coalesce(b.sale_price, b.final_bid) BETWEEN s2.hammer_price * 0.95 AND s2.hammer_price * 1.2
                         ORDER BY 1 DESC NULLS LAST LIMIT 1) bl ON true
      WHERE s2.auction_event_id >= %L::uuid AND (%L = 'ff+' OR s2.auction_event_id < %L::uuid)
        AND s2.sold_at IS NULL AND s2.sold_at_filled IS NULL
    ) x
    WHERE s.auction_event_id = x.auction_event_id AND x.d IS NOT NULL$q$,
    p_run_id, rpad(p_lo, 8, '0') || '-0000-0000-0000-000000000000', p_hi,
    CASE WHEN p_hi = 'ff+' THEN 'ffffffff-ffff-ffff-ffff-ffffffffffff' ELSE rpad(p_hi, 8, '0') || '-0000-0000-0000-000000000000' END);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $f$;
