-- =============================================================================
-- LIVE AUCTION PLATFORMS - Comprehensive Registry
-- =============================================================================
-- All collector car platforms that run live auctions with online bidding.
-- This seeds the businesses table with proper categorization and metadata.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TIER 1: Major Online-First Auction Platforms (Primary Targets)
-- These run continuous online auctions with real-time bidding
-- -----------------------------------------------------------------------------

-- Bring a Trailer (BaT) - Already exists, update metadata
UPDATE businesses SET
    business_type = 'auction_house',
    website = 'https://bringatrailer.com',
    is_verified = true,
    description = 'Premier online auction platform for enthusiast vehicles. 7-day auctions with 2-minute soft-close extension. Founded 2007 by Randy Nonnenberg.'
WHERE LOWER(business_name) LIKE '%bring a trailer%' OR website LIKE '%bringatrailer.com%';

-- Cars & Bids (Doug DeMuro)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Cars & Bids',
    'auction_house',
    'https://carsandbids.com',
    true,
    'Online auction platform for modern enthusiast vehicles (1981+). Founded by Doug DeMuro in 2020. 7-day auctions with soft-close protection.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- PCARMARKET (Porsche focused)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'PCARMARKET',
    'auction_house',
    'https://pcarmarket.com',
    true,
    'Leading marketplace for Porsche and collectible vehicles. Online auctions with community engagement. Founded 2017.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Collecting Cars (UK-based, 24/7 global)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Collecting Cars',
    'auction_house',
    'https://collectingcars.com',
    true,
    'UK-based 24/7 global online auction platform for classic, sports and performance cars. Founded 2018 by Edward Lovett.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Hagerty Marketplace Auctions
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Hagerty Marketplace',
    'auction_house',
    'https://www.hagerty.com/marketplace',
    true,
    'Hagerty''s auction platform with 1.8M member community. Free to list, 2-minute soft-close protection. Parent company of Broad Arrow.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- The Market (UK)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'The Market',
    'auction_house',
    'https://www.themarket.co.uk',
    true,
    'UK-based online classic and collectible car auction platform. Curated selection with global bidding.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- The MB Market (Mercedes-Benz focused)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'The MB Market',
    'auction_house',
    'https://thembmarket.com',
    true,
    'Mercedes-Benz focused online auction platform. Founded March 2021 by Blakey Leonard. Also sells MB memorabilia and parts.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- SBX Cars
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'SBX Cars',
    'auction_house',
    'https://sbxcars.com',
    true,
    'Online auction platform for collector and enthusiast vehicles. Part of the online auction ecosystem tracked by Classic.com.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- ISSIMI
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'ISSIMI',
    'auction_house',
    'https://issimi.com',
    true,
    'Online collector car auction platform. Curated selection of classic and exotic vehicles.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Kickdown
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Kickdown',
    'auction_house',
    'https://kickdown.com',
    true,
    'Online auction platform for classic and collector cars. European-focused with global reach.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Hemmings Auctions
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Hemmings Auctions',
    'auction_house',
    'https://www.hemmings.com/auctions',
    true,
    'Online auctions from the classic car magazine. Mix of dealer and private listings with established collector community.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- -----------------------------------------------------------------------------
-- TIER 2: Major Live Auction Houses with Online Bidding
-- These run live events with simultaneous online bidding capability
-- -----------------------------------------------------------------------------

-- Mecum Auctions
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Mecum Auctions',
    'auction_house',
    'https://www.mecum.com',
    true,
    'North America''s largest collector car auction company. Live events with simultaneous online bidding. Founded 1988 by Dana Mecum. Key events: Kissimmee, Indianapolis, Monterey.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Barrett-Jackson
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Barrett-Jackson',
    'auction_house',
    'https://www.barrett-jackson.com',
    true,
    'World''s most famous collector car auction house. "No Reserve" policy. Founded 1971. Live TV broadcasts. Key events: Scottsdale, Las Vegas, Palm Beach, Houston.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- RM Sotheby's
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'RM Sotheby''s',
    'auction_house',
    'https://rmsothebys.com',
    true,
    '#1 classic car auction house in the world. 7 of the most expensive auction sales in history. Key events: Monterey, Amelia Island, Monaco, Paris. Online bidding available.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Gooding & Company
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Gooding & Company',
    'auction_house',
    'https://www.goodingco.com',
    true,
    'Premier auction house for significant collector cars. 3 of top 10 most expensive auction sales. Key event: Pebble Beach alongside Concours d''Elegance.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Bonhams
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Bonhams',
    'auction_house',
    'https://www.bonhams.com/departments/MOT',
    true,
    'International auction house with 24/7 online car auctions. Sold Fangio''s 1954 Mercedes W196R for £19.6M. Key events: Goodwood, The Quail, Amelia Island.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Broad Arrow Auctions (Hagerty company)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Broad Arrow Auctions',
    'auction_house',
    'https://broadarrowauctions.com',
    true,
    'Hagerty company founded 2021 by industry veterans. Live and online auctions for collector cars and memorabilia. January 2026: Global Icons multi-location sale.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Russo and Steele
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Russo and Steele',
    'auction_house',
    'https://russoandsteele.com',
    true,
    'Founded 2001, headquartered in Phoenix. Known for "auction-in-the-round" format. Specializes in European sports, American muscle, hot rods. Key event: Scottsdale.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Worldwide Auctioneers
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Worldwide Auctioneers',
    'auction_house',
    'https://www.worldwide-auctioneers.com',
    true,
    'Boutique auction experience focusing on curated selection of classic and rare vehicles. Personalized service. Key event: Auburn Auction in Auburn, Indiana.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Leake Auctions
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Leake Auctions',
    'auction_house',
    'https://leakecar.com',
    true,
    'Family-owned Tulsa, Oklahoma collector car auctioneer. Acquired by Ritchie Bros. in 2018. Regional focus with deep tradition.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- duPont Registry Live (already exists, update)
UPDATE businesses SET
    business_type = 'auction_house',
    is_verified = true,
    description = 'Online auction platform from the luxury vehicle magazine. Live auctions for exotic and collector cars.'
WHERE website LIKE '%dupontregistry%' OR LOWER(business_name) LIKE '%dupont%';

-- -----------------------------------------------------------------------------
-- TIER 3: Aggregators/Platforms with Auction Capabilities
-- These aggregate auctions or provide bidding infrastructure
-- -----------------------------------------------------------------------------

-- Proxibid
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Proxibid',
    'auction_house',
    'https://www.proxibid.com',
    true,
    'Online bidding platform aggregating multiple auction houses. Timed and live online auction events for collector cars and other assets.'
)
ON CONFLICT (website) DO UPDATE SET
    business_type = 'auction_house',
    is_verified = true,
    description = EXCLUDED.description;

-- Classic.com (aggregator, not auction house - but tracks auctions)
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'Classic.com',
    'other',
    'https://www.classic.com',
    true,
    'Listing aggregator tracking 275+ dealers and all major online/live auctions. Provides market data, valuations, and auction results. Not an auction platform itself.'
)
ON CONFLICT (website) DO UPDATE SET
    is_verified = true,
    description = EXCLUDED.description;

-- eBay Motors
INSERT INTO businesses (business_name, business_type, website, is_verified, description)
VALUES (
    'eBay Motors',
    'marketplace',
    'https://www.ebay.com/motors',
    true,
    'Largest online vehicle marketplace. Auction and Buy-It-Now formats. High volume but less curated than specialist platforms.'
)
ON CONFLICT (website) DO UPDATE SET
    is_verified = true,
    description = EXCLUDED.description;

-- -----------------------------------------------------------------------------
-- Summary of platforms for real-time monitoring priority:
-- -----------------------------------------------------------------------------
-- HIGH PRIORITY (Online-first, continuous auctions):
--   1. Bring a Trailer - Has adapter, needs WebSocket analysis
--   2. Cars & Bids - Similar to BaT, Doug DeMuro platform
--   3. PCARMARKET - Porsche focus, engaged community
--   4. Collecting Cars - 24/7 global, UK-based
--   5. Hagerty Marketplace - 1.8M members, Hagerty ecosystem
--
-- MEDIUM PRIORITY (Live events + online bidding):
--   6. Mecum - Largest by volume, live events
--   7. Barrett-Jackson - Most famous, TV broadcasts
--   8. RM Sotheby's - Highest value sales
--   9. Bonhams - 24/7 online capability
--   10. Broad Arrow - Hagerty company, growing
--
-- LOWER PRIORITY (Niche/smaller):
--   11-20. The Market, MB Market, SBX Cars, ISSIMI, Kickdown, etc.
-- -----------------------------------------------------------------------------
