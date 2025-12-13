-- Add fields needed for Classic.com dealer indexing
-- Supports geographic matching and dealer license tracking

-- Add dealer_license to organizations (businesses table)
DO $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'dealer_license'
    ) THEN
      ALTER TABLE businesses ADD COLUMN dealer_license TEXT;
      CREATE INDEX IF NOT EXISTS idx_businesses_dealer_license ON businesses(dealer_license) WHERE dealer_license IS NOT NULL;
    END IF;
  END IF;
END $$;

-- Add geographic_key for matching organizations by name+location
DO $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'geographic_key'
    ) THEN
      ALTER TABLE businesses ADD COLUMN geographic_key TEXT;
      CREATE INDEX IF NOT EXISTS idx_businesses_geographic_key ON businesses(geographic_key) WHERE geographic_key IS NOT NULL;
    END IF;
  END IF;
END $$;

-- Add source_url to track where organization was discovered
DO $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'source_url'
    ) THEN
      ALTER TABLE businesses ADD COLUMN source_url TEXT;
    END IF;
  END IF;
END $$;

-- Ensure type can handle auction_house
DO $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    -- Check if type column exists and what values it accepts
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'type'
    ) THEN
      NULL; -- Column exists, nothing to do
    ELSE
      -- Add type column if it doesn't exist
      ALTER TABLE businesses ADD COLUMN type TEXT;
      -- Add check constraint for valid types
      ALTER TABLE businesses ADD CONSTRAINT businesses_type_check 
        CHECK (type IN ('dealer', 'auction_house', 'marketplace', 'garage', 'dealership', 'restoration_shop', 'performance_shop'));
    END IF;
  END IF;
END $$;

-- Add discovered_via to track indexing source
DO $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'businesses' AND column_name = 'discovered_via'
    ) THEN
      ALTER TABLE businesses ADD COLUMN discovered_via TEXT;
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.businesses') IS NOT NULL THEN
    EXECUTE 'COMMENT ON COLUMN businesses.dealer_license IS ''Dealer license number - key identifier for matching organizations''';
    EXECUTE 'COMMENT ON COLUMN businesses.geographic_key IS ''Composite key: name-city-state for geographic matching (prevents mixing inventories)''';
    EXECUTE 'COMMENT ON COLUMN businesses.source_url IS ''URL where this organization was discovered (e.g., Classic.com profile)''';
    EXECUTE 'COMMENT ON COLUMN businesses.discovered_via IS ''Method used to discover organization (e.g., classic_com_indexing, scraper, manual)''';
  END IF;
END $$;


