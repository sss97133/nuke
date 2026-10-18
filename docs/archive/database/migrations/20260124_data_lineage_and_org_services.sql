-- =============================================================================
-- DATA LINEAGE AND ORGANIZATION SERVICE CATEGORIZATION
-- =============================================================================
-- "We don't care WHERE data comes from, but we need to UNDERSTAND the PATH"
-- "5Ws of everyday the car is on this earth"
--
-- This migration adds:
-- 1. Data lineage tracking - the chain of sources data passed through
-- 2. Organization service types - what service/tool each org provides
-- 3. Wayback Machine as a meta-source for historical discovery
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ORGANIZATION SERVICE TYPES
-- -----------------------------------------------------------------------------
-- All organizations in automotive provide a service or tool.
-- This categorizes what they DO, not what they ARE.

DO $$ BEGIN
    CREATE TYPE org_service_type AS ENUM (
        -- Primary data sources
        'auction_house',          -- Runs auctions (BaT, RM Sotheby's, Mecum)
        'dealer',                 -- Sells vehicles directly
        'marketplace',            -- Platform where others list (eBay, Craigslist)
        'broker',                 -- Connects buyers/sellers, doesn't hold inventory

        -- Aggregators (windows into other sources)
        'listing_aggregator',     -- Aggregates listings (Classic.com, Hemmings)
        'price_aggregator',       -- Aggregates pricing data (Hagerty, Classic.com)
        'search_tool',            -- Queries other sources (SearchTempest)

        -- Platform providers (power other businesses)
        'website_builder',        -- Builds dealer websites (Speed Digital, DealerAccelerate)
        'inventory_system',       -- Manages dealer inventory
        'dms_provider',           -- Dealer Management System

        -- Service providers
        'restoration_shop',       -- Restores vehicles
        'service_shop',           -- Repairs/maintains vehicles
        'parts_supplier',         -- Sells parts
        'detailing',              -- Detailing services
        'storage',                -- Vehicle storage
        'transport',              -- Vehicle transport
        'inspection',             -- Pre-purchase inspections
        'appraisal',              -- Vehicle appraisals
        'documentation',          -- Title/registration services

        -- Information sources
        'registry',               -- Marque registries, clubs
        'media_outlet',           -- Magazines, blogs, YouTube channels
        'valuation_service',      -- Price guides (Hagerty, Classic.com)
        'history_report',         -- Carfax, AutoCheck
        'archive',                -- Wayback Machine, newspaper archives

        -- Community
        'forum',                  -- Online forums
        'club',                   -- Car clubs
        'event_organizer'         -- Shows, rallies, concours
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add service type to businesses table
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS service_type org_service_type,
ADD COLUMN IF NOT EXISTS service_description TEXT,
ADD COLUMN IF NOT EXISTS powers_other_orgs BOOLEAN DEFAULT false,  -- True for platforms like Speed Digital
ADD COLUMN IF NOT EXISTS powered_by_org_id UUID REFERENCES businesses(id);  -- If this dealer uses Speed Digital

-- Index for finding platforms and their clients
CREATE INDEX IF NOT EXISTS idx_businesses_service_type ON businesses(service_type);
CREATE INDEX IF NOT EXISTS idx_businesses_powered_by ON businesses(powered_by_org_id) WHERE powered_by_org_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN businesses.service_type IS 'What service or tool does this organization provide? All automotive orgs offer a service.';
COMMENT ON COLUMN businesses.powers_other_orgs IS 'True if this org provides services TO other orgs (e.g., Speed Digital builds dealer websites)';
COMMENT ON COLUMN businesses.powered_by_org_id IS 'If this dealer/org uses a platform like Speed Digital or DealerAccelerate';

-- -----------------------------------------------------------------------------
-- DATA LINEAGE TRACKING
-- -----------------------------------------------------------------------------
-- Track the PATH data took to reach us, not just the final source.
-- Example: Data from "Joe's Classic Cars" -> aggregated by "Classic.com" -> found via "Wayback Machine"

-- Observation source chain - tracks the lineage of an observation
CREATE TABLE IF NOT EXISTS observation_lineage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_id UUID NOT NULL REFERENCES vehicle_observations(id) ON DELETE CASCADE,

    -- Position in chain (0 = original source, 1 = first intermediary, etc.)
    chain_position INTEGER NOT NULL DEFAULT 0,

    -- The source at this position
    source_id UUID REFERENCES observation_sources(id),
    organization_id UUID REFERENCES businesses(id),  -- Can reference an org instead of observation_source

    -- What role did this source play?
    role TEXT NOT NULL CHECK (role IN (
        'original_source',     -- Where the data originated (e.g., the actual dealer)
        'aggregator',          -- Collected/aggregated the data (e.g., Classic.com)
        'archive',             -- Preserved historical copy (e.g., Wayback Machine)
        'discovery_tool',      -- How we found it (e.g., SearchTempest)
        'reference',           -- Cross-reference that confirmed data
        'enrichment'           -- Added additional data
    )),

    -- Source-specific details
    source_url TEXT,           -- URL at this source
    source_identifier TEXT,    -- ID at this source
    observed_at_source TIMESTAMPTZ,  -- When this source observed it

    -- Data transformation notes
    data_changes TEXT,         -- What changed at this hop? (e.g., "price updated", "images removed")

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(observation_id, chain_position)
);

CREATE INDEX IF NOT EXISTS idx_observation_lineage_obs ON observation_lineage(observation_id);
CREATE INDEX IF NOT EXISTS idx_observation_lineage_source ON observation_lineage(source_id);
CREATE INDEX IF NOT EXISTS idx_observation_lineage_org ON observation_lineage(organization_id);

COMMENT ON TABLE observation_lineage IS
'Tracks the path data took to reach us. Each row is one hop in the chain from original source to our system.';

-- Add lineage summary to observations for quick access
ALTER TABLE vehicle_observations
ADD COLUMN IF NOT EXISTS lineage_chain UUID[],           -- Array of source_ids in order
ADD COLUMN IF NOT EXISTS original_source_id UUID,        -- Quick reference to the TRUE original source
ADD COLUMN IF NOT EXISTS original_source_url TEXT,       -- URL at the original source
ADD COLUMN IF NOT EXISTS discovered_via_id UUID,         -- How we found this (archive, aggregator, etc.)
ADD COLUMN IF NOT EXISTS data_freshness_at_discovery INTERVAL;  -- How old was the data when we found it?

-- -----------------------------------------------------------------------------
-- WAYBACK MACHINE / ARCHIVE SUPPORT
-- -----------------------------------------------------------------------------

-- Add Wayback Machine as a meta-source
INSERT INTO observation_sources (slug, display_name, category, base_url, base_trust_score, supported_observations, notes)
VALUES (
    'wayback-machine',
    'Internet Archive Wayback Machine',
    'registry',  -- Using registry as closest fit; it's an archive
    'https://web.archive.org',
    0.95,  -- Very high trust - it's what was actually there
    ARRAY['listing', 'media', 'specification', 'provenance']::observation_kind[],
    'Historical snapshots of web pages. Data is what WAS there at the time, extremely reliable for provenance.'
)
ON CONFLICT (slug) DO UPDATE SET
    base_trust_score = 0.95,
    notes = EXCLUDED.notes;

-- Add Google Cache as another archive source
INSERT INTO observation_sources (slug, display_name, category, base_url, base_trust_score, supported_observations, notes)
VALUES (
    'google-cache',
    'Google Cache',
    'registry',
    'https://webcache.googleusercontent.com',
    0.90,
    ARRAY['listing', 'media', 'specification']::observation_kind[],
    'Google cached version of pages. Recent snapshots, good for recently removed listings.'
)
ON CONFLICT (slug) DO NOTHING;

-- Table to track VINs we should search in Wayback
CREATE TABLE IF NOT EXISTS wayback_vin_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id),
    vin TEXT NOT NULL,

    -- Search status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'searching', 'found_results', 'no_results', 'error')),

    -- Results
    snapshots_found INTEGER DEFAULT 0,
    unique_sources_found INTEGER DEFAULT 0,
    earliest_snapshot TIMESTAMPTZ,
    latest_snapshot TIMESTAMPTZ,

    -- Tracking
    priority INTEGER DEFAULT 50,  -- Higher = search sooner
    created_at TIMESTAMPTZ DEFAULT NOW(),
    searched_at TIMESTAMPTZ,
    error_message TEXT,

    UNIQUE(vin)
);

CREATE INDEX IF NOT EXISTS idx_wayback_queue_status ON wayback_vin_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_wayback_queue_vehicle ON wayback_vin_queue(vehicle_id);

-- -----------------------------------------------------------------------------
-- TIMELINE VIEW
-- -----------------------------------------------------------------------------
-- "5Ws of everyday the car is on this earth"
-- Who, What, When, Where, Why for every observation

CREATE OR REPLACE VIEW vehicle_timeline AS
SELECT
    vo.vehicle_id,
    vo.observed_at AS when_observed,
    vo.kind AS what_happened,
    os.display_name AS where_source,
    os.category AS source_category,
    vo.source_url AS where_url,
    COALESCE(ei.display_name, vo.observer_raw->>'username', 'Unknown') AS who_observer,
    vo.content_text AS what_content,
    vo.structured_data AS what_details,
    vo.confidence AS how_confident,
    vo.confidence_score,

    -- Lineage info
    vo.original_source_url AS original_where,
    CASE
        WHEN vo.discovered_via_id IS NOT NULL THEN 'Via archive/aggregator'
        ELSE 'Direct'
    END AS how_discovered,

    -- Time context
    vo.ingested_at AS when_we_learned,
    vo.observed_at - vo.ingested_at AS data_age_when_found

FROM vehicle_observations vo
LEFT JOIN observation_sources os ON os.id = vo.source_id
LEFT JOIN external_identities ei ON ei.id = vo.observer_id
WHERE NOT vo.is_superseded
ORDER BY vo.observed_at DESC;

COMMENT ON VIEW vehicle_timeline IS
'Complete timeline of a vehicle''s observed history - the 5Ws of every day of its existence we know about.';

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Record the lineage chain for an observation
CREATE OR REPLACE FUNCTION record_observation_lineage(
    p_observation_id UUID,
    p_chain JSONB  -- Array of {source_id, org_id, role, url, identifier, observed_at, changes}
) RETURNS VOID AS $$
DECLARE
    v_item JSONB;
    v_position INTEGER := 0;
    v_source_ids UUID[] := ARRAY[]::UUID[];
    v_original_source_id UUID;
    v_original_url TEXT;
    v_discovered_via_id UUID;
BEGIN
    -- Clear existing lineage
    DELETE FROM observation_lineage WHERE observation_id = p_observation_id;

    -- Insert each hop
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_chain)
    LOOP
        INSERT INTO observation_lineage (
            observation_id, chain_position, source_id, organization_id, role,
            source_url, source_identifier, observed_at_source, data_changes
        ) VALUES (
            p_observation_id,
            v_position,
            (v_item->>'source_id')::UUID,
            (v_item->>'org_id')::UUID,
            v_item->>'role',
            v_item->>'url',
            v_item->>'identifier',
            (v_item->>'observed_at')::TIMESTAMPTZ,
            v_item->>'changes'
        );

        -- Track for summary
        IF (v_item->>'source_id') IS NOT NULL THEN
            v_source_ids := v_source_ids || (v_item->>'source_id')::UUID;
        END IF;

        IF v_item->>'role' = 'original_source' THEN
            v_original_source_id := COALESCE((v_item->>'source_id')::UUID, (v_item->>'org_id')::UUID);
            v_original_url := v_item->>'url';
        END IF;

        IF v_item->>'role' IN ('archive', 'aggregator', 'discovery_tool') AND v_position > 0 THEN
            v_discovered_via_id := (v_item->>'source_id')::UUID;
        END IF;

        v_position := v_position + 1;
    END LOOP;

    -- Update observation with summary
    UPDATE vehicle_observations SET
        lineage_chain = v_source_ids,
        original_source_id = v_original_source_id,
        original_source_url = v_original_url,
        discovered_via_id = v_discovered_via_id
    WHERE id = p_observation_id;
END;
$$ LANGUAGE plpgsql;

-- Get the full lineage for an observation
CREATE OR REPLACE FUNCTION get_observation_lineage(p_observation_id UUID)
RETURNS TABLE (
    position INTEGER,
    source_name TEXT,
    org_name TEXT,
    role TEXT,
    url TEXT,
    observed_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ol.chain_position,
        os.display_name,
        b.name,
        ol.role,
        ol.source_url,
        ol.observed_at_source
    FROM observation_lineage ol
    LEFT JOIN observation_sources os ON os.id = ol.source_id
    LEFT JOIN businesses b ON b.id = ol.organization_id
    WHERE ol.observation_id = p_observation_id
    ORDER BY ol.chain_position;
END;
$$ LANGUAGE plpgsql STABLE;

-- -----------------------------------------------------------------------------
-- UPDATE CLASSIC.COM CATEGORIZATION
-- -----------------------------------------------------------------------------

-- Classic.com is a listing_aggregator, not a registry
UPDATE observation_sources
SET category = 'aggregator',
    notes = 'Aggregates listings from 275+ dealers. Good for VINs and finding original sources. Data passthrough only.'
WHERE slug = 'classic-com';

-- -----------------------------------------------------------------------------
-- SEED: Known Platform Providers
-- -----------------------------------------------------------------------------

-- Speed Digital (website builder for classic car dealers)
INSERT INTO businesses (id, name, service_type, service_description, powers_other_orgs, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000001'::UUID,
    'Speed Digital',
    'website_builder',
    'DealerAccelerate platform - powers 200+ classic car dealer websites. Acquired by Hagerty 2022.',
    true,
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'website_builder',
    service_description = EXCLUDED.service_description,
    powers_other_orgs = true;

-- DealerAccelerate (the product, owned by Speed Digital)
INSERT INTO businesses (id, name, service_type, service_description, powers_other_orgs, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000002'::UUID,
    'DealerAccelerate',
    'website_builder',
    'Speed Digital''s dealer website platform. Many classic.com dealers use this.',
    true,
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'website_builder',
    service_description = EXCLUDED.service_description,
    powers_other_orgs = true;

-- Classic.com as a business
INSERT INTO businesses (id, name, service_type, service_description, powers_other_orgs, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000003'::UUID,
    'Classic.com',
    'listing_aggregator',
    'Aggregates classic car listings from 275+ dealers and auctions. Good for VINs, finding original sources.',
    false,
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'listing_aggregator',
    service_description = EXCLUDED.service_description;

-- Hemmings
INSERT INTO businesses (id, name, service_type, service_description, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000004'::UUID,
    'Hemmings',
    'listing_aggregator',
    'Classic car magazine and listing aggregator. Mix of dealer and private listings.',
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'listing_aggregator',
    service_description = EXCLUDED.service_description;

-- SearchTempest
INSERT INTO businesses (id, name, service_type, service_description, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000005'::UUID,
    'SearchTempest',
    'search_tool',
    'Meta-search that queries Craigslist, Facebook Marketplace. Does not store listings.',
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'search_tool',
    service_description = EXCLUDED.service_description;

-- Carfax
INSERT INTO businesses (id, name, service_type, service_description, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000006'::UUID,
    'Carfax',
    'history_report',
    'Vehicle history reports from DMV, service, accident records.',
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'history_report',
    service_description = EXCLUDED.service_description;

-- Internet Archive (org for Wayback)
INSERT INTO businesses (id, name, service_type, service_description, business_type)
VALUES (
    'a0000000-0000-0000-0000-000000000007'::UUID,
    'Internet Archive',
    'archive',
    'Wayback Machine - historical snapshots of web pages. Invaluable for provenance.',
    'other'
)
ON CONFLICT (id) DO UPDATE SET
    service_type = 'archive',
    service_description = EXCLUDED.service_description;

-- -----------------------------------------------------------------------------
-- COMMENTS
-- -----------------------------------------------------------------------------

COMMENT ON TYPE org_service_type IS
'What service or tool does an organization provide? All automotive orgs offer a service - this categorizes WHAT they do.';

COMMENT ON TABLE wayback_vin_queue IS
'Queue of VINs to search in Wayback Machine for historical data. High-value way to find past listings.';
