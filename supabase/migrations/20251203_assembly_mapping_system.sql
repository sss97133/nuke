-- ASSEMBLY MAPPING SYSTEM
-- Maps LMC assembly diagrams to individual parts with callout numbers

-- Assembly groupings (one image, many parts)
CREATE TABLE IF NOT EXISTS part_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- "1973-74 Grille Complete Assembly"
  slug TEXT UNIQUE, -- "cc-1973-74-grille-and-components"
  assembly_image_url TEXT, -- Main diagram with numbered callouts
  source_url TEXT, -- Original LMC page URL
  category TEXT,
  subcategory TEXT,
  description TEXT,
  fits_year_start INTEGER,
  fits_year_end INTEGER,
  fits_models TEXT[],
  total_parts_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Callout mapping (which number on diagram = which part)
CREATE TABLE IF NOT EXISTS assembly_callouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id UUID REFERENCES part_assemblies(id) ON DELETE CASCADE,
  part_id UUID REFERENCES catalog_parts(id) ON DELETE CASCADE,
  callout_number INTEGER NOT NULL, -- The number shown on the diagram (1, 2, 3, etc.)
  quantity INTEGER DEFAULT 1, -- How many of this part in the assembly
  role TEXT CHECK (role IN ('primary', 'hardware', 'fastener', 'gasket', 'optional')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assembly_id, callout_number)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_assembly_callouts_assembly ON assembly_callouts(assembly_id);
CREATE INDEX IF NOT EXISTS idx_assembly_callouts_part ON assembly_callouts(part_id);
CREATE INDEX IF NOT EXISTS idx_assemblies_slug ON part_assemblies(slug);
CREATE INDEX IF NOT EXISTS idx_assemblies_category ON part_assemblies(category);

-- RLS Policies
ALTER TABLE part_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_callouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read assemblies" ON part_assemblies FOR SELECT USING (true);
CREATE POLICY "Public read callouts" ON assembly_callouts FOR SELECT USING (true);

-- Helper function to get all parts in an assembly
CREATE OR REPLACE FUNCTION get_assembly_parts(assembly_uuid UUID)
RETURNS TABLE (
  callout_number INTEGER,
  quantity INTEGER,
  part_number TEXT,
  part_name TEXT,
  price NUMERIC,
  role TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ac.callout_number,
    ac.quantity,
    cp.part_number,
    cp.name as part_name,
    cp.price_current as price,
    ac.role
  FROM assembly_callouts ac
  JOIN catalog_parts cp ON ac.part_id = cp.id
  WHERE ac.assembly_id = assembly_uuid
  ORDER BY ac.callout_number;
END;
$$ LANGUAGE plpgsql;

-- Helper function to get assemblies for a part
CREATE OR REPLACE FUNCTION get_part_assemblies(part_uuid UUID)
RETURNS TABLE (
  assembly_id UUID,
  assembly_name TEXT,
  assembly_image_url TEXT,
  callout_number INTEGER,
  total_parts INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pa.id as assembly_id,
    pa.name as assembly_name,
    pa.assembly_image_url,
    ac.callout_number,
    pa.total_parts_count as total_parts
  FROM assembly_callouts ac
  JOIN part_assemblies pa ON ac.assembly_id = pa.id
  WHERE ac.part_id = part_uuid;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE part_assemblies IS 'Groups related parts shown in assembly diagrams';
COMMENT ON TABLE assembly_callouts IS 'Maps diagram callout numbers to specific parts';
COMMENT ON COLUMN assembly_callouts.callout_number IS 'The number shown on the assembly diagram';
COMMENT ON COLUMN assembly_callouts.role IS 'primary = main component, hardware = bolts/screws, etc.';

