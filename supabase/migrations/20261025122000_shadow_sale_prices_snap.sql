-- Point-in-time materialization of shadow_sale_prices (built in chunks under a run id) so comp lookups are index scans.
CREATE TABLE IF NOT EXISTS public.shadow_sale_prices_snap (
  auction_event_id uuid PRIMARY KEY, vehicle_id uuid, make_l text, model_l text, year int, platform text, sold_at timestamptz,
  currency_code text, price_basis text, hammer_price numeric, gross_price numeric, net_to_owner numeric, run_id uuid NOT NULL);
CREATE INDEX IF NOT EXISTS shadow_sale_prices_snap_mmy ON public.shadow_sale_prices_snap (make_l, model_l, year);
ALTER TABLE public.shadow_sale_prices_snap ENABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS public.shadow_sale_prices_snap_chunk(int, int, uuid);
DROP FUNCTION IF EXISTS public.shadow_sale_prices_snap_chunk(int, uuid);
-- Chunk = auction_events id range [p_lo, p_hi) (hex prefixes, e.g. '00','04'); dynamic SQL so the pk range index is used.
CREATE OR REPLACE FUNCTION public.shadow_sale_prices_snap_chunk(p_lo text, p_hi text, p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $f$
DECLARE n int;
BEGIN
  EXECUTE format($q$
    INSERT INTO shadow_sale_prices_snap
    SELECT sp.auction_event_id, sp.vehicle_id, lower(v.make), lower(v.model), v.year, sp.platform, sp.sold_at, sp.currency_code,
           sp.price_basis, sp.hammer_price, sp.gross_price, sp.net_to_owner, %L::uuid
    FROM shadow_sale_prices sp JOIN vehicles v ON v.id = sp.vehicle_id
    WHERE sp.auction_event_id >= %L::uuid AND (%L = 'ff+' OR sp.auction_event_id < %L::uuid)
    ON CONFLICT (auction_event_id) DO NOTHING$q$,
    p_run_id, rpad(p_lo, 8, '0') || '-0000-0000-0000-000000000000', p_hi,
    CASE WHEN p_hi = 'ff+' THEN 'ffffffff-ffff-ffff-ffff-ffffffffffff' ELSE rpad(p_hi, 8, '0') || '-0000-0000-0000-000000000000' END);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $f$;
