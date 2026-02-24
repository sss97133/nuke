-- =============================================================================
-- Migration: Rename businesses → organizations
-- =============================================================================

BEGIN;

-- STEP 1: Rename table
ALTER TABLE IF EXISTS businesses RENAME TO organizations;

-- STEP 2: Create backward-compat VIEW IMMEDIATELY (before any UPDATEs)
-- This is critical: trigger functions reference "businesses" by name.
-- Simple SELECT * views are auto-updatable in PostgreSQL.
CREATE OR REPLACE VIEW businesses AS SELECT * FROM organizations;

-- STEP 3: Add new columns
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_structure TEXT;

-- STEP 4: Migrate business_type → entity_type
-- Functional roles
UPDATE organizations SET entity_type = business_type
WHERE entity_type IS NULL AND business_type IN (
  'collection', 'auction_house', 'garage', 'dealer',
  'restoration_shop', 'performance_shop', 'body_shop', 'detailing',
  'mobile_service', 'specialty_shop', 'parts_supplier', 'fabrication',
  'racing_team', 'marketplace', 'concours', 'builder', 'club',
  'media', 'registry', 'developer', 'forum', 'other'
);

UPDATE organizations SET entity_type = 'dealer'
WHERE entity_type IS NULL AND business_type = 'dealership';

UPDATE organizations SET entity_type = 'concours'
WHERE entity_type IS NULL AND business_type IN ('automotive_expo', 'motorsport_event', 'rally_event');

UPDATE organizations
SET legal_structure = business_type, entity_type = 'uncategorized'
WHERE entity_type IS NULL AND business_type IN ('sole_proprietorship', 'partnership', 'llc', 'corporation');

UPDATE organizations SET entity_type = 'uncategorized' WHERE entity_type IS NULL;

-- STEP 5: CHECK constraints
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_entity_type
CHECK (entity_type IN (
  'collection', 'museum', 'private_foundation',
  'dealer', 'franchise_dealer', 'independent_dealer', 'wholesale_dealer',
  'broker', 'consignment_dealer', 'dealer_group',
  'auction_house', 'online_auction_platform',
  'restoration_shop', 'performance_shop', 'body_shop', 'detailing',
  'storage_facility', 'collection_manager', 'appraiser', 'transporter',
  'garage', 'mobile_service', 'specialty_shop', 'fabrication',
  'manufacturer', 'heritage_division', 'importer_distributor',
  'marque_club', 'club', 'registry', 'concours',
  'marketplace', 'data_platform', 'investment_platform',
  'investment_fund', 'series_llc', 'spv',
  'media', 'racing_team', 'builder', 'parts_supplier',
  'forum', 'developer', 'other', 'uncategorized'
));

ALTER TABLE organizations ADD CONSTRAINT chk_organizations_legal_structure
CHECK (legal_structure IS NULL OR legal_structure IN (
  'individual', 'sole_proprietorship', 'partnership',
  'llc', 'single_member_llc', 'multi_member_llc', 'series_llc',
  'corporation', 'c_corp', 's_corp',
  'revocable_trust', 'irrevocable_trust', 'dynasty_trust',
  'charitable_remainder_trust',
  'foundation_501c3', 'social_club_501c7',
  'limited_partnership', 'family_limited_partnership',
  'family_office',
  'unknown'
));

-- STEP 6: Indexes
CREATE INDEX IF NOT EXISTS idx_organizations_entity_type
  ON organizations(entity_type);
CREATE INDEX IF NOT EXISTS idx_organizations_legal_structure
  ON organizations(legal_structure) WHERE legal_structure IS NOT NULL;

COMMIT;
