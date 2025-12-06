-- Unified Search Function for All Document Types
-- Searches service manuals, material manuals, and TDS sheets

CREATE OR REPLACE FUNCTION search_document_chunks(
  p_query TEXT,
  p_document_type TEXT DEFAULT NULL, -- 'service_manual', 'material_manual', 'tds'
  p_document_id UUID DEFAULT NULL,
  p_brand TEXT DEFAULT NULL,
  p_material_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  document_type TEXT,
  document_title TEXT,
  page_number INTEGER,
  section_name TEXT,
  section_heading TEXT,
  content TEXT,
  content_type TEXT,
  key_topics TEXT[],
  -- TDS fields
  product_name TEXT,
  product_code TEXT,
  brand TEXT,
  color_code TEXT,
  mixing_ratio JSONB,
  application_method TEXT,
  -- Material manual fields
  material_category TEXT,
  compatibility TEXT[],
  relevance_score REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id,
    dc.document_id,
    dc.document_type,
    ld.title as document_title,
    dc.page_number,
    dc.section_name,
    dc.section_heading,
    dc.content,
    dc.content_type,
    dc.key_topics,
    dc.product_name,
    dc.product_code,
    dc.brand,
    dc.color_code,
    dc.mixing_ratio,
    dc.application_method,
    dc.material_category,
    dc.compatibility,
    ts_rank(to_tsvector('english', dc.content), plainto_tsquery('english', p_query)) as relevance_score
  FROM document_chunks dc
  JOIN library_documents ld ON dc.document_id = ld.id
  WHERE 
    (p_document_type IS NULL OR dc.document_type = p_document_type)
    AND (p_document_id IS NULL OR dc.document_id = p_document_id)
    AND (p_brand IS NULL OR dc.brand ILIKE '%' || p_brand || '%')
    AND (p_material_category IS NULL OR dc.material_category = p_material_category)
    AND (
      to_tsvector('english', dc.content) @@ plainto_tsquery('english', p_query)
      OR dc.key_topics && string_to_array(lower(p_query), ' ')
      OR (dc.product_name IS NOT NULL AND dc.product_name ILIKE '%' || p_query || '%')
      OR (dc.product_code IS NOT NULL AND dc.product_code ILIKE '%' || p_query || '%')
    )
  ORDER BY relevance_score DESC, dc.page_number
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION search_document_chunks IS 'Unified search for all document types (service manuals, material manuals, TDS sheets)';

-- Example queries:
-- SELECT * FROM search_document_chunks('basecoat red', 'tds', NULL, 'PPG', NULL, 5);
-- SELECT * FROM search_document_chunks('body filler', 'material_manual', NULL, NULL, 'filler', 10);

