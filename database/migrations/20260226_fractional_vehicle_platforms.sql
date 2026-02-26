-- =============================================================================
-- Fractional Vehicle Platforms — Organization Ingestion
-- 2026-02-26
--
-- These are companies offering fractionalized vehicle ownership/investment.
-- They represent supply-side players with no unified exchange to trade on.
-- Nuke is building that exchange.
--
-- Strategic note: These orgs are competitors AND potential data partners.
-- Their vehicle listings become Nuke inventory once we run extractors on them.
-- =============================================================================

-- Add fractional_marketplace to the service_type enum
ALTER TYPE org_service_type ADD VALUE IF NOT EXISTS 'fractional_marketplace';

-- =============================================================================
-- Ingest all fractional vehicle platforms into businesses table
-- =============================================================================

INSERT INTO businesses (
  business_name,
  website,
  description,
  business_type,
  service_type,
  country,
  status,
  is_public,
  verification_level,
  metadata
) VALUES

-- --------------------------------------------------------------------------
-- INVESTMENT-GRADE (equity/financial instrument — regulated securities)
-- --------------------------------------------------------------------------

(
  'Rally Rd.',
  'https://rallyrd.com',
  'SEC-registered fractional equity shares in collector cars, art, wine, whiskey, and watches. Each asset securitized as a standalone entity with monthly trading windows. ~400K investors, 300+ assets IPO''d. Backed by Porsche Ventures, Accel, Alexis Ohanian, Kevin Durant.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'equity_shares',
    'regulatory', 'SEC-registered, FINRA broker-dealer',
    'jurisdiction', 'USA (New York, NY)',
    'funding_raised_usd', 84000000,
    'notable_investors', ARRAY['Porsche Ventures', 'Accel', 'Alexis Ohanian', 'Kevin Durant', 'Wheelhouse'],
    'vehicle_focus', 'Blue-chip collector/classic cars + broad collectibles',
    'min_investment_usd', 0,
    'trading', 'Monthly trading windows',
    'x_handle', 'OnRallyRd',
    'nuke_priority', 'high',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'MCQ Markets',
  'https://www.mcqmarkets.com',
  'Fractional equity shares in investment-grade luxury/exotic cars via Reg A+ SEC-qualified offerings. Shares from $20. Also operates McQueen Garage wholesale trading division. Backed by SOL Global Investments.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'equity_shares',
    'regulatory', 'SEC Reg A+, Delaware Series LLC',
    'jurisdiction', 'USA (Fort Lauderdale/Miami, FL)',
    'notable_investors', ARRAY['SOL Global Investments'],
    'vehicle_focus', 'Luxury exotics — Lamborghini, Ferrari, Lexus LFA, Maybach',
    'min_investment_usd', 20,
    'x_handle', 'MCQmarkets',
    'nuke_priority', 'high',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'TheCarCrowd',
  'https://thecarcrowd.uk',
  'Fractional equity shares in classic/collectible cars. Each car wrapped in its own limited company; investors buy shares (up to 1,000 per car). 2023 returns: 15.8%, 2024 returns: 12.7%. Partnership with aShareX for US cross-border offering.',
  'other',
  'fractional_marketplace',
  'GB',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'equity_shares',
    'regulatory', 'UK syndicate structure, previously FCA-appointed representative',
    'jurisdiction', 'UK (Nottingham/Newark, England)',
    'funding_raised_usd', 2400000,
    'vehicle_focus', 'Classic and modern classic investment-grade collector cars (Ferrari, Porsche, Jaguar)',
    'min_investment_gbp', 2000,
    'annual_returns', '12-16%',
    'x_handle', 'thecarcrowduk',
    'nuke_priority', 'high',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'aShareX',
  'https://www.asharex.com',
  'Fractional investment auction platform — the only platform where fractional bidders compete against 100% bidders in live auction format. Patent-pending. Partners with TheCarCrowd. Min investment $5,000.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'fractional_auction',
    'jurisdiction', 'USA (Los Angeles, CA)',
    'vehicle_focus', 'Classic/collectible cars — Ferrari, curated by partners',
    'min_investment_usd', 5000,
    'notable_feature', 'Fractional bidders compete against 100% bidders in live auction',
    'nuke_priority', 'high',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Timeless Investments',
  'https://www.timeless.investments',
  'Mobile-first fractional ownership app for collectibles — classic cars, watches, sneakers, art. Investors buy fractional shares from €50. Secondary market trading available. BaFin-regulated (Germany). Backed by EQT Ventures and Porsche Ventures.',
  'other',
  'fractional_marketplace',
  'DE',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'mobile_app_fractional',
    'regulatory', 'BaFin-regulated',
    'jurisdiction', 'Germany (Berlin)',
    'funding_raised_eur', 12000000,
    'notable_investors', ARRAY['EQT Ventures', 'Porsche Ventures', 'C3 EOS VC', 'La Roca Capital'],
    'vehicle_focus', 'Classic/vintage cars + broader collectibles',
    'min_investment_eur', 50,
    'x_handle', 'timeless_invest',
    'nuke_priority', 'medium',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Silverpine',
  'https://www.silverpine.io',
  'App-based fractional ownership of rare collectible cars. BaFin-regulated. Provides provenance, financial data, ownership history, and market prices per asset. Cars stored in Germany. Secondary market planned.',
  'other',
  'fractional_marketplace',
  'DE',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'mobile_app_fractional',
    'regulatory', 'BaFin-regulated',
    'jurisdiction', 'Germany (Berlin)',
    'vehicle_focus', 'Rare/priceless collectible cars',
    'notable_feature', 'Provenance + financial data + ownership history per vehicle',
    'nuke_priority', 'medium',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'duPont REGISTRY Invest',
  'https://invest.dupontregistry.com',
  'Fractional equity investment in investment-grade collector cars. Joint venture between duPont Registry (40yr luxury auto brand) and Rally. SEC-qualified. No minimums, no commissions. Curated by duPont Registry specialists, securitized by Rally.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'equity_shares',
    'regulatory', 'SEC-qualified via Rally (FINRA broker-dealer)',
    'jurisdiction', 'USA (St. Petersburg, FL)',
    'notable_investors', ARRAY['Porsche Ventures', 'Accel', 'Alexis Ohanian'],
    'vehicle_focus', 'Rare, museum-quality luxury and collector automobiles',
    'min_investment_usd', 0,
    'parent_platform', 'Rally Rd.',
    'x_handle', 'duPontREGISTRY',
    'nuke_priority', 'high',
    'source', 'x_monitor_research_2026_02_26'
  )
),

-- --------------------------------------------------------------------------
-- CO-OWNERSHIP / USAGE + ASSET (investors get stake AND access)
-- --------------------------------------------------------------------------

(
  'Supercar Sharing AG',
  'https://www.supercarsharing.com',
  'True fractional co-ownership of supercars. Min 10% share = ~30 days usage/year. 1,900+ active members, franchise network across 31 countries. Fleet value >20M CHF. Vehicles include Porsche, Ferrari, Lamborghini, Bugatti, Koenigsegg.',
  'other',
  'fractional_marketplace',
  'CH',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'co_ownership_with_access',
    'jurisdiction', 'Switzerland (Zurich). Franchise: 31+ countries',
    'vehicle_focus', 'Supercars — Porsche, Ferrari, Lamborghini, Bugatti, Koenigsegg, McLaren',
    'min_ownership_pct', 10,
    'member_count', 1900,
    'fleet_value_chf', 20000000,
    'franchise_countries', 31,
    'nuke_priority', 'medium',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Frax''d',
  'https://www.fraxd.com',
  'B2B platform for premium car dealerships to offer fractional co-ownership of exotic/luxury inventory. Splits vehicles into up to 12 co-ownership shares. Dealer-centric model — handles scheduling, maintenance, insurance.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'dealer_b2b_fractional',
    'jurisdiction', 'USA',
    'vehicle_focus', 'Exotic/luxury dealer inventory',
    'max_co_owners', 12,
    'model', 'B2B (dealer-facing)',
    'nuke_priority', 'medium',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Prorata Cars',
  'https://www.proratacar.com',
  'India''s first fractional car ownership platform for residential communities. 1 ticket = 8.33% ownership = 30 days usage/year. Up to 12 co-owners per vehicle. Community-based model — co-owners are neighbors.',
  'other',
  'fractional_marketplace',
  'IN',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'co_ownership_with_access',
    'jurisdiction', 'India (Bengaluru)',
    'vehicle_focus', 'Luxury/premium cars for occasional use',
    'max_co_owners', 12,
    'notable_feature', 'Shark Tank India appearance 2025',
    'x_handle', 'proratacar',
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Auto Timeshare',
  'https://autotimeshare.com',
  'Fractional supercar co-ownership. Splits cost between 4, 6, 12, or 24 co-owners. 2-year and 4-year contracts. Handles maintenance and insurance. Includes hybrid/EV supercar options.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'co_ownership_with_access',
    'jurisdiction', 'USA',
    'vehicle_focus', 'Supercars (exotic/performance)',
    'co_owner_splits', ARRAY[4, 6, 12, 24],
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Curvy Road / Exotic Car Share',
  'https://curvyroad.com',
  'Exotic car fractional ownership and timeshare. "Private Access Plan" — weekly usage with full delivery/detail. Royalty program for exotic car owners to monetize their cars while retaining ownership. Established 2000.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'co_ownership_with_access',
    'jurisdiction', 'USA (Chicago IL, LA, NY, Fort Myers FL)',
    'vehicle_focus', 'Exotic/luxury — Ferrari, Lamborghini, Bentley',
    'founded', 2000,
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

-- --------------------------------------------------------------------------
-- BLOCKCHAIN / TOKENIZED
-- --------------------------------------------------------------------------

(
  'Dreamcars',
  'https://dreamcars.co',
  'Blockchain/NFT-based fractional ownership of luxury rental cars. Cars tokenized as NFTs on BNB Smart Chain. $DCARS native token. Monthly USDT passive income from rental revenue. Locations: Dubai, Miami, Marbella.',
  'other',
  'fractional_marketplace',
  'AE',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'blockchain_nft',
    'regulatory', 'BNB Smart Chain, unregulated crypto',
    'jurisdiction', 'UAE (Dubai), USA (Miami), Spain (Marbella)',
    'vehicle_focus', 'Luxury/exotic rental fleet — Ferrari, Lamborghini',
    'min_investment_usd', 10,
    'blockchain', 'BNB Smart Chain',
    'token', 'DCARS',
    'yield_claimed_pct', '20-50% annual',
    'nuke_priority', 'low',
    'risk_flag', 'crypto/DeFi — high failure rate, unregulated',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Renegade / Mulsano',
  'https://www.mulsano.com',
  'Partnership to tokenize collector cars held at Mulsano showroom (Germany). Cars tokenized at $100/token on blockchain. Investors earn proportional profit when car sells. Renegade handles crypto/fiat infrastructure.',
  'other',
  'fractional_marketplace',
  'DE',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'blockchain_tokenized',
    'jurisdiction', 'Germany (Hannoversch Münden)',
    'vehicle_focus', 'Rare, exclusive collector cars (physical showroom)',
    'min_investment_usd', 100,
    'token_price_usd', 100,
    'x_handle', 'renegade_app',
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'The Vogu',
  'https://www.thevogu.io',
  'NFT-based car auction platform. Tokenizes vehicles as unique NFTs; auctions run on blockchain with crypto payments. Claims fractional ownership via tokenization. Focuses on classic, luxury, sports, and EV vehicles.',
  'other',
  'fractional_marketplace',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'blockchain_nft',
    'vehicle_focus', 'Classic, luxury, sports, EV',
    'nuke_priority', 'low',
    'risk_flag', 'Scale and traction unclear',
    'source', 'x_monitor_research_2026_02_26'
  )
),

-- --------------------------------------------------------------------------
-- MEMBERSHIP / SUBSCRIPTION (company owns, members access — NOT true ownership)
-- --------------------------------------------------------------------------

(
  'Gotham Dream Cars',
  'https://www.gothamdreamcars.com',
  'DreamShare prepaid membership/timeshare for exotic access. Members buy prepaid credits ($18K-$49K tiers). NOT equity ownership — company owns assets, members pay for access days. NYC, Miami, LA.',
  'other',
  'club',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', false,
    'platform_type', 'membership_timeshare',
    'jurisdiction', 'USA (NYC, Miami, LA)',
    'vehicle_focus', 'Exotics — Lamborghini, Ferrari, McLaren, Rolls-Royce',
    'membership_tiers_usd', ARRAY[18000, 49000],
    'x_handle', 'GothamDreamCars',
    'note', 'No equity ownership — access-only model',
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Freedom Supercars',
  'https://www.freedomsupercars.com',
  'Private supercar membership club with concierge delivery. ~$1,400-$3,800/month. No maintenance/depreciation for members. Company owns the fleet. Houston TX.',
  'other',
  'club',
  'US',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', false,
    'platform_type', 'membership_subscription',
    'jurisdiction', 'USA (Houston, TX)',
    'vehicle_focus', 'Supercars — Ferrari, Lamborghini, McLaren, Porsche, Bentley',
    'monthly_fee_range_usd', ARRAY[1400, 3800],
    'note', 'No equity ownership — access-only model',
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

(
  'Vancouver Car Club',
  'https://www.vancouvercarclub.com',
  'Exotic car rental and fractional ownership in Canada. Also offers fractional ownership in Area 27 race track (10% stakes). Includes planes/jets/helicopters. Ferrari, Lamborghini, Bentley, Aston Martin.',
  'other',
  'fractional_marketplace',
  'CA',
  'active',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'co_ownership_with_access',
    'jurisdiction', 'Canada (Vancouver, BC)',
    'vehicle_focus', 'Exotic supercars — Ferrari, Lamborghini, Bentley, Aston Martin',
    'nuke_priority', 'low',
    'source', 'x_monitor_research_2026_02_26'
  )
),

-- --------------------------------------------------------------------------
-- DEAD — ingest for research/competitive intelligence
-- --------------------------------------------------------------------------

(
  'Acquicent',
  'https://acquicent.com',
  'DEFUNCT. Was a fractional ownership platform for vintage cars and fine art. Enabled professional collectors/museums to offer minority stakes. Investments from $100. Shut down after failing to close financing round needed for regulatory compliance.',
  'other',
  'fractional_marketplace',
  'US',
  'inactive',
  true,
  'unverified',
  jsonb_build_object(
    'fractional_platform', true,
    'platform_type', 'equity_shares',
    'jurisdiction', 'USA (Walnut, CA)',
    'vehicle_focus', 'Vintage/classic collector cars and fine art',
    'min_investment_usd', 100,
    'shutdown_reason', 'Failed to close financing round for regulatory compliance',
    'nuke_lesson', 'Regulatory burden killed them — Nuke needs clear legal structure for exchange',
    'founded', 2018,
    'nuke_priority', 'research',
    'source', 'x_monitor_research_2026_02_26'
  )
)

-- Remove dupes from this session (website not unique-constrained, clean up any doubles)
DELETE FROM businesses a
USING businesses b
WHERE a.id > b.id
  AND a.website = b.website
  AND a.metadata->>'source' = 'x_monitor_research_2026_02_26';

-- =============================================================================
-- Add high-priority platforms to observation_sources so we can track
-- their vehicle listings as data we can extract
-- =============================================================================

INSERT INTO observation_sources (
  slug, display_name, category, base_url, base_trust_score, supported_observations, notes
) VALUES
  ('rally-rd', 'Rally Rd.', 'marketplace', 'https://rallyrd.com', 0.70,
   ARRAY['listing', 'sale_result', 'valuation']::observation_kind[],
   'Fractional equity shares in collector cars. SEC-registered. ~400K investors.'),
  ('mcq-markets', 'MCQ Markets', 'marketplace', 'https://www.mcqmarkets.com', 0.65,
   ARRAY['listing', 'valuation']::observation_kind[],
   'Reg A+ fractional exotic car shares. SOL Global-backed. Fort Lauderdale FL.'),
  ('thecarcrowd', 'TheCarCrowd', 'marketplace', 'https://thecarcrowd.uk', 0.65,
   ARRAY['listing', 'valuation']::observation_kind[],
   'UK fractional classic car equity shares. 12-16% annual returns.'),
  ('dupont-registry-invest', 'duPont REGISTRY Invest', 'marketplace', 'https://invest.dupontregistry.com', 0.70,
   ARRAY['listing', 'valuation']::observation_kind[],
   'SEC-qualified fractional collector car shares via Rally. duPont Registry brand.')
ON CONFLICT (slug) DO UPDATE SET
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- =============================================================================
-- Summary view — see all fractional platforms at a glance
-- =============================================================================

CREATE OR REPLACE VIEW fractional_vehicle_platforms AS
SELECT
  id,
  business_name,
  website,
  country,
  status,
  service_type,
  (metadata->>'platform_type') AS platform_type,
  (metadata->>'min_investment_usd')::numeric AS min_investment_usd,
  (metadata->>'nuke_priority') AS nuke_priority,
  (metadata->>'x_handle') AS x_handle,
  (metadata->>'vehicle_focus') AS vehicle_focus,
  (metadata->>'funding_raised_usd')::numeric AS funding_raised_usd,
  created_at
FROM businesses
WHERE metadata->>'fractional_platform' = 'true'
ORDER BY
  CASE metadata->>'nuke_priority'
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
    ELSE 4
  END,
  business_name;
