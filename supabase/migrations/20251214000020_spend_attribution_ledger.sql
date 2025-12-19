-- =====================================================
-- SPEND ATTRIBUTION LEDGER (ROOT MONEY FLOW)
-- =====================================================
-- Goal: make every dollar traceable:
--   cash movement -> (quote/work_order/event) -> receipts -> cost breakdown -> ROI
--
-- This migration adds:
-- - timeline_events.work_order_id link
-- - receipt_links support for work_order + work_order_quote
-- - spend_attributions table (canonical mapping of money -> work)
-- - helper RPCs for common workflows
--
-- Safe/idempotent patterns for db reset.
-- Date: 2025-12-14

BEGIN;

-- ==========================
-- 1) LINK TIMELINE EVENTS -> WORK ORDERS
-- ==========================

DO $$
BEGIN
  IF to_regclass('public.timeline_events') IS NOT NULL
     AND to_regclass('public.work_orders') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'timeline_events'
         AND column_name = 'work_order_id'
     ) THEN
    ALTER TABLE public.timeline_events
      ADD COLUMN work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_timeline_events_work_order_id ON public.timeline_events(work_order_id);
  END IF;
END $$;

-- ==========================
-- 2) RECEIPT LINKS: SUPPORT WORK_ORDER + WORK_ORDER_QUOTE
-- ==========================
-- Existing `receipt_links.linked_type` CHECK constraint may not include these.
-- We replace it in a guarded way.

DO $$
DECLARE
  v_has_receipt_links BOOLEAN;
  v_constraint_name TEXT;
BEGIN
  v_has_receipt_links := (to_regclass('public.receipt_links') IS NOT NULL);
  IF NOT v_has_receipt_links THEN
    RETURN;
  END IF;

  -- Find a CHECK constraint on linked_type (name varies across migrations).
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'receipt_links'
    AND c.contype = 'c'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.receipt_links DROP CONSTRAINT IF EXISTS %I', v_constraint_name);
  END IF;

  -- Add updated CHECK constraint.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'receipt_links_linked_type_check'
      AND conrelid = 'public.receipt_links'::regclass
  ) THEN
    ALTER TABLE public.receipt_links
      ADD CONSTRAINT receipt_links_linked_type_check
      CHECK (linked_type IN ('vehicle','org','work_session','timeline_event','work_order','work_order_quote'));
  END IF;
END $$;

-- ==========================
-- 3) SPEND ATTRIBUTION TABLE
-- ==========================

CREATE TABLE IF NOT EXISTS public.spend_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE CASCADE,

  -- Work graph anchors (optional but at least one should be present in practice)
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  work_order_quote_id UUID REFERENCES public.work_order_quotes(id) ON DELETE SET NULL,
  timeline_event_id UUID REFERENCES public.timeline_events(id) ON DELETE SET NULL,

  -- Evidence / source docs
  receipt_id UUID REFERENCES public.receipts(id) ON DELETE SET NULL,
  receipt_item_id UUID REFERENCES public.receipt_items(id) ON DELETE SET NULL,

  -- Cash ledger link (if spending came from platform cash balance)
  cash_transaction_id UUID REFERENCES public.cash_transactions(id) ON DELETE SET NULL,

  -- Amounts
  direction TEXT NOT NULL CHECK (direction IN ('outflow','inflow')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',

  -- Categorization
  spend_category TEXT NOT NULL DEFAULT 'other' CHECK (spend_category IN (
    'parts','labor','materials','tax','shipping','overhead','tools','fee','refund','other'
  )),

  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spend_attr_vehicle ON public.spend_attributions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_spend_attr_work_order ON public.spend_attributions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_spend_attr_quote ON public.spend_attributions(work_order_quote_id);
CREATE INDEX IF NOT EXISTS idx_spend_attr_event ON public.spend_attributions(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_spend_attr_receipt ON public.spend_attributions(receipt_id);
CREATE INDEX IF NOT EXISTS idx_spend_attr_cash_tx ON public.spend_attributions(cash_transaction_id);

COMMENT ON TABLE public.spend_attributions IS 'Canonical mapping of money -> work graph (quotes/work orders/events) with evidence (receipts) and optional cash ledger linkage.';

-- ==========================
-- 4) RLS
-- ==========================

ALTER TABLE public.spend_attributions ENABLE ROW LEVEL SECURITY;

-- Basic RLS: creators can read, plus vehicle uploader/owner can read.
-- (Keep conservative; expand for org/shop roles later.)
DROP POLICY IF EXISTS spend_attr_select ON public.spend_attributions;
CREATE POLICY spend_attr_select ON public.spend_attributions
  FOR SELECT USING (
    created_by = auth.uid()
    OR (
      vehicle_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.vehicles v
        WHERE v.id = spend_attributions.vehicle_id
          AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS spend_attr_insert ON public.spend_attributions;
CREATE POLICY spend_attr_insert ON public.spend_attributions
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS spend_attr_update ON public.spend_attributions;
CREATE POLICY spend_attr_update ON public.spend_attributions
  FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS spend_attr_delete ON public.spend_attributions;
CREATE POLICY spend_attr_delete ON public.spend_attributions
  FOR DELETE USING (created_by = auth.uid());

-- ==========================
-- 5) HELPER RPC: ATTRIBUTE A RECEIPT TOTAL TO A WORK ORDER / QUOTE / EVENT
-- ==========================

CREATE OR REPLACE FUNCTION public.attribute_receipt_to_work(
  p_receipt_id UUID,
  p_vehicle_id UUID,
  p_work_order_id UUID DEFAULT NULL,
  p_work_order_quote_id UUID DEFAULT NULL,
  p_timeline_event_id UUID DEFAULT NULL,
  p_spend_category TEXT DEFAULT 'parts',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total NUMERIC;
  v_amount_cents BIGINT;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT total INTO v_total
  FROM public.receipts
  WHERE id = p_receipt_id;

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Receipt total missing or invalid';
  END IF;

  v_amount_cents := FLOOR(v_total * 100);

  INSERT INTO public.spend_attributions (
    vehicle_id,
    work_order_id,
    work_order_quote_id,
    timeline_event_id,
    receipt_id,
    direction,
    amount_cents,
    currency,
    spend_category,
    notes,
    created_by,
    metadata
  )
  VALUES (
    p_vehicle_id,
    p_work_order_id,
    p_work_order_quote_id,
    p_timeline_event_id,
    p_receipt_id,
    'outflow',
    v_amount_cents,
    'USD',
    COALESCE(p_spend_category, 'other'),
    p_notes,
    auth.uid(),
    jsonb_build_object('source', 'receipt_total')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.attribute_receipt_to_work IS 'Creates a spend attribution row linking a receipt total to a vehicle/work order/quote/event.';

-- ==========================
-- 6) SUMMARY VIEW: WORK ORDER MONEY ROOTS
-- ==========================

CREATE OR REPLACE VIEW public.work_order_money_roots AS
SELECT
  wo.id AS work_order_id,
  wo.vehicle_id,
  wo.customer_id,
  wo.status,
  wo.title,
  wo.created_at,

  -- Quotes
  (SELECT COUNT(*) FROM public.work_order_quotes q WHERE q.work_order_id = wo.id) AS quote_count,
  (SELECT COALESCE(SUM(q.amount_cents), 0) FROM public.work_order_quotes q WHERE q.work_order_id = wo.id) AS quoted_total_cents,

  -- Receipts linked via spend_attributions
  (SELECT COUNT(DISTINCT sa.receipt_id) FROM public.spend_attributions sa WHERE sa.work_order_id = wo.id AND sa.receipt_id IS NOT NULL) AS receipt_count,
  (SELECT COALESCE(SUM(sa.amount_cents), 0) FROM public.spend_attributions sa WHERE sa.work_order_id = wo.id AND sa.direction = 'outflow') AS attributed_spend_cents
FROM public.work_orders wo;

COMMENT ON VIEW public.work_order_money_roots IS 'Work order money flow summary: quotes vs attributed spend (via receipts/cash tx) for forensic accounting.';

COMMIT;






