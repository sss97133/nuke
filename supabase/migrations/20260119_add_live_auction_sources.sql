-- Add Live Auction Sources and Motorsport Events
-- This migration adds major auction houses and motorsport events that should be tracked

-- =============================================================================
-- MAJOR AUCTION HOUSES (missing from current data)
-- =============================================================================

INSERT INTO businesses (business_name, business_type, website, description, status, is_verified)
VALUES
  ('Mecum Auctions', 'auction_house', 'https://www.mecum.com', 'The world''s largest collector car auction company', 'active', true),
  ('RM Sotheby''s', 'auction_house', 'https://rmsothebys.com', 'Premier collector car auction house, part of Sotheby''s', 'active', true),
  ('Gooding & Company', 'auction_house', 'https://www.goodingco.com', 'Specialist collector car auction house', 'active', true),
  ('Bonhams', 'auction_house', 'https://www.bonhams.com/departments/mot/', 'International auction house with motoring department', 'active', true),
  ('Worldwide Auctioneers', 'auction_house', 'https://www.worldwide-auctioneers.com', 'Classic and collector car auctions', 'active', true),
  ('Russo and Steele', 'auction_house', 'https://russoandsteele.com', 'European sports, American muscle, and hot rod auctions', 'active', true),
  ('Auctions America', 'auction_house', 'https://www.auctionsamerica.com', 'Classic and collector car auctions', 'active', true),
  ('GAA Classic Cars', 'auction_house', 'https://www.gaaclassiccars.com', 'North Carolina-based classic car auctions', 'active', true),
  ('Artcurial', 'auction_house', 'https://www.artcurial.com/en/motorcars', 'European auction house with motorcars department', 'active', true),
  ('Silverstone Auctions', 'auction_house', 'https://www.silverstoneauctions.com', 'UK-based classic car auctions', 'active', true),
  ('Collecting Cars', 'auction_house', 'https://collectingcars.com', 'Online-only global car auction platform', 'active', true),
  ('Hemmings Auctions', 'auction_house', 'https://www.hemmings.com/auctions/', 'Online auctions from Hemmings Motor News', 'active', true)
ON CONFLICT (website) DO NOTHING;

-- =============================================================================
-- MOTORSPORT EVENTS & SHOWS (new business type)
-- =============================================================================

INSERT INTO business_type_taxonomy (type_name, category, description, discovery_count)
VALUES
  ('motorsport_event', 'events', 'Racing series, rallies, and motorsport events', 0),
  ('concours', 'events', 'Concours d''Elegance and car shows', 0),
  ('automotive_expo', 'events', 'Automotive trade shows and expositions', 0),
  ('rally_event', 'events', 'Rally races and touring events', 0)
ON CONFLICT (type_name) DO NOTHING;

INSERT INTO businesses (business_name, business_type, website, description, status, is_verified)
VALUES
  -- Major Rally Events
  ('Mille Miglia', 'rally_event', 'https://1000miglia.it', 'Historic Italian road race from Brescia to Rome and back', 'active', true),
  ('Dakar Rally', 'rally_event', 'https://www.dakar.com', 'The most renowned off-road endurance rally', 'active', true),
  ('Gumball 3000', 'rally_event', 'https://www.gumball3000.com', 'Annual 3000-mile international celebrity motor rally', 'active', true),
  ('Rally Monte-Carlo', 'rally_event', 'https://acm.mc', 'Legendary WRC rally in Monaco', 'active', true),

  -- Concours & Shows
  ('Pebble Beach Concours d''Elegance', 'concours', 'https://www.pebblebeachconcours.net', 'The premier automotive event in the world', 'active', true),
  ('Amelia Island Concours', 'concours', 'https://www.ameliaconcours.com', 'Premier automotive event on Florida''s Atlantic coast', 'active', true),
  ('Goodwood Festival of Speed', 'motorsport_event', 'https://www.goodwood.com/motorsport/festival-of-speed/', 'Annual hill climb featuring historic and modern vehicles', 'active', true),
  ('Goodwood Revival', 'motorsport_event', 'https://www.goodwood.com/motorsport/goodwood-revival/', 'Historic motor racing festival', 'active', true),
  ('Monterey Car Week', 'concours', 'https://www.montereycarweek.com', 'Week-long celebration of automotive excellence', 'active', true),
  ('Quail Motorsports Gathering', 'concours', 'https://signatureevents.peninsula.com/en/The-Quail/The-Quail-A-Motorsports-Gathering.html', 'Exclusive automotive event during Monterey Car Week', 'active', true),

  -- Trade Shows
  ('SEMA Show', 'automotive_expo', 'https://www.semashow.com', 'Specialty Equipment Market Association trade show', 'active', true),
  ('Geneva Motor Show', 'automotive_expo', 'https://www.gims.swiss', 'International Motor Show Geneva', 'active', true),
  ('Retromobile', 'automotive_expo', 'https://www.retromobile.com', 'Paris vintage car show', 'active', true),
  ('Techno Classica Essen', 'automotive_expo', 'https://www.siha.de', 'World''s largest classic car show', 'active', true)
ON CONFLICT (website) DO NOTHING;

-- =============================================================================
-- SCRAPE SOURCES FOR LIVE AUCTIONS
-- =============================================================================

-- Add scrape sources for auction houses with live auctions
INSERT INTO scrape_sources (name, url, source_type, is_active, scrape_frequency_hours)
SELECT
  b.business_name || ' - Live Auctions',
  b.website,
  'auction',
  true,
  4
FROM businesses b
WHERE b.business_type = 'auction_house'
  AND b.website IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM scrape_sources s
    WHERE s.url = b.website
  );

-- Add specific live auction URLs for major houses
INSERT INTO scrape_sources (name, url, source_type, is_active, scrape_frequency_hours)
VALUES
  ('Mecum - Live Auctions', 'https://www.mecum.com/lots/', 'auction', true, 4),
  ('RM Sotheby''s - Auctions', 'https://rmsothebys.com/en/auctions', 'auction', true, 4),
  ('Gooding - Current Auctions', 'https://www.goodingco.com/auctions/', 'auction', true, 4),
  ('Bonhams - Motoring', 'https://www.bonhams.com/departments/mot/', 'auction', true, 6),
  ('Barrett-Jackson - Auctions', 'https://www.barrett-jackson.com/Events/', 'auction', true, 4),
  ('Cars & Bids - Live', 'https://carsandbids.com/', 'auction', true, 2),
  ('Collecting Cars - Auctions', 'https://collectingcars.com/search/', 'auction', true, 4),
  ('PCarMarket - Auctions', 'https://www.pcarmarket.com/listings/', 'auction', true, 4)
ON CONFLICT (url) DO NOTHING;

-- =============================================================================
-- SCRAPE SOURCES FOR EVENTS
-- =============================================================================

INSERT INTO scrape_sources (name, url, source_type, is_active, scrape_frequency_hours)
VALUES
  ('Mille Miglia - Events', 'https://1000miglia.it/en/', 'event', true, 24),
  ('Dakar Rally - News', 'https://www.dakar.com/en/', 'event', true, 24),
  ('Pebble Beach - Events', 'https://www.pebblebeachconcours.net/the-events/', 'event', true, 24),
  ('Goodwood - Events', 'https://www.goodwood.com/motorsport/', 'event', true, 24),
  ('Monterey Car Week', 'https://www.montereycarweek.com/', 'event', true, 24)
ON CONFLICT (url) DO NOTHING;

-- =============================================================================
-- UPDATE DISCOVERY LEADS - Add auction houses as pending leads
-- =============================================================================

INSERT INTO discovery_leads (
  discovered_from_type,
  lead_type,
  lead_url,
  lead_name,
  suggested_business_type,
  confidence_score,
  status,
  metadata
)
VALUES
  ('seed', 'auction_house', 'https://www.mecum.com/lots/', 'Mecum Live Lots', 'auction_house', 0.95, 'pending', '{"priority": "high", "has_live_auctions": true}'),
  ('seed', 'auction_house', 'https://rmsothebys.com/en/auctions', 'RM Sotheby''s Auctions', 'auction_house', 0.95, 'pending', '{"priority": "high", "has_live_auctions": true}'),
  ('seed', 'auction_house', 'https://collectingcars.com/search/', 'Collecting Cars', 'auction_house', 0.90, 'pending', '{"priority": "high", "online_only": true}'),
  ('seed', 'event', 'https://1000miglia.it/en/', 'Mille Miglia', 'rally_event', 0.85, 'pending', '{"priority": "medium", "event_type": "rally"}'),
  ('seed', 'event', 'https://www.dakar.com/en/', 'Dakar Rally', 'rally_event', 0.85, 'pending', '{"priority": "medium", "event_type": "rally"}'),
  ('seed', 'event', 'https://www.pebblebeachconcours.net/', 'Pebble Beach Concours', 'concours', 0.90, 'pending', '{"priority": "high", "event_type": "concours"}')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- INDEXES FOR LIVE AUCTION QUERIES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_external_listings_platform_status
ON external_listings(platform, listing_status)
WHERE listing_status IN ('active', 'live');

CREATE INDEX IF NOT EXISTS idx_external_listings_end_date_active
ON external_listings(end_date)
WHERE listing_status IN ('active', 'live') AND end_date > NOW();

-- Track auction sources that should be polled for live auctions
ALTER TABLE scrape_sources ADD COLUMN IF NOT EXISTS has_live_auctions BOOLEAN DEFAULT false;
ALTER TABLE scrape_sources ADD COLUMN IF NOT EXISTS live_auction_poll_interval_minutes INTEGER DEFAULT 15;

-- Mark auction sources with live auctions
UPDATE scrape_sources
SET has_live_auctions = true, live_auction_poll_interval_minutes = 15
WHERE source_type = 'auction'
  AND url ILIKE ANY(ARRAY[
    '%bringatrailer.com%',
    '%carsandbids.com%',
    '%collectingcars.com%',
    '%pcarmarket.com%',
    '%mecum.com%',
    '%rmsothebys.com%'
  ]);
