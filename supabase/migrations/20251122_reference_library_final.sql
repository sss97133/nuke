-- Reference Library System - Auto-Shared with Attribution
-- Libraries are shared per YMM (efficient, no duplication)
-- Contributors get credit (builds reputation, shows expertise)
-- Like tools: Shops/users contribute specialized knowledge, everyone benefits

-- ============================================
-- CORE SCHEMA
-- ============================================

-- Main library (one per YMM) - shared resource
CREATE TABLE IF NOT EXISTS reference_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- YMM identification
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT,
  series TEXT,
  body_style TEXT,
  
  -- Description
  description TEXT,
  
  -- Stats (auto-computed)
  vehicle_count INTEGER DEFAULT 0,
  document_count INTEGER DEFAULT 0,
  contributor_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_ymm_library UNIQUE (year, make, series, body_style)
);

-- Documents with ATTRIBUTION (who contributed)
CREATE TABLE IF NOT EXISTS library_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  -- WHAT
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes BIGINT,
  page_count INTEGER,
  mime_type TEXT,
  
  -- WHO contributed (attribution)
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  uploader_type TEXT DEFAULT 'user',  -- 'user' or 'organization'
  uploader_org_id UUID REFERENCES businesses(id),  -- If uploaded by org employee
  
  -- PUBLISHING INFO
  year_published INTEGER,
  year_range_start INTEGER,
  year_range_end INTEGER,
  publisher TEXT,
  part_number TEXT,
  language TEXT DEFAULT 'en',
  
  -- QUALITY
  is_factory_original BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
  
  -- METADATA
  tags TEXT[],
  
  -- STATS
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Auto-link vehicles to libraries
CREATE TABLE IF NOT EXISTS vehicle_library_links (
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  match_type TEXT DEFAULT 'auto',  -- 'exact', 'series', 'year_make'
  confidence INTEGER DEFAULT 100,
  
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (vehicle_id, library_id)
);

-- User bookmarks
CREATE TABLE IF NOT EXISTS library_bookmarks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  
  notes TEXT,
  bookmarked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (user_id, document_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_ref_lib_ymm ON reference_libraries(year, make, series);
CREATE INDEX idx_lib_docs_library ON library_documents(library_id);
CREATE INDEX idx_lib_docs_uploader ON library_documents(uploaded_by);
CREATE INDEX idx_lib_docs_org ON library_documents(uploader_org_id) WHERE uploader_org_id IS NOT NULL;
CREATE INDEX idx_lib_docs_type ON library_documents(document_type);
CREATE INDEX idx_vehicle_lib_links ON vehicle_library_links(vehicle_id);
CREATE INDEX idx_lib_bookmarks_user ON library_bookmarks(user_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Auto-link vehicle to library (or create library)
CREATE OR REPLACE FUNCTION link_vehicle_to_library(p_vehicle_id UUID)
RETURNS UUID AS $$
DECLARE
  v_vehicle RECORD;
  v_library_id UUID;
BEGIN
  SELECT year, make, series, body_style INTO v_vehicle
  FROM vehicles WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN RETURN NULL; END IF;
  
  -- Find existing library
  SELECT id INTO v_library_id
  FROM reference_libraries
  WHERE year = v_vehicle.year
    AND make ILIKE v_vehicle.make
    AND (series = v_vehicle.series OR (series IS NULL AND v_vehicle.series IS NULL))
    AND (body_style = v_vehicle.body_style OR (body_style IS NULL AND v_vehicle.body_style IS NULL))
  ORDER BY 
    CASE WHEN series = v_vehicle.series THEN 1 ELSE 2 END,
    CASE WHEN body_style = v_vehicle.body_style THEN 1 ELSE 2 END
  LIMIT 1;
  
  -- Create if doesn't exist
  IF v_library_id IS NULL THEN
    INSERT INTO reference_libraries (year, make, series, body_style)
    VALUES (v_vehicle.year, v_vehicle.make, v_vehicle.series, v_vehicle.body_style)
    RETURNING id INTO v_library_id;
  END IF;
  
  -- Link vehicle
  INSERT INTO vehicle_library_links (vehicle_id, library_id, match_type)
  VALUES (p_vehicle_id, v_library_id, 'exact')
  ON CONFLICT DO NOTHING;
  
  RETURN v_library_id;
END;
$$ LANGUAGE plpgsql;

-- Get documents for vehicle (with contributor info)
CREATE OR REPLACE FUNCTION get_vehicle_library_docs(p_vehicle_id UUID)
RETURNS TABLE (
  doc_id UUID,
  doc_type TEXT,
  title TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  page_count INTEGER,
  contributor_name TEXT,
  contributor_type TEXT,
  org_name TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ld.id,
    ld.document_type,
    ld.title,
    ld.file_url,
    ld.thumbnail_url,
    ld.page_count,
    COALESCE(p.full_name, p.username) as contributor_name,
    ld.uploader_type,
    b.business_name as org_name,
    ld.uploaded_at
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  JOIN vehicle_library_links vll ON vll.library_id = rl.id
  LEFT JOIN profiles p ON p.id = ld.uploaded_by
  LEFT JOIN businesses b ON b.id = ld.uploader_org_id
  WHERE vll.vehicle_id = p_vehicle_id
  ORDER BY 
    CASE ld.document_type
      WHEN 'brochure' THEN 1
      WHEN 'owners_manual' THEN 2
      ELSE 3
    END,
    ld.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Increment stats
CREATE OR REPLACE FUNCTION increment_doc_stat(p_doc_id UUID, p_stat TEXT)
RETURNS VOID AS $$
BEGIN
  IF p_stat = 'view' THEN UPDATE library_documents SET view_count = view_count + 1 WHERE id = p_doc_id;
  ELSIF p_stat = 'download' THEN UPDATE library_documents SET download_count = download_count + 1 WHERE id = p_doc_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

CREATE OR REPLACE FUNCTION trigger_link_vehicle()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.year IS NOT NULL AND NEW.make IS NOT NULL THEN
    PERFORM link_vehicle_to_library(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_link_vehicle_library ON vehicles;
CREATE TRIGGER trg_link_vehicle_library
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_link_vehicle();

-- ============================================
-- RLS
-- ============================================

ALTER TABLE reference_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_library_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lib_read_all" ON reference_libraries FOR SELECT TO public USING (true);
CREATE POLICY "lib_auth_create" ON reference_libraries FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "docs_read_all" ON library_documents FOR SELECT TO public USING (true);
CREATE POLICY "docs_user_upload" ON library_documents FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "docs_owner_update" ON library_documents FOR UPDATE TO authenticated USING (uploaded_by = auth.uid());
CREATE POLICY "docs_owner_delete" ON library_documents FOR DELETE TO authenticated USING (uploaded_by = auth.uid());

CREATE POLICY "links_read_all" ON vehicle_library_links FOR SELECT TO public USING (true);
CREATE POLICY "links_create" ON vehicle_library_links FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "bookmarks_user" ON library_bookmarks FOR ALL TO authenticated 
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
