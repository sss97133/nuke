-- Auto-process receipts: Extract data and link to images when receipt uploaded
-- Triggers smart-receipt-linker edge function automatically
-- HARDENED: idempotent drops, guarded FK references

-- receipt_items table already exists, just add missing columns
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_items') THEN
ALTER TABLE receipt_items
      ADD COLUMN IF NOT EXISTS vehicle_id UUID,
      ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS extracted_by_ai BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS linked_image_ids UUID[] DEFAULT ARRAY[]::UUID[];
    
    -- Add FK constraint
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'receipt_items_vehicle_id_fkey') THEN
      ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;
    END IF;
    
    -- Add CHECK constraint for category
    IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'receipt_items' AND constraint_name LIKE '%category%') THEN
      ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_category_check CHECK (category IN ('part', 'labor', 'tax', 'fee', 'other'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receipt_items_vehicle ON receipt_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items(category);

-- Backfill vehicle_id from receipt_id reference (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_items') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipts') THEN
UPDATE receipt_items ri
SET vehicle_id = r.vehicle_id
FROM receipts r
WHERE ri.receipt_id = r.id AND ri.vehicle_id IS NULL;
  END IF;
END $$;

-- RLS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_items') THEN
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views receipt items" ON receipt_items;
CREATE POLICY "Anyone views receipt items" ON receipt_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages receipt items" ON receipt_items;
CREATE POLICY "Service role manages receipt items" ON receipt_items
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Note: Automatic triggering via database function requires pg_net extension
-- Instead, frontend will call smart-receipt-linker directly after upload

-- Add processing status to vehicle_documents
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vehicle_documents') THEN
ALTER TABLE vehicle_documents
      ADD COLUMN IF NOT EXISTS ai_processing_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ai_processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_processing_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_extraction_confidence NUMERIC(4,2);

    -- Add CHECK constraint
    IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'vehicle_documents' AND constraint_name LIKE '%ai_processing_status%') THEN
      ALTER TABLE vehicle_documents ADD CONSTRAINT vehicle_documents_ai_processing_status_check CHECK (ai_processing_status IN ('pending', 'processing', 'completed', 'failed'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_processing_status ON vehicle_documents(ai_processing_status) WHERE ai_processing_status != 'completed';

COMMENT ON COLUMN vehicle_documents.ai_processing_status IS 'Status of AI receipt extraction: pending, processing, completed, failed';

