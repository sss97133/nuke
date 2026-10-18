-- =============================================================================
-- FORUM EXTRACTION PIPELINE
-- =============================================================================
-- Tables for forum discovery, inspection, and build thread extraction.
-- Integrates with the existing observation system and external_identities.
--
-- Design Principles:
-- 1. SOURCE-AGNOSTIC: Works with vBulletin, XenForo, phpBB, Discourse, custom
-- 2. PROGRESSIVE: pending -> inspected -> mapped -> active
-- 3. PROVENANCE: Every post links to vehicle_observations
-- 4. IDEMPOTENT: Content hashes for deduplication
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FORUM SOURCES (Registry of target forums)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forum_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    slug TEXT UNIQUE NOT NULL,              -- 'rennlist', 'corvetteforum', etc.
    name TEXT NOT NULL,                      -- Human-readable name
    base_url TEXT NOT NULL,                  -- https://rennlist.com/forums

    -- Platform detection
    platform_type TEXT,                      -- 'vbulletin', 'xenforo', 'phpbb', 'discourse', 'custom'
    platform_version TEXT,                   -- Optional version if detected

    -- Categorization
    vehicle_categories TEXT[],               -- ['porsche', 'european-sports']
    vehicle_makes TEXT[],                    -- ['Porsche', 'BMW'] for filtering
    year_range INT4RANGE,                    -- [1950, 2000) for year filtering

    -- Build thread patterns
    build_thread_patterns TEXT[],            -- URL patterns for build threads
    build_section_urls TEXT[],               -- Direct URLs to build/garage sections

    -- Inspection status
    inspection_status TEXT DEFAULT 'pending'
        CHECK (inspection_status IN ('pending', 'inspected', 'mapped', 'active', 'failed', 'paused')),

    -- DOM mapping (stored after inspection)
    dom_map JSONB,                           -- Stored DOM analysis
    extraction_config JSONB,                 -- Selectors, patterns, custom config

    -- Stats
    estimated_build_count INT,               -- From inspection
    estimated_post_count INT,                -- Total posts estimate
    estimated_image_count INT,               -- Total images estimate

    -- Auth requirements
    requires_login BOOLEAN DEFAULT false,
    login_wall_indicator TEXT,               -- CSS selector or text that indicates login required

    -- Health tracking
    last_inspected_at TIMESTAMPTZ,
    last_crawled_at TIMESTAMPTZ,
    last_error TEXT,
    consecutive_failures INT DEFAULT 0,

    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_forum_sources_status ON forum_sources(inspection_status);
CREATE INDEX IF NOT EXISTS idx_forum_sources_platform ON forum_sources(platform_type);
CREATE INDEX IF NOT EXISTS idx_forum_sources_categories ON forum_sources USING GIN(vehicle_categories);

COMMENT ON TABLE forum_sources IS 'Registry of target forums for build thread extraction.';
COMMENT ON COLUMN forum_sources.dom_map IS 'JSON structure mapping forum HTML selectors for extraction.';
COMMENT ON COLUMN forum_sources.inspection_status IS 'pending=not crawled, inspected=DOM analyzed, mapped=ready for extraction, active=extracting, failed=errors, paused=manual stop';

-- -----------------------------------------------------------------------------
-- BUILD THREADS (Discovered build journal threads)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS build_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source reference
    forum_source_id UUID NOT NULL REFERENCES forum_sources(id) ON DELETE CASCADE,

    -- Thread identity
    thread_url TEXT UNIQUE NOT NULL,
    thread_url_normalized TEXT,              -- Normalized for matching
    thread_id_external TEXT,                 -- Forum's internal thread ID if available
    thread_title TEXT,

    -- Author information
    author_handle TEXT,
    author_profile_url TEXT,
    author_external_identity_id UUID REFERENCES external_identities(id),

    -- Vehicle linking
    vehicle_id UUID REFERENCES vehicles(id),
    vehicle_hints JSONB,                     -- {year, make, model, vin, color, etc.}
    vehicle_match_confidence DECIMAL(3,2),   -- How confident is the vehicle match

    -- Thread stats
    post_count INT,
    image_count_estimate INT,
    view_count INT,
    reply_count INT,

    -- Temporal
    first_post_date TIMESTAMPTZ,
    last_post_date TIMESTAMPTZ,
    last_activity_date TIMESTAMPTZ,

    -- Extraction status
    extraction_status TEXT DEFAULT 'discovered'
        CHECK (extraction_status IN ('discovered', 'queued', 'extracting', 'complete', 'failed', 'stale')),
    posts_extracted INT DEFAULT 0,
    images_extracted INT DEFAULT 0,
    last_extracted_at TIMESTAMPTZ,
    extraction_cursor TEXT,                  -- For pagination/resume

    -- Quality signals
    is_featured BOOLEAN DEFAULT false,       -- Forum-marked as featured
    is_complete BOOLEAN DEFAULT false,       -- Build is finished
    has_sale_mention BOOLEAN DEFAULT false,  -- Mentions selling/sold

    -- Deduplication
    content_hash TEXT,                       -- Hash of first post for dedup

    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_build_threads_forum ON build_threads(forum_source_id);
CREATE INDEX IF NOT EXISTS idx_build_threads_vehicle ON build_threads(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_build_threads_status ON build_threads(extraction_status);
CREATE INDEX IF NOT EXISTS idx_build_threads_author ON build_threads(author_external_identity_id) WHERE author_external_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_build_threads_last_activity ON build_threads(last_activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_build_threads_queued ON build_threads(id) WHERE extraction_status = 'queued';

COMMENT ON TABLE build_threads IS 'Discovered build journal threads from forums.';
COMMENT ON COLUMN build_threads.vehicle_hints IS 'Extracted hints about the vehicle before full resolution.';
COMMENT ON COLUMN build_threads.extraction_cursor IS 'Bookmark for resuming extraction (page number, post ID, etc).';

-- -----------------------------------------------------------------------------
-- BUILD POSTS (Individual posts from build threads)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS build_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent reference
    build_thread_id UUID NOT NULL REFERENCES build_threads(id) ON DELETE CASCADE,

    -- Post identity
    post_number INT NOT NULL,                -- Sequence within thread (1 = OP)
    post_id_external TEXT,                   -- Forum's internal post ID
    post_url TEXT,                           -- Direct link to post if available

    -- Author information
    author_handle TEXT,
    author_profile_url TEXT,
    external_identity_id UUID REFERENCES external_identities(id),

    -- Content
    posted_at TIMESTAMPTZ,
    content_text TEXT,                       -- Plain text content
    content_html TEXT,                       -- Original HTML (for re-parsing)

    -- Media
    images TEXT[],                           -- Array of image URLs
    image_count INT DEFAULT 0,
    has_video BOOLEAN DEFAULT false,
    video_urls TEXT[],

    -- Relationships
    quoted_handles TEXT[],                   -- Users quoted in this post
    quoted_post_ids TEXT[],                  -- Post IDs quoted
    external_links TEXT[],                   -- Links to parts, shops, etc.

    -- Classification
    post_type TEXT DEFAULT 'update'
        CHECK (post_type IN ('original', 'update', 'question', 'answer', 'media_only', 'milestone', 'completion', 'sale')),

    -- Integration with observation system
    observation_id UUID REFERENCES vehicle_observations(id),

    -- Quality signals
    like_count INT DEFAULT 0,
    reply_count INT DEFAULT 0,               -- Direct replies to this post
    word_count INT DEFAULT 0,

    -- Deduplication
    content_hash TEXT UNIQUE,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_thread_post UNIQUE(build_thread_id, post_number)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_build_posts_thread ON build_posts(build_thread_id);
CREATE INDEX IF NOT EXISTS idx_build_posts_author ON build_posts(external_identity_id) WHERE external_identity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_build_posts_posted_at ON build_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_build_posts_observation ON build_posts(observation_id) WHERE observation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_build_posts_images ON build_posts(build_thread_id) WHERE image_count > 0;

COMMENT ON TABLE build_posts IS 'Individual posts extracted from build threads.';
COMMENT ON COLUMN build_posts.post_number IS '1-indexed post position in thread (1 = original post).';
COMMENT ON COLUMN build_posts.observation_id IS 'Link to vehicle_observations for unified data model.';

-- -----------------------------------------------------------------------------
-- FORUM PAGE SNAPSHOTS (For audit trail and re-parsing)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS forum_page_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What was fetched
    forum_source_id UUID REFERENCES forum_sources(id) ON DELETE SET NULL,
    page_url TEXT NOT NULL,
    page_type TEXT NOT NULL                  -- 'thread', 'thread_list', 'profile', 'section'
        CHECK (page_type IN ('thread', 'thread_list', 'profile', 'section', 'homepage')),

    -- Fetch metadata
    fetch_method TEXT NOT NULL,              -- 'direct', 'firecrawl', 'playwright'
    http_status INT,
    success BOOLEAN NOT NULL,
    error_message TEXT,

    -- Content
    html TEXT,
    html_sha256 TEXT,
    content_length INT,

    -- Reference
    build_thread_id UUID REFERENCES build_threads(id) ON DELETE SET NULL,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index for dedup (only when we have content)
CREATE UNIQUE INDEX IF NOT EXISTS idx_forum_snapshots_dedup
    ON forum_page_snapshots(forum_source_id, page_url, html_sha256)
    WHERE html_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_forum_snapshots_source ON forum_page_snapshots(forum_source_id);
CREATE INDEX IF NOT EXISTS idx_forum_snapshots_thread ON forum_page_snapshots(build_thread_id) WHERE build_thread_id IS NOT NULL;

COMMENT ON TABLE forum_page_snapshots IS 'Raw HTML snapshots for audit trail and re-parsing.';

-- -----------------------------------------------------------------------------
-- EXTEND OBSERVATION_SOURCES FOR FORUMS
-- -----------------------------------------------------------------------------

-- Register forum category if not already present (handled by existing migration)
-- This DO block adds forum sources to observation_sources for unified querying

DO $$
BEGIN
    -- Add forum observation kinds if not present
    -- (observation_kind enum already has 'comment' which we'll use for forum posts)
    NULL; -- Kinds already exist
END $$;

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Function to get next forums to inspect
CREATE OR REPLACE FUNCTION get_forums_to_inspect(
    p_limit INT DEFAULT 10
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    base_url TEXT,
    inspection_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        fs.id,
        fs.slug,
        fs.base_url,
        fs.inspection_status
    FROM forum_sources fs
    WHERE fs.inspection_status = 'pending'
       OR (fs.inspection_status = 'failed' AND fs.consecutive_failures < 3)
    ORDER BY
        fs.inspection_status = 'pending' DESC,  -- Pending first
        fs.consecutive_failures ASC,             -- Then least failed
        fs.created_at ASC                        -- Then oldest
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get build threads ready for extraction
CREATE OR REPLACE FUNCTION get_threads_to_extract(
    p_limit INT DEFAULT 50,
    p_forum_id UUID DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    thread_url TEXT,
    forum_slug TEXT,
    post_count INT,
    posts_extracted INT,
    extraction_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        bt.id,
        bt.thread_url,
        fs.slug,
        bt.post_count,
        bt.posts_extracted,
        bt.extraction_status
    FROM build_threads bt
    JOIN forum_sources fs ON fs.id = bt.forum_source_id
    WHERE bt.extraction_status IN ('queued', 'extracting')
      AND fs.inspection_status = 'active'
      AND (p_forum_id IS NULL OR bt.forum_source_id = p_forum_id)
    ORDER BY
        bt.extraction_status = 'extracting' DESC,  -- Resume in-progress first
        bt.last_activity_date DESC NULLS LAST,     -- Then most recent activity
        bt.post_count DESC NULLS LAST              -- Then most posts
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update forum health after extraction attempt
CREATE OR REPLACE FUNCTION update_forum_health(
    p_forum_id UUID,
    p_success BOOLEAN,
    p_error_message TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF p_success THEN
        UPDATE forum_sources
        SET
            last_crawled_at = NOW(),
            last_error = NULL,
            consecutive_failures = 0,
            updated_at = NOW()
        WHERE id = p_forum_id;
    ELSE
        UPDATE forum_sources
        SET
            last_error = p_error_message,
            consecutive_failures = consecutive_failures + 1,
            inspection_status = CASE
                WHEN consecutive_failures >= 2 THEN 'failed'
                ELSE inspection_status
            END,
            updated_at = NOW()
        WHERE id = p_forum_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- VIEWS
-- -----------------------------------------------------------------------------

-- Forum extraction summary
CREATE OR REPLACE VIEW forum_extraction_stats AS
SELECT
    fs.slug,
    fs.name,
    fs.platform_type,
    fs.inspection_status,
    fs.estimated_build_count,
    COUNT(DISTINCT bt.id) AS discovered_threads,
    COUNT(DISTINCT bt.id) FILTER (WHERE bt.extraction_status = 'complete') AS extracted_threads,
    COUNT(DISTINCT bt.id) FILTER (WHERE bt.extraction_status = 'queued') AS queued_threads,
    COUNT(DISTINCT bt.vehicle_id) FILTER (WHERE bt.vehicle_id IS NOT NULL) AS matched_vehicles,
    SUM(bt.posts_extracted) AS total_posts_extracted,
    SUM(bt.images_extracted) AS total_images_extracted,
    MAX(bt.last_extracted_at) AS last_extraction
FROM forum_sources fs
LEFT JOIN build_threads bt ON bt.forum_source_id = fs.id
GROUP BY fs.id, fs.slug, fs.name, fs.platform_type, fs.inspection_status, fs.estimated_build_count
ORDER BY discovered_threads DESC NULLS LAST;

-- Build thread summary with vehicle info
CREATE OR REPLACE VIEW build_thread_summary AS
SELECT
    bt.id,
    bt.thread_title,
    bt.thread_url,
    fs.slug AS forum_slug,
    fs.name AS forum_name,
    bt.author_handle,
    bt.vehicle_hints,
    bt.vehicle_id,
    v.year AS vehicle_year,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    bt.post_count,
    bt.posts_extracted,
    bt.image_count_estimate,
    bt.images_extracted,
    bt.extraction_status,
    bt.first_post_date,
    bt.last_activity_date
FROM build_threads bt
JOIN forum_sources fs ON fs.id = bt.forum_source_id
LEFT JOIN vehicles v ON v.id = bt.vehicle_id
ORDER BY bt.last_activity_date DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- RLS POLICIES
-- -----------------------------------------------------------------------------

ALTER TABLE forum_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_page_snapshots ENABLE ROW LEVEL SECURITY;

-- Public read for forum sources
DROP POLICY IF EXISTS "Public read forum sources" ON forum_sources;
CREATE POLICY "Public read forum sources"
    ON forum_sources FOR SELECT
    USING (true);

-- Service role writes for forum sources
DROP POLICY IF EXISTS "Service role manages forum sources" ON forum_sources;
CREATE POLICY "Service role manages forum sources"
    ON forum_sources FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Public read for build threads
DROP POLICY IF EXISTS "Public read build threads" ON build_threads;
CREATE POLICY "Public read build threads"
    ON build_threads FOR SELECT
    USING (true);

-- Service role writes for build threads
DROP POLICY IF EXISTS "Service role manages build threads" ON build_threads;
CREATE POLICY "Service role manages build threads"
    ON build_threads FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Public read for build posts
DROP POLICY IF EXISTS "Public read build posts" ON build_posts;
CREATE POLICY "Public read build posts"
    ON build_posts FOR SELECT
    USING (true);

-- Service role writes for build posts
DROP POLICY IF EXISTS "Service role manages build posts" ON build_posts;
CREATE POLICY "Service role manages build posts"
    ON build_posts FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Service role only for snapshots (contains raw HTML)
DROP POLICY IF EXISTS "Service role manages forum snapshots" ON forum_page_snapshots;
CREATE POLICY "Service role manages forum snapshots"
    ON forum_page_snapshots FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- -----------------------------------------------------------------------------
-- COMMENTS
-- -----------------------------------------------------------------------------

COMMENT ON VIEW forum_extraction_stats IS 'Summary statistics for forum extraction progress.';
COMMENT ON VIEW build_thread_summary IS 'Build threads with vehicle and forum info joined.';
COMMENT ON FUNCTION get_forums_to_inspect IS 'Get forums ready for DOM inspection.';
COMMENT ON FUNCTION get_threads_to_extract IS 'Get build threads ready for post extraction.';
COMMENT ON FUNCTION update_forum_health IS 'Update forum health after extraction attempt.';
