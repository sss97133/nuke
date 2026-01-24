-- =============================================================================
-- VEHICLE OBSERVATION SYSTEM
-- =============================================================================
-- Event-sourced, source-agnostic observation model with full data lineage.
--
-- Design Principles:
-- 1. IMMUTABLE: Observations are append-only events, never updated
-- 2. PROVENANCE: Every data point tracks its source and confidence
-- 3. BITEMPORAL: Track both observation time and ingestion time
-- 4. EXTENSIBLE: New sources via config, not code
-- 5. RESOLVABLE: Handle conflicts between sources
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------

-- Source categories (extensible via ALTER TYPE)
DO $$ BEGIN
    CREATE TYPE source_category AS ENUM (
        'auction',           -- BaT, C&B, RM Sotheby's, etc.
        'marketplace',       -- eBay, Craigslist, FB Marketplace
        'forum',             -- Rennlist, Pelican Parts, model-specific
        'social_media',      -- Instagram, YouTube, TikTok
        'registry',          -- Hagerty, Classic.com, marque registries
        'shop',              -- Restoration shops, dealers, mechanics
        'documentation',     -- Titles, registrations, build sheets
        'owner',             -- Direct owner input
        'aggregator',        -- ClassicCars.com, Hemmings
        'media',             -- Magazine features, TV shows
        'event',             -- Concours, rallies, shows
        'internal'           -- Our own analysis/inference
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Observation types (what kind of data point is this)
DO $$ BEGIN
    CREATE TYPE observation_kind AS ENUM (
        'listing',           -- For-sale listing
        'sale_result',       -- Completed sale with price
        'comment',           -- Discussion/comment
        'bid',               -- Auction bid
        'sighting',          -- Vehicle spotted/photographed
        'work_record',       -- Service/restoration work
        'ownership',         -- Ownership information
        'specification',     -- Technical specs
        'provenance',        -- History/documentation
        'valuation',         -- Price estimate/appraisal
        'condition',         -- Condition assessment
        'media',             -- Photo/video content
        'social_mention',    -- Social media mention
        'expert_opinion'     -- Expert/authority statement
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Confidence levels (for human readability)
DO $$ BEGIN
    CREATE TYPE confidence_level AS ENUM (
        'verified',          -- Confirmed by multiple sources or authority
        'high',              -- Single authoritative source
        'medium',            -- Reasonable source, unverified
        'low',               -- User-generated, unverified
        'inferred'           -- Derived/computed, not directly observed
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- SOURCE REGISTRY (Enhanced)
-- -----------------------------------------------------------------------------

-- Drop and recreate with better structure
CREATE TABLE IF NOT EXISTS observation_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    slug TEXT UNIQUE NOT NULL,              -- 'bat', 'rennlist', 'pca-registry'
    display_name TEXT NOT NULL,
    category source_category NOT NULL,

    -- Location
    base_url TEXT,
    url_patterns TEXT[],                    -- Regex patterns for URL matching

    -- Trust scoring (0.0 - 1.0)
    base_trust_score DECIMAL(3,2) DEFAULT 0.50,
    trust_factors JSONB DEFAULT '{}',       -- {"editorial_review": 0.1, "identity_verified": 0.2}

    -- Capabilities
    supported_observations observation_kind[],
    requires_auth BOOLEAN DEFAULT false,
    rate_limit_per_hour INTEGER,

    -- Coverage
    makes_covered TEXT[],                   -- NULL = all makes
    years_covered INT4RANGE,                -- e.g., [1950, 2000)
    regions_covered TEXT[],                 -- NULL = global

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- OBSERVATION EVENTS (Core immutable event store)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicle_observations (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What vehicle (nullable for unresolved observations)
    vehicle_id UUID REFERENCES vehicles(id),
    vehicle_match_confidence DECIMAL(3,2),  -- How sure are we this is the right vehicle?
    vehicle_match_signals JSONB,            -- {"vin_match": true, "plate_match": false, "visual_match": 0.85}

    -- Bitemporal timestamps
    observed_at TIMESTAMPTZ NOT NULL,       -- When did this actually happen?
    ingested_at TIMESTAMPTZ DEFAULT NOW(),  -- When did we record it?

    -- Source provenance
    source_id UUID REFERENCES observation_sources(id),
    source_url TEXT,                        -- Original URL
    source_identifier TEXT,                 -- Platform-specific ID (listing ID, comment ID, etc.)

    -- Observer identity (who made this observation)
    observer_id UUID REFERENCES external_identities(id),
    observer_raw JSONB,                     -- Raw observer data before identity resolution

    -- Observation content
    kind observation_kind NOT NULL,
    content_text TEXT,                      -- Main text content
    content_hash TEXT,                      -- SHA256 for dedup
    structured_data JSONB NOT NULL DEFAULT '{}',  -- Type-specific structured fields

    -- Quality signals
    confidence confidence_level DEFAULT 'medium',
    confidence_score DECIMAL(3,2),          -- Computed 0.00-1.00
    confidence_factors JSONB DEFAULT '{}',  -- What contributed to confidence

    -- Processing status
    is_processed BOOLEAN DEFAULT false,     -- Has discovery been run?
    processing_metadata JSONB,

    -- Extraction metadata
    extractor_id UUID,                      -- Which extractor created this
    extraction_metadata JSONB,              -- Raw extraction context

    -- Soft delete (never actually delete observations)
    is_superseded BOOLEAN DEFAULT false,    -- Replaced by newer observation
    superseded_by UUID REFERENCES vehicle_observations(id),
    superseded_at TIMESTAMPTZ,

    -- Deduplication constraint
    CONSTRAINT unique_observation UNIQUE (source_id, source_identifier, kind, content_hash)
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS idx_observations_vehicle ON vehicle_observations(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_source ON vehicle_observations(source_id);
CREATE INDEX IF NOT EXISTS idx_observations_kind ON vehicle_observations(kind);
CREATE INDEX IF NOT EXISTS idx_observations_observed_at ON vehicle_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_unprocessed ON vehicle_observations(id) WHERE NOT is_processed AND vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observations_unresolved ON vehicle_observations(id) WHERE vehicle_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON vehicle_observations(content_hash);

-- -----------------------------------------------------------------------------
-- EXTRACTORS (How to get observations from sources)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observation_extractors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What source does this extract from
    source_id UUID NOT NULL REFERENCES observation_sources(id),

    -- Extractor identity
    slug TEXT NOT NULL,                     -- 'bat-listing-extractor'
    display_name TEXT NOT NULL,

    -- Implementation
    extractor_type TEXT NOT NULL,           -- 'edge_function', 'firecrawl', 'api', 'manual'
    edge_function_name TEXT,                -- If edge_function type
    extractor_config JSONB DEFAULT '{}',    -- Type-specific config

    -- What it produces
    produces_kinds observation_kind[] NOT NULL,

    -- Scheduling
    is_active BOOLEAN DEFAULT true,
    schedule_type TEXT DEFAULT 'on_demand', -- 'on_demand', 'cron', 'continuous'
    schedule_cron TEXT,                     -- If cron type

    -- Rate limiting
    rate_limit_per_hour INTEGER,
    min_interval_seconds INTEGER DEFAULT 1,

    -- Health tracking
    last_run_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    consecutive_failures INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_id, slug)
);

-- -----------------------------------------------------------------------------
-- DISCOVERIES (Derived insights from observations)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS observation_discoveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was analyzed
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),

    -- Input observations
    observation_ids UUID[],                 -- Which observations contributed
    observation_count INTEGER,
    source_categories source_category[],    -- Which source types were included
    date_range_start TIMESTAMPTZ,
    date_range_end TIMESTAMPTZ,

    -- Discovery type and results
    discovery_type TEXT NOT NULL,           -- 'sentiment', 'field_extraction', 'timeline', 'market_signal'
    raw_extraction JSONB NOT NULL,

    -- Quality
    confidence_score DECIMAL(3,2),
    model_used TEXT,
    prompt_version TEXT,

    -- Tracking
    discovered_at TIMESTAMPTZ DEFAULT NOW(),

    -- Review
    is_reviewed BOOLEAN DEFAULT false,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_discoveries_vehicle ON observation_discoveries(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_discoveries_type ON observation_discoveries(discovery_type);

-- -----------------------------------------------------------------------------
-- VEHICLE DATA CONSENSUS (Resolved "truth" from multiple observations)
-- -----------------------------------------------------------------------------

-- When multiple sources say different things, this table holds the resolved value
CREATE TABLE IF NOT EXISTS vehicle_field_consensus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),

    -- What field
    field_name TEXT NOT NULL,               -- 'sale_price', 'mileage', 'color', etc.

    -- Resolved value
    field_value JSONB NOT NULL,             -- The consensus value
    field_value_text TEXT,                  -- Human-readable version

    -- Contributing observations
    supporting_observations UUID[],          -- Observations that agree
    conflicting_observations UUID[],         -- Observations that disagree

    -- Confidence in this consensus
    confidence_score DECIMAL(3,2),
    resolution_method TEXT,                  -- 'unanimous', 'majority', 'authority_wins', 'most_recent', 'manual'

    -- Tracking
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,                  -- When to recompute (for time-sensitive fields)

    -- Manual override
    is_manually_set BOOLEAN DEFAULT false,
    set_by UUID,

    UNIQUE(vehicle_id, field_name)
);

-- -----------------------------------------------------------------------------
-- HELPER VIEWS
-- -----------------------------------------------------------------------------

-- Quick stats on observation coverage
CREATE OR REPLACE VIEW observation_stats AS
SELECT
    os.display_name AS source,
    os.category,
    COUNT(vo.id) AS observation_count,
    COUNT(DISTINCT vo.vehicle_id) AS vehicles_observed,
    MIN(vo.observed_at) AS earliest_observation,
    MAX(vo.observed_at) AS latest_observation,
    COUNT(*) FILTER (WHERE NOT vo.is_processed) AS unprocessed_count
FROM observation_sources os
LEFT JOIN vehicle_observations vo ON vo.source_id = os.id
GROUP BY os.id, os.display_name, os.category
ORDER BY observation_count DESC;

-- Vehicle observation summary
CREATE OR REPLACE VIEW vehicle_observation_summary AS
SELECT
    v.id AS vehicle_id,
    v.year,
    v.make,
    v.model,
    COUNT(vo.id) AS total_observations,
    COUNT(DISTINCT vo.source_id) AS source_count,
    ARRAY_AGG(DISTINCT vo.kind) AS observation_types,
    MIN(vo.observed_at) AS first_observed,
    MAX(vo.observed_at) AS last_observed,
    COUNT(*) FILTER (WHERE vo.kind = 'comment') AS comment_count,
    COUNT(*) FILTER (WHERE vo.kind = 'listing') AS listing_count,
    COUNT(*) FILTER (WHERE vo.kind = 'sale_result') AS sale_count
FROM vehicles v
LEFT JOIN vehicle_observations vo ON vo.vehicle_id = v.id
GROUP BY v.id, v.year, v.make, v.model;

-- -----------------------------------------------------------------------------
-- FUNCTIONS
-- -----------------------------------------------------------------------------

-- Compute confidence score from factors
CREATE OR REPLACE FUNCTION compute_observation_confidence(
    p_source_trust DECIMAL,
    p_factors JSONB
) RETURNS DECIMAL AS $$
DECLARE
    v_score DECIMAL := COALESCE(p_source_trust, 0.5);
    v_factor RECORD;
BEGIN
    -- Add/subtract based on factors
    FOR v_factor IN SELECT * FROM jsonb_each(p_factors)
    LOOP
        v_score := v_score + COALESCE((v_factor.value)::decimal, 0);
    END LOOP;

    -- Clamp to 0-1
    RETURN GREATEST(0, LEAST(1, v_score));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get all observations for a vehicle, sorted by confidence
CREATE OR REPLACE FUNCTION get_vehicle_observations(
    p_vehicle_id UUID,
    p_kinds observation_kind[] DEFAULT NULL,
    p_min_confidence DECIMAL DEFAULT 0
) RETURNS TABLE (
    observation_id UUID,
    kind observation_kind,
    source_name TEXT,
    observed_at TIMESTAMPTZ,
    content_text TEXT,
    structured_data JSONB,
    confidence_score DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        vo.id,
        vo.kind,
        os.display_name,
        vo.observed_at,
        vo.content_text,
        vo.structured_data,
        vo.confidence_score
    FROM vehicle_observations vo
    JOIN observation_sources os ON os.id = vo.source_id
    WHERE vo.vehicle_id = p_vehicle_id
      AND (p_kinds IS NULL OR vo.kind = ANY(p_kinds))
      AND COALESCE(vo.confidence_score, 0.5) >= p_min_confidence
      AND NOT vo.is_superseded
    ORDER BY vo.confidence_score DESC NULLS LAST, vo.observed_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- SEED DATA: Initial sources
-- -----------------------------------------------------------------------------

INSERT INTO observation_sources (slug, display_name, category, base_url, base_trust_score, supported_observations)
VALUES
    ('bat', 'Bring a Trailer', 'auction', 'https://bringatrailer.com', 0.85,
     ARRAY['listing', 'sale_result', 'comment', 'bid']::observation_kind[]),
    ('cars-and-bids', 'Cars & Bids', 'auction', 'https://carsandbids.com', 0.80,
     ARRAY['listing', 'sale_result', 'comment', 'bid']::observation_kind[]),
    ('rm-sothebys', 'RM Sotheby''s', 'auction', 'https://rmsothebys.com', 0.90,
     ARRAY['listing', 'sale_result', 'bid']::observation_kind[]),
    ('bonhams', 'Bonhams', 'auction', 'https://bonhams.com', 0.90,
     ARRAY['listing', 'sale_result', 'bid']::observation_kind[]),
    ('gooding', 'Gooding & Company', 'auction', 'https://goodingco.com', 0.90,
     ARRAY['listing', 'sale_result', 'bid']::observation_kind[]),
    ('mecum', 'Mecum Auctions', 'auction', 'https://mecum.com', 0.75,
     ARRAY['listing', 'sale_result', 'bid']::observation_kind[]),
    ('barrett-jackson', 'Barrett-Jackson', 'auction', 'https://barrett-jackson.com', 0.75,
     ARRAY['listing', 'sale_result', 'bid']::observation_kind[]),
    ('pcarmarket', 'PCarMarket', 'auction', 'https://pcarmarket.com', 0.80,
     ARRAY['listing', 'sale_result', 'comment', 'bid']::observation_kind[]),
    ('hagerty-marketplace', 'Hagerty Marketplace', 'marketplace', 'https://hagerty.com', 0.70,
     ARRAY['listing', 'valuation']::observation_kind[]),
    ('classic-com', 'Classic.com', 'aggregator', 'https://classic.com', 0.65,
     ARRAY['listing', 'sale_result', 'valuation']::observation_kind[]),
    ('rennlist', 'Rennlist Forums', 'forum', 'https://rennlist.com', 0.60,
     ARRAY['comment', 'sighting', 'work_record']::observation_kind[]),
    ('pelican-parts', 'Pelican Parts Forums', 'forum', 'https://forums.pelicanparts.com', 0.60,
     ARRAY['comment', 'sighting', 'work_record']::observation_kind[]),
    ('instagram', 'Instagram', 'social_media', 'https://instagram.com', 0.40,
     ARRAY['media', 'social_mention', 'sighting']::observation_kind[]),
    ('youtube', 'YouTube', 'social_media', 'https://youtube.com', 0.50,
     ARRAY['media', 'social_mention', 'expert_opinion']::observation_kind[]),
    ('owner-input', 'Owner Input', 'owner', NULL, 0.70,
     ARRAY['ownership', 'work_record', 'provenance', 'specification', 'media']::observation_kind[]),
    ('internal-inference', 'System Inference', 'internal', NULL, 0.50,
     ARRAY['valuation', 'condition', 'specification']::observation_kind[])
ON CONFLICT (slug) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    category = EXCLUDED.category,
    base_trust_score = EXCLUDED.base_trust_score,
    supported_observations = EXCLUDED.supported_observations;

-- -----------------------------------------------------------------------------
-- COMMENTS
-- -----------------------------------------------------------------------------

COMMENT ON TABLE vehicle_observations IS
'Immutable event store for all vehicle observations from any source. Every data point about a vehicle flows through here.';

COMMENT ON TABLE observation_sources IS
'Registry of data sources. Add new auction houses, forums, or other sources here.';

COMMENT ON TABLE observation_extractors IS
'Configuration for how to extract observations from each source. Maps sources to edge functions or scraping configs.';

COMMENT ON TABLE observation_discoveries IS
'AI-derived insights from analyzing observations. Sentiment, field extraction, market signals.';

COMMENT ON TABLE vehicle_field_consensus IS
'Resolved "truth" when multiple observations conflict. Tracks which sources agree/disagree.';
