-- Migration: Discovery Snowball System
-- Purpose: Enable recursive discovery of vehicle data sources across platforms
--
-- The "snowball effect":
-- - Classic.com → lists dealers → find web developers → find more dealers
-- - BaT partners → investigate specialties → find more sources
-- - YouTube channels → extract captions → find vehicle data
-- - Collections → leads to Instagram → collector info → more vehicles
-- - Builders (Icon 4x4, Ring Brothers) → portfolio → vehicles

-- ==============================================================================
-- STEP 1: Expand organization types to include all entity categories
-- ==============================================================================

-- First, let's add the new business types to the check constraint
ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_business_type_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_business_type_check
  CHECK (business_type IN (
    -- Original types
    'sole_proprietorship', 'partnership', 'llc', 'corporation',
    'garage', 'dealership', 'restoration_shop', 'performance_shop',
    'body_shop', 'detailing', 'mobile_service', 'specialty_shop',
    'parts_supplier', 'fabrication', 'racing_team',
    -- New types for discovery snowball
    'builder',              -- Icon 4x4, Ring Brothers, Kindred, Emory Porsche
    'collection',           -- Private collections, museums
    'auction_house',        -- BaT, C&B, RM Sotheby's, Mecum
    'marketplace',          -- Classic.com, Hemmings, etc.
    'event',                -- Monterey Car Week, Amelia Island, etc.
    'influencer',           -- YouTube channels, Instagram accounts
    'media',                -- Petrolicious, Jay Leno's Garage, DriveTribe
    'registry',             -- exclusivecarregistry.com, marque registries
    'club',                 -- Marque clubs, enthusiast organizations
    'web_developer',        -- Dealers for dealerships (SpeedDigital, DealerFire)
    'insurance',            -- Hagerty, Grundy
    'finance',              -- Woodside Credit, JJ Best
    'transport',            -- Enclosed auto transport
    'storage',              -- Climate-controlled storage facilities
    'other'
  ));

-- ==============================================================================
-- STEP 2: Create discovery_leads table for tracking lead chains
-- ==============================================================================

CREATE TABLE IF NOT EXISTS discovery_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The source of this lead
    discovered_from_type TEXT NOT NULL CHECK (discovered_from_type IN (
        'scrape_source', 'business', 'vehicle', 'user_profile',
        'youtube_video', 'instagram_post', 'manual', 'ai_suggestion'
    )),
    discovered_from_id UUID,  -- ID of the source entity
    discovered_from_url TEXT, -- URL where we found this lead

    -- What was discovered
    lead_type TEXT NOT NULL CHECK (lead_type IN (
        'organization', 'website', 'social_profile', 'youtube_channel',
        'vehicle_listing', 'collection', 'event', 'person', 'article'
    )),
    lead_url TEXT NOT NULL,
    lead_name TEXT,
    lead_description TEXT,

    -- Classification hints from discovery
    suggested_business_type TEXT,
    suggested_specialties TEXT[],
    confidence_score DECIMAL(3,2) DEFAULT 0.5, -- 0-1

    -- Processing status
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending',      -- Needs investigation
        'investigating', -- Being processed
        'converted',    -- Created an entity from this lead
        'duplicate',    -- Already exists
        'invalid',      -- Bad lead (404, unrelated, etc.)
        'skipped'       -- Intentionally skipped
    )),
    converted_to_type TEXT, -- 'business', 'scrape_source', 'vehicle', etc.
    converted_to_id UUID,   -- ID of created entity

    -- Metadata
    discovery_method TEXT,  -- 'crawl', 'api', 'llm_suggestion', 'pattern_match'
    raw_data JSONB DEFAULT '{}', -- Original scraped data
    processing_notes TEXT,

    -- Chain tracking for snowball effect
    depth INTEGER DEFAULT 0, -- How many hops from original source
    root_source_id UUID,     -- The original source that started this chain

    -- Timestamps
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    investigated_at TIMESTAMPTZ,
    converted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_leads_status ON discovery_leads(status);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_type ON discovery_leads(lead_type);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_url ON discovery_leads(lead_url);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_from ON discovery_leads(discovered_from_type, discovered_from_id);
CREATE INDEX IF NOT EXISTS idx_discovery_leads_pending ON discovery_leads(status) WHERE status = 'pending';

-- ==============================================================================
-- STEP 3: Create discovery_chains table for tracking snowball paths
-- ==============================================================================

CREATE TABLE IF NOT EXISTS discovery_chains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Chain identity
    chain_name TEXT,
    root_entity_type TEXT NOT NULL,
    root_entity_id UUID NOT NULL,
    root_url TEXT,

    -- Chain statistics
    total_leads_discovered INTEGER DEFAULT 0,
    leads_converted INTEGER DEFAULT 0,
    leads_pending INTEGER DEFAULT 0,
    leads_invalid INTEGER DEFAULT 0,
    max_depth_reached INTEGER DEFAULT 0,

    -- Vehicle outcomes (the ultimate goal)
    vehicles_discovered INTEGER DEFAULT 0,
    vehicles_extracted INTEGER DEFAULT 0,

    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN (
        'active', 'paused', 'completed', 'exhausted'
    )),

    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovery_chains_status ON discovery_chains(status);
CREATE INDEX IF NOT EXISTS idx_discovery_chains_root ON discovery_chains(root_entity_type, root_entity_id);

-- ==============================================================================
-- STEP 4: Create youtube_channels table for video content sources
-- ==============================================================================

CREATE TABLE IF NOT EXISTS youtube_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- YouTube identifiers
    channel_id TEXT UNIQUE NOT NULL,
    channel_handle TEXT,  -- @handle
    channel_name TEXT NOT NULL,

    -- Channel info
    description TEXT,
    subscriber_count INTEGER,
    video_count INTEGER,
    view_count BIGINT,

    -- Classification
    channel_type TEXT CHECK (channel_type IN (
        'review',       -- Regular car reviews
        'restoration',  -- Restoration content
        'auction',      -- Auction coverage
        'collection',   -- Private collection tours
        'builder',      -- Build content (Icon, Ring Brothers)
        'documentary',  -- Petrolicious style
        'entertainment', -- Jay Leno's Garage
        'educational',  -- Technical content
        'mixed'
    )),

    -- What vehicles they cover
    make_focus TEXT[],      -- ['Porsche', 'Ferrari'] or empty for all
    era_focus TEXT[],       -- ['classic', 'vintage', 'modern_classic']
    content_focus TEXT[],   -- ['reviews', 'builds', 'history', 'auctions']

    -- Linked business (if applicable)
    business_id UUID REFERENCES businesses(id),

    -- Extraction status
    is_active BOOLEAN DEFAULT true,
    last_scraped_at TIMESTAMPTZ,
    videos_processed INTEGER DEFAULT 0,
    vehicles_extracted INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_channels_type ON youtube_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_youtube_channels_active ON youtube_channels(is_active) WHERE is_active = true;

-- ==============================================================================
-- STEP 5: Create youtube_videos table for individual video tracking
-- ==============================================================================

CREATE TABLE IF NOT EXISTS youtube_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- YouTube identifiers
    video_id TEXT UNIQUE NOT NULL,
    channel_id TEXT NOT NULL REFERENCES youtube_channels(channel_id),

    -- Video info
    title TEXT NOT NULL,
    description TEXT,
    published_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    view_count BIGINT,
    like_count INTEGER,
    comment_count INTEGER,

    -- Content analysis
    video_type TEXT CHECK (video_type IN (
        'review', 'tour', 'auction_coverage', 'restoration_update',
        'build_progress', 'comparison', 'history', 'interview',
        'event_coverage', 'collection_tour', 'other'
    )),

    -- Vehicle mentions (populated by caption analysis)
    vehicles_mentioned JSONB DEFAULT '[]',  -- [{year, make, model, vin?, timestamps}]
    primary_vehicle_id UUID REFERENCES vehicles(id),

    -- Caption extraction
    has_captions BOOLEAN DEFAULT false,
    captions_extracted BOOLEAN DEFAULT false,
    caption_language TEXT,
    caption_text TEXT,  -- Full transcript for search

    -- Processing status
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN (
        'pending', 'processing', 'processed', 'failed', 'no_vehicle_content'
    )),

    -- Timestamps
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_youtube_videos_channel ON youtube_videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_status ON youtube_videos(processing_status);
CREATE INDEX IF NOT EXISTS idx_youtube_videos_pending ON youtube_videos(processing_status) WHERE processing_status = 'pending';

-- ==============================================================================
-- STEP 6: Create web_developer_clients table for tracking dealer site networks
-- ==============================================================================

CREATE TABLE IF NOT EXISTS web_developer_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Developer info
    developer_name TEXT NOT NULL,
    developer_website TEXT,
    developer_business_id UUID REFERENCES businesses(id),

    -- Platform/CMS detection
    platform_name TEXT,  -- 'SpeedDigital', 'DealerFire', 'FusionZone', etc.
    cms_type TEXT,       -- 'custom', 'wordpress', 'shopify', etc.

    -- Client (dealer) info
    client_domain TEXT NOT NULL,
    client_name TEXT,
    client_business_id UUID REFERENCES businesses(id),
    client_scrape_source_id UUID REFERENCES scrape_sources(id),

    -- Detection confidence
    confidence_score DECIMAL(3,2) DEFAULT 0.5,
    detection_method TEXT,  -- 'meta_tag', 'footer', 'source_code', 'api_pattern'

    -- Discovery chain
    discovered_via_lead_id UUID REFERENCES discovery_leads(id),

    -- Timestamps
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_developer_clients_developer ON web_developer_clients(developer_name);
CREATE INDEX IF NOT EXISTS idx_web_developer_clients_platform ON web_developer_clients(platform_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_developer_clients_unique ON web_developer_clients(developer_name, client_domain);

-- ==============================================================================
-- STEP 7: Function to process a discovery lead
-- ==============================================================================

CREATE OR REPLACE FUNCTION process_discovery_lead(
    p_lead_id UUID,
    p_converted_type TEXT DEFAULT NULL,
    p_converted_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT 'converted'
) RETURNS JSONB AS $$
DECLARE
    v_lead RECORD;
    v_chain_id UUID;
    v_result JSONB;
BEGIN
    -- Get the lead
    SELECT * INTO v_lead FROM discovery_leads WHERE id = p_lead_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Lead not found');
    END IF;

    -- Update the lead
    UPDATE discovery_leads
    SET
        status = p_status,
        converted_to_type = p_converted_type,
        converted_to_id = p_converted_id,
        investigated_at = NOW(),
        converted_at = CASE WHEN p_status = 'converted' THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = p_lead_id;

    -- Update chain statistics if part of a chain
    IF v_lead.root_source_id IS NOT NULL THEN
        UPDATE discovery_chains
        SET
            leads_converted = leads_converted + CASE WHEN p_status = 'converted' THEN 1 ELSE 0 END,
            leads_invalid = leads_invalid + CASE WHEN p_status = 'invalid' THEN 1 ELSE 0 END,
            leads_pending = leads_pending - 1,
            last_activity_at = NOW()
        WHERE root_entity_id = v_lead.root_source_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'lead_id', p_lead_id,
        'status', p_status,
        'converted_to_type', p_converted_type,
        'converted_to_id', p_converted_id
    );
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- STEP 8: Function to get next pending leads for processing
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_pending_discovery_leads(
    p_limit INTEGER DEFAULT 10,
    p_lead_type TEXT DEFAULT NULL,
    p_max_depth INTEGER DEFAULT 5
) RETURNS TABLE (
    id UUID,
    lead_type TEXT,
    lead_url TEXT,
    lead_name TEXT,
    suggested_business_type TEXT,
    confidence_score DECIMAL,
    depth INTEGER,
    discovered_from_url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dl.id,
        dl.lead_type,
        dl.lead_url,
        dl.lead_name,
        dl.suggested_business_type,
        dl.confidence_score,
        dl.depth,
        dl.discovered_from_url
    FROM discovery_leads dl
    WHERE dl.status = 'pending'
      AND dl.depth <= p_max_depth
      AND (p_lead_type IS NULL OR dl.lead_type = p_lead_type)
    ORDER BY
        dl.confidence_score DESC,
        dl.depth ASC,
        dl.discovered_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- STEP 9: View for discovery statistics
-- ==============================================================================

CREATE OR REPLACE VIEW discovery_statistics AS
SELECT
    -- Lead counts by status
    COUNT(*) FILTER (WHERE status = 'pending') as leads_pending,
    COUNT(*) FILTER (WHERE status = 'investigating') as leads_investigating,
    COUNT(*) FILTER (WHERE status = 'converted') as leads_converted,
    COUNT(*) FILTER (WHERE status = 'duplicate') as leads_duplicate,
    COUNT(*) FILTER (WHERE status = 'invalid') as leads_invalid,
    COUNT(*) FILTER (WHERE status = 'skipped') as leads_skipped,
    COUNT(*) as leads_total,

    -- Lead counts by type
    COUNT(*) FILTER (WHERE lead_type = 'organization') as org_leads,
    COUNT(*) FILTER (WHERE lead_type = 'youtube_channel') as youtube_leads,
    COUNT(*) FILTER (WHERE lead_type = 'vehicle_listing') as vehicle_leads,
    COUNT(*) FILTER (WHERE lead_type = 'social_profile') as social_leads,

    -- Conversion rates
    CASE WHEN COUNT(*) FILTER (WHERE status != 'pending') > 0
         THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'converted') /
                    COUNT(*) FILTER (WHERE status != 'pending'), 1)
         ELSE 0 END as conversion_rate,

    -- Chain statistics
    (SELECT COUNT(*) FROM discovery_chains WHERE status = 'active') as active_chains,
    (SELECT MAX(max_depth_reached) FROM discovery_chains) as deepest_chain,
    (SELECT SUM(vehicles_discovered) FROM discovery_chains) as total_vehicles_from_chains

FROM discovery_leads;

-- ==============================================================================
-- STEP 10: Grants and permissions
-- ==============================================================================

GRANT SELECT ON discovery_leads TO authenticated, service_role;
GRANT INSERT, UPDATE ON discovery_leads TO service_role;
GRANT SELECT ON discovery_chains TO authenticated, service_role;
GRANT INSERT, UPDATE ON discovery_chains TO service_role;
GRANT SELECT ON youtube_channels TO authenticated, service_role;
GRANT INSERT, UPDATE ON youtube_channels TO service_role;
GRANT SELECT ON youtube_videos TO authenticated, service_role;
GRANT INSERT, UPDATE ON youtube_videos TO service_role;
GRANT SELECT ON web_developer_clients TO authenticated, service_role;
GRANT INSERT ON web_developer_clients TO service_role;
GRANT SELECT ON discovery_statistics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION process_discovery_lead TO service_role;
GRANT EXECUTE ON FUNCTION get_pending_discovery_leads TO service_role;

-- ==============================================================================
-- STEP 11: Seed some known discovery sources
-- ==============================================================================

-- YouTube channels for vehicle content
INSERT INTO youtube_channels (channel_id, channel_handle, channel_name, channel_type, content_focus)
VALUES
    ('UC0S8dRg6Oxh2oIjGSxpZfMg', '@JayLenosGarage', 'Jay Leno''s Garage', 'entertainment', ARRAY['reviews', 'history', 'collections']),
    ('UC0J5Z-mGbsJEv_8MlLpWvkQ', '@Petrolicious', 'Petrolicious', 'documentary', ARRAY['history', 'collections', 'profiles']),
    ('UCDqV6glfCpFpN0VTqKzPm7g', '@VINwiki', 'VINwiki', 'entertainment', ARRAY['history', 'stories']),
    ('UCsqjHFMB_JYTaEnf_vmTNqg', '@DougDeMuro', 'Doug DeMuro', 'review', ARRAY['reviews']),
    ('UCsI5T-g24SfLwUzN4M1cLrw', '@HarrysDriveway', 'Harry''s Garage', 'review', ARRAY['reviews', 'collections'])
ON CONFLICT (channel_id) DO NOTHING;

-- Known builders
INSERT INTO businesses (business_name, business_type, website, industry_focus, specializations, metadata)
VALUES
    ('Icon 4x4', 'builder', 'https://www.icon4x4.com', ARRAY['trucks', 'off-road'], ARRAY['restoration', 'custom_build'], '{"discovery_source": "manual_seed"}'),
    ('Ring Brothers', 'builder', 'https://www.ringbrothers.com', ARRAY['muscle_cars', 'custom'], ARRAY['custom_build', 'fabrication'], '{"discovery_source": "manual_seed"}'),
    ('Singer Vehicle Design', 'builder', 'https://singervehicledesign.com', ARRAY['porsche'], ARRAY['restoration', 'reimagining'], '{"discovery_source": "manual_seed"}'),
    ('Emory Motorsports', 'builder', 'https://emorymotorsports.com', ARRAY['porsche'], ARRAY['outlaw', 'restoration'], '{"discovery_source": "manual_seed"}'),
    ('Kindred Motorworks', 'builder', 'https://kindredmotorworks.com', ARRAY['trucks', 'electric'], ARRAY['ev_conversion', 'restoration'], '{"discovery_source": "manual_seed"}'),
    ('Gunther Werks', 'builder', 'https://gunther-werks.com', ARRAY['porsche'], ARRAY['remastering'], '{"discovery_source": "manual_seed"}')
ON CONFLICT DO NOTHING;

-- Known marketplaces/registries as discovery starting points
INSERT INTO discovery_leads (discovered_from_type, lead_type, lead_url, lead_name, suggested_business_type, confidence_score, status, discovery_method)
VALUES
    ('manual', 'organization', 'https://www.classic.com/dealers', 'Classic.com Dealer Directory', 'marketplace', 0.95, 'pending', 'manual_seed'),
    ('manual', 'organization', 'https://bringatrailer.com/partners', 'BaT Partners', 'marketplace', 0.90, 'pending', 'manual_seed'),
    ('manual', 'organization', 'https://www.exclusivecarregistry.com', 'Exclusive Car Registry', 'registry', 0.85, 'pending', 'manual_seed'),
    ('manual', 'organization', 'https://www.hemmings.com/dealers', 'Hemmings Dealer Directory', 'marketplace', 0.90, 'pending', 'manual_seed'),
    ('manual', 'organization', 'https://classiccars.com/dealers', 'ClassicCars.com Dealers', 'marketplace', 0.85, 'pending', 'manual_seed')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE discovery_leads IS 'Tracks leads discovered through the snowball effect - each lead can spawn more leads';
COMMENT ON TABLE discovery_chains IS 'Tracks chains of discovery from root sources through multiple hops';
COMMENT ON TABLE youtube_channels IS 'YouTube channels that produce vehicle content for caption extraction';
COMMENT ON TABLE youtube_videos IS 'Individual videos with caption extraction for vehicle data';
COMMENT ON TABLE web_developer_clients IS 'Tracks which dealers use which web platforms (for network discovery)';
