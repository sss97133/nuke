-- Fix: 063100 failed on deals_needing_terms (jsonb vs text mismatch)
-- RLS policies and user_deal_positions deployed; this adds the remaining functions

-- Gap detection: consigned permissions without structured deals
-- Fixed: permission_context is text, not jsonb
CREATE OR REPLACE FUNCTION deals_needing_terms()
RETURNS TABLE (
  vehicle_id uuid,
  user_id uuid,
  permission_role text,
  permission_context text,
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
GRANT EXECUTE ON FUNCTION deals_needing_terms TO authenticated;

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

DROP TRIGGER IF EXISTS trg_auto_consignment_deal ON vehicle_user_permissions;
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

DROP TRIGGER IF EXISTS trg_close_deal_on_sale ON auction_events;
CREATE TRIGGER trg_close_deal_on_sale
  AFTER INSERT OR UPDATE ON auction_events
  FOR EACH ROW
  EXECUTE FUNCTION close_deal_on_sale();
