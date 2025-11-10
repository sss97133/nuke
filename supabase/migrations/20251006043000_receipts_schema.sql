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

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS scope_type text,
  ADD COLUMN IF NOT EXISTS scope_id uuid,
  ADD COLUMN IF NOT EXISTS source_document_table text,
  ADD COLUMN IF NOT EXISTS source_document_id uuid,
  ADD COLUMN IF NOT EXISTS vendor_name text,
  ADD COLUMN IF NOT EXISTS receipt_date date,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS subtotal numeric,
  ADD COLUMN IF NOT EXISTS tax numeric,
  ADD COLUMN IF NOT EXISTS total numeric,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS card_last4 text,
  ADD COLUMN IF NOT EXISTS card_holder text,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS purchase_order text,
  ADD COLUMN IF NOT EXISTS raw_json jsonb,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz;

ALTER TABLE public.receipts
  ALTER COLUMN status SET DEFAULT 'processed';

ALTER TABLE public.receipts
  ALTER COLUMN processed_at SET DEFAULT now();

ALTER TABLE public.receipts
  ALTER COLUMN created_at SET DEFAULT now();

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
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'receipts' AND column_name = 'source_document_table'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'receipts' AND column_name = 'source_document_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_receipts_doc ON public.receipts(source_document_table, source_document_id)';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON public.receipt_items(receipt_id);

-- Enable RLS
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_links ENABLE ROW LEVEL SECURITY;

-- Policies for receipts
DROP POLICY IF EXISTS receipts_select ON public.receipts;
DROP POLICY IF EXISTS receipts_insert ON public.receipts;
DROP POLICY IF EXISTS receipts_update ON public.receipts;
DROP POLICY IF EXISTS receipts_delete ON public.receipts;

-- Policies for receipt_items
DROP POLICY IF EXISTS receipt_items_select ON public.receipt_items;
DROP POLICY IF EXISTS receipt_items_insert ON public.receipt_items;
DROP POLICY IF EXISTS receipt_items_update ON public.receipt_items;
DROP POLICY IF EXISTS receipt_items_delete ON public.receipt_items;

-- SELECT receipts: author or org owner/admin of linked scope
CREATE POLICY receipts_select ON public.receipts
FOR SELECT USING (
  created_by::text = auth.uid()::text
  OR (
    scope_type = 'vehicle' AND EXISTS (
      SELECT 1 FROM public.vehicles v
      JOIN public.shop_members sm ON sm.shop_id = v.owner_shop_id
      WHERE v.id::text = receipts.scope_id::text
        AND sm.user_id::text = auth.uid()::text
        AND sm.role IN ('owner','admin')
    )
  )
  OR (
    scope_type = 'org' AND EXISTS (
      SELECT 1 FROM public.shop_members sm
      WHERE sm.shop_id::text = receipts.scope_id::text
        AND sm.user_id::text = auth.uid()::text
        AND sm.role IN ('owner','admin')
    )
  )
);

-- INSERT receipts: author is current user
CREATE POLICY receipts_insert ON public.receipts
FOR INSERT WITH CHECK (
  created_by::text = auth.uid()::text
);

-- UPDATE receipts: only author
CREATE POLICY receipts_update ON public.receipts
FOR UPDATE USING (created_by::text = auth.uid()::text) WITH CHECK (created_by::text = auth.uid()::text);

-- DELETE receipts: only author
CREATE POLICY receipts_delete ON public.receipts
FOR DELETE USING (created_by::text = auth.uid()::text);

-- Policies for receipt_items: permitted if parent receipt is permitted
CREATE POLICY receipt_items_select ON public.receipt_items
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.receipts r
    WHERE r.id = receipt_items.receipt_id
      AND (
        r.created_by::text = auth.uid()::text
        OR (
          r.scope_type = 'vehicle' AND EXISTS (
            SELECT 1 FROM public.vehicles v
            JOIN public.shop_members sm ON sm.shop_id = v.owner_shop_id
            WHERE v.id::text = r.scope_id::text
              AND sm.user_id::text = auth.uid()::text
              AND sm.role IN ('owner','admin')
          )
        )
        OR (
          r.scope_type = 'org' AND EXISTS (
            SELECT 1 FROM public.shop_members sm
            WHERE sm.shop_id::text = r.scope_id::text
              AND sm.user_id::text = auth.uid()::text
              AND sm.role IN ('owner','admin')
          )
        )
      )
  )
);

CREATE POLICY receipt_items_insert ON public.receipt_items
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by::text = auth.uid()::text)
);

CREATE POLICY receipt_items_update ON public.receipt_items
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by::text = auth.uid()::text)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by::text = auth.uid()::text)
);

CREATE POLICY receipt_items_delete ON public.receipt_items
FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.receipts r WHERE r.id = receipt_items.receipt_id AND r.created_by::text = auth.uid()::text)
);
