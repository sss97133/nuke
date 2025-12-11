-- Fix document_chunks to reference reference_documents instead of library_documents
-- This migration updates the foreign key constraint and edge function compatibility

-- Drop old foreign key constraint
ALTER TABLE document_chunks
  DROP CONSTRAINT IF EXISTS fk_document;

-- Update foreign key to reference reference_documents
ALTER TABLE document_chunks
  ADD CONSTRAINT fk_document 
  FOREIGN KEY (document_id) 
  REFERENCES reference_documents(id) 
  ON DELETE CASCADE;

-- Update catalog_parts if it references library_documents
DO $$
BEGIN
  -- Check if catalog_parts has a foreign key to library_documents
  IF EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints 
    WHERE constraint_name = 'catalog_parts_document_id_fkey'
    AND table_name = 'catalog_parts'
  ) THEN
    ALTER TABLE catalog_parts
      DROP CONSTRAINT IF EXISTS catalog_parts_document_id_fkey;
    
    ALTER TABLE catalog_parts
      ADD CONSTRAINT catalog_parts_document_id_fkey
      FOREIGN KEY (document_id) 
      REFERENCES reference_documents(id) 
      ON DELETE CASCADE;
  END IF;
END $$;

-- Update catalog_sources to reference reference_documents
DO $$
BEGIN
  -- Drop old constraint if it exists
  ALTER TABLE catalog_sources
    DROP CONSTRAINT IF EXISTS catalog_sources_pdf_document_id_fkey;
  
  -- Add new constraint referencing reference_documents
  ALTER TABLE catalog_sources
    ADD CONSTRAINT catalog_sources_pdf_document_id_fkey
    FOREIGN KEY (pdf_document_id) 
    REFERENCES reference_documents(id) 
    ON DELETE SET NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- Constraint might not exist yet, that's okay
    NULL;
END $$;

COMMENT ON CONSTRAINT fk_document ON document_chunks IS 'References reference_documents table (user-owned documents)';

