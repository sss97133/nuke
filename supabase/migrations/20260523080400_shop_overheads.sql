-- 20260523080400_shop_overheads.sql
--
-- Shop overhead line items — the substrate for the `overhead_floor` term in the
-- multi-factor pricing equation (see docs/library/working/working-papers/2026-05-23_worth-proving-engine-retrospective.md).
--
-- overhead_floor = sum(monthly_cost across overhead line items) / shop_billable_hours_per_month
--
-- This is what Skylar's $85/hr decomposes against:
--   $15/hr equipment recovery (from equipment depreciation ledger)
--   $20/hr other overhead (from THIS table — rent, insurance, license, utilities)
--   $50/hr remaining labor compensation
--
-- Without this table, the system cannot answer "is your $85/hr competitive given your cost basis?"
-- because the cost basis is unknown.

CREATE TABLE IF NOT EXISTS public.shop_overheads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID NOT NULL,  -- references organizations(id) but no FK to avoid coupling
  line_item                   TEXT NOT NULL,  -- 'rent', 'insurance_liability', 'insurance_garage_keepers', 'business_license', 'utilities_electric', 'utilities_water', 'internet', 'phone', 'waste_disposal', 'cleaning', 'security_system', ...
  category                    TEXT,           -- 'fixed', 'variable', 'one_time', 'semi_variable'
  monthly_cost                NUMERIC(10,2),
  annual_cost                 NUMERIC(10,2),
  effective_from              DATE,
  effective_to                DATE,           -- nullable = still current
  vendor                      TEXT,
  source_doc_url              TEXT,           -- link to invoice, lease, license PDF
  payment_frequency           TEXT,           -- 'monthly', 'annual', 'quarterly', 'one_time'
  notes                       TEXT,
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_overheads_shop ON public.shop_overheads(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_overheads_category ON public.shop_overheads(category);
CREATE INDEX IF NOT EXISTS idx_shop_overheads_active ON public.shop_overheads(shop_id) WHERE effective_to IS NULL;

-- Function: current monthly overhead for a shop
CREATE OR REPLACE FUNCTION public.shop_current_monthly_overhead(p_shop_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(monthly_cost), 0)
    FROM public.shop_overheads
   WHERE shop_id = p_shop_id
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     AND (effective_from IS NULL OR effective_from <= CURRENT_DATE);
$$;

-- Function: derived hourly overhead recovery, given a billable_hours_per_month figure
CREATE OR REPLACE FUNCTION public.shop_overhead_floor_per_hour(
  p_shop_id UUID,
  p_billable_hours_per_month NUMERIC DEFAULT 160  -- default: 40hr/week × 4 weeks
) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_billable_hours_per_month, 0) > 0
    THEN public.shop_current_monthly_overhead(p_shop_id) / p_billable_hours_per_month
    ELSE NULL
  END;
$$;

GRANT SELECT ON public.shop_overheads TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_current_monthly_overhead(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_overhead_floor_per_hour(UUID, NUMERIC) TO anon, authenticated;

COMMENT ON TABLE public.shop_overheads IS
'Per-shop overhead line items. The aggregate (current_monthly_overhead) divided by billable_hours_per_month gives overhead_floor — the per-hour cost the shop MUST recover before any labor compensation. See working paper 2026-05-23 section "Hourly rate is a 2D price surface".';

COMMENT ON FUNCTION public.shop_overhead_floor_per_hour(UUID, NUMERIC) IS
'Returns $/hour the shop must recover to cover overhead. Used as the overhead_floor term in compute_inferred_value() and in build-day.mjs.';
