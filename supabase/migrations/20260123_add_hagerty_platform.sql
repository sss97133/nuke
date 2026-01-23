-- Add Hagerty Marketplace to external_listings platform constraint

ALTER TABLE external_listings DROP CONSTRAINT IF EXISTS external_listings_platform_check;

ALTER TABLE external_listings ADD CONSTRAINT external_listings_platform_check CHECK (
  platform = ANY (ARRAY[
    'bat', 'cars_and_bids', 'mecum', 'barrettjackson', 'russoandsteele',
    'pcarmarket', 'sbx', 'bonhams', 'rmsothebys', 'collecting_cars',
    'broad_arrow', 'gooding', 'ebay_motors', 'facebook_marketplace',
    'autotrader', 'hemmings', 'classic_com', 'craigslist', 'copart', 'iaai',
    'hagerty'
  ])
);

COMMENT ON CONSTRAINT external_listings_platform_check ON external_listings IS
  'Allowed platforms for external listings - added Hagerty Marketplace 2026-01-23';
