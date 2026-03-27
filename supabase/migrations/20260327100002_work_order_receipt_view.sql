-- ============================================
-- WORK ORDER INTELLIGENCE: Receipt View + Balance Function
-- ============================================
-- Unified receipt view bridges the dual system:
--   work_orders (system 2: customer workflow) ←→ timeline_events (system 1: forensic accounting)
-- Both FK columns exist on parts/labor tables. This view queries via work_order_id.

-- ============================================
-- 1. Unified Receipt View
-- ============================================
CREATE OR REPLACE VIEW work_order_receipt_unified AS
SELECT
  wo.id AS work_order_id,
  wo.vehicle_id,
  wo.title AS work_order_title,
  wo.status AS work_order_status,
  wo.customer_name,
  wo.customer_email,
  wo.customer_phone,
  wo.created_at AS work_order_created,
  wo.notes,

  -- Parts totals
  COALESCE(parts.charged_total, 0) AS parts_total,
  COALESCE(parts.charged_count, 0) AS parts_count,
  COALESCE(parts.comped_value, 0) AS comped_parts_value,
  COALESCE(parts.comped_count, 0) AS comped_parts_count,

  -- Labor totals
  COALESCE(labor.charged_total, 0) AS labor_total,
  COALESCE(labor.charged_count, 0) AS labor_count,
  COALESCE(labor.charged_hours, 0) AS labor_hours,
  COALESCE(labor.comped_value, 0) AS comped_labor_value,
  COALESCE(labor.comped_count, 0) AS comped_labor_count,

  -- Payment totals
  COALESCE(payments.total_paid, 0) AS payments_total,
  COALESCE(payments.payment_count, 0) AS payment_count,

  -- Computed balance
  COALESCE(parts.charged_total, 0) + COALESCE(labor.charged_total, 0) AS invoice_total,
  COALESCE(parts.charged_total, 0) + COALESCE(labor.charged_total, 0)
    - COALESCE(payments.total_paid, 0) AS balance_due,

  -- Total comped value (goodwill tracking)
  COALESCE(parts.comped_value, 0) + COALESCE(labor.comped_value, 0) AS total_comped_value

FROM work_orders wo

LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN NOT COALESCE(is_comped, false) THEN COALESCE(unit_price * quantity, 0) ELSE 0 END) AS charged_total,
    COUNT(*) FILTER (WHERE NOT COALESCE(is_comped, false)) AS charged_count,
    SUM(CASE WHEN COALESCE(is_comped, false) THEN COALESCE(comp_retail_value, unit_price * quantity, 0) ELSE 0 END) AS comped_value,
    COUNT(*) FILTER (WHERE COALESCE(is_comped, false)) AS comped_count
  FROM work_order_parts wop
  WHERE wop.work_order_id = wo.id
) parts ON true

LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN NOT COALESCE(is_comped, false) THEN COALESCE(hours * hourly_rate, 0) ELSE 0 END) AS charged_total,
    COUNT(*) FILTER (WHERE NOT COALESCE(is_comped, false)) AS charged_count,
    SUM(CASE WHEN NOT COALESCE(is_comped, false) THEN COALESCE(hours, 0) ELSE 0 END) AS charged_hours,
    SUM(CASE WHEN COALESCE(is_comped, false) THEN COALESCE(comp_retail_value, hours * hourly_rate, 0) ELSE 0 END) AS comped_value,
    COUNT(*) FILTER (WHERE COALESCE(is_comped, false)) AS comped_count
  FROM work_order_labor wol
  WHERE wol.work_order_id = wo.id
) labor ON true

LEFT JOIN LATERAL (
  SELECT
    SUM(amount) AS total_paid,
    COUNT(*) AS payment_count
  FROM work_order_payments wop
  WHERE wop.work_order_id = wo.id
    AND wop.status = 'completed'
) payments ON true;

COMMENT ON VIEW work_order_receipt_unified IS 'Unified receipt: parts + labor + payments + balance per work order. Queries via work_order_id (system 2). Excludes comped items from invoice total, tracks comped value separately.';

GRANT SELECT ON work_order_receipt_unified TO anon, authenticated, service_role;

-- ============================================
-- 2. Balance Function (single work order)
-- ============================================
CREATE OR REPLACE FUNCTION work_order_balance(p_work_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'work_order_id', work_order_id,
    'work_order_title', work_order_title,
    'status', work_order_status,
    'parts_total', parts_total,
    'parts_count', parts_count,
    'labor_total', labor_total,
    'labor_count', labor_count,
    'labor_hours', labor_hours,
    'payments_total', payments_total,
    'payment_count', payment_count,
    'invoice_total', invoice_total,
    'balance_due', balance_due,
    'comped_parts_value', comped_parts_value,
    'comped_labor_value', comped_labor_value,
    'total_comped_value', total_comped_value
  )
  FROM work_order_receipt_unified
  WHERE work_order_id = p_work_order_id;
$$;

COMMENT ON FUNCTION work_order_balance IS 'Returns JSONB balance summary for a single work order. Uses work_order_receipt_unified view.';

GRANT EXECUTE ON FUNCTION work_order_balance TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
