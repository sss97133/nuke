-- =============================================================================
-- ORG MENTION QUEUE & OBSERVATION INTEGRATION
-- =============================================================================
-- Extracts organization mentions from forum posts and queues for matching/creation
-- Integrates forum posts into the observation system
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ORG MENTION QUEUE
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_mention_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source reference
    source_post_id UUID REFERENCES build_posts(id) ON DELETE CASCADE,
    source_thread_id UUID REFERENCES build_threads(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id),
    forum_source_id UUID REFERENCES forum_sources(id),

    -- The mention
    mention_text TEXT NOT NULL,              -- "Summit Racing", "XYZ Customs"
    mention_context TEXT,                     -- Surrounding sentence/paragraph
    mention_type TEXT DEFAULT 'unknown'
        CHECK (mention_type IN (
            'parts_supplier',    -- Summit Racing, RockAuto, JEGS
            'shop',              -- General repair/build shop
            'paint',             -- Paint/body shop
            'machine_shop',      -- Engine machine work
            'upholstery',        -- Interior work
            'restoration',       -- Full restoration shop
            'performance',       -- Performance/tuning shop
            'dealer',            -- Car dealer
            'forum',             -- Forum/community (the source itself)
            'media',             -- Magazine, YouTube channel
            'event',             -- Car show, auction house
            'unknown'
        )),

    -- Matching
    matched_org_id UUID,                      -- Links to orgs table if matched
    match_confidence DECIMAL(3,2),            -- How confident is the match
    match_method TEXT,                        -- 'exact', 'fuzzy', 'manual', 'ai'

    -- Status
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'matched', 'created', 'ignored', 'review')),

    -- Extracted details
    extracted_url TEXT,                       -- If URL mentioned
    extracted_phone TEXT,                     -- If phone mentioned
    extracted_location TEXT,                  -- If location mentioned
    extracted_services TEXT[],                -- Services mentioned

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    reviewed_by UUID,
    notes TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_mentions_status ON org_mention_queue(status);
CREATE INDEX IF NOT EXISTS idx_org_mentions_type ON org_mention_queue(mention_type);
CREATE INDEX IF NOT EXISTS idx_org_mentions_text ON org_mention_queue(mention_text);
CREATE INDEX IF NOT EXISTS idx_org_mentions_pending ON org_mention_queue(id) WHERE status = 'pending';

COMMENT ON TABLE org_mention_queue IS 'Queue of organization mentions extracted from forum posts for matching/creation.';

-- -----------------------------------------------------------------------------
-- UPDATE BUILD_POSTS FOR OBSERVATION INTEGRATION
-- -----------------------------------------------------------------------------

-- Add observation_id if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'build_posts' AND column_name = 'observation_id'
    ) THEN
        ALTER TABLE build_posts ADD COLUMN observation_id UUID;
    END IF;
END $$;

-- Add org_mentions array to track which orgs were mentioned
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'build_posts' AND column_name = 'org_mentions'
    ) THEN
        ALTER TABLE build_posts ADD COLUMN org_mentions TEXT[];
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- REGISTER FORUMS AS OBSERVATION SOURCES
-- -----------------------------------------------------------------------------

-- Insert forum-builds as a generic forum source type
-- Note: supported_observations uses observation_kind enum - 'comment' is valid for forum posts
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
SELECT 'forum-builds', 'Forum Build Threads', 'forum', 0.7, ARRAY['comment']::observation_kind[]
WHERE NOT EXISTS (SELECT 1 FROM observation_sources WHERE slug = 'forum-builds');

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------

-- Function to get pending org mentions for processing
CREATE OR REPLACE FUNCTION get_pending_org_mentions(
    p_limit INT DEFAULT 100,
    p_type TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    mention_text TEXT,
    mention_type TEXT,
    mention_context TEXT,
    vehicle_id UUID,
    forum_slug TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        omq.id,
        omq.mention_text,
        omq.mention_type,
        omq.mention_context,
        omq.vehicle_id,
        fs.slug
    FROM org_mention_queue omq
    LEFT JOIN forum_sources fs ON fs.id = omq.forum_source_id
    WHERE omq.status = 'pending'
      AND (p_type IS NULL OR omq.mention_type = p_type)
    ORDER BY omq.created_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to mark mention as matched
CREATE OR REPLACE FUNCTION match_org_mention(
    p_mention_id UUID,
    p_org_id UUID,
    p_confidence DECIMAL DEFAULT 1.0,
    p_method TEXT DEFAULT 'manual'
) RETURNS VOID AS $$
BEGIN
    UPDATE org_mention_queue
    SET
        matched_org_id = p_org_id,
        match_confidence = p_confidence,
        match_method = p_method,
        status = 'matched',
        processed_at = NOW()
    WHERE id = p_mention_id;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- ORG MENTION STATS VIEW
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW org_mention_stats AS
SELECT
    mention_type,
    status,
    COUNT(*) as count,
    COUNT(DISTINCT mention_text) as unique_mentions,
    COUNT(DISTINCT matched_org_id) as matched_orgs
FROM org_mention_queue
GROUP BY mention_type, status
ORDER BY count DESC;

-- -----------------------------------------------------------------------------
-- RLS POLICIES
-- -----------------------------------------------------------------------------

ALTER TABLE org_mention_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages org mentions" ON org_mention_queue;
CREATE POLICY "Service role manages org mentions"
    ON org_mention_queue FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

DROP POLICY IF EXISTS "Public read org mentions" ON org_mention_queue;
CREATE POLICY "Public read org mentions"
    ON org_mention_queue FOR SELECT
    USING (true);
