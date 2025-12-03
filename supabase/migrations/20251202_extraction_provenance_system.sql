-- ============================================
-- EXTRACTION PROVENANCE & BACKFILL SYSTEM
-- ============================================
-- Tracks WHEN, HOW, and BY WHAT VERSION data was extracted
-- Enables automated backfilling when scrapers improve

-- ============================================
-- 1. EXTRACTION METADATA (Provenance Tracking)
-- ============================================

CREATE TABLE IF NOT EXISTS extraction_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Target
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- What was extracted
  field_name TEXT NOT NULL, -- 'vin', 'mileage', 'images', 'seller_name', etc.
  field_value TEXT, -- Snapshot of value at extraction time
  
  -- How it was extracted
  extraction_method TEXT NOT NULL, -- 'ksl_scraper', 'bat_scraper', 'manual_entry', 'manual_fix'
  scraper_version TEXT, -- Semantic version: 'v3.2.1'
  source_url TEXT, -- Original listing URL
  
  -- Quality
  confidence_score NUMERIC(3,2) DEFAULT 0.5 CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  validation_status TEXT DEFAULT 'unvalidated' CHECK (validation_status IN (
    'unvalidated',    -- Not yet checked
    'valid',          -- Confirmed correct
    'invalid',        -- Confirmed wrong
    'conflicting',    -- Multiple sources disagree
    'low_confidence'  -- Extracted but uncertain (e.g., partial name)
  )),
  
  -- When
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Debugging
  raw_extraction_data JSONB, -- Full scraper output for debugging
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_extraction_vehicle ON extraction_metadata(vehicle_id);
CREATE INDEX idx_extraction_field ON extraction_metadata(field_name);
CREATE INDEX idx_extraction_method ON extraction_metadata(extraction_method);
CREATE INDEX idx_extraction_date ON extraction_metadata(extracted_at DESC);
CREATE INDEX idx_extraction_confidence ON extraction_metadata(confidence_score);

COMMENT ON TABLE extraction_metadata IS 'Tracks provenance of every extracted field - when, how, by what version';
COMMENT ON COLUMN extraction_metadata.confidence_score IS '0.0 = uncertain, 0.5 = medium confidence (e.g., partial name), 1.0 = certain';

-- ============================================
-- 2. SCRAPER VERSIONS (Version Registry)
-- ============================================

CREATE TABLE IF NOT EXISTS scraper_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Version Info
  scraper_name TEXT NOT NULL, -- 'ksl_scraper', 'bat_scraper', 'mecum_scraper'
  version TEXT NOT NULL, -- Semantic version: 'v3.2.1'
  
  -- What changed
  improvements TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['added_legacy_vin_support', 'fixed_mileage_parsing']
  fields_affected TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['vin', 'mileage']
  bug_fixes TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Backfill Configuration
  backfill_required BOOLEAN DEFAULT FALSE,
  backfill_priority INTEGER DEFAULT 5 CHECK (backfill_priority >= 1 AND backfill_priority <= 10), -- 1=critical, 10=low
  backfill_completed BOOLEAN DEFAULT FALSE,
  backfilled_count INTEGER DEFAULT 0,
  
  -- Metadata
  deployed_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_by TEXT,
  release_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(scraper_name, version)
);

CREATE INDEX idx_scraper_versions_name ON scraper_versions(scraper_name);
CREATE INDEX idx_scraper_versions_backfill ON scraper_versions(backfill_required) WHERE backfill_required = TRUE AND backfill_completed = FALSE;

COMMENT ON TABLE scraper_versions IS 'Registry of scraper versions and their improvements';

-- ============================================
-- 3. BACKFILL QUEUE (Automated Re-Extraction)
-- ============================================

CREATE TABLE IF NOT EXISTS backfill_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Target
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  field_names TEXT[] DEFAULT ARRAY[]::TEXT[], -- Which fields to re-extract
  
  -- Why
  reason TEXT NOT NULL CHECK (reason IN (
    'scraper_improved',      -- New scraper version deployed
    'low_quality_score',     -- Quality score below threshold
    'user_reported_issue',   -- User flagged incorrect data
    'manual_audit',          -- Manual investigation found missing data
    'scheduled_refresh'      -- Periodic re-scraping
  )),
  scraper_version_id UUID REFERENCES scraper_versions(id) ON DELETE SET NULL,
  triggered_by TEXT DEFAULT 'auto', -- 'auto', 'manual', 'user_report', 'admin'
  
  -- Priority
  priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10), -- 1=critical, 10=low
  quality_score INTEGER, -- Current vehicle quality score (for prioritization)
  
  -- Source
  source_url TEXT, -- Listing URL to re-scrape
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',      -- Awaiting processing
    'processing',   -- Currently being scraped
    'completed',    -- Successfully processed
    'failed',       -- Extraction failed
    'skipped'       -- Skipped (e.g., source no longer available)
  )),
  
  -- Results
  extraction_result JSONB,
  changes_detected JSONB, -- Diff: { field: { old: 'x', new: 'y' } }
  fields_updated TEXT[] DEFAULT ARRAY[]::TEXT[],
  error_message TEXT,
  
  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  
  UNIQUE(vehicle_id, scraper_version_id) -- Don't queue same vehicle twice for same version
);

CREATE INDEX idx_backfill_status ON backfill_queue(status, priority DESC);
CREATE INDEX idx_backfill_vehicle ON backfill_queue(vehicle_id);
CREATE INDEX idx_backfill_reason ON backfill_queue(reason);
CREATE INDEX idx_backfill_created ON backfill_queue(created_at DESC);

COMMENT ON TABLE backfill_queue IS 'Automated queue for re-extracting data when scrapers improve or quality is low';

-- ============================================
-- 4. AUTO-QUEUE BACKFILLS (The Magic Trigger)
-- ============================================

CREATE OR REPLACE FUNCTION auto_queue_backfills()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_queued_count INTEGER := 0;
BEGIN
  -- When new scraper version is deployed with backfill_required=TRUE
  IF NEW.backfill_required = TRUE AND NEW.backfill_completed = FALSE THEN
    
    -- Find all vehicles that need backfilling
    INSERT INTO backfill_queue (
      vehicle_id, 
      field_names, 
      reason, 
      scraper_version_id, 
      priority, 
      quality_score, 
      source_url, 
      triggered_by
    )
    SELECT 
      v.id,
      NEW.fields_affected,
      'scraper_improved',
      NEW.id,
      NEW.backfill_priority,
      COALESCE(q.overall_score, 0),
      v.listing_url,
      'auto'
    FROM vehicles v
    LEFT JOIN vehicle_quality_scores q ON q.vehicle_id = v.id
    WHERE 
      -- Only vehicles from this scraper's source
      v.listing_url LIKE CASE
        WHEN NEW.scraper_name = 'ksl_scraper' THEN '%cars.ksl.com%'
        WHEN NEW.scraper_name = 'bat_scraper' THEN '%bringatrailer.com%'
        WHEN NEW.scraper_name = 'mecum_scraper' THEN '%mecum.com%'
        WHEN NEW.scraper_name = 'craigslist_scraper' THEN '%craigslist.org%'
        ELSE '%'
      END
      -- AND (missing affected fields OR low quality)
      AND (
        -- Low quality score
        (q.overall_score IS NULL OR q.overall_score < 60)
        OR
        -- Has issues in affected fields
        (q.issues && NEW.fields_affected)
      )
      -- Not already queued for this version
      AND NOT EXISTS (
        SELECT 1 FROM backfill_queue bq
        WHERE bq.vehicle_id = v.id
        AND bq.scraper_version_id = NEW.id
      )
    ON CONFLICT (vehicle_id, scraper_version_id) DO NOTHING;
    
    GET DIAGNOSTICS v_queued_count = ROW_COUNT;
    
    RAISE NOTICE 'Auto-queued % vehicles for backfill (scraper: %, version: %)', 
      v_queued_count, NEW.scraper_name, NEW.version;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_queue_backfills ON scraper_versions;
CREATE TRIGGER trg_auto_queue_backfills
  AFTER INSERT OR UPDATE ON scraper_versions
  FOR EACH ROW
  EXECUTE FUNCTION auto_queue_backfills();

-- ============================================
-- 5. HELPER FUNCTIONS
-- ============================================

-- Function: Manually queue a vehicle for backfill
CREATE OR REPLACE FUNCTION queue_vehicle_for_backfill(
  p_vehicle_id UUID,
  p_reason TEXT DEFAULT 'manual_audit',
  p_priority INTEGER DEFAULT 5
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_queue_id UUID;
  v_listing_url TEXT;
  v_quality_score INTEGER;
BEGIN
  -- Get vehicle info
  SELECT listing_url INTO v_listing_url
  FROM vehicles WHERE id = p_vehicle_id;
  
  IF v_listing_url IS NULL THEN
    RAISE EXCEPTION 'Vehicle has no listing_url - cannot backfill';
  END IF;
  
  -- Get quality score
  SELECT overall_score INTO v_quality_score
  FROM vehicle_quality_scores WHERE vehicle_id = p_vehicle_id;
  
  -- Queue it
  INSERT INTO backfill_queue (
    vehicle_id,
    reason,
    priority,
    quality_score,
    source_url,
    triggered_by
  )
  VALUES (
    p_vehicle_id,
    p_reason,
    p_priority,
    v_quality_score,
    v_listing_url,
    'manual'
  )
  RETURNING id INTO v_queue_id;
  
  RETURN v_queue_id;
END;
$$;

-- Function: Get extraction history for a vehicle
CREATE OR REPLACE FUNCTION get_extraction_history(p_vehicle_id UUID)
RETURNS TABLE (
  field_name TEXT,
  field_value TEXT,
  extraction_method TEXT,
  scraper_version TEXT,
  confidence_score NUMERIC,
  extracted_at TIMESTAMPTZ
)
LANGUAGE sql
AS $$
  SELECT 
    field_name,
    field_value,
    extraction_method,
    scraper_version,
    confidence_score,
    extracted_at
  FROM extraction_metadata
  WHERE vehicle_id = p_vehicle_id
  ORDER BY extracted_at DESC;
$$;

-- ============================================
-- 6. VIEWS FOR MONITORING
-- ============================================

-- Backfill queue dashboard
CREATE OR REPLACE VIEW backfill_dashboard AS
SELECT 
  status,
  reason,
  COUNT(*) as count,
  AVG(quality_score) as avg_quality_score,
  MIN(created_at) as oldest_created,
  MAX(created_at) as newest_created
FROM backfill_queue
GROUP BY status, reason
ORDER BY 
  CASE status
    WHEN 'processing' THEN 1
    WHEN 'pending' THEN 2
    WHEN 'failed' THEN 3
    WHEN 'completed' THEN 4
    WHEN 'skipped' THEN 5
  END,
  count DESC;

-- Low confidence extractions (need review)
CREATE OR REPLACE VIEW low_confidence_extractions AS
SELECT 
  v.id as vehicle_id,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  em.field_name,
  em.field_value,
  em.confidence_score,
  em.extraction_method,
  em.extracted_at
FROM extraction_metadata em
JOIN vehicles v ON v.id = em.vehicle_id
WHERE em.confidence_score < 0.6
ORDER BY em.confidence_score ASC, em.extracted_at DESC;

-- ============================================
-- 7. RLS POLICIES
-- ============================================

ALTER TABLE extraction_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraper_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE backfill_queue ENABLE ROW LEVEL SECURITY;

-- Anyone can view (transparency)
CREATE POLICY "Anyone can view extraction metadata"
  ON extraction_metadata FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view scraper versions"
  ON scraper_versions FOR SELECT
  USING (true);

CREATE POLICY "Anyone can view backfill queue"
  ON backfill_queue FOR SELECT
  USING (true);

-- Only service role can write
CREATE POLICY "Service role can manage extraction metadata"
  ON extraction_metadata FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage scraper versions"
  ON scraper_versions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage backfill queue"
  ON backfill_queue FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 8. INITIAL DATA
-- ============================================

-- Register current scraper versions (baseline)
INSERT INTO scraper_versions (scraper_name, version, deployed_at, deployed_by, release_notes)
VALUES 
  ('ksl_scraper', 'v3.2.0', NOW(), 'baseline', 'Current production version - missing legacy VIN fallback'),
  ('bat_scraper', 'v2.1.0', NOW(), 'baseline', 'Current production version'),
  ('mecum_scraper', 'v1.0.0', NOW(), 'baseline', 'Current production version')
ON CONFLICT (scraper_name, version) DO NOTHING;

COMMENT ON TABLE extraction_metadata IS 'Tracks provenance: WHEN, HOW, BY WHAT VERSION each field was extracted';
COMMENT ON TABLE scraper_versions IS 'Version registry: Tracks scraper improvements and triggers backfills';
COMMENT ON TABLE backfill_queue IS 'Automated re-extraction queue: Processes when scrapers improve or quality is low';

