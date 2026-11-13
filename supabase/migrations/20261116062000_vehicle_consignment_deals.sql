-- Personal consignment/partnership deals on vehicles
-- Grain: one deal per vehicle (a vehicle can have at most one active deal)
-- Episode: active → closed (sale completed) or cancelled
-- Source: owner input, substantiated by text thread or contract
-- Writer: owner decision required (creates financial position)
-- Reader: vehicle_profile_read.deal, get_user_garage position

-- The deal terms
CREATE TABLE vehicle_consignment_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),

  -- Type and terms
  deal_type text NOT NULL DEFAULT 'split' CHECK (deal_type IN ('split', 'flat_fee', 'commission')),
  threshold_amount numeric(12,2),        -- for split: profit starts above this
  threshold_currency text DEFAULT 'USD',

  -- Status
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'cancelled')),

  -- Evidence (texts are contracts)
  source text NOT NULL CHECK (source IN ('owner_input', 'text_thread', 'contract')),
  source_ref uuid,                       -- observation_id or document_id
  source_summary text,                   -- the terms as agreed, human-readable

  -- Clocks
  created_at timestamptz NOT NULL DEFAULT now(),
  effective_date date,                   -- when arrangement started
  closed_at timestamptz,                 -- when resolved

  -- Outcome (filled on close)
  sale_price numeric(12,2),
  sale_currency text DEFAULT 'USD',
  sale_observation_id uuid,              -- the sold event

  -- Owner decision
  created_by uuid NOT NULL REFERENCES auth.users(id),
  decided_at timestamptz,                -- NULL until owner confirms in app

  -- One active deal per vehicle
  CONSTRAINT one_active_deal_per_vehicle UNIQUE (vehicle_id) WHERE (status = 'active')
);

COMMENT ON TABLE vehicle_consignment_deals IS 'Personal consignment/partnership deals on vehicles. One active deal per vehicle. Terms define how sale proceeds are split.';
COMMENT ON COLUMN vehicle_consignment_deals.threshold_amount IS 'For split deals: profit sharing applies to amount above this threshold.';
COMMENT ON COLUMN vehicle_consignment_deals.source_summary IS 'Human-readable summary of terms as agreed (e.g., "split over 40k with owner and Ernie").';

-- Who gets what
CREATE TABLE vehicle_consignment_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES vehicle_consignment_deals(id) ON DELETE CASCADE,

  -- Party (one of these)
  user_id uuid REFERENCES auth.users(id),
  contact_name text,                     -- external party not in system

  -- Role
  role text NOT NULL CHECK (role IN ('owner', 'consigner', 'partner', 'investor')),

  -- Stake (interpretation depends on deal_type)
  -- split: split_pct of amount above threshold
  -- flat_fee: gets flat_amount regardless
  -- commission: gets commission_pct of total sale
  split_pct numeric(5,2) CHECK (split_pct >= 0 AND split_pct <= 100),
  flat_amount numeric(12,2),
  commission_pct numeric(5,2) CHECK (commission_pct >= 0 AND commission_pct <= 100),

  -- Outcome (filled on close)
  actual_take numeric(12,2),
  actual_currency text DEFAULT 'USD',

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT party_has_identity CHECK (
    (user_id IS NOT NULL)::int + (contact_name IS NOT NULL)::int = 1
  ),
  CONSTRAINT party_has_stake CHECK (
    split_pct IS NOT NULL OR flat_amount IS NOT NULL OR commission_pct IS NOT NULL
  )
);

COMMENT ON TABLE vehicle_consignment_parties IS 'Parties to a consignment deal and their stakes. Each party is either a user (user_id) or external contact (contact_name).';

-- Indexes
CREATE INDEX idx_vcd_vehicle ON vehicle_consignment_deals(vehicle_id);
CREATE INDEX idx_vcd_user ON vehicle_consignment_deals(created_by);
CREATE INDEX idx_vcp_deal ON vehicle_consignment_parties(deal_id);
CREATE INDEX idx_vcp_user ON vehicle_consignment_parties(user_id) WHERE user_id IS NOT NULL;

-- RLS
ALTER TABLE vehicle_consignment_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_consignment_parties ENABLE ROW LEVEL SECURITY;

-- Deals: owner or party can read; owner can write
CREATE POLICY deal_select ON vehicle_consignment_deals FOR SELECT USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM vehicle_consignment_parties p WHERE p.deal_id = id AND p.user_id = auth.uid())
);

CREATE POLICY deal_insert ON vehicle_consignment_deals FOR INSERT WITH CHECK (
  created_by = auth.uid()
);

CREATE POLICY deal_update ON vehicle_consignment_deals FOR UPDATE USING (
  created_by = auth.uid()
) WITH CHECK (
  created_by = auth.uid()
);

-- Parties: follow deal visibility
CREATE POLICY party_select ON vehicle_consignment_parties FOR SELECT USING (
  EXISTS (SELECT 1 FROM vehicle_consignment_deals d WHERE d.id = deal_id AND (
    d.created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM vehicle_consignment_parties p2 WHERE p2.deal_id = d.id AND p2.user_id = auth.uid())
  ))
);

CREATE POLICY party_insert ON vehicle_consignment_parties FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM vehicle_consignment_deals d WHERE d.id = deal_id AND d.created_by = auth.uid())
);

CREATE POLICY party_update ON vehicle_consignment_parties FOR UPDATE USING (
  EXISTS (SELECT 1 FROM vehicle_consignment_deals d WHERE d.id = deal_id AND d.created_by = auth.uid())
);

-- Service role bypass
CREATE POLICY deal_service ON vehicle_consignment_deals FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY party_service ON vehicle_consignment_parties FOR ALL USING (auth.role() = 'service_role');

-- Reader: compute a user's position on a vehicle
CREATE OR REPLACE FUNCTION vehicle_deal_position(p_vehicle_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '5s'
AS $$
  SELECT jsonb_build_object(
    'deal_id', d.id,
    'deal_type', d.deal_type,
    'status', d.status,
    'threshold', d.threshold_amount,
    'currency', d.threshold_currency,
    'your_role', p.role,
    'your_stake', CASE d.deal_type
      WHEN 'split' THEN jsonb_build_object('split_pct', p.split_pct, 'of_amount_above', d.threshold_amount)
      WHEN 'flat_fee' THEN jsonb_build_object('flat_amount', p.flat_amount)
      WHEN 'commission' THEN jsonb_build_object('commission_pct', p.commission_pct)
    END,
    'parties', (
      SELECT jsonb_agg(jsonb_build_object(
        'role', p2.role,
        'name', COALESCE((SELECT display_name FROM profiles WHERE id = p2.user_id), p2.contact_name),
        'is_you', p2.user_id = p_user_id,
        'split_pct', p2.split_pct,
        'flat_amount', p2.flat_amount
      ) ORDER BY CASE p2.role WHEN 'owner' THEN 1 WHEN 'consigner' THEN 2 ELSE 3 END)
      FROM vehicle_consignment_parties p2 WHERE p2.deal_id = d.id
    ),
    'outcome', CASE WHEN d.status = 'closed' THEN jsonb_build_object(
      'sale_price', d.sale_price,
      'your_take', p.actual_take,
      'closed_at', d.closed_at
    ) END
  )
  FROM vehicle_consignment_deals d
  JOIN vehicle_consignment_parties p ON p.deal_id = d.id AND p.user_id = p_user_id
  WHERE d.vehicle_id = p_vehicle_id AND d.status = 'active';
$$;

COMMENT ON FUNCTION vehicle_deal_position IS 'Returns the calling user''s position in a vehicle''s active deal: role, stake, parties, outcome if closed.';

-- Compute expected take from current market estimate
CREATE OR REPLACE FUNCTION vehicle_deal_expected_take(p_vehicle_id uuid, p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '5s'
AS $$
  WITH estimate AS (
    SELECT ne.estimated_value, ne.low_estimate, ne.high_estimate, ne.calculated_at
    FROM nuke_estimates ne
    WHERE ne.vehicle_id = p_vehicle_id AND ne.comp_method = 'class_stratified'
    ORDER BY ne.calculated_at DESC NULLS LAST LIMIT 1
  ),
  deal AS (
    SELECT d.*, p.split_pct, p.flat_amount, p.commission_pct, p.role
    FROM vehicle_consignment_deals d
    JOIN vehicle_consignment_parties p ON p.deal_id = d.id AND p.user_id = p_user_id
    WHERE d.vehicle_id = p_vehicle_id AND d.status = 'active'
  )
  SELECT jsonb_build_object(
    'has_deal', deal.id IS NOT NULL,
    'your_role', deal.role,
    'estimate', jsonb_build_object(
      'value', estimate.estimated_value,
      'low', estimate.low_estimate,
      'high', estimate.high_estimate,
      'as_of', estimate.calculated_at
    ),
    'threshold', deal.threshold_amount,
    'expected_take', CASE deal.deal_type
      WHEN 'split' THEN jsonb_build_object(
        'low', GREATEST(0, (estimate.low_estimate - deal.threshold_amount) * deal.split_pct / 100),
        'mid', GREATEST(0, (estimate.estimated_value - deal.threshold_amount) * deal.split_pct / 100),
        'high', GREATEST(0, (estimate.high_estimate - deal.threshold_amount) * deal.split_pct / 100),
        'basis', 'split_pct of amount above threshold'
      )
      WHEN 'flat_fee' THEN jsonb_build_object(
        'low', deal.flat_amount,
        'mid', deal.flat_amount,
        'high', deal.flat_amount,
        'basis', 'flat_amount'
      )
      WHEN 'commission' THEN jsonb_build_object(
        'low', estimate.low_estimate * deal.commission_pct / 100,
        'mid', estimate.estimated_value * deal.commission_pct / 100,
        'high', estimate.high_estimate * deal.commission_pct / 100,
        'basis', 'commission_pct of sale'
      )
    END
  )
  FROM estimate, deal;
$$;

COMMENT ON FUNCTION vehicle_deal_expected_take IS 'Computes expected take for a user''s deal position based on current market estimate. Returns low/mid/high based on estimate range.';

-- Grant anon read on the position function (for public profile view of own position)
GRANT EXECUTE ON FUNCTION vehicle_deal_position TO authenticated;
GRANT EXECUTE ON FUNCTION vehicle_deal_expected_take TO authenticated;
