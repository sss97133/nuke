-- Add compound index on vehicles(make, model, year) for the most common query pattern.
-- Also add CHECK constraints for data quality.

-- Compound index for make/model/year queries (case-insensitive make/model)
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model_year
  ON vehicles (lower(make), lower(model), year);

-- Validate year is within reasonable range (1885 = first automobile, +2 for pre-production)
DO $$
BEGIN
  ALTER TABLE vehicles ADD CONSTRAINT chk_vehicle_year
    CHECK (year IS NULL OR (year >= 1885 AND year <= extract(year FROM now()) + 2));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Validate sale_price is positive when present
DO $$
BEGIN
  ALTER TABLE vehicles ADD CONSTRAINT chk_vehicle_sale_price
    CHECK (sale_price IS NULL OR sale_price > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
