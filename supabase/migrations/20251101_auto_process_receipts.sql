-- Auto-process receipts: Extract data and link to images when receipt uploaded
-- Triggers smart-receipt-linker edge function automatically

-- receipt_items table already exists, just add missing columns
ALTER TABLE receipt_items
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('part', 'labor', 'tax', 'fee', 'other')),
  ADD COLUMN IF NOT EXISTS extracted_by_ai BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS linked_image_ids UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX IF NOT EXISTS idx_receipt_items_vehicle ON receipt_items(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items(category);

-- Backfill vehicle_id from receipt_id reference
UPDATE receipt_items ri
SET vehicle_id = r.vehicle_id
FROM receipts r
WHERE ri.receipt_id = r.id AND ri.vehicle_id IS NULL;

-- RLS
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone views receipt items" ON receipt_items;
CREATE POLICY "Anyone views receipt items" ON receipt_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role manages receipt items" ON receipt_items;
CREATE POLICY "Service role manages receipt items" ON receipt_items
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Note: Automatic triggering via database function requires pg_net extension
-- Instead, frontend will call smart-receipt-linker directly after upload

-- Add processing status to vehicle_documents
ALTER TABLE vehicle_documents
  ADD COLUMN IF NOT EXISTS ai_processing_status TEXT DEFAULT 'pending' CHECK (ai_processing_status IN ('pending', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS ai_processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_processing_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_extraction_confidence NUMERIC(4,2);

CREATE INDEX idx_vehicle_documents_processing_status ON vehicle_documents(ai_processing_status) WHERE ai_processing_status != 'completed';

COMMENT ON COLUMN vehicle_documents.ai_processing_status IS 'Status of AI receipt extraction: pending, processing, completed, failed';

