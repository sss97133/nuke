-- Vehicle Content Sections Table
-- Stores structured content from auction listings (Doug's Take, highlights, equipment, etc.)

CREATE TABLE IF NOT EXISTS vehicle_content_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Section identification
  section_type TEXT NOT NULL,  -- 'dougs_take', 'highlights', 'equipment', 'modifications', 'known_flaws', 'service_history', 'seller_notes', 'carfax_url', 'video_url'

  -- Content (flexible - can be text, array, or JSON)
  content JSONB NOT NULL,

  -- Source tracking
  source TEXT DEFAULT 'cars_and_bids',  -- 'cars_and_bids', 'bring_a_trailer', 'manual', etc.
  source_url TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicates
  UNIQUE(vehicle_id, section_type, source)
);

-- Indexes
CREATE INDEX idx_vcs_vehicle_id ON vehicle_content_sections(vehicle_id);
CREATE INDEX idx_vcs_section_type ON vehicle_content_sections(section_type);
CREATE INDEX idx_vcs_source ON vehicle_content_sections(source);

-- RLS
ALTER TABLE vehicle_content_sections ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
CREATE POLICY "Allow read access to vehicle content sections"
  ON vehicle_content_sections FOR SELECT
  USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to vehicle content sections"
  ON vehicle_content_sections FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE vehicle_content_sections IS 'Stores structured content sections from vehicle listings (Doug''s Take, highlights, equipment, etc.)';
COMMENT ON COLUMN vehicle_content_sections.section_type IS 'Type of content: dougs_take, highlights, equipment, modifications, known_flaws, service_history, seller_notes, carfax_url, video_url';
COMMENT ON COLUMN vehicle_content_sections.content IS 'Content as JSONB - can be string, array of strings, or structured object';
