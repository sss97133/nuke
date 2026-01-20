-- Migration: Programmatic Source-Extractor Assignment
-- Purpose: Every URL source gets assigned an extraction function
-- This enables tracking which function handles which source and detecting broken extractors

-- ==============================================================================
-- STEP 1: Add source_id to extractor_registry to link sources to extractors
-- ==============================================================================

ALTER TABLE extractor_registry
  ADD COLUMN IF NOT EXISTS scrape_source_id UUID REFERENCES scrape_sources(id),
  ADD COLUMN IF NOT EXISTS url_pattern TEXT,  -- Regex pattern this extractor handles
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;  -- Default extractor for generic URLs

CREATE INDEX IF NOT EXISTS idx_extractor_registry_scrape_source
  ON extractor_registry(scrape_source_id) WHERE scrape_source_id IS NOT NULL;

COMMENT ON COLUMN extractor_registry.scrape_source_id IS 'Links extractor to specific source from scrape_sources';
COMMENT ON COLUMN extractor_registry.url_pattern IS 'URL pattern this extractor handles (e.g., "bringatrailer.com")';
COMMENT ON COLUMN extractor_registry.is_default IS 'Default extractor when no specific one matches';

-- ==============================================================================
-- STEP 2: View to show sources without assigned extractors
-- ==============================================================================

CREATE OR REPLACE VIEW sources_without_extractors AS
SELECT
  ss.id,
  ss.name,
  ss.url,
  ss.source_type,
  ss.is_active,
  ss.last_successful_scrape,
  (SELECT COUNT(*) FROM import_queue iq WHERE iq.source_id = ss.id AND iq.status = 'failed') as failed_count,
  (SELECT COUNT(*) FROM import_queue iq WHERE iq.source_id = ss.id AND iq.status = 'complete') as success_count
FROM scrape_sources ss
LEFT JOIN extractor_registry er ON er.scrape_source_id = ss.id
WHERE er.id IS NULL
  AND ss.is_active = true
ORDER BY ss.last_successful_scrape DESC NULLS LAST;

COMMENT ON VIEW sources_without_extractors IS 'Active sources that need extractors assigned';

-- ==============================================================================
-- STEP 3: View to show extractor health per source
-- ==============================================================================

CREATE OR REPLACE VIEW source_extractor_health AS
SELECT
  ss.id as source_id,
  ss.name as source_name,
  ss.url as source_url,
  ss.source_type,
  ss.is_active,
  ss.last_successful_scrape,
  er.id as extractor_id,
  er.name as extractor_name,
  er.version as extractor_version,
  er.status as extractor_status,
  er.success_rate,
  er.total_attempts,
  er.failed_count,
  CASE
    WHEN er.id IS NULL THEN 'no_extractor'
    WHEN er.success_rate < 0.5 THEN 'broken'
    WHEN er.success_rate < 0.8 THEN 'degraded'
    ELSE 'healthy'
  END as health_status
FROM scrape_sources ss
LEFT JOIN extractor_registry er ON er.scrape_source_id = ss.id AND er.status != 'retired'
WHERE ss.is_active = true
ORDER BY
  CASE WHEN er.id IS NULL THEN 0 ELSE er.success_rate END ASC,
  ss.name;

COMMENT ON VIEW source_extractor_health IS 'Health status of all sources and their assigned extractors';

-- ==============================================================================
-- STEP 4: Function to auto-register extractors for all sources
-- ==============================================================================

CREATE OR REPLACE FUNCTION auto_register_extractors_for_sources()
RETURNS TABLE(
  source_id UUID,
  source_name TEXT,
  extractor_id UUID,
  extractor_name TEXT,
  action_taken TEXT
) AS $$
DECLARE
  rec RECORD;
  new_extractor_id UUID;
  extractor_name_str TEXT;
  url_domain TEXT;
BEGIN
  -- For each active source without an extractor
  FOR rec IN
    SELECT * FROM sources_without_extractors
  LOOP
    -- Extract domain from URL for extractor naming
    url_domain := regexp_replace(rec.url, '^https?://(?:www\.)?([^/]+).*', '\1');
    extractor_name_str := 'generic-' || regexp_replace(url_domain, '\.', '-', 'g');

    -- Create a new extractor entry for this source
    INSERT INTO extractor_registry (
      name,
      version,
      source_type,
      status,
      scrape_source_id,
      url_pattern,
      description
    ) VALUES (
      extractor_name_str,
      'v1',
      COALESCE(rec.source_type, 'generic'),
      'active',
      rec.id,
      url_domain,
      'Auto-registered extractor for ' || rec.name
    )
    ON CONFLICT (name, version) DO UPDATE SET
      scrape_source_id = EXCLUDED.scrape_source_id,
      url_pattern = EXCLUDED.url_pattern
    RETURNING id INTO new_extractor_id;

    -- Return the result
    source_id := rec.id;
    source_name := rec.name;
    extractor_id := new_extractor_id;
    extractor_name := extractor_name_str;
    action_taken := 'registered';
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_register_extractors_for_sources IS 'Auto-registers extractors for all sources without one';

-- ==============================================================================
-- STEP 5: Function to get the right extractor for a URL
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_extractor_for_url(p_url TEXT)
RETURNS TABLE(
  extractor_id UUID,
  extractor_name TEXT,
  extractor_version TEXT,
  source_type TEXT,
  success_rate NUMERIC
) AS $$
DECLARE
  url_domain TEXT;
BEGIN
  -- Extract domain from URL
  url_domain := regexp_replace(p_url, '^https?://(?:www\.)?([^/]+).*', '\1');

  -- First try exact domain match
  RETURN QUERY
  SELECT
    er.id,
    er.name,
    er.version,
    er.source_type,
    er.success_rate
  FROM extractor_registry er
  WHERE er.status IN ('active', 'preferred')
    AND (
      er.url_pattern = url_domain
      OR p_url LIKE '%' || er.url_pattern || '%'
    )
  ORDER BY
    CASE er.status WHEN 'preferred' THEN 0 ELSE 1 END,
    er.success_rate DESC
  LIMIT 1;

  -- If no match, return default extractor
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      er.id,
      er.name,
      er.version,
      er.source_type,
      er.success_rate
    FROM extractor_registry er
    WHERE er.is_default = true
      AND er.status IN ('active', 'preferred')
    ORDER BY er.success_rate DESC
    LIMIT 1;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_extractor_for_url IS 'Returns the best extractor for a given URL';

-- ==============================================================================
-- STEP 6: Trigger to record extraction performance
-- ==============================================================================

CREATE OR REPLACE FUNCTION update_extractor_performance()
RETURNS TRIGGER AS $$
BEGIN
  -- Update extractor_registry stats when extraction_attempts changes
  UPDATE extractor_registry
  SET
    total_attempts = total_attempts + 1,
    success_count = success_count + CASE WHEN NEW.status = 'success' THEN 1 ELSE 0 END,
    failed_count = failed_count + CASE WHEN NEW.status = 'failed' THEN 1 ELSE 0 END,
    partial_count = partial_count + CASE WHEN NEW.status = 'partial' THEN 1 ELSE 0 END
  WHERE id = NEW.extractor_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only create trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_extractor_performance'
  ) THEN
    CREATE TRIGGER trg_update_extractor_performance
      AFTER INSERT ON extraction_attempts
      FOR EACH ROW
      WHEN (NEW.extractor_id IS NOT NULL)
      EXECUTE FUNCTION update_extractor_performance();
  END IF;
END $$;

-- ==============================================================================
-- STEP 7: Create default generic extractor
-- ==============================================================================

INSERT INTO extractor_registry (name, version, source_type, status, is_default, description)
VALUES ('generic-firecrawl', 'v1', 'generic', 'active', true, 'Default extractor using Firecrawl for any URL')
ON CONFLICT (name, version) DO UPDATE SET is_default = true;

-- ==============================================================================
-- STEP 8: Enable RLS
-- ==============================================================================

ALTER VIEW sources_without_extractors OWNER TO postgres;
ALTER VIEW source_extractor_health OWNER TO postgres;

-- Grant access
GRANT SELECT ON sources_without_extractors TO authenticated, service_role;
GRANT SELECT ON source_extractor_health TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auto_register_extractors_for_sources TO service_role;
GRANT EXECUTE ON FUNCTION get_extractor_for_url TO authenticated, service_role;
