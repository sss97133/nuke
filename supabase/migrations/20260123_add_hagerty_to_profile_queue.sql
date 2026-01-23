-- Add Hagerty Marketplace to user_profile_queue platform constraint
-- This allows external_identities trigger to queue Hagerty profiles for scraping

ALTER TABLE user_profile_queue DROP CONSTRAINT IF EXISTS user_profile_queue_platform_check;

ALTER TABLE user_profile_queue ADD CONSTRAINT user_profile_queue_platform_check CHECK (
  platform = ANY (ARRAY[
    'bat', 'cars_and_bids', 'mecum', 'barrettjackson', 'russoandsteele',
    'pcarmarket', 'sbx', 'bonhams', 'rmsothebys', 'collecting_cars',
    'broad_arrow', 'gooding', 'ebay_motors', 'facebook_marketplace',
    'autotrader', 'hemmings', 'classic_com', 'craigslist', 'copart', 'iaai',
    'hagerty'
  ])
);

COMMENT ON CONSTRAINT user_profile_queue_platform_check ON user_profile_queue IS
  'Allowed platforms for profile queue - added Hagerty Marketplace 2026-01-23';
