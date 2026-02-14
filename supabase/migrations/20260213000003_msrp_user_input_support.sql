-- MSRP enrichment support — track source and contributor for user-contributed pricing
-- Supports PricePortal's MSRP contribution flow

-- ============================================================================
-- 1. Add msrp_source to vehicles
--    Tracks where the MSRP value came from
-- ============================================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS msrp_source TEXT;
COMMENT ON COLUMN vehicles.msrp_source IS 'Source of MSRP value: oem, user, ai_estimated, listing_parsed';

-- ============================================================================
-- 2. Add msrp_contributed_by to vehicles
--    FK to auth.users for user-contributed MSRPs
-- ============================================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS msrp_contributed_by UUID REFERENCES auth.users(id);
COMMENT ON COLUMN vehicles.msrp_contributed_by IS 'User who contributed the MSRP value (for user-sourced MSRPs)';

-- ============================================================================
-- 3. Add check constraint for valid msrp_source values
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_vehicles_msrp_source'
  ) THEN
    ALTER TABLE vehicles ADD CONSTRAINT chk_vehicles_msrp_source
      CHECK (msrp_source IS NULL OR msrp_source IN ('oem', 'user', 'ai_estimated', 'listing_parsed'));
  END IF;
END $$;

-- ============================================================================
-- 4. Backfill msrp_source for existing MSRP values
--    Existing MSRPs without a source are assumed to be from OEM data or listing parsing
-- ============================================================================
UPDATE vehicles
SET msrp_source = 'listing_parsed'
WHERE msrp IS NOT NULL AND msrp > 0
  AND msrp_source IS NULL;

-- ============================================================================
-- 5. Index for querying vehicles by msrp_source
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_vehicles_msrp_source ON vehicles (msrp_source)
  WHERE msrp IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_msrp_contributed_by ON vehicles (msrp_contributed_by)
  WHERE msrp_contributed_by IS NOT NULL;
