-- Universal paint_codes table — cross-manufacturer paint code reference
-- Replaces the GM-only gm_paint_codes with a unified table.

-- ============================================================================
-- 1. Create universal paint_codes table
-- ============================================================================
CREATE TABLE IF NOT EXISTS paint_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make TEXT NOT NULL,                  -- Manufacturer: 'Porsche', 'Chevrolet', 'BMW', etc.
  code TEXT NOT NULL,                  -- OEM paint code: 'L1A1', 'WA8867', 'M3M3'
  name TEXT NOT NULL,                  -- Color name: 'Guards Red', 'Summit White'
  hex_color TEXT,                      -- CSS hex: '#FF0000'
  color_family TEXT,                   -- Normalized family: 'red', 'blue', 'silver', 'black'
  type TEXT,                           -- 'solid', 'metallic', 'pearl', 'matte', 'two-tone'
  year_start INTEGER,                  -- First model year this code was available
  year_end INTEGER,                    -- Last model year (NULL = still in production)
  source TEXT DEFAULT 'seed',          -- 'seed', 'oem_docs', 'user_contributed', 'ai_extracted'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (make, code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_paint_codes_make ON paint_codes (lower(make));
CREATE INDEX IF NOT EXISTS idx_paint_codes_name ON paint_codes USING gin (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_paint_codes_family ON paint_codes (color_family);
CREATE INDEX IF NOT EXISTS idx_paint_codes_years ON paint_codes (year_start, year_end);

-- RLS
ALTER TABLE paint_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paint_codes_read" ON paint_codes
  FOR SELECT TO public USING (true);

CREATE POLICY "paint_codes_insert" ON paint_codes
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "paint_codes_update" ON paint_codes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE paint_codes IS 'Universal cross-manufacturer paint code reference for MicroPortal ColorPortal';

-- ============================================================================
-- 2. Migrate existing GM paint codes into universal table
-- ============================================================================
INSERT INTO paint_codes (make, code, name, hex_color, color_family, type, year_start, year_end, source)
SELECT
  unnest(gpc.brands) as make,
  gpc.code,
  gpc.name,
  gpc.hex_color,
  CASE
    WHEN lower(gpc.name) LIKE '%black%' OR lower(gpc.name) LIKE '%onyx%' OR lower(gpc.name) LIKE '%tuxedo%' THEN 'black'
    WHEN lower(gpc.name) LIKE '%white%' OR lower(gpc.name) LIKE '%summit%' OR lower(gpc.name) LIKE '%olympic%' THEN 'white'
    WHEN lower(gpc.name) LIKE '%red%' OR lower(gpc.name) LIKE '%victory%' OR lower(gpc.name) LIKE '%flame%' OR lower(gpc.name) LIKE '%hugger%' THEN 'red'
    WHEN lower(gpc.name) LIKE '%blue%' THEN 'blue'
    WHEN lower(gpc.name) LIKE '%silver%' THEN 'silver'
    WHEN lower(gpc.name) LIKE '%bronze%' OR lower(gpc.name) LIKE '%brown%' OR lower(gpc.name) LIKE '%sandalwood%' THEN 'brown'
    WHEN lower(gpc.name) LIKE '%orange%' THEN 'orange'
    ELSE NULL
  END as color_family,
  gpc.type,
  gpc.year_start,
  gpc.year_end,
  'seed'
FROM gm_paint_codes gpc
ON CONFLICT (make, code) DO NOTHING;

-- ============================================================================
-- 3. Seed Porsche factory colors — first cross-manufacturer data
-- ============================================================================
INSERT INTO paint_codes (make, code, name, hex_color, color_family, type, year_start, year_end, source) VALUES
  -- Classic Porsche colors
  ('Porsche', 'L1A1', 'Guards Red', '#FF0000', 'red', 'solid', 1974, NULL, 'seed'),
  ('Porsche', 'L3AZ', 'Speed Yellow', '#FFD700', 'yellow', 'solid', 1995, 2005, 'seed'),
  ('Porsche', 'LM7W', 'Arctic Silver Metallic', '#C0C0C0', 'silver', 'metallic', 1999, 2012, 'seed'),
  ('Porsche', 'LM9A', 'Lapis Blue Metallic', '#1E3A5F', 'blue', 'metallic', 1998, 2002, 'seed'),
  ('Porsche', 'L5C1', 'Riviera Blue', '#4682B4', 'blue', 'solid', 1994, 1999, 'seed'),
  ('Porsche', 'LM6C', 'Midnight Blue Metallic', '#003366', 'blue', 'metallic', 2006, 2020, 'seed'),
  ('Porsche', 'LM4S', 'Aventurine Green Metallic', '#4B6F44', 'green', 'metallic', 2019, NULL, 'seed'),
  ('Porsche', 'L3K7', 'Racing Yellow', '#FFD100', 'yellow', 'solid', 2003, NULL, 'seed'),
  ('Porsche', 'L6D9', 'Python Green', '#8DB600', 'green', 'solid', 2018, NULL, 'seed'),
  ('Porsche', 'L2A1', 'Signal Yellow', '#FFE135', 'yellow', 'solid', 1974, 1981, 'seed'),
  ('Porsche', 'LM8Y', 'Chalk', '#D3CEC4', 'white', 'solid', 2018, NULL, 'seed'),
  ('Porsche', 'LB9A', 'Carrera White', '#F2F2F2', 'white', 'solid', 1974, 1998, 'seed'),
  ('Porsche', 'L041', 'Black', '#000000', 'black', 'solid', 1965, NULL, 'seed'),
  ('Porsche', 'LM9Z', 'Jet Black Metallic', '#1A1A1A', 'black', 'metallic', 1999, NULL, 'seed'),
  ('Porsche', 'LM3D', 'Gentian Blue Metallic', '#2E4A7A', 'blue', 'metallic', 2016, NULL, 'seed'),
  ('Porsche', 'LM7Z', 'Rhodium Silver Metallic', '#ABABAB', 'silver', 'metallic', 2008, 2020, 'seed'),
  ('Porsche', 'LB7S', 'Seal Grey Metallic', '#7B8B8B', 'grey', 'metallic', 2004, 2008, 'seed'),
  ('Porsche', 'LM6A', 'Basalt Black Metallic', '#3B3B3B', 'black', 'metallic', 2004, 2012, 'seed'),
  ('Porsche', 'L3T7', 'Lava Orange', '#FF6600', 'orange', 'solid', 2007, 2020, 'seed'),
  ('Porsche', 'LM8Z', 'Miami Blue', '#00BFFF', 'blue', 'solid', 2016, NULL, 'seed'),
  ('Porsche', 'L2A7', 'Rubystone Red', '#9B1B30', 'red', 'solid', 1991, 1995, 'seed'),
  ('Porsche', 'LM3B', 'GT Silver Metallic', '#A9A9A9', 'silver', 'metallic', 2003, NULL, 'seed'),
  ('Porsche', 'L5B7', 'Mexico Blue', '#0070C0', 'blue', 'solid', 1972, 1981, 'seed'),
  ('Porsche', 'LA3X', 'Crayon', '#C9C5BE', 'grey', 'solid', 2019, NULL, 'seed'),
  ('Porsche', 'LM8W', 'Shark Blue', '#3A6B94', 'blue', 'metallic', 2022, NULL, 'seed')
ON CONFLICT (make, code) DO NOTHING;

-- ============================================================================
-- 4. Seed BMW M colors (bonus — another high-signal make)
-- ============================================================================
INSERT INTO paint_codes (make, code, name, hex_color, color_family, type, year_start, year_end, source) VALUES
  ('BMW', 'A96', 'Mineral White Metallic', '#F0EDE6', 'white', 'metallic', 2011, NULL, 'seed'),
  ('BMW', '475', 'Black Sapphire Metallic', '#1C1C1C', 'black', 'metallic', 2001, NULL, 'seed'),
  ('BMW', '668', 'Jet Black', '#000000', 'black', 'solid', 1994, NULL, 'seed'),
  ('BMW', 'B45', 'Alpine White', '#FFFFFF', 'white', 'solid', 1979, NULL, 'seed'),
  ('BMW', 'C31', 'Sao Paulo Yellow', '#FFD700', 'yellow', 'solid', 2020, NULL, 'seed'),
  ('BMW', 'B68', 'Frozen Marina Bay Blue', '#3B6DB1', 'blue', 'matte', 2018, NULL, 'seed'),
  ('BMW', 'C1M', 'Isle of Man Green Metallic', '#2E3B2E', 'green', 'metallic', 2020, NULL, 'seed'),
  ('BMW', 'S54', 'Imola Red', '#CC0000', 'red', 'solid', 1999, 2003, 'seed'),
  ('BMW', 'A83', 'Glacier Silver Metallic', '#BEC0C2', 'silver', 'metallic', 2011, NULL, 'seed'),
  ('BMW', 'B39', 'Mineral Grey Metallic', '#6E6E6E', 'grey', 'metallic', 2014, NULL, 'seed'),
  ('BMW', 'A90', 'Frozen Dark Grey', '#4A4A4A', 'grey', 'matte', 2013, NULL, 'seed'),
  ('BMW', '381', 'Laguna Seca Blue', '#4FA3D1', 'blue', 'solid', 2001, 2002, 'seed'),
  ('BMW', 'C2Y', 'Zanzibar Metallic', '#3F3028', 'brown', 'metallic', 2020, NULL, 'seed'),
  ('BMW', 'A52', 'Space Grey Metallic', '#646464', 'grey', 'metallic', 2005, 2020, 'seed'),
  ('BMW', 'A76', 'Deep Sea Blue Metallic', '#1B3353', 'blue', 'metallic', 2011, 2018, 'seed')
ON CONFLICT (make, code) DO NOTHING;
