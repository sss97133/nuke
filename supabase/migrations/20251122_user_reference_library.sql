-- User/Entity Reference Library System
-- Users and organizations own their documentation libraries
-- Documents can be linked to specific vehicles
-- Public documents can be discovered and used by others

-- Drop the auto-shared tables from previous migration
DROP TABLE IF EXISTS library_document_bookmarks CASCADE;
DROP TABLE IF EXISTS vehicle_reference_links CASCADE;
DROP TABLE IF EXISTS library_documents CASCADE;
DROP TABLE IF EXISTS reference_libraries CASCADE;
DROP VIEW IF EXISTS reference_library_stats CASCADE;
DROP FUNCTION IF EXISTS get_or_create_library_for_vehicle CASCADE;
DROP FUNCTION IF EXISTS trigger_auto_link_vehicle_library CASCADE;
DROP FUNCTION IF EXISTS trigger_update_library_stats CASCADE;
DROP TRIGGER IF EXISTS trg_auto_link_vehicle_library ON vehicles;
DROP TRIGGER IF EXISTS trg_update_library_doc_stats ON library_documents;

-- ============================================
-- NEW SIMPLIFIED SCHEMA: USER-OWNED DOCUMENTS
-- ============================================

-- Main documents table (user/org owned)
CREATE TABLE IF NOT EXISTS reference_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- OWNERSHIP (who uploaded this)
  owner_id UUID NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'organization')),
  
  -- DOCUMENT INFO
  document_type TEXT NOT NULL,  -- brochure, manual, spec_sheet, paint_codes, rpo_codes, etc.
  title TEXT NOT NULL,
  description TEXT,
  
  -- FILE STORAGE
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes BIGINT,
  page_count INTEGER,
  mime_type TEXT,
  
  -- APPLICABILITY (what vehicles can use this - loose tags for filtering)
  year INTEGER,              -- NULL = applies to any year
  year_range_start INTEGER,  -- For docs spanning years (e.g., 1967-1986 RPO codes)
  year_range_end INTEGER,
  make TEXT,                 -- NULL = applies to any make
  series TEXT,               -- C10, K5, K1500, etc. NULL = applies to any series
  body_style TEXT,           -- Pickup, Blazer, etc. NULL = applies to any body style
  
  -- PUBLISHING INFO
  year_published INTEGER,
  publisher TEXT,            -- "General Motors", "Chevrolet Division"
  part_number TEXT,          -- Factory part number
  edition TEXT,
  language TEXT DEFAULT 'en',
  
  -- SHARING & VERIFICATION
  is_public BOOLEAN DEFAULT FALSE,          -- Can others discover and use?
  is_factory_original BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- METADATA
  tags TEXT[],
  quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
  
  -- STATS
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  link_count INTEGER DEFAULT 0,  -- How many vehicles use this
  
  -- TIMESTAMPS
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link documents to specific vehicles (many-to-many)
CREATE TABLE IF NOT EXISTS vehicle_documents (
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  
  -- WHO linked it
  linked_by UUID NOT NULL REFERENCES auth.users(id),
  link_type TEXT DEFAULT 'owner',  -- 'owner' (you own doc), 'public' (using someone else's), 'shared' (org doc)
  
  -- WHEN
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- NOTES (optional context for this vehicle)
  notes TEXT,
  
  PRIMARY KEY (vehicle_id, document_id)
);

-- User bookmarks for quick access to docs they like
CREATE TABLE IF NOT EXISTS user_document_bookmarks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  
  notes TEXT,
  bookmarked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (user_id, document_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ref_docs_owner ON reference_documents(owner_id, owner_type);
CREATE INDEX IF NOT EXISTS idx_ref_docs_type ON reference_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_ref_docs_public ON reference_documents(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_ref_docs_ymm ON reference_documents(year, make, series);
CREATE INDEX IF NOT EXISTS idx_ref_docs_verified ON reference_documents(is_verified, is_factory_original);
CREATE INDEX IF NOT EXISTS idx_vehicle_docs_vehicle ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_docs_document ON vehicle_documents(document_id);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks ON user_document_bookmarks(user_id);

-- ============================================
-- VIEWS
-- ============================================

-- User's library with stats
CREATE OR REPLACE VIEW user_document_library AS
SELECT 
  rd.id,
  rd.owner_id,
  rd.owner_type,
  rd.document_type,
  rd.title,
  rd.year,
  rd.make,
  rd.series,
  rd.file_url,
  rd.thumbnail_url,
  rd.page_count,
  rd.is_public,
  rd.is_verified,
  COUNT(DISTINCT vd.vehicle_id) as vehicles_using,
  rd.view_count,
  rd.download_count,
  rd.uploaded_at
FROM reference_documents rd
LEFT JOIN vehicle_documents vd ON vd.document_id = rd.id
GROUP BY rd.id;

-- Public documents available for discovery
CREATE OR REPLACE VIEW public_reference_documents AS
SELECT 
  rd.*,
  COALESCE(p.full_name, p.username, b.business_name) as owner_name,
  COUNT(DISTINCT vd.vehicle_id) as usage_count
FROM reference_documents rd
LEFT JOIN profiles p ON p.id = rd.owner_id AND rd.owner_type = 'user'
LEFT JOIN businesses b ON b.id = rd.owner_id AND rd.owner_type = 'organization'
LEFT JOIN vehicle_documents vd ON vd.document_id = rd.id
WHERE rd.is_public = true
GROUP BY rd.id, p.full_name, p.username, b.business_name;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Get documents for a specific vehicle
CREATE OR REPLACE FUNCTION get_vehicle_documents(p_vehicle_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_type TEXT,
  title TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  page_count INTEGER,
  owner_name TEXT,
  link_type TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rd.id,
    rd.document_type,
    rd.title,
    rd.file_url,
    rd.thumbnail_url,
    rd.page_count,
    COALESCE(p.full_name, p.username, b.business_name, 'Unknown') as owner_name,
    vd.link_type,
    rd.uploaded_at
  FROM reference_documents rd
  JOIN vehicle_documents vd ON vd.document_id = rd.id
  LEFT JOIN profiles p ON p.id = rd.owner_id AND rd.owner_type = 'user'
  LEFT JOIN businesses b ON b.id = rd.owner_id AND rd.owner_type = 'organization'
  WHERE vd.vehicle_id = p_vehicle_id
  ORDER BY 
    CASE rd.document_type
      WHEN 'brochure' THEN 1
      WHEN 'owners_manual' THEN 2
      WHEN 'service_manual' THEN 3
      WHEN 'spec_sheet' THEN 4
      ELSE 5
    END,
    rd.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Search public documents
CREATE OR REPLACE FUNCTION search_public_documents(
  p_year INTEGER DEFAULT NULL,
  p_make TEXT DEFAULT NULL,
  p_series TEXT DEFAULT NULL,
  p_document_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  document_id UUID,
  document_type TEXT,
  title TEXT,
  year INTEGER,
  make TEXT,
  series TEXT,
  owner_name TEXT,
  usage_count BIGINT,
  is_verified BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rd.id,
    rd.document_type,
    rd.title,
    rd.year,
    rd.make,
    rd.series,
    COALESCE(p.full_name, p.username, b.business_name, 'Anonymous') as owner_name,
    COUNT(DISTINCT vd.vehicle_id) as usage_count,
    rd.is_verified
  FROM reference_documents rd
  LEFT JOIN profiles p ON p.id = rd.owner_id AND rd.owner_type = 'user'
  LEFT JOIN businesses b ON b.id = rd.owner_id AND rd.owner_type = 'organization'
  LEFT JOIN vehicle_documents vd ON vd.document_id = rd.id
  WHERE rd.is_public = true
    AND (p_year IS NULL OR rd.year = p_year OR rd.year IS NULL)
    AND (p_make IS NULL OR rd.make ILIKE p_make OR rd.make IS NULL)
    AND (p_series IS NULL OR rd.series = p_series OR rd.series IS NULL)
    AND (p_document_type IS NULL OR rd.document_type = p_document_type)
  GROUP BY rd.id, p.full_name, p.username, b.business_name
  ORDER BY usage_count DESC, rd.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Increment stat counters
CREATE OR REPLACE FUNCTION increment_document_stat(
  p_document_id UUID,
  p_stat_type TEXT  -- 'view', 'download', 'bookmark', 'link'
)
RETURNS VOID AS $$
BEGIN
  IF p_stat_type = 'view' THEN
    UPDATE reference_documents SET view_count = view_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'download' THEN
    UPDATE reference_documents SET download_count = download_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'bookmark' THEN
    UPDATE reference_documents SET bookmark_count = bookmark_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'link' THEN
    UPDATE reference_documents SET link_count = link_count + 1 WHERE id = p_document_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE reference_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_document_bookmarks ENABLE ROW LEVEL SECURITY;

-- Documents: Users see their own + public docs
CREATE POLICY "ref_docs_owner_read" ON reference_documents
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid() AND owner_type = 'user'
    OR is_public = true
  );

CREATE POLICY "ref_docs_public_anon_read" ON reference_documents
  FOR SELECT TO anon
  USING (is_public = true);

CREATE POLICY "ref_docs_user_create" ON reference_documents
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND owner_type = 'user');

CREATE POLICY "ref_docs_owner_update" ON reference_documents
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND owner_type = 'user');

CREATE POLICY "ref_docs_owner_delete" ON reference_documents
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() AND owner_type = 'user');

-- Vehicle Documents: Vehicle owner can manage
CREATE POLICY "vehicle_docs_read" ON vehicle_documents
  FOR SELECT TO public
  USING (true);

CREATE POLICY "vehicle_docs_create" ON vehicle_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_id
        AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
    )
  );

CREATE POLICY "vehicle_docs_delete" ON vehicle_documents
  FOR DELETE TO authenticated
  USING (linked_by = auth.uid());

-- Bookmarks: User manages their own
CREATE POLICY "bookmarks_user_all" ON user_document_bookmarks
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- STORAGE BUCKET
-- ============================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reference-docs',
  'reference-docs',
  true,
  104857600,  -- 100MB per file
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "ref_docs_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'reference-docs');

CREATE POLICY "ref_docs_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reference-docs' AND auth.uid()::text = owner);

CREATE POLICY "ref_docs_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'reference-docs' AND auth.uid()::text = owner);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE reference_documents IS 'User/organization owned reference library - brochures, manuals, specs, etc.';
COMMENT ON TABLE vehicle_documents IS 'Links reference documents to specific vehicles';
COMMENT ON TABLE user_document_bookmarks IS 'User bookmarks for quick access to documents';
COMMENT ON FUNCTION get_vehicle_documents IS 'Get all reference documents linked to a vehicle';
COMMENT ON FUNCTION search_public_documents IS 'Search publicly shared reference documents';
COMMENT ON FUNCTION increment_document_stat IS 'Increment view/download/bookmark/link counters';

