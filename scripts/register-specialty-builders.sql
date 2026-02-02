-- Register specialty builder sources in scrape_sources table
-- Run with: dotenvx run -- psql ... -f scripts/register-specialty-builders.sql

-- Velocity Restorations
INSERT INTO scrape_sources (
  name, url, source_type, parent_aggregator,
  inventory_url, requires_firecrawl, is_active,
  scrape_config
)
VALUES (
  'Velocity Restorations',
  'https://www.velocityrestorations.com',
  'dealer',
  NULL,
  'https://www.velocityrestorations.com/for-sale/',
  true,
  true,
  '{
    "builder_type": "specialty_restoration",
    "specializations": ["restoration", "classic_cars", "restomod"],
    "extraction_rules": {
      "requiresDescription": true,
      "requiresChassisNumber": true,
      "extractTimeline": true,
      "extractAuctionAffiliation": true
    },
    "known_makes": ["Ford", "Chevrolet", "International"],
    "known_models": ["Bronco", "Mustang", "F-100", "F-150", "F-250", "F-350", "C10", "K10", "K5 Blazer", "Scout II"]
  }'::jsonb
)
ON CONFLICT (url) DO UPDATE SET
  inventory_url = EXCLUDED.inventory_url,
  scrape_config = EXCLUDED.scrape_config,
  updated_at = NOW();

-- Kindred Motorworks
INSERT INTO scrape_sources (
  name, url, source_type, parent_aggregator,
  inventory_url, requires_firecrawl, is_active,
  scrape_config
)
VALUES (
  'Kindred Motorworks',
  'https://kindredmotorworks.com',
  'dealer',
  NULL,
  'https://kindredmotorworks.com/for-sale',
  true,
  true,
  '{
    "builder_type": "specialty_conversion",
    "specializations": ["custom_conversion", "ev_conversion", "restomod"],
    "extraction_rules": {
      "requiresDescription": true,
      "extractTimeline": true
    },
    "known_products": ["Gas Bronco", "EV Bronco", "EV VW Bus"]
  }'::jsonb
)
ON CONFLICT (url) DO UPDATE SET
  inventory_url = EXCLUDED.inventory_url,
  scrape_config = EXCLUDED.scrape_config,
  updated_at = NOW();

-- Singer Vehicle Design
INSERT INTO scrape_sources (
  name, url, source_type, parent_aggregator,
  inventory_url, requires_firecrawl, is_active,
  scrape_config
)
VALUES (
  'Singer Vehicle Design',
  'https://singervehicledesign.com',
  'dealer',
  NULL,
  NULL, -- To be discovered
  true,
  true,
  '{
    "builder_type": "specialty_restoration",
    "specializations": ["restoration", "custom_conversion", "porsche_specialist"],
    "extraction_rules": {
      "requiresDescription": true,
      "requiresChassisNumber": true,
      "extractTimeline": true
    },
    "known_makes": ["Porsche"],
    "price_range": [500000, 2000000]
  }'::jsonb
)
ON CONFLICT (url) DO UPDATE SET
  scrape_config = EXCLUDED.scrape_config,
  updated_at = NOW();

-- RUF Automobile
INSERT INTO scrape_sources (
  name, url, source_type, parent_aggregator,
  inventory_url, requires_firecrawl, is_active,
  scrape_config
)
VALUES (
  'RUF Automobile',
  'https://ruf-automobile.de',
  'dealer',
  NULL,
  NULL, -- To be discovered
  true,
  true,
  '{
    "builder_type": "specialty_tuner",
    "specializations": ["tuning", "custom_conversion", "porsche_specialist"],
    "extraction_rules": {
      "requiresDescription": true,
      "requiresChassisNumber": true,
      "extractTimeline": true
    },
    "known_makes": ["Porsche", "RUF"],
    "price_range": [300000, 1500000]
  }'::jsonb
)
ON CONFLICT (url) DO UPDATE SET
  scrape_config = EXCLUDED.scrape_config,
  updated_at = NOW();

-- Brabus
INSERT INTO scrape_sources (
  name, url, source_type, parent_aggregator,
  inventory_url, requires_firecrawl, is_active,
  scrape_config
)
VALUES (
  'Brabus',
  'https://brabus.com',
  'dealer',
  NULL,
  NULL, -- To be discovered
  true,
  true,
  '{
    "builder_type": "specialty_tuner",
    "specializations": ["tuning", "custom_conversion", "mercedes_specialist"],
    "extraction_rules": {
      "requiresDescription": true,
      "extractTimeline": true
    },
    "known_makes": ["Mercedes-Benz", "Brabus"],
    "price_range": [200000, 1000000]
  }'::jsonb
)
ON CONFLICT (url) DO UPDATE SET
  scrape_config = EXCLUDED.scrape_config,
  updated_at = NOW();

-- Cool N Vintage
INSERT INTO scrape_sources (
  name, url, source_type, parent_aggregator,
  inventory_url, requires_firecrawl, is_active,
  scrape_config
)
VALUES (
  'Cool N Vintage',
  'https://coolnvintage.com',
  'dealer',
  NULL,
  NULL, -- To be discovered
  true,
  true,
  '{
    "builder_type": "specialty_restoration",
    "specializations": ["restoration", "classic_cars", "porsche_specialist"],
    "extraction_rules": {
      "requiresDescription": true,
      "extractTimeline": true
    },
    "known_makes": ["Porsche"]
  }'::jsonb
)
ON CONFLICT (url) DO UPDATE SET
  scrape_config = EXCLUDED.scrape_config,
  updated_at = NOW();

-- Show registered builders
SELECT
  name,
  source_type,
  inventory_url,
  is_active,
  scrape_config->>'builder_type' as builder_type,
  scrape_config->'specializations' as specializations
FROM scrape_sources
WHERE name IN (
  'Velocity Restorations',
  'Kindred Motorworks',
  'Singer Vehicle Design',
  'RUF Automobile',
  'Brabus',
  'Cool N Vintage'
)
ORDER BY name;
