-- PARTS CATALOG SYSTEM
-- Transforms PDF catalogs into structured, shoppable data

-- 1. The Catalog Source
CREATE TABLE IF NOT EXISTS catalog_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "LMC Truck 1973-1987"
  provider TEXT NOT NULL, -- "LMC", "Classic Industries"
  base_url TEXT, -- Website base URL
  pdf_document_id UUID REFERENCES library_documents(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Pages (for reference/citation)
CREATE TABLE IF NOT EXISTS catalog_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id UUID REFERENCES catalog_sources(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  image_url TEXT, -- Screenshot of the page
  raw_text TEXT,
  embedding VECTOR(1536), -- For semantic search
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(catalog_id, page_number)
);

-- 3. Diagrams (Visual indexing)
CREATE TABLE IF NOT EXISTS catalog_diagrams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID REFERENCES catalog_pages(id) ON DELETE CASCADE,
  name TEXT, -- "Front Bumper Assembly"
  image_url TEXT, -- Cropped diagram image
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. The Parts (Atomic units)
CREATE TABLE IF NOT EXISTS catalog_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id UUID REFERENCES catalog_sources(id),
  page_id UUID REFERENCES catalog_pages(id),
  diagram_id UUID REFERENCES catalog_diagrams(id),
  
  part_number TEXT NOT NULL, -- "38-9630"
  name TEXT NOT NULL, -- "Bumper Bolt Kit"
  description TEXT,
  price_current NUMERIC,
  currency TEXT DEFAULT 'USD',
  
  -- Application Logic (JSONB for flexibility)
  -- { "years": [1973, 1974], "models": ["C10", "K10"], "notes": "Chrome only" }
  application_data JSONB, 
  
  -- Vector search
  name_embedding VECTOR(1536), 
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. AI Matches (The "Shopping List")
CREATE TABLE IF NOT EXISTS vehicle_part_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  image_id UUID REFERENCES vehicle_images(id), -- The image that triggered this
  catalog_part_id UUID REFERENCES catalog_parts(id),
  
  confidence_score NUMERIC, -- AI confidence 0-100
  match_reason TEXT, -- "Visual match on bumper style + verified 1973 year"
  
  user_action TEXT CHECK (user_action IN ('viewed', 'saved', 'purchased', 'rejected')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_parts_number ON catalog_parts(part_number);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_name ON catalog_parts USING ivfflat (name_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_part_matches_vehicle ON vehicle_part_matches(vehicle_id);

-- RLS
ALTER TABLE catalog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_diagrams ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_part_matches ENABLE ROW LEVEL SECURITY;

-- Policies (Open read, Admin write)
CREATE POLICY "Public read catalogs" ON catalog_sources FOR SELECT USING (true);
CREATE POLICY "Public read pages" ON catalog_pages FOR SELECT USING (true);
CREATE POLICY "Public read parts" ON catalog_parts FOR SELECT USING (true);

-- User matches
CREATE POLICY "User view own matches" ON vehicle_part_matches 
  FOR SELECT USING (auth.uid() IN (
    SELECT user_id FROM vehicles WHERE id = vehicle_id
  ));

