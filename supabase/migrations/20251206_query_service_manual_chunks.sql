-- RPC Function to Query Service Manual Chunks
-- For AI to search indexed service manual content

CREATE OR REPLACE FUNCTION search_service_manual_chunks(
  p_query TEXT,
  p_document_id UUID DEFAULT NULL,
  p_section_name TEXT DEFAULT NULL,
  p_content_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  document_title TEXT,
  page_number INTEGER,
  section_name TEXT,
  section_heading TEXT,
  content TEXT,
  content_type TEXT,
  key_topics TEXT[],
  relevance_score REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    smc.id,
    smc.document_id,
    ld.title as document_title,
    smc.page_number,
    smc.section_name,
    smc.section_heading,
    smc.content,
    smc.content_type,
    smc.key_topics,
    ts_rank(to_tsvector('english', smc.content), plainto_tsquery('english', p_query)) as relevance_score
  FROM service_manual_chunks smc
  JOIN library_documents ld ON smc.document_id = ld.id
  WHERE 
    (p_document_id IS NULL OR smc.document_id = p_document_id)
    AND (p_section_name IS NULL OR smc.section_name = p_section_name)
    AND (p_content_type IS NULL OR smc.content_type = p_content_type)
    AND (
      to_tsvector('english', smc.content) @@ plainto_tsquery('english', p_query)
      OR smc.key_topics && string_to_array(lower(p_query), ' ')
    )
  ORDER BY relevance_score DESC, smc.page_number
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION search_service_manual_chunks IS 'Search indexed service manual chunks by text query, with optional filters';

