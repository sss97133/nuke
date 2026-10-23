-- SHADOW only. One price basis: hammer (net-to-seller before seller fees). Comps from premium-inclusive
-- platforms are divided down; comps whose basis is unknown (vehicle_record rows, unlisted platforms) are dropped,
-- so no comp set mixes bases. Gross (buyer-paid) is derived from hammer with the target platform's fee schedule.
CREATE TABLE IF NOT EXISTS public.shadow_price_basis_factors (
  platform text PRIMARY KEY, reported_basis text NOT NULL, hammer_divisor numeric NOT NULL, basis_note text NOT NULL);
ALTER TABLE public.shadow_price_basis_factors ENABLE ROW LEVEL SECURITY;
INSERT INTO public.shadow_price_basis_factors VALUES
 ('bat','hammer',1.00,'BaT reports hammer; buyer fee on top'),
 ('cars_and_bids','hammer',1.00,'C&B reports hammer'),
 ('pcarmarket','hammer',1.00,'PCarMarket reports hammer'),
 ('bonhams','hammer',1.00,'normalized to hammer by bonhams-premium-norm runs'),
 ('mecum','hammer_plus_premium',1.10,'Skylar 2026-10-23: Mecum / 1.10'),
 ('barrett-jackson','hammer_plus_premium',1.10,'Skylar 2026-10-23: Barrett-Jackson / 1.10'),
 ('broad-arrow','hammer_plus_premium',1.12,'Skylar 2026-10-23: Broad Arrow / 1.12')
ON CONFLICT (platform) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.shadow_comp_base (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE, as_of timestamptz NOT NULL,
  basis text NOT NULL DEFAULT 'hammer', base_hammer numeric, n_comps int, platforms jsonb, run_id uuid NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (vehicle_id, as_of));
ALTER TABLE public.shadow_comp_base ENABLE ROW LEVEL SECURITY;

-- Point-in-time: only comps sold strictly before as_of, never the vehicle itself; median of hammer-basis prices.
-- Comp set: same make, same model (or same normalized_model), year +/-3, USD, sold auction_events on a basis-known platform.
CREATE OR REPLACE FUNCTION public.compute_shadow_comp_base(p_vehicle_ids uuid[], p_as_of timestamptz[], p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SET statement_timeout = '120s' SET search_path = public AS $fn$
DECLARE n int;
BEGIN
  IF array_length(p_vehicle_ids,1) > 100 THEN RAISE EXCEPTION 'max 100 per call'; END IF;
  INSERT INTO shadow_comp_base AS s (vehicle_id, as_of, base_hammer, n_comps, platforms, run_id)
  SELECT x.vid, x.asof, c.med, c.n, c.pl, p_run_id
  FROM unnest(p_vehicle_ids, p_as_of) x(vid, asof)
  JOIN vehicles v ON v.id = x.vid
  CROSS JOIN LATERAL (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) med, count(*)::int n,
           to_jsonb(array_agg(DISTINCT platform)) pl
    FROM (SELECT DISTINCT ON (sp.auction_event_id) sp.platform, sp.hammer_price h
          FROM shadow_sale_prices_snap sp
          WHERE sp.make_l = lower(v.make) AND sp.model_l = lower(v.model) AND sp.year BETWEEN v.year - 3 AND v.year + 3
            AND sp.vehicle_id <> v.id AND sp.sold_at < x.asof AND sp.currency_code = 'USD' AND sp.price_basis = 'hammer'
          ORDER BY sp.auction_event_id) cs) c
  ON CONFLICT (vehicle_id, as_of) DO UPDATE SET base_hammer=excluded.base_hammer, n_comps=excluded.n_comps,
    platforms=excluded.platforms, run_id=excluded.run_id, computed_at=now();
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $fn$;
