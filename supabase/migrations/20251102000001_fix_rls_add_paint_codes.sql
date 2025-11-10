-- Fix RLS policies for vehicle editing by contributors
-- Add GM paint code system with primary/secondary colors

-- 1. DROP conflicting UPDATE policies and create comprehensive one
DROP POLICY IF EXISTS "Simple vehicle update policy" ON vehicles;
DROP POLICY IF EXISTS "authenticated_users_can_update_vehicles" ON vehicles;

-- Allow updates by: owner, uploader, or contributors
CREATE POLICY "vehicles_update_by_contributors" ON vehicles
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = uploaded_by 
    OR auth.uid() = owner_id
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM vehicle_contributors vc
      WHERE vc.vehicle_id = vehicles.id
      AND vc.user_id = auth.uid()
      AND vc.role IN ('owner', 'restorer', 'contributor', 'moderator')
      AND (vc.end_date IS NULL OR vc.end_date > CURRENT_DATE)
    )
  )
  WITH CHECK (
    auth.uid() = uploaded_by 
    OR auth.uid() = owner_id
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM vehicle_contributors vc
      WHERE vc.vehicle_id = vehicles.id
      AND vc.user_id = auth.uid()
      AND vc.role IN ('owner', 'restorer', 'contributor', 'moderator')
      AND (vc.end_date IS NULL OR vc.end_date > CURRENT_DATE)
    )
  );

-- 2. Add RLS for vehicle_nomenclature if not exists
ALTER TABLE vehicle_nomenclature ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_nomenclature_read" ON vehicle_nomenclature;
CREATE POLICY "vehicle_nomenclature_read" ON vehicle_nomenclature
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "vehicle_nomenclature_insert" ON vehicle_nomenclature;
CREATE POLICY "vehicle_nomenclature_insert" ON vehicle_nomenclature
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_nomenclature.vehicle_id
      AND (
        auth.uid() = v.uploaded_by 
        OR auth.uid() = v.owner_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
          AND vc.user_id = auth.uid()
          AND vc.role IN ('owner', 'restorer', 'contributor', 'moderator')
        )
      )
    )
  );

DROP POLICY IF EXISTS "vehicle_nomenclature_update" ON vehicle_nomenclature;
CREATE POLICY "vehicle_nomenclature_update" ON vehicle_nomenclature
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_nomenclature.vehicle_id
      AND (
        auth.uid() = v.uploaded_by 
        OR auth.uid() = v.owner_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
          AND vc.user_id = auth.uid()
          AND vc.role IN ('owner', 'restorer', 'contributor', 'moderator')
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_nomenclature.vehicle_id
      AND (
        auth.uid() = v.uploaded_by 
        OR auth.uid() = v.owner_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
          AND vc.user_id = auth.uid()
          AND vc.role IN ('owner', 'restorer', 'contributor', 'moderator')
        )
      )
    )
  );

-- 3. Add RLS for vehicle_edit_history
ALTER TABLE vehicle_edit_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_edit_history_read" ON vehicle_edit_history;
CREATE POLICY "vehicle_edit_history_read" ON vehicle_edit_history
  FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "vehicle_edit_history_insert" ON vehicle_edit_history;
CREATE POLICY "vehicle_edit_history_insert" ON vehicle_edit_history
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = edited_by);

-- 4. Add color columns to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color_primary TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color_secondary TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS paint_code TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS paint_code_secondary TEXT;

-- Keep old 'color' field for backwards compatibility, but migrate data
UPDATE vehicles 
SET color_primary = color 
WHERE color IS NOT NULL AND color != '' AND color_primary IS NULL;

-- 5. Create GM paint code reference table
CREATE TABLE IF NOT EXISTS gm_paint_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hex_color TEXT,
  year_start INTEGER,
  year_end INTEGER,
  brands TEXT[], -- ['Chevrolet', 'GMC', 'Cadillac', etc.]
  type TEXT, -- 'solid', 'metallic', 'two-tone'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add common GM paint codes (sample data - can be expanded)
INSERT INTO gm_paint_codes (code, name, hex_color, year_start, year_end, brands, type) VALUES
  ('10', 'Tuxedo Black', '#000000', 1960, 2025, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('11', 'Jet Black', '#0A0A0A', 1973, 2025, ARRAY['Chevrolet', 'GMC', 'Cadillac'], 'solid'),
  ('13', 'Onyx Black', '#1A1A1A', 1988, 2025, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('40', 'Summit White', '#FFFFFF', 1960, 2025, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('41', 'Olympic White', '#F5F5F5', 1973, 1999, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('50', 'Light Blue', '#87CEEB', 1960, 1985, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('51', 'Medium Blue', '#4169E1', 1960, 1985, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('52', 'Dark Blue', '#00008B', 1960, 1985, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('63', 'Autumn Bronze', '#8B4513', 1973, 1987, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('67', 'Burnt Orange', '#CC5500', 1973, 1980, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('70', 'Bright Red', '#FF0000', 1960, 2025, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('72', 'Victory Red', '#C1272D', 1988, 2025, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('74', 'Hugger Orange', '#FF4500', 1969, 1975, ARRAY['Chevrolet'], 'solid'),
  ('75', 'Flame Red', '#DC143C', 1973, 1987, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('80', 'Silver Metallic', '#C0C0C0', 1960, 2025, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('86', 'Light Sandalwood', '#C19A6B', 1973, 1987, ARRAY['Chevrolet', 'GMC'], 'metallic'),
  ('GBA', 'Summit White', '#FFFFFF', 2000, 2025, ARRAY['Chevrolet', 'GMC'], 'solid'),
  ('WA8867', 'Summit White', '#FFFFFF', 1988, 2025, ARRAY['Chevrolet', 'GMC'], 'solid')
ON CONFLICT (code) DO NOTHING;

-- Enable RLS on paint codes
ALTER TABLE gm_paint_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gm_paint_codes_read" ON gm_paint_codes
  FOR SELECT
  TO public
  USING (true);

-- Admins can insert/update paint codes (simplified for now - expand later)
CREATE POLICY "gm_paint_codes_insert" ON gm_paint_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "gm_paint_codes_update" ON gm_paint_codes
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicles_color_primary ON vehicles(color_primary);
CREATE INDEX IF NOT EXISTS idx_vehicles_paint_code ON vehicles(paint_code);
CREATE INDEX IF NOT EXISTS idx_gm_paint_codes_code ON gm_paint_codes(code);
CREATE INDEX IF NOT EXISTS idx_gm_paint_codes_name ON gm_paint_codes(name);
CREATE INDEX IF NOT EXISTS idx_gm_paint_codes_years ON gm_paint_codes(year_start, year_end);

COMMENT ON COLUMN vehicles.color_primary IS 'Primary exterior color name';
COMMENT ON COLUMN vehicles.color_secondary IS 'Secondary exterior color (for two-tone)';
COMMENT ON COLUMN vehicles.paint_code IS 'OEM paint code (e.g., GM code 10, 40, WA8867)';
COMMENT ON COLUMN vehicles.paint_code_secondary IS 'Secondary paint code for two-tone';
COMMENT ON TABLE gm_paint_codes IS 'GM OEM paint code reference database';

