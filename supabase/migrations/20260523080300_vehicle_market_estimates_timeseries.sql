-- 20260523080300_vehicle_market_estimates_timeseries.sql
--
-- Vehicle market value as TIME SERIES, not stored scalar.
-- Per docs/library/reference/encyclopedia/05-image-as-butterfly-node.md (Vehicle value over time),
-- vehicles.estimated_value should be derived from this table — not directly written.
-- Each estimate carries: comparable count, condition factor (derived from photo cascade),
-- completion factor (derived from milestone evidence), methodology.
--
-- For Skylar's Mustang: this table will show the value compounding as restoration milestones land.
-- Apr 14 baseline ~$20K (driver-quality unrestored), May 21 ~$35K (resto-mod with stainless +
-- Kilmat + wiring in progress). Time series is the visible asset growth.

CREATE TABLE IF NOT EXISTS public.vehicle_market_estimates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id                  UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  estimated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  value_low                   NUMERIC(12,2),  -- 25th percentile of comparable range
  value_mid                   NUMERIC(12,2),  -- median
  value_high                  NUMERIC(12,2),  -- 75th percentile
  currency                    TEXT DEFAULT 'USD',
  methodology                 TEXT,           -- 'bat_comparables', 'hagerty_quote', 'manual_estimate', 'cascade_derived'
  comparable_count            INT DEFAULT 0,
  comparables_used            JSONB DEFAULT '[]'::jsonb,  -- [{vehicle_id, sale_price, sold_at, similarity_score}]
  condition_factor            NUMERIC(3,2),   -- 0.0..2.0 — multiplier derived from photo cascade vision-gate signals
  completion_factor           NUMERIC(3,2),   -- 0.0..1.0 — fraction of expected restoration milestones reached
  confidence                  TEXT CHECK (confidence IN ('zero_data', 'low', 'moderate', 'high')),
  source                      TEXT,
  derived_from_observations   UUID[],         -- array of vehicle_observation ids that fed this estimate
  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vme_vehicle ON public.vehicle_market_estimates(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vme_estimated_at ON public.vehicle_market_estimates(estimated_at DESC);
CREATE INDEX IF NOT EXISTS idx_vme_vehicle_at ON public.vehicle_market_estimates(vehicle_id, estimated_at DESC);

GRANT SELECT ON public.vehicle_market_estimates TO anon, authenticated;

-- Convenience function: latest estimate for a vehicle
CREATE OR REPLACE FUNCTION public.latest_market_estimate(p_vehicle_id UUID)
RETURNS public.vehicle_market_estimates
LANGUAGE sql STABLE AS $$
  SELECT * FROM public.vehicle_market_estimates
   WHERE vehicle_id = p_vehicle_id
   ORDER BY estimated_at DESC
   LIMIT 1;
$$;

-- Convenience function: value delta over period (for enablement_value computation in build-day.mjs)
CREATE OR REPLACE FUNCTION public.market_value_delta(
  p_vehicle_id UUID,
  p_from_date  DATE,
  p_to_date    DATE
) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_before NUMERIC;
  v_after  NUMERIC;
BEGIN
  SELECT value_mid INTO v_before
    FROM public.vehicle_market_estimates
   WHERE vehicle_id = p_vehicle_id AND estimated_at::date <= p_from_date
   ORDER BY estimated_at DESC LIMIT 1;

  SELECT value_mid INTO v_after
    FROM public.vehicle_market_estimates
   WHERE vehicle_id = p_vehicle_id AND estimated_at::date <= p_to_date
   ORDER BY estimated_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'from_date', p_from_date,
    'to_date', p_to_date,
    'value_before', COALESCE(v_before, 0),
    'value_after', COALESCE(v_after, 0),
    'delta', COALESCE(v_after, 0) - COALESCE(v_before, 0),
    'has_data', (v_before IS NOT NULL AND v_after IS NOT NULL)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.latest_market_estimate(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.market_value_delta(UUID, DATE, DATE) TO anon, authenticated;

COMMENT ON TABLE public.vehicle_market_estimates IS
'Time series of vehicle market value estimates. The vehicles.estimated_value scalar should be deprecated in favor of querying this. Each row carries comparable count, condition + completion factors (derived from photo cascade), methodology, and confidence. See encyclopedia chapter 05 "Vehicle value over time".';

COMMENT ON FUNCTION public.market_value_delta(UUID, DATE, DATE) IS
'Returns market value delta over a date range for a vehicle. Used by build-day.mjs to compute enablement_value (post_value - pre_value when a task closes a critical gap).';
