-- Fix Circular Dependency Between vehicle_documents and timeline_events
-- Created: November 1, 2025
--
-- PROBLEM: vehicle_documents.timeline_event_id references timeline_events.id
--          BUT timeline_events.documentation_urls[] contains document URLs
--          This creates a chicken-and-egg problem where you can't insert either first
--
-- SOLUTION: Remove the circular foreign key and create a link table instead

-- Step 1: Remove circular foreign key from vehicle_documents
ALTER TABLE vehicle_documents 
DROP COLUMN IF EXISTS timeline_event_id CASCADE;

-- Step 2: Remove timeline_event_created flag (no longer needed)
ALTER TABLE vehicle_documents
DROP COLUMN IF EXISTS timeline_event_created;

-- Step 3: Create link table to connect documents and timeline events
CREATE TABLE IF NOT EXISTS timeline_event_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES vehicle_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, document_id)
);

-- Step 4: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_timeline_event_documents_event 
  ON timeline_event_documents(event_id);
  
CREATE INDEX IF NOT EXISTS idx_timeline_event_documents_document 
  ON timeline_event_documents(document_id);

-- Step 5: Enable RLS
ALTER TABLE timeline_event_documents ENABLE ROW LEVEL SECURITY;

-- Step 6: RLS Policies - same access as timeline_events
CREATE POLICY "Users can view timeline_event_documents for vehicles they can view" 
  ON timeline_event_documents FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON te.vehicle_id = v.id
      WHERE te.id = timeline_event_documents.event_id
      AND (v.is_public = true OR v.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can create timeline_event_documents for their vehicles" 
  ON timeline_event_documents FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON te.vehicle_id = v.id
      WHERE te.id = timeline_event_documents.event_id
      AND v.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete timeline_event_documents for their vehicles" 
  ON timeline_event_documents FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM timeline_events te
      JOIN vehicles v ON te.vehicle_id = v.id
      WHERE te.id = timeline_event_documents.event_id
      AND v.user_id = auth.uid()
    )
  );

-- Step 7: Migrate any existing data if timeline_events.documentation_urls is populated
-- This creates link records for documents that are referenced in timeline events
-- (Run this only if you have existing data to migrate)

-- Step 8: Add helper function to get documents for an event
CREATE OR REPLACE FUNCTION get_event_documents(p_event_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_type TEXT,
  file_url TEXT,
  vendor_name TEXT,
  amount DECIMAL(10,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vd.id,
    vd.document_type::TEXT,
    vd.file_url,
    vd.vendor_name,
    vd.amount
  FROM vehicle_documents vd
  JOIN timeline_event_documents ted ON vd.id = ted.document_id
  WHERE ted.event_id = p_event_id;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Add helper function to get timeline events for a document
CREATE OR REPLACE FUNCTION get_document_events(p_document_id UUID)
RETURNS TABLE (
  event_id UUID,
  event_type TEXT,
  event_date DATE,
  title TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    te.id,
    te.event_type,
    te.event_date,
    te.title
  FROM timeline_events te
  JOIN timeline_event_documents ted ON te.id = ted.event_id
  WHERE ted.document_id = p_document_id;
END;
$$ LANGUAGE plpgsql;

-- Success! Circular dependency is now broken.
-- New flow:
-- 1. Insert into vehicle_documents → get document_id
-- 2. Insert into timeline_events → get event_id  
-- 3. Insert into timeline_event_documents (event_id, document_id) → link them

