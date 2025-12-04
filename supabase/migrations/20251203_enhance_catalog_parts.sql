-- ENHANCE CATALOG PARTS SCHEMA
-- Adds comprehensive product data columns for complete catalog functionality

-- Add missing columns to catalog_parts
ALTER TABLE catalog_parts
  ADD COLUMN IF NOT EXISTS product_image_url TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT DEFAULT 'LMC',
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS fits_models TEXT[],
  ADD COLUMN IF NOT EXISTS year_start INTEGER,
  ADD COLUMN IF NOT EXISTS year_end INTEGER,
  ADD COLUMN IF NOT EXISTS in_stock BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS supplier_url TEXT,
  ADD COLUMN IF NOT EXISTS weight_lbs NUMERIC,
  ADD COLUMN IF NOT EXISTS dimensions JSONB,
  ADD COLUMN IF NOT EXISTS installation_difficulty TEXT,
  ADD COLUMN IF NOT EXISTS related_parts TEXT[];

-- Add indexes for search performance
CREATE INDEX IF NOT EXISTS idx_catalog_parts_category ON catalog_parts(category);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_subcategory ON catalog_parts(subcategory);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_year_range ON catalog_parts(year_start, year_end);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_models ON catalog_parts USING GIN(fits_models);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_in_stock ON catalog_parts(in_stock);

-- Add catalog_pages section tracking
ALTER TABLE catalog_pages
  ADD COLUMN IF NOT EXISTS section TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS subcategory TEXT;

CREATE INDEX IF NOT EXISTS idx_catalog_pages_section ON catalog_pages(section);

-- Create storage bucket for product images
INSERT INTO storage.buckets (id, name, public)
VALUES ('catalog-images', 'catalog-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy for catalog images
CREATE POLICY IF NOT EXISTS "Public read catalog images"
ON storage.objects FOR SELECT
USING (bucket_id = 'catalog-images');

CREATE POLICY IF NOT EXISTS "Service role upload catalog images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'catalog-images' AND auth.role() = 'service_role');

COMMENT ON COLUMN catalog_parts.product_image_url IS 'Direct link to product photo';
COMMENT ON COLUMN catalog_parts.category IS 'Main category: Interior, Exterior, Engine, etc.';
COMMENT ON COLUMN catalog_parts.subcategory IS 'Sub-category: Seats, Bumpers, Cooling, etc.';
COMMENT ON COLUMN catalog_parts.fits_models IS 'Array of model names: C10, K10, Blazer';
COMMENT ON COLUMN catalog_parts.year_start IS 'Starting year of compatibility';
COMMENT ON COLUMN catalog_parts.year_end IS 'Ending year of compatibility';
COMMENT ON COLUMN catalog_parts.supplier_url IS 'Direct link to product on supplier website';
COMMENT ON COLUMN catalog_parts.related_parts IS 'Part numbers often bought together';

