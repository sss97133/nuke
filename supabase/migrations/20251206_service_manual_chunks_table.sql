-- Service Manual Chunks Table
-- Stores indexed chunks from service manuals for AI querying

CREATE TABLE IF NOT EXISTS service_manual_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  section_name TEXT,
  section_heading TEXT,
  content TEXT NOT NULL,
  content_type TEXT CHECK (content_type IN ('procedure', 'specification', 'chart', 'diagram', 'reference')),
  key_topics TEXT[],
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_document FOREIGN KEY (document_id) REFERENCES library_documents(id)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_service_chunks_document ON service_manual_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_service_chunks_page ON service_manual_chunks(page_number);
CREATE INDEX IF NOT EXISTS idx_service_chunks_section ON service_manual_chunks(section_name);
CREATE INDEX IF NOT EXISTS idx_service_chunks_topics ON service_manual_chunks USING GIN(key_topics);
CREATE INDEX IF NOT EXISTS idx_service_chunks_content_search ON service_manual_chunks USING GIN(to_tsvector('english', content));

COMMENT ON TABLE service_manual_chunks IS 'Indexed chunks from service manuals for AI querying';
COMMENT ON COLUMN service_manual_chunks.key_topics IS 'Array of topics covered in this chunk for semantic search';

