-- Extend deal_jackets with structured multi-party economics
-- Currently the split lives in notes as prose; this structures it

CREATE TABLE deal_jacket_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_jacket_id uuid NOT NULL REFERENCES deal_jackets(id) ON DELETE CASCADE,

  -- Party identity (one of these)
  user_id uuid REFERENCES auth.users(id),
  organization_id uuid REFERENCES organizations(id),
  contact_id uuid REFERENCES deal_contacts(id),
  party_name text,  -- external party not in system

  -- Role in this deal
  role text NOT NULL CHECK (role IN (
    'owner',           -- vehicle owner, gets base/threshold amount
    'consigner',       -- building/selling for owner, gets split
    'partner',         -- co-investor in the deal
    'broker',          -- finding buyers, commission
    'investor',        -- money in, share of proceeds
    'seller'           -- the entity selling (may be org)
  )),

  -- Economics (interpretation depends on deal_jackets.deal_type)
  -- consignment: split_pct of profit above threshold; owner gets threshold
  -- sale: seller gets all; split_pct divides among partners
  -- buy-sell: initial_cost to buyer; profit split among partners
  threshold_amount numeric(12,2),  -- for owner: gets this before split kicks in
  split_pct numeric(5,2) CHECK (split_pct >= 0 AND split_pct <= 100),
  flat_fee numeric(12,2),          -- fixed amount regardless of sale price
  commission_pct numeric(5,2) CHECK (commission_pct >= 0 AND commission_pct <= 100),

  -- Outcome (filled when deal closes)
  actual_amount numeric(12,2),
  actual_currency text DEFAULT 'USD',
  paid_at timestamptz,
  payment_ref text,  -- check number, transfer id, etc.

  -- Source
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),

  CONSTRAINT party_has_identity CHECK (
    (user_id IS NOT NULL)::int +
    (organization_id IS NOT NULL)::int +
    (contact_id IS NOT NULL)::int +
    (party_name IS NOT NULL)::int = 1
  )
);

COMMENT ON TABLE deal_jacket_parties IS 'Structured multi-party economics for deal_jackets. Replaces prose in notes field with queryable stakes.';

CREATE INDEX idx_djp_deal ON deal_jacket_parties(deal_jacket_id);
CREATE INDEX idx_djp_user ON deal_jacket_parties(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_djp_org ON deal_jacket_parties(organization_id) WHERE organization_id IS NOT NULL;

-- RLS: follow deal_jackets visibility
ALTER TABLE deal_jacket_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY djp_select ON deal_jacket_parties FOR SELECT USING (
  EXISTS (SELECT 1 FROM deal_jackets dj WHERE dj.id = deal_jacket_id AND (
    dj.created_by = auth.uid()
    OR dj.organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
    OR auth.role() = 'service_role'
  ))
);

CREATE POLICY djp_insert ON deal_jacket_parties FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM deal_jackets dj WHERE dj.id = deal_jacket_id AND (
    dj.created_by = auth.uid() OR auth.role() = 'service_role'
  ))
);

CREATE POLICY djp_update ON deal_jacket_parties FOR UPDATE USING (
  EXISTS (SELECT 1 FROM deal_jackets dj WHERE dj.id = deal_jacket_id AND (
    dj.created_by = auth.uid() OR auth.role() = 'service_role'
  ))
);

CREATE POLICY djp_service ON deal_jacket_parties FOR ALL USING (auth.role() = 'service_role');

-- Reader: get a user's position across all their deals
CREATE OR REPLACE FUNCTION user_deal_positions(p_user_id uuid DEFAULT auth.uid())
RETURNS TABLE (
  deal_jacket_id uuid,
  vehicle_id uuid,
  deal_type text,
  your_role text,
  threshold_amount numeric,
  split_pct numeric,
  expected_take numeric,
  actual_amount numeric,
  deal_status text,
  sale_price numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '10s'
AS $$
  SELECT
    dj.id,
    dj.vehicle_id,
    dj.deal_type,
    p.role,
    p.threshold_amount,
    p.split_pct,
    CASE
      WHEN dj.sale_price_inc_doc IS NOT NULL AND p.split_pct IS NOT NULL THEN
        GREATEST(0, (dj.sale_price_inc_doc - COALESCE(p.threshold_amount, 0)) * p.split_pct / 100)
      WHEN p.flat_fee IS NOT NULL THEN p.flat_fee
      ELSE NULL
    END as expected_take,
    p.actual_amount,
    CASE
      WHEN dj.sold_date IS NOT NULL THEN 'closed'
      ELSE 'active'
    END,
    dj.sale_price_inc_doc
  FROM deal_jacket_parties p
  JOIN deal_jackets dj ON dj.id = p.deal_jacket_id
  WHERE p.user_id = p_user_id
  ORDER BY dj.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION user_deal_positions TO authenticated;

-- Gap detection: consigned permissions without structured deals
CREATE OR REPLACE FUNCTION deals_needing_terms()
RETURNS TABLE (
  vehicle_id uuid,
  user_id uuid,
  permission_role text,
  permission_context jsonb,
  deal_jacket_id uuid,
  has_parties boolean,
  gap text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET statement_timeout = '10s'
AS $$
  -- Consigned permissions that need deal terms
  SELECT
    vup.vehicle_id,
    vup.user_id,
    vup.role,
    vup.context,
    dj.id,
    EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id),
    CASE
      WHEN dj.id IS NULL THEN 'no_deal_jacket'
      WHEN NOT EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id) THEN 'no_structured_parties'
      ELSE 'complete'
    END
  FROM vehicle_user_permissions vup
  LEFT JOIN deal_jackets dj ON dj.vehicle_id = vup.vehicle_id
    AND dj.deal_type = 'consignment'
    AND dj.sold_date IS NULL
  WHERE vup.role = 'consigned'
    AND vup.revoked_at IS NULL
    AND COALESCE(vup.is_active, true)
    AND (dj.id IS NULL OR NOT EXISTS (SELECT 1 FROM deal_jacket_parties p WHERE p.deal_jacket_id = dj.id))
  ORDER BY vup.created_at DESC;
$$;

COMMENT ON FUNCTION deals_needing_terms IS 'Returns consigned vehicles missing deal structure - either no deal_jacket or no parties. Used to prompt users for terms.';

-- Auto-create deal jacket when consigned permission is set
CREATE OR REPLACE FUNCTION auto_create_consignment_deal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NEW.role = 'consigned' AND NEW.revoked_at IS NULL AND COALESCE(NEW.is_active, true) THEN
    -- Create deal jacket if none exists for this vehicle
    INSERT INTO deal_jackets (vehicle_id, deal_type, notes, created_by, organization_id)
    SELECT
      NEW.vehicle_id,
      'consignment',
      'Auto-created from consigned permission. Terms pending.',
      NEW.user_id,
      NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM deal_jackets
      WHERE vehicle_id = NEW.vehicle_id
        AND deal_type = 'consignment'
        AND sold_date IS NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_consignment_deal
  AFTER INSERT OR UPDATE ON vehicle_user_permissions
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_consignment_deal();

-- Close deal and compute actual takes when vehicle sells
CREATE OR REPLACE FUNCTION close_deal_on_sale()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_deal record;
  v_sale_price numeric;
  v_threshold numeric;
  v_profit numeric;
BEGIN
  -- Only on sold events
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN RETURN NEW; END IF;

  v_sale_price := COALESCE(NEW.sale_price, NEW.high_bid);
  IF v_sale_price IS NULL OR v_sale_price <= 0 THEN RETURN NEW; END IF;

  -- Find active consignment deal for this vehicle
  FOR v_deal IN
    SELECT dj.id, dj.vehicle_id
    FROM deal_jackets dj
    WHERE dj.vehicle_id = NEW.vehicle_id
      AND dj.deal_type = 'consignment'
      AND dj.sold_date IS NULL
  LOOP
    -- Update the deal jacket with sale info
    UPDATE deal_jackets SET
      sold_date = COALESCE(NEW.event_date, CURRENT_DATE),
      sale_price_inc_doc = v_sale_price,
      updated_at = now()
    WHERE id = v_deal.id;

    -- Get owner's threshold
    SELECT COALESCE(threshold_amount, 0) INTO v_threshold
    FROM deal_jacket_parties
    WHERE deal_jacket_id = v_deal.id AND role = 'owner'
    LIMIT 1;

    v_profit := GREATEST(0, v_sale_price - v_threshold);

    -- Compute actual amounts for each party
    UPDATE deal_jacket_parties SET
      actual_amount = CASE
        WHEN role = 'owner' THEN LEAST(v_sale_price, COALESCE(threshold_amount, 0))
        WHEN split_pct IS NOT NULL THEN v_profit * split_pct / 100
        WHEN flat_fee IS NOT NULL THEN flat_fee
        WHEN commission_pct IS NOT NULL THEN v_sale_price * commission_pct / 100
        ELSE NULL
      END,
      actual_currency = 'USD'
    WHERE deal_jacket_id = v_deal.id;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_close_deal_on_sale
  AFTER INSERT OR UPDATE ON auction_events
  FOR EACH ROW
  EXECUTE FUNCTION close_deal_on_sale();

GRANT EXECUTE ON FUNCTION deals_needing_terms TO authenticated;
