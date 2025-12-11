-- Add metadata column to reference_documents for storing indexing structure
-- This allows edge functions to store document structure (TOC, sections, etc.)

ALTER TABLE reference_documents
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::JSONB;

-- Add index for metadata queries
CREATE INDEX IF NOT EXISTS idx_ref_docs_metadata ON reference_documents USING GIN(metadata);

COMMENT ON COLUMN reference_documents.metadata IS 'Stores document structure, indexing status, and other metadata from AI processing';


