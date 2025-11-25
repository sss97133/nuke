-- ==========================================================================
-- CREATE vehicle_documents TABLE
-- ==========================================================================
-- Purpose: Store vehicle-related documents (titles, receipts, invoices, etc.)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Document metadata
  document_type TEXT NOT NULL, -- 'title', 'receipt', 'invoice', 'registration', 'insurance', etc.
  title TEXT,
  description TEXT,
  file_url TEXT,
  file_type TEXT, -- 'pdf', 'image', etc.
  
  -- Financial data (for receipts/invoices)
  amount NUMERIC(10, 2),
  vendor_name TEXT,
  currency TEXT DEFAULT 'USD',
  
  -- Privacy
  privacy_level TEXT DEFAULT 'private' CHECK (privacy_level IN ('private', 'organization', 'public')),
  
  -- Linking
  linked_to_tag_id UUID, -- Link to image tag if document was extracted from image
  source_document_id UUID, -- If this was extracted from another document
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle_id ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_uploaded_by ON vehicle_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_document_type ON vehicle_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_created_at ON vehicle_documents(created_at);

-- RLS Policies
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vehicle documents"
  ON vehicle_documents FOR SELECT
  USING (
    -- User owns the vehicle
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_documents.vehicle_id
      AND v.user_id = auth.uid()
    )
    OR
    -- User uploaded the document
    uploaded_by = auth.uid()
    OR
    -- Document is public
    privacy_level = 'public'
  );

CREATE POLICY "Users can insert documents for own vehicles"
  ON vehicle_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_documents.vehicle_id
      AND v.user_id = auth.uid()
    )
    OR
    uploaded_by = auth.uid()
  );

CREATE POLICY "Users can update own documents"
  ON vehicle_documents FOR UPDATE
  USING (
    uploaded_by = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_documents.vehicle_id
      AND v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own documents"
  ON vehicle_documents FOR DELETE
  USING (
    uploaded_by = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_documents.vehicle_id
      AND v.user_id = auth.uid()
    )
  );

COMMENT ON TABLE vehicle_documents IS 'Stores vehicle-related documents (titles, receipts, invoices, etc.)';

