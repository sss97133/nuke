-- Reference Library System
-- Central repository for factory documentation, brochures, manuals, etc.
-- Organized by Year/Make/Model/Series and shared across all matching vehicles

-- ============================================
-- PART 1: CORE TABLES
-- ============================================

-- Main library table (one per YMM combination)
CREATE TABLE IF NOT EXISTS reference_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- YMM identification
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT,
  series TEXT,              -- C10, K5, K1500, etc.
  body_style TEXT,          -- Pickup, Blazer, Suburban
  trim TEXT,                -- Silverado, Cheyenne (optional)
  
  -- Description of this library
  description TEXT,
  notes TEXT,
  
  -- Stats (computed via triggers)
  vehicle_count INTEGER DEFAULT 0,
  document_count INTEGER DEFAULT 0,
  contributor_count INTEGER DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  
  -- Admin
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Unique per YMM combination
  CONSTRAINT unique_reference_library UNIQUE (year, make, series, body_style)
);

-- Documents in each library
CREATE TABLE IF NOT EXISTS library_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  -- Document metadata
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  
  -- File info
  file_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes BIGINT,
  page_count INTEGER,
  mime_type TEXT,
  
  -- Publishing info
  year_published INTEGER,
  year_range_start INTEGER,  -- If doc covers multiple years (e.g., 1967-1986 RPO codes)
  year_range_end INTEGER,
  publisher TEXT,            -- "General Motors", "Chevrolet Division"
  part_number TEXT,          -- GM part number if available
  language TEXT DEFAULT 'en',
  edition TEXT,              -- "First Edition", "Revised 1974"
  
  -- Categorization
  tags TEXT[],
  is_factory_original BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
  
  -- Engagement metrics
  view_count INTEGER DEFAULT 0,
  download_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  
  -- Admin
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link vehicles to libraries (auto-generated + manual)
CREATE TABLE IF NOT EXISTS vehicle_reference_links (
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  library_id UUID NOT NULL REFERENCES reference_libraries(id) ON DELETE CASCADE,
  
  link_type TEXT DEFAULT 'auto',  -- 'auto', 'manual', 'suggested'
  confidence INTEGER DEFAULT 100,
  match_reason TEXT,              -- 'exact_ymm', 'series_match', 'year_make_match'
  
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  linked_by UUID REFERENCES auth.users(id),
  
  PRIMARY KEY (vehicle_id, library_id)
);

-- User bookmarks for quick access
CREATE TABLE IF NOT EXISTS library_document_bookmarks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES library_documents(id) ON DELETE CASCADE,
  
  notes TEXT,
  bookmarked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (user_id, document_id)
);

-- ============================================
-- PART 2: INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ref_lib_ymm ON reference_libraries(year, make, series);
CREATE INDEX IF NOT EXISTS idx_ref_lib_make ON reference_libraries(make, year);
CREATE INDEX IF NOT EXISTS idx_lib_docs_library ON library_documents(library_id);
CREATE INDEX IF NOT EXISTS idx_lib_docs_type ON library_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_lib_docs_verified ON library_documents(is_verified, is_factory_original);
CREATE INDEX IF NOT EXISTS idx_lib_docs_year ON library_documents(year_published);
CREATE INDEX IF NOT EXISTS idx_vehicle_ref_links_vehicle ON vehicle_reference_links(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_ref_links_library ON vehicle_reference_links(library_id);
CREATE INDEX IF NOT EXISTS idx_lib_bookmarks_user ON library_document_bookmarks(user_id);

-- ============================================
-- PART 3: VIEWS
-- ============================================

-- Stats view for libraries
CREATE OR REPLACE VIEW reference_library_stats AS
SELECT 
  rl.id,
  rl.year,
  rl.make,
  rl.model,
  rl.series,
  rl.body_style,
  rl.trim,
  COUNT(DISTINCT ld.id) as document_count,
  COUNT(DISTINCT vrl.vehicle_id) as vehicle_count,
  COUNT(DISTINCT ld.uploaded_by) as contributor_count,
  COALESCE(SUM(ld.download_count), 0) as total_downloads,
  COALESCE(SUM(ld.view_count), 0) as total_views,
  MAX(ld.uploaded_at) as last_updated,
  rl.is_verified,
  rl.created_at
FROM reference_libraries rl
LEFT JOIN library_documents ld ON ld.library_id = rl.id
LEFT JOIN vehicle_reference_links vrl ON vrl.library_id = rl.id
GROUP BY rl.id;

-- ============================================
-- PART 4: FUNCTIONS
-- ============================================

-- Function: Find or create library for a vehicle
CREATE OR REPLACE FUNCTION get_or_create_library_for_vehicle(p_vehicle_id UUID)
RETURNS UUID AS $$
DECLARE
  v_vehicle RECORD;
  v_library_id UUID;
BEGIN
  -- Get vehicle data
  SELECT year, make, model, series, body_style INTO v_vehicle
  FROM vehicles
  WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found: %', p_vehicle_id;
  END IF;
  
  -- Try to find existing library (prioritize exact match)
  SELECT id INTO v_library_id
  FROM reference_libraries
  WHERE year = v_vehicle.year
    AND make ILIKE v_vehicle.make
    AND (series = v_vehicle.series OR (series IS NULL AND v_vehicle.series IS NULL))
    AND (body_style = v_vehicle.body_style OR (body_style IS NULL AND v_vehicle.body_style IS NULL))
  ORDER BY 
    CASE WHEN series = v_vehicle.series AND series IS NOT NULL THEN 1 ELSE 2 END,
    CASE WHEN body_style = v_vehicle.body_style AND body_style IS NOT NULL THEN 1 ELSE 2 END
  LIMIT 1;
  
  -- Create library if doesn't exist
  IF v_library_id IS NULL THEN
    INSERT INTO reference_libraries (year, make, model, series, body_style)
    VALUES (v_vehicle.year, v_vehicle.make, v_vehicle.model, v_vehicle.series, v_vehicle.body_style)
    RETURNING id INTO v_library_id;
  END IF;
  
  -- Link vehicle to library if not already linked
  INSERT INTO vehicle_reference_links (vehicle_id, library_id, link_type, match_reason)
  VALUES (
    p_vehicle_id,
    v_library_id,
    'auto',
    CASE 
      WHEN v_vehicle.series IS NOT NULL THEN 'exact_series_match'
      ELSE 'year_make_match'
    END
  )
  ON CONFLICT (vehicle_id, library_id) DO NOTHING;
  
  RETURN v_library_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get library for a specific YMM
CREATE OR REPLACE FUNCTION find_library(
  p_year INTEGER,
  p_make TEXT,
  p_series TEXT DEFAULT NULL,
  p_body_style TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_library_id UUID;
BEGIN
  SELECT id INTO v_library_id
  FROM reference_libraries
  WHERE year = p_year
    AND make ILIKE p_make
    AND (p_series IS NULL OR series = p_series)
    AND (p_body_style IS NULL OR body_style = p_body_style)
  ORDER BY 
    CASE WHEN series = p_series THEN 1 ELSE 2 END,
    CASE WHEN body_style = p_body_style THEN 1 ELSE 2 END
  LIMIT 1;
  
  RETURN v_library_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Increment document stats
CREATE OR REPLACE FUNCTION increment_document_stat(
  p_document_id UUID,
  p_stat_type TEXT  -- 'view', 'download', 'bookmark'
)
RETURNS VOID AS $$
BEGIN
  IF p_stat_type = 'view' THEN
    UPDATE library_documents SET view_count = view_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'download' THEN
    UPDATE library_documents SET download_count = download_count + 1 WHERE id = p_document_id;
  ELSIF p_stat_type = 'bookmark' THEN
    UPDATE library_documents SET bookmark_count = bookmark_count + 1 WHERE id = p_document_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: TRIGGERS
-- ============================================

-- Auto-link vehicles when created
CREATE OR REPLACE FUNCTION trigger_auto_link_vehicle_library()
RETURNS TRIGGER AS $$
BEGIN
  -- Only auto-link if vehicle has year and make
  IF NEW.year IS NOT NULL AND NEW.make IS NOT NULL THEN
    PERFORM get_or_create_library_for_vehicle(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_link_vehicle_library ON vehicles;
CREATE TRIGGER trg_auto_link_vehicle_library
  AFTER INSERT ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_link_vehicle_library();

-- Update library stats when documents added/removed
CREATE OR REPLACE FUNCTION trigger_update_library_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE reference_libraries
    SET 
      document_count = document_count + 1,
      updated_at = NOW()
    WHERE id = NEW.library_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE reference_libraries
    SET 
      document_count = GREATEST(0, document_count - 1),
      updated_at = NOW()
    WHERE id = OLD.library_id;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_library_doc_stats ON library_documents;
CREATE TRIGGER trg_update_library_doc_stats
  AFTER INSERT OR DELETE ON library_documents
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_library_stats();

-- ============================================
-- PART 6: RLS POLICIES
-- ============================================

ALTER TABLE reference_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_reference_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_document_bookmarks ENABLE ROW LEVEL SECURITY;

-- Reference Libraries: Public read, authenticated create
CREATE POLICY "ref_libraries_public_read" ON reference_libraries
  FOR SELECT TO public
  USING (true);

CREATE POLICY "ref_libraries_auth_create" ON reference_libraries
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "ref_libraries_auth_update" ON reference_libraries
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR auth.uid() = verified_by);

-- Library Documents: Public read, authenticated upload
CREATE POLICY "lib_docs_public_read" ON library_documents
  FOR SELECT TO public
  USING (true);

CREATE POLICY "lib_docs_auth_upload" ON library_documents
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "lib_docs_owner_update" ON library_documents
  FOR UPDATE TO authenticated
  USING (auth.uid() = uploaded_by OR auth.uid() = verified_by);

CREATE POLICY "lib_docs_owner_delete" ON library_documents
  FOR DELETE TO authenticated
  USING (auth.uid() = uploaded_by);

-- Public can update stats (views, downloads)
CREATE POLICY "lib_docs_public_stats" ON library_documents
  FOR UPDATE TO public
  USING (true)
  WITH CHECK (true);

-- Vehicle Links: Public read, auto-created by system
CREATE POLICY "vehicle_links_public_read" ON vehicle_reference_links
  FOR SELECT TO public
  USING (true);

CREATE POLICY "vehicle_links_system_create" ON vehicle_reference_links
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Bookmarks: User can manage their own
CREATE POLICY "bookmarks_user_manage" ON library_document_bookmarks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- PART 7: BACKFILL EXISTING VEHICLES
-- ============================================

-- Auto-link all existing vehicles to their libraries
DO $$
DECLARE
  v_record RECORD;
BEGIN
  FOR v_record IN 
    SELECT id FROM vehicles 
    WHERE year IS NOT NULL AND make IS NOT NULL
    LIMIT 1000  -- Process in batches to avoid timeout
  LOOP
    BEGIN
      PERFORM get_or_create_library_for_vehicle(v_record.id);
    EXCEPTION WHEN OTHERS THEN
      -- Skip if error, continue with next
      CONTINUE;
    END;
  END LOOP;
END $$;

-- ============================================
-- PART 8: STORAGE BUCKET
-- ============================================

-- Create storage bucket for reference documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'reference-docs',
  'reference-docs',
  true,
  104857600,  -- 100MB limit per file
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "ref_docs_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'reference-docs');

CREATE POLICY "ref_docs_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reference-docs');

CREATE POLICY "ref_docs_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'reference-docs' AND auth.uid()::text = owner);

-- ============================================
-- PART 9: HELPER FUNCTIONS
-- ============================================

-- Get all documents for a vehicle
CREATE OR REPLACE FUNCTION get_vehicle_library_documents(p_vehicle_id UUID)
RETURNS TABLE (
  document_id UUID,
  document_type TEXT,
  title TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  page_count INTEGER,
  uploaded_at TIMESTAMP WITH TIME ZONE,
  uploader_name TEXT
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
    ld.uploaded_at,
    COALESCE(p.full_name, p.username, 'Anonymous') as uploader_name
  FROM library_documents ld
  JOIN reference_libraries rl ON rl.id = ld.library_id
  JOIN vehicle_reference_links vrl ON vrl.library_id = rl.id
  LEFT JOIN profiles p ON p.id = ld.uploaded_by
  WHERE vrl.vehicle_id = p_vehicle_id
  ORDER BY 
    CASE ld.document_type
      WHEN 'brochure' THEN 1
      WHEN 'owners_manual' THEN 2
      WHEN 'service_manual' THEN 3
      WHEN 'spec_sheet' THEN 4
      ELSE 5
    END,
    ld.uploaded_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Search libraries
CREATE OR REPLACE FUNCTION search_libraries(
  p_year INTEGER DEFAULT NULL,
  p_make TEXT DEFAULT NULL,
  p_series TEXT DEFAULT NULL
)
RETURNS TABLE (
  library_id UUID,
  year INTEGER,
  make TEXT,
  series TEXT,
  body_style TEXT,
  document_count BIGINT,
  vehicle_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rl.id,
    rl.year,
    rl.make,
    rl.series,
    rl.body_style,
    COUNT(DISTINCT ld.id) as document_count,
    COUNT(DISTINCT vrl.vehicle_id) as vehicle_count
  FROM reference_libraries rl
  LEFT JOIN library_documents ld ON ld.library_id = rl.id
  LEFT JOIN vehicle_reference_links vrl ON vrl.library_id = rl.id
  WHERE (p_year IS NULL OR rl.year = p_year)
    AND (p_make IS NULL OR rl.make ILIKE p_make)
    AND (p_series IS NULL OR rl.series = p_series)
  GROUP BY rl.id
  ORDER BY rl.year DESC, rl.make, rl.series;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 10: COMMENTS
-- ============================================

COMMENT ON TABLE reference_libraries IS 'Central repository for factory documentation organized by Year/Make/Model/Series';
COMMENT ON TABLE library_documents IS 'Individual documents (brochures, manuals, specs) in each library';
COMMENT ON TABLE vehicle_reference_links IS 'Links vehicles to their appropriate reference libraries';
COMMENT ON FUNCTION get_or_create_library_for_vehicle IS 'Auto-links vehicle to appropriate library, creating library if needed';
COMMENT ON FUNCTION get_vehicle_library_documents IS 'Returns all reference documents available for a specific vehicle';

-- ============================================
-- PART 11: DOCUMENT TYPE ENUM (for reference)
-- ============================================

-- Valid document types (enforced in application layer):
-- - brochure
-- - owners_manual
-- - service_manual
-- - parts_catalog
-- - spec_sheet
-- - paint_codes
-- - rpo_codes
-- - wiring_diagram
-- - build_sheet
-- - recall_notice
-- - tsb (technical service bulletin)
-- - other

