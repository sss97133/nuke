-- Fix: 062500 failed on RLS policy (organization_members doesn't exist)
-- The table and indexes were created; this adds the missing RLS and functions

-- RLS policies with correct org membership tables
CREATE POLICY djp_select ON deal_jacket_parties FOR SELECT USING (
  EXISTS (SELECT 1 FROM deal_jackets dj WHERE dj.id = deal_jacket_id AND (
    dj.created_by = auth.uid()
    OR dj.organization_id IN (
      SELECT organization_id FROM organization_contributors WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'employee')
      UNION
      SELECT business_entity_id FROM business_team_members WHERE user_id = auth.uid() AND is_active = true
    )
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
  IF NEW.outcome IS DISTINCT FROM 'sold' THEN RETURN NEW; END IF;

  v_sale_price := COALESCE(NEW.sale_price, NEW.high_bid);
  IF v_sale_price IS NULL OR v_sale_price <= 0 THEN RETURN NEW; END IF;

  FOR v_deal IN
    SELECT dj.id, dj.vehicle_id
    FROM deal_jackets dj
    WHERE dj.vehicle_id = NEW.vehicle_id
      AND dj.deal_type = 'consignment'
      AND dj.sold_date IS NULL
  LOOP
    UPDATE deal_jackets SET
      sold_date = COALESCE(NEW.event_date, CURRENT_DATE),
      sale_price_inc_doc = v_sale_price,
      updated_at = now()
    WHERE id = v_deal.id;

    SELECT COALESCE(threshold_amount, 0) INTO v_threshold
    FROM deal_jacket_parties
    WHERE deal_jacket_id = v_deal.id AND role = 'owner'
    LIMIT 1;

    v_profit := GREATEST(0, v_sale_price - v_threshold);

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
