-- =============================================================================
-- MIGRATION: Publications System
-- Creates 2 new tables: publications + publication_pages
-- Mirrors vehicles + vehicle_images pattern for Issuu publication extraction
-- =============================================================================

-- publications: mirrors vehicles pattern
CREATE TABLE IF NOT EXISTS publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),

  -- Identity
  publisher_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'issuu',
  platform_id TEXT,
  platform_url TEXT NOT NULL,
  cdn_hash TEXT,

  -- Metadata
  publication_date DATE,
  issue_number TEXT,
  page_count INTEGER,
  language TEXT DEFAULT 'en',

  -- Classification
  publication_type TEXT,

  -- Cover image
  cover_image_url TEXT,
  storage_cover_path TEXT,

  -- Extraction pipeline
  extraction_status TEXT DEFAULT 'pending'
    CHECK (extraction_status IN (
      'pending', 'pending_hash', 'hash_extracted',
      'pages_indexed', 'analyzing', 'complete', 'failed'
    )),
  extraction_metadata JSONB DEFAULT '{}',

  -- Standard fields
  source TEXT DEFAULT 'issuu_import',
  data_quality_score INTEGER DEFAULT 0,
  search_vector TSVECTOR,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(publisher_slug, slug, platform)
);

-- publication_pages: mirrors vehicle_images pattern
CREATE TABLE IF NOT EXISTS publication_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id UUID REFERENCES publications(id) ON DELETE CASCADE,

  -- Page identity
  page_number INTEGER NOT NULL,
  page_type TEXT,

  -- Image
  image_url TEXT,
  storage_image_path TEXT,
  thumbnail_url TEXT,

  -- Text extraction
  extracted_text TEXT,
  extraction_confidence FLOAT,

  -- AI analysis
  ai_scan_metadata JSONB DEFAULT '{}',
  ai_last_scanned TIMESTAMPTZ,
  ai_processing_status TEXT DEFAULT 'pending'
    CHECK (ai_processing_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  analysis_model TEXT,
  analysis_cost NUMERIC,

  -- Spatial entity tags (same pattern as vehicle_images.spatial_tags)
  spatial_tags JSONB DEFAULT '[]',

  -- Queue management
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,

  -- Standard fields
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(publication_id, page_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_publications_org ON publications(organization_id);
CREATE INDEX IF NOT EXISTS idx_publications_platform ON publications(platform, platform_url);
CREATE INDEX IF NOT EXISTS idx_publications_date ON publications(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_publications_type ON publications(publication_type);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(extraction_status);
CREATE INDEX IF NOT EXISTS idx_publications_cdn_hash ON publications(cdn_hash);
CREATE INDEX IF NOT EXISTS idx_publications_publisher ON publications(publisher_slug);
CREATE INDEX IF NOT EXISTS idx_publications_search ON publications USING GIN(search_vector);

CREATE INDEX IF NOT EXISTS idx_pub_pages_publication ON publication_pages(publication_id);
CREATE INDEX IF NOT EXISTS idx_pub_pages_type ON publication_pages(page_type);
CREATE INDEX IF NOT EXISTS idx_pub_pages_ai_status ON publication_pages(ai_processing_status);
CREATE INDEX IF NOT EXISTS idx_pub_pages_spatial ON publication_pages USING GIN(spatial_tags);
CREATE INDEX IF NOT EXISTS idx_pub_pages_locked ON publication_pages(locked_by) WHERE locked_by IS NOT NULL;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_publications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER publications_updated_at
  BEFORE UPDATE ON publications
  FOR EACH ROW
  EXECUTE FUNCTION update_publications_updated_at();

CREATE OR REPLACE FUNCTION update_publication_pages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER publication_pages_updated_at
  BEFORE UPDATE ON publication_pages
  FOR EACH ROW
  EXECUTE FUNCTION update_publication_pages_updated_at();

-- Trigger: auto-populate search_vector
CREATE OR REPLACE FUNCTION update_publications_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector = to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.slug, '') || ' ' ||
    coalesce(NEW.publisher_slug, '') || ' ' ||
    coalesce(NEW.issue_number, '') || ' ' ||
    coalesce(NEW.publication_type, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER publications_search_vector
  BEFORE INSERT OR UPDATE ON publications
  FOR EACH ROW
  EXECUTE FUNCTION update_publications_search_vector();

-- RLS
ALTER TABLE publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE publication_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publications_read" ON publications FOR SELECT USING (true);
CREATE POLICY "publications_insert" ON publications FOR INSERT WITH CHECK (true);
CREATE POLICY "publications_update" ON publications FOR UPDATE USING (true);

CREATE POLICY "pub_pages_read" ON publication_pages FOR SELECT USING (true);
CREATE POLICY "pub_pages_insert" ON publication_pages FOR INSERT WITH CHECK (true);
CREATE POLICY "pub_pages_update" ON publication_pages FOR UPDATE USING (true);
