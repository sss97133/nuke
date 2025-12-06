-- Unified Document Chunks Table
-- Handles service manuals, material manuals, TDS sheets, and other technical documents

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- 'service_manual', 'material_manual', 'tds', etc.
  page_number INTEGER,
  section_name TEXT,
  section_heading TEXT,
  content TEXT NOT NULL,
  content_type TEXT, -- 'procedure', 'specification', 'chart', 'diagram', 'reference', 'safety_data', 'mixing_ratio', 'application_guide'
  key_topics TEXT[],
  
  -- TDS-specific fields
  product_name TEXT, -- Paint/product name
  product_code TEXT, -- SKU/part number
  brand TEXT, -- Manufacturer brand
  color_code TEXT, -- Paint color code
  mixing_ratio JSONB, -- {"base": 4, "activator": 1, "reducer": 1}
  application_method TEXT, -- Spray, brush, etc.
  dry_time TEXT, -- "15 minutes flash, 24 hours cure"
  coverage TEXT, -- "300 sq ft per gallon"
  safety_notes TEXT[], -- Safety warnings
  
  -- Material manual specific
  material_category TEXT, -- 'paint', 'primer', 'filler', 'adhesive', etc.
  compatibility TEXT[], -- Compatible products
  usage_instructions TEXT,
  
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT fk_document FOREIGN KEY (document_id) REFERENCES library_documents(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_doc_chunks_document ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_type ON document_chunks(document_type);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_page ON document_chunks(page_number);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_section ON document_chunks(section_name);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_topics ON document_chunks USING GIN(key_topics);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_content_search ON document_chunks USING GIN(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_doc_chunks_product ON document_chunks(product_code) WHERE product_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_chunks_brand ON document_chunks(brand) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_chunks_color_code ON document_chunks(color_code) WHERE color_code IS NOT NULL;

COMMENT ON TABLE document_chunks IS 'Unified table for all indexed document chunks (service manuals, material manuals, TDS sheets)';
COMMENT ON COLUMN document_chunks.document_type IS 'Type of source document: service_manual, material_manual, tds, etc.';
COMMENT ON COLUMN document_chunks.product_code IS 'Product SKU/part number (for TDS sheets)';
COMMENT ON COLUMN document_chunks.mixing_ratio IS 'Mixing ratios for paints/chemicals (JSONB)';

