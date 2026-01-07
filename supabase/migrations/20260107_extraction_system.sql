-- Migration: Extraction Attempts & Extractor Registry System
-- Purpose: Enable versioned, auditable, self-healing data extraction
-- See: docs/architecture/DATA_INGESTION_AND_REPAIR_SYSTEM.md

-- ==============================================================================
-- EXTRACTOR REGISTRY
-- ==============================================================================
-- Tracks all extractor versions, their performance, and lifecycle status

CREATE TABLE IF NOT EXISTS extractor_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    name TEXT NOT NULL,                 -- e.g., 'bat-listing', 'craigslist-search'
    version TEXT NOT NULL,              -- e.g., 'v6', 'v6.1', 'v7-beta'
    source_type TEXT NOT NULL,          -- e.g., 'bat', 'craigslist', 'ebay'
    
    -- Status lifecycle
    status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'preferred', 'deprecated', 'retired'
    
    -- Performance tracking (updated by triggers or periodic jobs)
    total_attempts INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    partial_count INTEGER DEFAULT 0,
    
    -- Computed success rate (stored generated column for performance)
    success_rate NUMERIC(5,4) GENERATED ALWAYS AS (
        CASE WHEN total_attempts > 0 
        THEN ROUND(success_count::numeric / total_attempts::numeric, 4)
        ELSE 0 END
    ) STORED,
    
    -- Lifecycle timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    promoted_at TIMESTAMPTZ,            -- When it became 'preferred'
    deprecated_at TIMESTAMPTZ,          -- When marked 'deprecated'
    retired_at TIMESTAMPTZ,             -- When marked 'retired'
    
    -- Metadata
    description TEXT,
    notes TEXT,                         -- Why promoted/deprecated/retired
    config JSONB DEFAULT '{}',          -- Extractor-specific config
    
    -- Constraints
    CONSTRAINT extractor_registry_unique_name_version UNIQUE(name, version),
    CONSTRAINT extractor_registry_valid_status CHECK (status IN ('active', 'preferred', 'deprecated', 'retired'))
);

-- Index for finding preferred extractors by source
CREATE INDEX idx_extractor_registry_source_status ON extractor_registry(source_type, status);

-- Index for performance queries
CREATE INDEX idx_extractor_registry_success_rate ON extractor_registry(success_rate DESC) WHERE status != 'retired';

COMMENT ON TABLE extractor_registry IS 'Versioned extractor catalog with performance tracking';
COMMENT ON COLUMN extractor_registry.status IS 'active=usable, preferred=recommended, deprecated=avoid, retired=never use';
COMMENT ON COLUMN extractor_registry.success_rate IS 'Auto-computed from success_count/total_attempts';

-- ==============================================================================
-- EXTRACTION ATTEMPTS
-- ==============================================================================
-- Audit log of every extraction attempt with evidence and metrics

CREATE TABLE IF NOT EXISTS extraction_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- What we're extracting
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,          -- Must match extractor_registry.source_type
    
    -- Which extractor ran
    extractor_name TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    extractor_id UUID REFERENCES extractor_registry(id), -- Link to registry
    
    -- What happened
    status TEXT NOT NULL,               -- 'success', 'partial', 'failed'
    failure_code TEXT,                  -- 'BLOCKED', 'SELECTOR_DRIFT', etc. (see docs)
    failure_reason TEXT,                -- Human-readable explanation
    failure_details JSONB,              -- Structured failure context
    
    -- What we extracted
    metrics JSONB NOT NULL DEFAULT '{}',  -- Counts, timings, source stats
    extracted_data JSONB,                 -- The actual values extracted (pre-validation)
    validation_passed BOOLEAN,            -- Did it pass acceptance criteria?
    validation_errors JSONB,              -- What failed validation (if any)
    
    -- Evidence (critical for disputes and debugging)
    snapshot_ref TEXT,                  -- Storage path to HTML snapshot
    screenshot_ref TEXT,                -- Storage path to visual screenshot (optional)
    snapshot_hash TEXT,                 -- SHA256 of snapshot for integrity
    
    -- Timing
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER GENERATED ALWAYS AS (
        EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000
    ) STORED,
    
    -- Lineage (for repairs)
    previous_attempt_id UUID REFERENCES extraction_attempts(id),  -- If this is a retry/repair
    repaired_by_attempt_id UUID,        -- If this failed attempt was later fixed
    
    -- Metadata
    triggered_by TEXT DEFAULT 'manual', -- 'manual', 'cron', 'repair_loop', 'user_request'
    user_id UUID REFERENCES auth.users(id),  -- If user-triggered
    notes TEXT,
    
    -- Constraints
    CONSTRAINT extraction_attempts_valid_status CHECK (status IN ('success', 'partial', 'failed')),
    CONSTRAINT extraction_attempts_failure_requires_code CHECK (
        (status = 'failed' AND failure_code IS NOT NULL) OR status != 'failed'
    )
);

-- Index for finding attempts by vehicle
CREATE INDEX idx_extraction_attempts_vehicle ON extraction_attempts(vehicle_id, completed_at DESC);

-- Index for finding recent failures
CREATE INDEX idx_extraction_attempts_failures ON extraction_attempts(status, completed_at DESC) 
    WHERE status = 'failed';

-- Index for finding attempts by extractor
CREATE INDEX idx_extraction_attempts_extractor ON extraction_attempts(extractor_name, extractor_version, completed_at DESC);

-- Index for repair queue (failed attempts without repair)
CREATE INDEX idx_extraction_attempts_needs_repair ON extraction_attempts(status, completed_at DESC)
    WHERE status = 'failed' AND repaired_by_attempt_id IS NULL;

-- Composite index for source monitoring
CREATE INDEX idx_extraction_attempts_source_status ON extraction_attempts(source_type, status, completed_at DESC);

COMMENT ON TABLE extraction_attempts IS 'Complete audit log of all extraction attempts with evidence';
COMMENT ON COLUMN extraction_attempts.snapshot_ref IS 'Path to saved HTML - critical for proving correctness';
COMMENT ON COLUMN extraction_attempts.validation_passed IS 'Did extracted data meet acceptance criteria?';
COMMENT ON COLUMN extraction_attempts.previous_attempt_id IS 'Links repairs to original failed attempts';

-- ==============================================================================
-- TRIGGER: Update extractor_registry stats
-- ==============================================================================
-- Automatically update performance counters when attempts complete

CREATE OR REPLACE FUNCTION update_extractor_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if status is set and extractor_id exists
    IF NEW.status IS NOT NULL AND NEW.extractor_id IS NOT NULL THEN
        UPDATE extractor_registry
        SET 
            total_attempts = total_attempts + 1,
            success_count = success_count + CASE WHEN NEW.status = 'success' THEN 1 ELSE 0 END,
            failed_count = failed_count + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
            partial_count = partial_count + CASE WHEN NEW.status = 'partial' THEN 1 ELSE 0 END
        WHERE id = NEW.extractor_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_extractor_stats
    AFTER INSERT OR UPDATE OF status ON extraction_attempts
    FOR EACH ROW
    EXECUTE FUNCTION update_extractor_stats();

COMMENT ON FUNCTION update_extractor_stats() IS 'Maintains extractor_registry performance counters';

-- ==============================================================================
-- VIEWS
-- ==============================================================================

-- View: Vehicles needing extraction (no recent successful attempt)
CREATE OR REPLACE VIEW vehicles_needing_extraction AS
SELECT 
    v.id,
    v.title,
    v.discovery_url as source_url,
    v.profile_origin as source_type,
    v.created_at,
    v.updated_at,
    COUNT(ea.id) FILTER (WHERE ea.status = 'failed') as failed_attempts,
    MAX(ea.completed_at) FILTER (WHERE ea.status = 'failed') as last_failed_at
FROM vehicles v
LEFT JOIN extraction_attempts ea ON ea.vehicle_id = v.id
WHERE v.discovery_url IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM extraction_attempts ea2
      WHERE ea2.vehicle_id = v.id
        AND ea2.status = 'success'
        AND ea2.validation_passed = true
        AND ea2.completed_at > now() - INTERVAL '30 days'
  )
GROUP BY v.id, v.title, v.discovery_url, v.profile_origin, v.created_at, v.updated_at;

COMMENT ON VIEW vehicles_needing_extraction IS 'Vehicles without recent successful validated extraction';

-- View: Recent failures by type
CREATE OR REPLACE VIEW extraction_failures_summary AS
SELECT 
    failure_code,
    source_type,
    extractor_name,
    extractor_version,
    COUNT(*) as failure_count,
    COUNT(DISTINCT vehicle_id) as vehicles_affected,
    MAX(completed_at) as last_failure,
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM extraction_attempts
WHERE status = 'failed'
  AND completed_at > now() - INTERVAL '24 hours'
GROUP BY failure_code, source_type, extractor_name, extractor_version
ORDER BY failure_count DESC;

COMMENT ON VIEW extraction_failures_summary IS 'Last 24h failures grouped by type for pattern detection';

-- View: Extractor performance dashboard
CREATE OR REPLACE VIEW extractor_performance AS
SELECT 
    er.name,
    er.version,
    er.source_type,
    er.status,
    er.total_attempts,
    er.success_count,
    er.failed_count,
    er.partial_count,
    er.success_rate,
    CASE 
        WHEN er.success_rate >= 0.95 THEN 'healthy'
        WHEN er.success_rate >= 0.80 THEN 'degraded'
        WHEN er.success_rate >= 0.50 THEN 'poor'
        ELSE 'failing'
    END as health_status,
    er.promoted_at,
    er.retired_at,
    COUNT(ea.id) FILTER (WHERE ea.completed_at > now() - INTERVAL '24 hours') as attempts_last_24h,
    COUNT(ea.id) FILTER (WHERE ea.status = 'success' AND ea.completed_at > now() - INTERVAL '24 hours') as success_last_24h
FROM extractor_registry er
LEFT JOIN extraction_attempts ea ON ea.extractor_id = er.id
WHERE er.status != 'retired'
GROUP BY er.id, er.name, er.version, er.source_type, er.status, 
         er.total_attempts, er.success_count, er.failed_count, er.partial_count,
         er.success_rate, er.promoted_at, er.retired_at
ORDER BY er.success_rate DESC, er.total_attempts DESC;

COMMENT ON VIEW extractor_performance IS 'Real-time extractor health monitoring';

-- View: Repair queue (failed attempts needing retry)
CREATE OR REPLACE VIEW extraction_repair_queue AS
SELECT 
    ea.id,
    ea.vehicle_id,
    ea.source_url,
    ea.source_type,
    ea.failure_code,
    ea.failure_reason,
    ea.extractor_name,
    ea.extractor_version,
    ea.completed_at as failed_at,
    EXTRACT(EPOCH FROM (now() - ea.completed_at))/3600 as hours_since_failure,
    COUNT(ea2.id) as retry_count
FROM extraction_attempts ea
LEFT JOIN extraction_attempts ea2 ON ea2.previous_attempt_id = ea.id
WHERE ea.status = 'failed'
  AND ea.repaired_by_attempt_id IS NULL
  AND ea.completed_at > now() - INTERVAL '7 days'  -- Don't retry ancient failures
GROUP BY ea.id, ea.vehicle_id, ea.source_url, ea.source_type, 
         ea.failure_code, ea.failure_reason, ea.extractor_name, 
         ea.extractor_version, ea.completed_at
ORDER BY ea.completed_at DESC;

COMMENT ON VIEW extraction_repair_queue IS 'Failed attempts ready for repair attempts';

-- ==============================================================================
-- HELPER FUNCTIONS
-- ==============================================================================

-- Function: Get preferred extractor for a source type
CREATE OR REPLACE FUNCTION get_preferred_extractor(p_source_type TEXT)
RETURNS TABLE(
    name TEXT,
    version TEXT,
    extractor_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT er.name, er.version, er.id
    FROM extractor_registry er
    WHERE er.source_type = p_source_type
      AND er.status = 'preferred'
    ORDER BY er.promoted_at DESC
    LIMIT 1;
    
    -- Fallback to most recent active if no preferred
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT er.name, er.version, er.id
        FROM extractor_registry er
        WHERE er.source_type = p_source_type
          AND er.status = 'active'
        ORDER BY er.created_at DESC
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_preferred_extractor IS 'Returns best extractor to use for a given source type';

-- Function: Record extraction attempt (helper for code to call)
CREATE OR REPLACE FUNCTION record_extraction_attempt(
    p_vehicle_id UUID,
    p_source_url TEXT,
    p_source_type TEXT,
    p_extractor_name TEXT,
    p_extractor_version TEXT,
    p_status TEXT,
    p_metrics JSONB DEFAULT '{}',
    p_extracted_data JSONB DEFAULT NULL,
    p_snapshot_ref TEXT DEFAULT NULL,
    p_failure_code TEXT DEFAULT NULL,
    p_failure_reason TEXT DEFAULT NULL,
    p_previous_attempt_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_extractor_id UUID;
    v_attempt_id UUID;
BEGIN
    -- Look up extractor_id
    SELECT id INTO v_extractor_id
    FROM extractor_registry
    WHERE name = p_extractor_name AND version = p_extractor_version;
    
    -- Insert attempt
    INSERT INTO extraction_attempts (
        vehicle_id, source_url, source_type,
        extractor_name, extractor_version, extractor_id,
        status, failure_code, failure_reason,
        metrics, extracted_data, snapshot_ref,
        previous_attempt_id, completed_at
    ) VALUES (
        p_vehicle_id, p_source_url, p_source_type,
        p_extractor_name, p_extractor_version, v_extractor_id,
        p_status, p_failure_code, p_failure_reason,
        p_metrics, p_extracted_data, p_snapshot_ref,
        p_previous_attempt_id, now()
    ) RETURNING id INTO v_attempt_id;
    
    RETURN v_attempt_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_extraction_attempt IS 'Simplified API for creating extraction attempt records';

-- ==============================================================================
-- RLS POLICIES (if needed - adjust based on your auth setup)
-- ==============================================================================

-- For now, allow service role full access
-- Adjust these based on your actual RLS requirements

ALTER TABLE extractor_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_attempts ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access to extractor_registry"
    ON extractor_registry
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access to extraction_attempts"
    ON extraction_attempts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated users can read (for debugging/monitoring dashboards)
CREATE POLICY "Authenticated read extractor_registry"
    ON extractor_registry
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated read extraction_attempts"
    ON extraction_attempts
    FOR SELECT
    TO authenticated
    USING (true);

-- ==============================================================================
-- SAMPLE DATA (optional - for testing)
-- ==============================================================================

-- Register a sample extractor
INSERT INTO extractor_registry (name, version, source_type, status, description)
VALUES 
    ('bat-listing', 'v6', 'bat', 'preferred', 'BaT listing extractor with gallery support'),
    ('bat-listing', 'v5', 'bat', 'deprecated', 'Old version with selector drift issues')
ON CONFLICT (name, version) DO NOTHING;

COMMENT ON TABLE extractor_registry IS 'Sample extractors inserted for testing';

-- ==============================================================================
-- MIGRATION COMPLETE
-- ==============================================================================

-- Verify tables exist
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM information_schema.tables 
            WHERE table_name IN ('extractor_registry', 'extraction_attempts')) = 2,
           'Migration failed: tables not created';
    
    RAISE NOTICE 'Migration complete: extraction system ready';
    RAISE NOTICE 'Tables: extractor_registry, extraction_attempts';
    RAISE NOTICE 'Views: vehicles_needing_extraction, extraction_failures_summary, extractor_performance, extraction_repair_queue';
    RAISE NOTICE 'See: docs/architecture/DATA_INGESTION_AND_REPAIR_SYSTEM.md';
END $$;

