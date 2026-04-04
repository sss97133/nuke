-- Admin CRUD on work_order_parts, work_order_labor, work_order_payments
-- Allows admin users (in admin_users table) full INSERT/UPDATE/DELETE
-- Also fixes resolve_work_order_status() to include row IDs for frontend editing

-- ────────────────────────────────────────────────────
-- 1. Admin policies for work_order_parts
-- ────────────────────────────────────────────────────

CREATE POLICY "Admin full access work_order_parts"
  ON work_order_parts
  FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active));

-- Allow admin DELETE (the ALL policy above covers it, but explicit for clarity)
-- Also allow authenticated users to delete their own rows
CREATE POLICY "Users can delete own parts"
  ON work_order_parts
  FOR DELETE
  USING ((SELECT auth.uid()) = added_by);

-- ────────────────────────────────────────────────────
-- 2. Admin policies for work_order_labor
-- ────────────────────────────────────────────────────

CREATE POLICY "Admin full access work_order_labor"
  ON work_order_labor
  FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active));

CREATE POLICY "Users can delete own labor"
  ON work_order_labor
  FOR DELETE
  USING ((SELECT auth.uid()) = added_by);

-- ────────────────────────────────────────────────────
-- 3. Admin policies for work_order_payments
-- ────────────────────────────────────────────────────

CREATE POLICY "Admin full access work_order_payments"
  ON work_order_payments
  FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active));

-- ────────────────────────────────────────────────────
-- 4. Fix resolve_work_order_status() to include row IDs
-- ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_work_order_status(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vehicle_id UUID;
  v_vehicle JSONB;
  v_contact JSONB;
  v_wo RECORD;
  v_wo_array JSONB := '[]'::jsonb;
  v_total_parts NUMERIC := 0;
  v_total_labor NUMERIC := 0;
  v_total_payments NUMERIC := 0;
  v_total_comped NUMERIC := 0;
  v_query TEXT := lower(trim(p_query));
BEGIN
  -- STEP 1: Resolve query → vehicle_id
  SELECT DISTINCT wo.vehicle_id INTO v_vehicle_id
  FROM work_orders wo WHERE lower(wo.customer_name) LIKE '%' || v_query || '%' AND wo.vehicle_id IS NOT NULL LIMIT 1;

  IF v_vehicle_id IS NULL THEN
    SELECT DISTINCT wo.vehicle_id INTO v_vehicle_id
    FROM deal_contacts dc JOIN work_orders wo ON wo.vehicle_id IN (SELECT v.id FROM vehicles v JOIN deal_contacts dc2 ON dc2.id = dc.id)
    WHERE lower(dc.full_name) LIKE '%' || v_query || '%' OR lower(dc.last_name) LIKE '%' || v_query || '%' OR lower(dc.email) LIKE '%' || v_query || '%'
    LIMIT 1;
  END IF;

  IF v_vehicle_id IS NULL THEN
    SELECT DISTINCT wo.vehicle_id INTO v_vehicle_id
    FROM work_orders wo WHERE (lower(wo.title) LIKE '%' || v_query || '%' OR lower(wo.description) LIKE '%' || v_query || '%' OR lower(wo.notes) LIKE '%' || v_query || '%') AND wo.vehicle_id IS NOT NULL LIMIT 1;
  END IF;

  IF v_vehicle_id IS NULL THEN
    SELECT v.id INTO v_vehicle_id FROM vehicles v WHERE lower(v.make || ' ' || v.model) LIKE '%' || v_query || '%' OR lower(v.vin) LIKE '%' || v_query || '%' LIMIT 1;
  END IF;

  -- Also try vehicle_id directly
  IF v_vehicle_id IS NULL THEN
    BEGIN
      v_vehicle_id := p_query::UUID;
      PERFORM 1 FROM vehicles WHERE id = v_vehicle_id;
      IF NOT FOUND THEN v_vehicle_id := NULL; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_vehicle_id := NULL;
    END;
  END IF;

  IF v_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_match', 'message', format('No vehicle or work order found matching "%s"', p_query), 'query', p_query);
  END IF;

  -- STEP 2: Vehicle
  SELECT jsonb_build_object('id', v.id, 'year', v.year, 'make', v.make, 'model', v.model, 'vin', v.vin, 'sale_price', v.sale_price) INTO v_vehicle FROM vehicles v WHERE v.id = v_vehicle_id;

  -- STEP 3: Contact
  SELECT jsonb_build_object('name', wo.customer_name, 'email', wo.customer_email, 'phone', wo.customer_phone) INTO v_contact FROM work_orders wo WHERE wo.vehicle_id = v_vehicle_id AND wo.customer_name IS NOT NULL LIMIT 1;

  IF v_contact IS NULL OR v_contact->>'name' IS NULL THEN
    SELECT jsonb_build_object('name', dc.full_name, 'email', dc.email, 'phone', COALESCE(dc.phone_mobile, dc.phone_home, dc.phone_work)) INTO v_contact FROM deal_contacts dc WHERE lower(dc.full_name) LIKE '%' || v_query || '%' OR lower(dc.last_name) LIKE '%' || v_query || '%' LIMIT 1;
  END IF;

  -- STEP 4: Work orders with row IDs included
  FOR v_wo IN SELECT wo.id, wo.title, wo.status, wo.created_at, wo.notes FROM work_orders wo WHERE wo.vehicle_id = v_vehicle_id ORDER BY wo.created_at
  LOOP
    DECLARE
      v_parts JSONB;
      v_labor JSONB;
      v_payments JSONB;
      v_wo_parts_total NUMERIC;
      v_wo_labor_total NUMERIC;
      v_wo_payments_total NUMERIC;
      v_wo_comped NUMERIC;
    BEGIN
      -- Parts: now includes 'id' for each row
      SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', wop.id,
          'name', wop.part_name,
          'number', wop.part_number,
          'price', wop.total_price,
          'unit_price', wop.unit_price,
          'quantity', wop.quantity,
          'supplier', wop.supplier,
          'status', wop.status,
          'is_comped', COALESCE(wop.is_comped, false),
          'comp_reason', wop.comp_reason,
          'comp_retail_value', COALESCE(wop.comp_retail_value, wop.unit_price * wop.quantity)
        ) ORDER BY wop.created_at), '[]'::jsonb),
        COALESCE(SUM(CASE WHEN NOT COALESCE(wop.is_comped, false) THEN wop.total_price ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN COALESCE(wop.is_comped, false) THEN COALESCE(wop.comp_retail_value, wop.unit_price * wop.quantity) ELSE 0 END), 0)
      INTO v_parts, v_wo_parts_total, v_wo_comped
      FROM work_order_parts wop
      WHERE wop.work_order_id = v_wo.id AND COALESCE(wop.status, '') != 'cancelled';

      -- Labor: now includes 'id' for each row
      SELECT
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', wol.id,
          'task', wol.task_name,
          'hours', wol.hours,
          'rate', wol.hourly_rate,
          'total', wol.total_cost,
          'rate_source', wol.rate_source,
          'is_comped', COALESCE(wol.is_comped, false),
          'comp_reason', wol.comp_reason,
          'comp_retail_value', COALESCE(wol.comp_retail_value, wol.total_cost)
        ) ORDER BY wol.created_at), '[]'::jsonb),
        COALESCE(SUM(CASE WHEN NOT COALESCE(wol.is_comped, false) THEN wol.total_cost ELSE 0 END), 0)
      INTO v_labor, v_wo_labor_total
      FROM work_order_labor wol WHERE wol.work_order_id = v_wo.id;

      -- Comped labor value
      v_wo_comped := v_wo_comped + COALESCE((
        SELECT SUM(COALESCE(comp_retail_value, total_cost))
        FROM work_order_labor WHERE work_order_id = v_wo.id AND COALESCE(is_comped, false)
      ), 0);

      -- Payments: now includes 'id' for each row
      SELECT
        COALESCE(jsonb_agg(jsonb_build_object('id', wop.id, 'amount', wop.amount, 'method', wop.payment_method, 'memo', wop.memo, 'date', wop.payment_date, 'sender', wop.sender_name) ORDER BY wop.payment_date), '[]'::jsonb),
        COALESCE(SUM(wop.amount), 0)
      INTO v_payments, v_wo_payments_total
      FROM work_order_payments wop WHERE wop.work_order_id = v_wo.id AND wop.status = 'completed';

      v_total_parts := v_total_parts + v_wo_parts_total;
      v_total_labor := v_total_labor + v_wo_labor_total;
      v_total_payments := v_total_payments + v_wo_payments_total;
      v_total_comped := v_total_comped + v_wo_comped;

      v_wo_array := v_wo_array || jsonb_build_object(
        'id', v_wo.id, 'title', v_wo.title, 'status', v_wo.status, 'created_at', v_wo.created_at, 'notes', v_wo.notes,
        'parts', v_parts, 'labor', v_labor, 'payments', v_payments,
        'parts_total', v_wo_parts_total, 'labor_total', v_wo_labor_total,
        'payments_total', v_wo_payments_total, 'comped_value', v_wo_comped,
        'balance_due', v_wo_parts_total + v_wo_labor_total - v_wo_payments_total
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'vehicle', v_vehicle, 'contact', v_contact, 'work_orders', v_wo_array,
    'summary', jsonb_build_object(
      'total_parts', v_total_parts, 'total_labor', v_total_labor,
      'total_invoice', v_total_parts + v_total_labor, 'total_payments', v_total_payments,
      'balance_due', v_total_parts + v_total_labor - v_total_payments,
      'total_comped', v_total_comped, 'work_order_count', jsonb_array_length(v_wo_array)
    ),
    'query', p_query, 'resolved_at', now()
  );
END;
$$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
