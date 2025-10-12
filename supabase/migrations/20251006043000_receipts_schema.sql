-- Receipts schema for OCR-extracted purchase data

CREATE TABLE IF NOT EXISTS public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('vehicle','org')),
  scope_id uuid NOT NULL,
  source_document_table text NOT NULL CHECK (source_document_table IN ('vehicle_documents','shop_documents')),
  source_document_id uuid NOT NULL,
  vendor_name text,
  receipt_date date,
  currency text,
  subtotal numeric,
  tax numeric,
  total numeric,
  payment_method text,
  card_last4 text,
  card_holder text,
  invoice_number text,
  purchase_order text,
  raw_json jsonb,
  status text NOT NULL DEFAULT 'processed' CHECK (status IN ('pending','processed','failed')),
  processed_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  line_number int,
  description text,
  part_number text,
  vendor_sku text,
  category text,
  quantity numeric,
  unit_price numeric,
  total_price numeric
);

CREATE TABLE IF NOT EXISTS public.receipt_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.receipts(id) ON DELETE CASCADE,
  linked_type text NOT NULL CHECK (linked_type IN ('vehicle','org','work_session','timeline_event')),
  linked_id uuid NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_receipts_scope ON public.receipts(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_receipts_doc ON public.receipts(source_document_table, source_document_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON public.receipt_items(receipt_id);

-- Enable RLS
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_links ENABLE ROW LEVEL SECURITY;

-- Policies for receipts
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receipts') THEN
    -- Drop existing to avoid duplicates when re-running locally
    PERFORM 1;
  END IF;
END $$;

-- SELECT receipts: author or org owner/admin of linked scope
CREATE POLICY receipts_select ON public.receipts
FOR SELECT USING (
  created_by = auth.uid()
  OR (
    scope_type = 'vehicle' AND EXISTS (
      SELECT 1 FROM public.vehicles v
      JOIN public.shop_members sm ON sm.shop_id = v.owner_shop_id
      WHERE v.id = receipts.scope_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner','admin')
    )
  )
  OR (
    scope_type = 'org' AND EXISTS (
      SELECT 1 FROM public.shop_members sm
      WHERE sm.shop_id = receipts.scope_id
        AND sm.user_id = auth.uid()
        AND sm.role IN ('owner','admin')
    )
  )
);

-- INSERT receipts: author is current user
CREATE POLICY receipts_insert ON public.receipts
FOR INSERT WITH CHECK (
  created_by = auth.uid()
);

-- UPDATE receipts: only author
CREATE POLICY receipts_update ON public.receipts
FOR UPDATE USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- DELETE receipts: only author
CREATE POLICY receipts_delete ON public.receipts
FOR DELETE USING (created_by = auth.uid());

-- Policies for receipt_items: permitted if parent receipt is permitted
CREATE POLICY receipt_items_select ON public.receipt_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.receipts r
    WHERE r.id = receipt_items.receipt_id
      AND (
        r.created_by = auth.uid()
        OR (
          r.scope_type = 'vehicle' AND EXISTS (
            SELECT 1 FROM public.vehicles v
            JOIN public.shop_members sm ON sm.shop_id = v.owner_shop_id
            WHERE v.id = r.scope_id
              AND sm.user_id = auth.uid()
              AND sm.role IN ('owner','admin')
          )
        )
        OR (
          r.scope_type = 'org' AND EXISTS (
            SELECT 1 FROM public.shop_members sm
            WHERE sm.shop_id = r.scope_id
              AND sm.user_id = auth.uid()
              AND sm.role IN ('owner','admin')
          )
        )
      )
  )
);

CREATE POLICY receipt_items_insert ON public.receipt_items
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by = auth.uid())
);

CREATE POLICY receipt_items_update ON public.receipt_items
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by = auth.uid())
);

CREATE POLICY receipt_items_delete ON public.receipt_items
FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by = auth.uid())
);
