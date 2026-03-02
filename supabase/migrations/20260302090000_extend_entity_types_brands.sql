-- =============================================================================
-- Extend organizations.entity_type CHECK constraint for St Barth ecosystem
-- Adds: hotel, restaurant, gallery, concierge, fashion, real_estate, historical, publisher
-- =============================================================================

-- Drop existing constraint and re-create with new values
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_organizations_entity_type;
ALTER TABLE organizations ADD CONSTRAINT chk_organizations_entity_type
CHECK (entity_type IN (
  -- Existing values
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
  'forum', 'developer', 'other', 'uncategorized',
  -- New values for St Barth ecosystem
  'hotel', 'restaurant', 'gallery', 'concierge',
  'fashion', 'real_estate', 'historical', 'publisher'
)) NOT VALID;

-- brands.industry is TEXT (not enum), so no schema change needed.
-- New industry values used by seed scripts: luxury, fashion, hospitality,
-- real_estate, art, food_beverage, jewelry, beauty, marine, lifestyle
