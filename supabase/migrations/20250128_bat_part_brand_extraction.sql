-- Migration: BAT Part/Brand Extraction System
-- Stores extracted part and brand information from Bring a Trailer listings
-- Links to images and provides provenance via BAT listing URL

-- Table to store extracted parts/brands from BAT listings
CREATE TABLE IF NOT EXISTS bat_listing_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  bat_listing_url TEXT NOT NULL,
  part_name TEXT NOT NULL,
  brand_name TEXT,
  part_number TEXT,
  description TEXT,
  context_text TEXT, -- Original text from listing mentioning this part
  confidence_score INTEGER DEFAULT 80, -- 0-100, how confident we are in extraction
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Index for fast lookups
  CONSTRAINT bat_listing_parts_vehicle_listing_part UNIQUE (vehicle_id, bat_listing_url, part_name, brand_name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bat_listing_parts_vehicle ON bat_listing_parts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_bat_listing_parts_brand ON bat_listing_parts(brand_name);
CREATE INDEX IF NOT EXISTS idx_bat_listing_parts_part ON bat_listing_parts(part_name);
CREATE INDEX IF NOT EXISTS idx_bat_listing_parts_url ON bat_listing_parts(bat_listing_url);

-- Link extracted parts to image tags
CREATE TABLE IF NOT EXISTS image_tag_bat_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_tag_id UUID NOT NULL REFERENCES image_tags(id) ON DELETE CASCADE,
  bat_listing_part_id UUID NOT NULL REFERENCES bat_listing_parts(id) ON DELETE CASCADE,
  match_confidence INTEGER DEFAULT 80, -- How well the tag matches the BAT part
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (image_tag_id, bat_listing_part_id)
);

CREATE INDEX IF NOT EXISTS idx_image_tag_bat_refs_tag ON image_tag_bat_references(image_tag_id);
CREATE INDEX IF NOT EXISTS idx_image_tag_bat_refs_part ON image_tag_bat_references(bat_listing_part_id);

-- RLS Policies
ALTER TABLE bat_listing_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_tag_bat_references ENABLE ROW LEVEL SECURITY;

-- Public read access (BAT listings are public)
DROP POLICY IF EXISTS bat_listing_parts_select_all ON bat_listing_parts;
CREATE POLICY bat_listing_parts_select_all ON bat_listing_parts
  FOR SELECT USING (true);

-- Service role can insert/update
DROP POLICY IF EXISTS bat_listing_parts_service_all ON bat_listing_parts;
CREATE POLICY bat_listing_parts_service_all ON bat_listing_parts
  FOR ALL USING (auth.role() = 'service_role');

-- Public read for references
DROP POLICY IF EXISTS image_tag_bat_refs_select_all ON image_tag_bat_references;
CREATE POLICY image_tag_bat_refs_select_all ON image_tag_bat_references
  FOR SELECT USING (true);

-- Service role can insert
DROP POLICY IF EXISTS image_tag_bat_refs_service_all ON image_tag_bat_references;
CREATE POLICY image_tag_bat_refs_service_all ON image_tag_bat_references
  FOR ALL USING (auth.role() = 'service_role');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_bat_listing_parts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bat_listing_parts_updated_at
  BEFORE UPDATE ON bat_listing_parts
  FOR EACH ROW
  EXECUTE FUNCTION update_bat_listing_parts_updated_at();

-- View to see parts with their BAT provenance
CREATE OR REPLACE VIEW bat_listing_parts_with_references AS
SELECT 
  blp.*,
  COUNT(itbr.id) as image_tag_count,
  ARRAY_AGG(DISTINCT it.image_id) FILTER (WHERE it.image_id IS NOT NULL) as linked_image_ids
FROM bat_listing_parts blp
LEFT JOIN image_tag_bat_references itbr ON itbr.bat_listing_part_id = blp.id
LEFT JOIN image_tags it ON it.id = itbr.image_tag_id
GROUP BY blp.id;

COMMENT ON TABLE bat_listing_parts IS 'Extracted parts and brands from Bring a Trailer listings, providing provenance for vehicle modifications';
COMMENT ON TABLE image_tag_bat_references IS 'Links image tags to BAT listing parts, legitimizing part identifications with external references';

