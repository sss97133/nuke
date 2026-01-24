-- Expand scraping_health source constraint to include premium auction sources
-- This enables the self-healing feedback loop for all extractors

-- Drop the existing constraint
ALTER TABLE scraping_health DROP CONSTRAINT IF EXISTS valid_source;

-- Add expanded constraint with all source types
ALTER TABLE scraping_health ADD CONSTRAINT valid_source CHECK (source IN (
  -- Existing sources
  'craigslist', 'bat', 'bringatrailer', 'ksl', 'facebook_marketplace',
  'classiccars', 'affordableclassics', 'classic.com', 'goxee', 'ebay',
  'hemmings', 'cars.com', 'autotrader', 'cargurus',
  -- Premium auction sources
  'carsandbids', 'pcarmarket', 'hagerty', 'mecum', 'barrett-jackson',
  'russo-steele', 'rm-sothebys', 'gooding', 'bonhams',
  -- Generic/fallback
  'firecrawl', 'generic', 'wayback'
));

COMMENT ON TABLE scraping_health IS 'Tracks every scraping attempt to monitor reliability and detect failures. All extractors should log here for the self-healing feedback loop.';
