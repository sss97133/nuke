-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSOLIDATE ORGANIZATION TABLES
-- Merges: organizations (169) + shops (2) → businesses (282) as single canonical table
-- ═══════════════════════════════════════════════════════════════════════════════

-- ANALYSIS BEFORE MIGRATION:
--   businesses:     282 records (canonical per 20251101 migration)
--   organizations:  169 records (legacy parallel table)
--   shops:            2 records (nearly unused)
--   Duplicates:      14 exact name matches between businesses & organizations

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Add missing columns to businesses table
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS social_links JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS inventory_url TEXT,
  ADD COLUMN IF NOT EXISTS total_inventory INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_inventory_sync TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scrape_source_id UUID,
  ADD COLUMN IF NOT EXISTS dealer_type TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS legacy_org_id UUID,  -- Track where data came from
  ADD COLUMN IF NOT EXISTS hours_of_operation JSONB DEFAULT '{}'::JSONB;

-- Create unique index on slug (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_businesses_slug_unique') THEN
    CREATE UNIQUE INDEX idx_businesses_slug_unique ON businesses(slug) WHERE slug IS NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN businesses.slug IS 'URL-friendly identifier (migrated from organizations)';
COMMENT ON COLUMN businesses.legacy_org_id IS 'Original organizations.id for audit trail';

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Add 'collection' to business_type check constraint
-- ═══════════════════════════════════════════════════════════════════════════════

-- Drop existing constraint
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_business_type_check;

-- Add expanded constraint with collection type
ALTER TABLE businesses ADD CONSTRAINT businesses_business_type_check
CHECK (business_type IN (
  'sole_proprietorship', 'partnership', 'llc', 'corporation',
  'garage', 'dealership', 'restoration_shop', 'performance_shop',
  'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
  'parts_supplier', 'fabrication', 'racing_team',
  'auction_house', 'marketplace', 'concours', 'automotive_expo',
  'motorsport_event', 'rally_event', 'builder',
  'collection',  -- Private collections
  'dealer',      -- Generic dealer (maps from organizations)
  'forum',       -- Online forums (future use)
  'club',        -- Car clubs
  'media',       -- Magazines, YouTube channels
  'registry',    -- Vehicle registries
  'other'
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Migrate UNIQUE organizations into businesses
-- (Skip the 14 duplicates - they already exist in businesses)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO businesses (
  business_name,
  business_type,
  slug,
  description,
  website,
  email,
  phone,
  address,
  city,
  state,
  zip_code,
  country,
  latitude,
  longitude,
  logo_url,
  banner_url,
  dealer_license,
  is_verified,
  is_public,
  is_active,
  social_links,
  inventory_url,
  total_inventory,
  last_inventory_sync,
  specializations,
  scrape_source_id,
  dealer_type,
  source_url,
  discovered_via,
  hours_of_operation,
  legacy_org_id,
  metadata,
  created_at,
  updated_at
)
SELECT
  o.name AS business_name,
  -- Type mapping: organizations.type → businesses.business_type
  CASE o.type
    WHEN 'dealer' THEN 'dealer'
    WHEN 'shop' THEN 'restoration_shop'
    WHEN 'auction_house' THEN 'auction_house'
    WHEN 'collection' THEN 'collection'
    ELSE 'other'
  END AS business_type,
  o.slug,
  o.description,
  o.website,
  o.email,
  o.phone,
  o.address,
  o.city,
  o.state,
  o.zip AS zip_code,
  COALESCE(o.country, 'US') AS country,
  o.latitude,
  o.longitude,
  o.logo_url,
  o.banner_url,
  o.dealer_license,
  COALESCE(o.is_verified, false) AS is_verified,
  true AS is_public,
  COALESCE(o.is_active, true) AS is_active,
  COALESCE(o.social_links, '{}'::JSONB) AS social_links,
  o.inventory_url,
  COALESCE(o.total_inventory, 0) AS total_inventory,
  o.last_inventory_sync,
  COALESCE(o.specialties, ARRAY[]::TEXT[]) AS specializations,
  o.scrape_source_id,
  o.dealer_type,
  o.source_url,
  o.discovered_via,
  COALESCE(o.hours_of_operation, '{}'::JSONB) AS hours_of_operation,
  o.id AS legacy_org_id,
  jsonb_build_object(
    'migrated_from', 'organizations',
    'migrated_at', NOW(),
    'original_type', o.type,
    'squarebody_inventory', o.squarebody_inventory
  ) AS metadata,
  o.created_at,
  o.updated_at
FROM organizations o
WHERE NOT EXISTS (
  -- Skip if name already exists in businesses (the 14 duplicates)
  SELECT 1 FROM businesses b
  WHERE LOWER(TRIM(b.business_name)) = LOWER(TRIM(o.name))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Update existing businesses with any useful data from organizations
-- (For the 14 duplicates, merge metadata)
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE businesses b
SET
  slug = COALESCE(b.slug, o.slug),
  social_links = COALESCE(b.social_links, o.social_links, '{}'::JSONB),
  inventory_url = COALESCE(b.inventory_url, o.inventory_url),
  total_inventory = GREATEST(COALESCE(b.total_inventory, 0), COALESCE(o.total_inventory, 0)),
  last_inventory_sync = GREATEST(b.last_inventory_sync, o.last_inventory_sync),
  scrape_source_id = COALESCE(b.scrape_source_id, o.scrape_source_id),
  hours_of_operation = COALESCE(
    NULLIF(b.hours_of_operation, '{}'::JSONB),
    o.hours_of_operation,
    '{}'::JSONB
  ),
  legacy_org_id = o.id,
  metadata = COALESCE(b.metadata, '{}'::JSONB) || jsonb_build_object(
    'merged_from_organizations', true,
    'merged_at', NOW(),
    'original_org_id', o.id,
    'squarebody_inventory', o.squarebody_inventory
  ),
  updated_at = NOW()
FROM organizations o
WHERE LOWER(TRIM(b.business_name)) = LOWER(TRIM(o.name))
  AND b.legacy_org_id IS NULL;  -- Only update if not already merged

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Migrate shops table data into businesses
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO businesses (
  business_name,
  business_type,
  slug,
  description,
  website,
  email,
  phone,
  city,
  state,
  country,
  logo_url,
  is_verified,
  is_public,
  is_active,
  discovered_by,
  metadata,
  created_at,
  updated_at
)
SELECT
  s.name AS business_name,
  'restoration_shop' AS business_type,
  s.slug,
  s.description,
  s.website_url AS website,
  s.email,
  s.phone,
  s.location_city AS city,
  s.location_state AS state,
  COALESCE(s.location_country, 'US') AS country,
  s.logo_url,
  COALESCE(s.is_verified, false) AS is_verified,
  true AS is_public,
  true AS is_active,
  s.owner_user_id AS discovered_by,
  jsonb_build_object(
    'migrated_from', 'shops',
    'migrated_at', NOW(),
    'original_shop_id', s.id,
    'owner_user_id', s.owner_user_id
  ) AS metadata,
  s.created_at,
  s.updated_at
FROM shops s
WHERE NOT EXISTS (
  SELECT 1 FROM businesses b
  WHERE LOWER(TRIM(b.business_name)) = LOWER(TRIM(s.name))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: Create backward-compatible views
-- ═══════════════════════════════════════════════════════════════════════════════

-- View: organizations → businesses (for legacy code compatibility)
DROP VIEW IF EXISTS organizations_compat;
CREATE VIEW organizations_compat AS
SELECT
  id,
  business_name AS name,
  CASE business_type
    WHEN 'dealership' THEN 'dealer'
    WHEN 'dealer' THEN 'dealer'
    WHEN 'restoration_shop' THEN 'shop'
    WHEN 'performance_shop' THEN 'shop'
    WHEN 'specialty_shop' THEN 'shop'
    WHEN 'body_shop' THEN 'shop'
    WHEN 'auction_house' THEN 'auction_house'
    WHEN 'collection' THEN 'collection'
    ELSE 'dealer'
  END AS type,
  slug,
  description,
  website,
  email,
  phone,
  address,
  city,
  state,
  zip_code AS zip,
  country,
  latitude,
  longitude,
  logo_url,
  banner_url,
  dealer_license,
  dealer_type,
  is_verified,
  is_active,
  social_links,
  inventory_url,
  total_inventory,
  last_inventory_sync,
  specializations AS specialties,
  scrape_source_id,
  source_url,
  discovered_via,
  hours_of_operation,
  created_at,
  updated_at
FROM businesses
WHERE is_public = true OR is_active = true;

COMMENT ON VIEW organizations_compat IS 'Backward-compatible view mapping businesses to legacy organizations schema';

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: Update foreign key references (if any point to organizations)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Check for tables referencing organizations and update them
-- organization_vehicles already references businesses(id), so no change needed

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 8: Create migration tracking record
-- ═══════════════════════════════════════════════════════════════════════════════

-- Log the migration for auditing
DO $$
DECLARE
  orgs_migrated INTEGER;
  shops_migrated INTEGER;
  duplicates_merged INTEGER;
  total_businesses INTEGER;
BEGIN
  SELECT COUNT(*) INTO orgs_migrated FROM businesses WHERE legacy_org_id IS NOT NULL;
  SELECT COUNT(*) INTO shops_migrated FROM businesses WHERE metadata->>'migrated_from' = 'shops';
  SELECT COUNT(*) INTO duplicates_merged FROM businesses WHERE metadata->>'merged_from_organizations' = 'true';
  SELECT COUNT(*) INTO total_businesses FROM businesses;

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'ORGANIZATION CONSOLIDATION COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Organizations migrated: %', orgs_migrated;
  RAISE NOTICE 'Shops migrated: %', shops_migrated;
  RAISE NOTICE 'Duplicates merged: %', duplicates_merged;
  RAISE NOTICE 'Total businesses now: %', total_businesses;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 9: Archive old tables (commented out - run manually after verification)
-- ═══════════════════════════════════════════════════════════════════════════════

-- After verifying migration success, run these manually:
--
-- -- Archive organizations table
-- ALTER TABLE organizations RENAME TO organizations_archived_20260129;
--
-- -- Archive shops table
-- ALTER TABLE shops RENAME TO shops_archived_20260129;
-- ALTER TABLE shop_members RENAME TO shop_members_archived_20260129;
-- ALTER TABLE shop_invitations RENAME TO shop_invitations_archived_20260129;
--
-- -- Or drop if confident:
-- DROP TABLE IF EXISTS organizations CASCADE;
-- DROP TABLE IF EXISTS shops CASCADE;
-- DROP TABLE IF EXISTS shop_members CASCADE;
-- DROP TABLE IF EXISTS shop_invitations CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 10: Create indexes for new columns
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_businesses_legacy_org ON businesses(legacy_org_id) WHERE legacy_org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_is_active ON businesses(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_businesses_inventory_sync ON businesses(last_inventory_sync) WHERE last_inventory_sync IS NOT NULL;
