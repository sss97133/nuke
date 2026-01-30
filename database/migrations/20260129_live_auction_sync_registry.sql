-- =============================================================================
-- LIVE AUCTION SYNC REGISTRY
-- =============================================================================
-- Tracks real-time sync configuration and status for each auction platform.
-- This is the control plane for the live auction monitoring system.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SYNC METHOD ENUM
-- -----------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE auction_sync_method AS ENUM (
        'websocket',        -- Real-time WebSocket connection (best)
        'sse',              -- Server-Sent Events stream
        'polling_api',      -- Polling a structured API endpoint
        'polling_scrape',   -- Polling via HTML scraping
        'hybrid'            -- Combination of methods
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- LIVE AUCTION SOURCES REGISTRY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS live_auction_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to organization
    organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,

    -- Platform identification
    slug TEXT UNIQUE NOT NULL,              -- 'bat', 'cars-and-bids', 'mecum', etc.
    display_name TEXT NOT NULL,             -- 'Bring a Trailer'
    base_url TEXT NOT NULL,                 -- 'https://bringatrailer.com'

    -- Sync capabilities
    sync_method auction_sync_method NOT NULL DEFAULT 'polling_scrape',
    supports_websocket BOOLEAN DEFAULT false,
    supports_sse BOOLEAN DEFAULT false,
    supports_api BOOLEAN DEFAULT false,

    -- Sync configuration
    default_poll_interval_ms INTEGER DEFAULT 60000,    -- 1 minute default
    soft_close_poll_interval_ms INTEGER DEFAULT 5000,  -- 5 seconds in soft-close
    soft_close_window_seconds INTEGER DEFAULT 120,     -- 2 minutes soft-close window
    rate_limit_requests_per_minute INTEGER DEFAULT 20,

    -- Authentication requirements
    requires_auth BOOLEAN DEFAULT false,
    auth_type TEXT,                         -- 'session_cookie', 'oauth', 'api_key', etc.
    supports_proxy_bidding BOOLEAN DEFAULT false,

    -- Auction format details
    auction_duration_typical TEXT,          -- '7 days', 'live event', etc.
    has_reserve_auctions BOOLEAN DEFAULT true,
    has_no_reserve_auctions BOOLEAN DEFAULT true,
    has_soft_close BOOLEAN DEFAULT true,

    -- Real-time endpoints (discovered through reverse engineering)
    websocket_url TEXT,                     -- WebSocket endpoint if available
    sse_url TEXT,                           -- SSE endpoint if available
    api_base_url TEXT,                      -- API base if available
    bid_endpoint TEXT,                      -- Endpoint to place bids
    state_endpoint TEXT,                    -- Endpoint to get auction state
    comments_endpoint TEXT,                 -- Endpoint to get comments

    -- Scraping selectors (for HTML scraping fallback)
    scraping_config JSONB DEFAULT '{}'::jsonb,  -- CSS selectors, XPaths, etc.

    -- Anti-blocking measures
    requires_residential_proxy BOOLEAN DEFAULT false,
    requires_session_rotation BOOLEAN DEFAULT false,
    known_rate_limits JSONB DEFAULT '{}'::jsonb,
    known_anti_bot_measures TEXT[],

    -- Monitoring status
    is_active BOOLEAN DEFAULT true,
    last_successful_sync TIMESTAMPTZ,
    last_sync_error TEXT,
    consecutive_failures INTEGER DEFAULT 0,
    health_status TEXT DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')),

    -- Metadata
    priority INTEGER DEFAULT 50,            -- Higher = sync more aggressively
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_live_auction_sources_slug ON live_auction_sources(slug);
CREATE INDEX IF NOT EXISTS idx_live_auction_sources_org ON live_auction_sources(organization_id);
CREATE INDEX IF NOT EXISTS idx_live_auction_sources_active ON live_auction_sources(is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_live_auction_sources_health ON live_auction_sources(health_status);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_live_auction_sources_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS live_auction_sources_updated_at ON live_auction_sources;
CREATE TRIGGER live_auction_sources_updated_at
    BEFORE UPDATE ON live_auction_sources
    FOR EACH ROW EXECUTE FUNCTION update_live_auction_sources_timestamp();

-- -----------------------------------------------------------------------------
-- ACTIVE AUCTION MONITORING
-- -----------------------------------------------------------------------------
-- Track which auctions are being actively monitored for real-time updates
CREATE TABLE IF NOT EXISTS monitored_auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source and external reference
    source_id UUID NOT NULL REFERENCES live_auction_sources(id) ON DELETE CASCADE,
    external_auction_id TEXT NOT NULL,      -- Platform's auction ID/slug
    external_auction_url TEXT NOT NULL,

    -- Link to our data
    vehicle_id UUID REFERENCES vehicles(id),
    external_listing_id UUID,               -- Reference to external_listings if exists

    -- Auction timing
    auction_start_time TIMESTAMPTZ,
    auction_end_time TIMESTAMPTZ,
    is_live BOOLEAN DEFAULT true,

    -- Current state cache
    current_bid_cents BIGINT,
    bid_count INTEGER DEFAULT 0,
    high_bidder_username TEXT,
    reserve_status TEXT CHECK (reserve_status IN ('met', 'not_met', 'no_reserve', 'unknown')),

    -- Soft-close tracking
    is_in_soft_close BOOLEAN DEFAULT false,
    extension_count INTEGER DEFAULT 0,
    last_extension_at TIMESTAMPTZ,

    -- Sync status
    last_synced_at TIMESTAMPTZ,
    sync_latency_ms INTEGER,
    poll_interval_ms INTEGER,
    next_poll_at TIMESTAMPTZ,

    -- Comment tracking
    last_comment_count INTEGER DEFAULT 0,
    last_comment_synced_at TIMESTAMPTZ,

    -- Monitoring config
    priority INTEGER DEFAULT 50,            -- Higher = poll more often
    notify_on_bid BOOLEAN DEFAULT false,
    notify_on_extension BOOLEAN DEFAULT false,

    -- User associations (for proxy bidding)
    watching_user_ids UUID[],               -- Users watching this auction
    proxy_bid_user_ids UUID[],              -- Users with active proxy bids

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_id, external_auction_id)
);

-- Indexes for efficient monitoring queries
CREATE INDEX IF NOT EXISTS idx_monitored_auctions_source ON monitored_auctions(source_id);
CREATE INDEX IF NOT EXISTS idx_monitored_auctions_live ON monitored_auctions(is_live, next_poll_at);
CREATE INDEX IF NOT EXISTS idx_monitored_auctions_vehicle ON monitored_auctions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_monitored_auctions_end_time ON monitored_auctions(auction_end_time) WHERE is_live = true;
CREATE INDEX IF NOT EXISTS idx_monitored_auctions_soft_close ON monitored_auctions(is_in_soft_close) WHERE is_live = true;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS monitored_auctions_updated_at ON monitored_auctions;
CREATE TRIGGER monitored_auctions_updated_at
    BEFORE UPDATE ON monitored_auctions
    FOR EACH ROW EXECUTE FUNCTION update_live_auction_sources_timestamp();

-- -----------------------------------------------------------------------------
-- BID EVENTS LOG
-- -----------------------------------------------------------------------------
-- Immutable log of all bid events we observe (for real-time streaming to users)
CREATE TABLE IF NOT EXISTS bid_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    monitored_auction_id UUID NOT NULL REFERENCES monitored_auctions(id) ON DELETE CASCADE,

    -- Bid details
    bid_amount_cents BIGINT NOT NULL,
    bidder_username TEXT,
    bidder_external_id TEXT,
    bid_time TIMESTAMPTZ NOT NULL,

    -- Context
    was_proxy_bid BOOLEAN DEFAULT false,
    caused_extension BOOLEAN DEFAULT false,
    new_end_time TIMESTAMPTZ,

    -- Provenance
    observed_at TIMESTAMPTZ DEFAULT NOW(),
    source_latency_ms INTEGER,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bid_events_auction ON bid_events(monitored_auction_id, bid_time DESC);
CREATE INDEX IF NOT EXISTS idx_bid_events_time ON bid_events(bid_time DESC);

-- -----------------------------------------------------------------------------
-- COMMENT EVENTS LOG
-- -----------------------------------------------------------------------------
-- Track new comments for real-time streaming
CREATE TABLE IF NOT EXISTS comment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    monitored_auction_id UUID NOT NULL REFERENCES monitored_auctions(id) ON DELETE CASCADE,

    -- Comment details
    external_comment_id TEXT,
    commenter_username TEXT,
    commenter_external_id TEXT,
    comment_text TEXT NOT NULL,
    comment_time TIMESTAMPTZ NOT NULL,

    -- Threading
    parent_comment_id UUID REFERENCES comment_events(id),

    -- Provenance
    observed_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comment_events_auction ON comment_events(monitored_auction_id, comment_time DESC);

-- -----------------------------------------------------------------------------
-- SEED: Initial Platform Configurations
-- -----------------------------------------------------------------------------

-- Bring a Trailer
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms, soft_close_window_seconds,
    rate_limit_requests_per_minute, auth_type, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'bat', 'Bring a Trailer', 'https://bringatrailer.com', 'polling_scrape',
    false, false, true,
    60000, 5000, 120,
    20, 'session_cookie', true,
    '7 days', true, 100,
    'Primary platform. Adapter exists in nuke_api. Need to reverse engineer WS.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 100,
    notes = EXCLUDED.notes;

-- Cars & Bids
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms, soft_close_window_seconds,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'cars-and-bids', 'Cars & Bids', 'https://carsandbids.com', 'polling_scrape',
    false, false, true,
    60000, 5000, 120,
    20, true,
    '7 days', true, 95,
    'Doug DeMuro platform. Similar to BaT. Need to build adapter.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 95,
    notes = EXCLUDED.notes;

-- PCARMARKET
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'pcarmarket', 'PCARMARKET', 'https://pcarmarket.com', 'polling_scrape',
    false, false, true,
    60000, 5000,
    15, true,
    '7 days', true, 90,
    'Porsche-focused. Active community. Have extractor already.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 90,
    notes = EXCLUDED.notes;

-- Collecting Cars
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'collecting-cars', 'Collecting Cars', 'https://collectingcars.com', 'polling_scrape',
    false, false, true,
    60000, 5000,
    15, true,
    '7 days', true, 85,
    'UK-based, 24/7 global. Have monitor script. Need adapter.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 85,
    notes = EXCLUDED.notes;

-- Hagerty Marketplace
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    soft_close_window_seconds, rate_limit_requests_per_minute,
    supports_proxy_bidding, auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'hagerty-marketplace', 'Hagerty Marketplace', 'https://www.hagerty.com/marketplace', 'polling_scrape',
    false, false, true,
    60000, 5000,
    120, 20,
    true, '7 days', true, 80,
    'Hagerty ecosystem. 1.8M members. Have extractor. Broad Arrow sister company.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 80,
    notes = EXCLUDED.notes;

-- Mecum (Live events)
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'mecum', 'Mecum Auctions', 'https://www.mecum.com', 'polling_scrape',
    false, false, true,
    30000, 10000,
    10, true,
    'live event', false, 75,
    'Live events with online bidding. Largest by volume. Need to analyze real-time feed.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 75,
    notes = EXCLUDED.notes;

-- Barrett-Jackson (Live events)
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'barrett-jackson', 'Barrett-Jackson', 'https://www.barrett-jackson.com', 'polling_scrape',
    false, false, true,
    30000, 10000,
    10, true,
    'live event', false, 70,
    'Most famous. No Reserve policy. TV broadcasts. Need to analyze online bidding system.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 70,
    notes = EXCLUDED.notes;

-- RM Sotheby's
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'rm-sothebys', 'RM Sothebys', 'https://rmsothebys.com', 'polling_scrape',
    false, false, true,
    30000, 10000,
    10, true,
    'live event + online', true, 65,
    'Highest value sales. #1 classic car auction house. Mix of live and online.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 65,
    notes = EXCLUDED.notes;

-- Bonhams
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'bonhams', 'Bonhams', 'https://www.bonhams.com', 'polling_scrape',
    false, false, true,
    60000, 10000,
    15, true,
    'online + live', true, 60,
    '24/7 online auctions. International house. Need to analyze their platform.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 60,
    notes = EXCLUDED.notes;

-- Broad Arrow
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'broad-arrow', 'Broad Arrow Auctions', 'https://broadarrowauctions.com', 'polling_scrape',
    false, false, true,
    60000, 10000,
    15, true,
    'online + live', true, 55,
    'Hagerty company. Growing platform. Multi-location online sales.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 55,
    notes = EXCLUDED.notes;

-- The Market (UK)
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    supports_websocket, supports_api, requires_auth,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'the-market', 'The Market', 'https://www.themarket.co.uk', 'polling_scrape',
    false, false, true,
    60000, 5000,
    15, true,
    '7 days', true, 50,
    'UK-based. Curated selection. Global bidding.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 50,
    notes = EXCLUDED.notes;

-- SBX Cars
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'sbx-cars', 'SBX Cars', 'https://sbxcars.com', 'polling_scrape',
    60000, 5000,
    15, true,
    '7 days', true, 45,
    'Online auction platform. Tracked by Classic.com.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 45,
    notes = EXCLUDED.notes;

-- Hemmings Auctions
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'hemmings', 'Hemmings Auctions', 'https://www.hemmings.com/auctions', 'polling_scrape',
    60000, 5000,
    15, true,
    '7 days', true, 40,
    'Classic car magazine auctions. Established community.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 40,
    notes = EXCLUDED.notes;

-- ISSIMI
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'issimi', 'ISSIMI', 'https://issimi.com', 'polling_scrape',
    60000, 5000,
    15, true,
    '7 days', true, 35,
    'Curated classic and exotic auctions.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 35,
    notes = EXCLUDED.notes;

-- Kickdown
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'kickdown', 'Kickdown', 'https://kickdown.com', 'polling_scrape',
    60000, 5000,
    15, true,
    '7 days', true, 30,
    'European-focused. Online classic car auctions.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 30,
    notes = EXCLUDED.notes;

-- The MB Market
INSERT INTO live_auction_sources (
    slug, display_name, base_url, sync_method,
    default_poll_interval_ms, soft_close_poll_interval_ms,
    rate_limit_requests_per_minute, supports_proxy_bidding,
    auction_duration_typical, has_soft_close, priority, notes
) VALUES (
    'mb-market', 'The MB Market', 'https://thembmarket.com', 'polling_scrape',
    60000, 5000,
    15, true,
    '7 days', true, 25,
    'Mercedes-Benz focused. Niche but engaged community.'
) ON CONFLICT (slug) DO UPDATE SET
    priority = 25,
    notes = EXCLUDED.notes;

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Get auctions that need polling now
CREATE OR REPLACE FUNCTION get_auctions_due_for_poll()
RETURNS TABLE (
    monitored_auction_id UUID,
    source_slug TEXT,
    external_auction_url TEXT,
    auction_end_time TIMESTAMPTZ,
    is_in_soft_close BOOLEAN,
    poll_interval_ms INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ma.id,
        las.slug,
        ma.external_auction_url,
        ma.auction_end_time,
        ma.is_in_soft_close,
        COALESCE(ma.poll_interval_ms,
            CASE WHEN ma.is_in_soft_close THEN las.soft_close_poll_interval_ms
                 ELSE las.default_poll_interval_ms END)
    FROM monitored_auctions ma
    JOIN live_auction_sources las ON las.id = ma.source_id
    WHERE ma.is_live = true
    AND las.is_active = true
    AND (ma.next_poll_at IS NULL OR ma.next_poll_at <= NOW())
    ORDER BY
        ma.is_in_soft_close DESC,  -- Soft-close auctions first
        las.priority DESC,
        ma.auction_end_time ASC;   -- Ending soonest
END;
$$ LANGUAGE plpgsql STABLE;

-- Update auction state after poll
CREATE OR REPLACE FUNCTION update_auction_state(
    p_monitored_auction_id UUID,
    p_current_bid_cents BIGINT,
    p_bid_count INTEGER,
    p_high_bidder TEXT,
    p_auction_end_time TIMESTAMPTZ,
    p_reserve_status TEXT,
    p_sync_latency_ms INTEGER
) RETURNS VOID AS $$
DECLARE
    v_source live_auction_sources;
    v_auction monitored_auctions;
    v_is_in_soft_close BOOLEAN;
    v_extension_detected BOOLEAN;
    v_poll_interval INTEGER;
BEGIN
    -- Get current auction state
    SELECT * INTO v_auction FROM monitored_auctions WHERE id = p_monitored_auction_id;
    SELECT * INTO v_source FROM live_auction_sources WHERE id = v_auction.source_id;

    -- Detect extension
    v_extension_detected := v_auction.auction_end_time IS NOT NULL
        AND p_auction_end_time > v_auction.auction_end_time;

    -- Calculate soft-close status
    v_is_in_soft_close := p_auction_end_time IS NOT NULL
        AND EXTRACT(EPOCH FROM (p_auction_end_time - NOW())) <= v_source.soft_close_window_seconds;

    -- Calculate poll interval based on time remaining
    IF v_is_in_soft_close THEN
        v_poll_interval := v_source.soft_close_poll_interval_ms;
    ELSIF p_auction_end_time IS NOT NULL
          AND EXTRACT(EPOCH FROM (p_auction_end_time - NOW())) <= 600 THEN  -- < 10 min
        v_poll_interval := 15000;
    ELSIF p_auction_end_time IS NOT NULL
          AND EXTRACT(EPOCH FROM (p_auction_end_time - NOW())) <= 3600 THEN  -- < 1 hour
        v_poll_interval := 30000;
    ELSE
        v_poll_interval := v_source.default_poll_interval_ms;
    END IF;

    -- Update auction
    UPDATE monitored_auctions SET
        current_bid_cents = p_current_bid_cents,
        bid_count = p_bid_count,
        high_bidder_username = p_high_bidder,
        auction_end_time = p_auction_end_time,
        reserve_status = p_reserve_status,
        is_in_soft_close = v_is_in_soft_close,
        extension_count = CASE WHEN v_extension_detected THEN extension_count + 1 ELSE extension_count END,
        last_extension_at = CASE WHEN v_extension_detected THEN NOW() ELSE last_extension_at END,
        last_synced_at = NOW(),
        sync_latency_ms = p_sync_latency_ms,
        poll_interval_ms = v_poll_interval,
        next_poll_at = NOW() + (v_poll_interval || ' milliseconds')::INTERVAL,
        is_live = p_auction_end_time IS NULL OR p_auction_end_time > NOW()
    WHERE id = p_monitored_auction_id;

    -- Log bid if amount changed
    IF v_auction.current_bid_cents IS NOT NULL
       AND p_current_bid_cents > v_auction.current_bid_cents THEN
        INSERT INTO bid_events (
            monitored_auction_id, bid_amount_cents, bidder_username,
            bid_time, caused_extension, new_end_time, source_latency_ms
        ) VALUES (
            p_monitored_auction_id, p_current_bid_cents, p_high_bidder,
            NOW(), v_extension_detected,
            CASE WHEN v_extension_detected THEN p_auction_end_time ELSE NULL END,
            p_sync_latency_ms
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- REALTIME SUBSCRIPTIONS
-- -----------------------------------------------------------------------------
-- Enable realtime for bid_events and comment_events so frontend can subscribe

-- Note: Run these in Supabase dashboard if needed:
-- ALTER PUBLICATION supabase_realtime ADD TABLE bid_events;
-- ALTER PUBLICATION supabase_realtime ADD TABLE comment_events;
-- ALTER PUBLICATION supabase_realtime ADD TABLE monitored_auctions;

COMMENT ON TABLE live_auction_sources IS 'Registry of all live auction platforms with their sync configuration and capabilities.';
COMMENT ON TABLE monitored_auctions IS 'Auctions currently being monitored for real-time updates.';
COMMENT ON TABLE bid_events IS 'Immutable log of bid events for real-time streaming to users.';
COMMENT ON TABLE comment_events IS 'Log of comment events for real-time streaming.';
