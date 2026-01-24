-- ============================================
-- EXTRACTION HEALTH MONITORING & SELF-HEALING SYSTEM
-- ============================================
-- Tracks extraction success/failure at the FIELD level, not just request level
-- Enables drift detection, pattern-based healing, and 100% extraction accuracy

-- ============================================
-- 1. FIELD EXTRACTION LOG
-- ============================================
-- Tracks every field extraction attempt (not just request success)

CREATE TABLE IF NOT EXISTS field_extraction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  extraction_run_id UUID NOT NULL, -- Groups all fields from same extraction
  source TEXT NOT NULL, -- 'bat', 'ksl', 'craigslist', 'classic_com', etc.
  source_url TEXT,
  extractor_name TEXT NOT NULL, -- 'bat-scraper', 'extract-vehicle-data-ai', etc.
  extractor_version TEXT,

  -- Field-level tracking
  field_name TEXT NOT NULL, -- 'vin', 'price', 'mileage', 'images', 'seller_name', etc.
  extraction_status TEXT NOT NULL CHECK (extraction_status IN (
    'extracted',       -- Field found and extracted
    'not_found',       -- Field not present in source
    'parse_error',     -- Field present but couldn't parse
    'validation_fail', -- Extracted but failed validation (e.g., invalid VIN)
    'low_confidence'   -- Extracted but confidence below threshold
  )),

  -- Value tracking
  extracted_value TEXT,  -- The actual extracted value (for drift analysis)
  expected_value TEXT,   -- If known (for accuracy checking)
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),

  -- Error details
  error_code TEXT,      -- Structured error code: 'REGEX_NO_MATCH', 'INVALID_FORMAT', etc.
  error_details JSONB,  -- Full error context for debugging

  -- Timing
  extraction_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_extraction_vehicle ON field_extraction_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_field_extraction_run ON field_extraction_log(extraction_run_id);
CREATE INDEX IF NOT EXISTS idx_field_extraction_source ON field_extraction_log(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_extraction_field ON field_extraction_log(field_name, extraction_status);
CREATE INDEX IF NOT EXISTS idx_field_extraction_status ON field_extraction_log(extraction_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_extraction_extractor ON field_extraction_log(extractor_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_extraction_errors ON field_extraction_log(error_code) WHERE error_code IS NOT NULL;

-- ============================================
-- 2. EXTRACTION HEALTH METRICS (Aggregated)
-- ============================================
-- Pre-computed metrics updated by cron for fast dashboard queries

CREATE TABLE IF NOT EXISTS extraction_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dimensions
  source TEXT NOT NULL,
  extractor_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  time_bucket TIMESTAMPTZ NOT NULL, -- Hourly bucket for trending

  -- Counts
  total_attempts INTEGER DEFAULT 0,
  successful_extractions INTEGER DEFAULT 0,
  not_found_count INTEGER DEFAULT 0,
  parse_errors INTEGER DEFAULT 0,
  validation_failures INTEGER DEFAULT 0,
  low_confidence_count INTEGER DEFAULT 0,

  -- Rates (pre-computed)
  success_rate NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE WHEN total_attempts > 0
    THEN (successful_extractions::NUMERIC / total_attempts * 100)
    ELSE 0 END
  ) STORED,

  -- Quality
  avg_confidence NUMERIC(3,2),
  min_confidence NUMERIC(3,2),
  max_confidence NUMERIC(3,2),

  -- Performance
  avg_extraction_time_ms INTEGER,
  p95_extraction_time_ms INTEGER,

  -- Computed at aggregation time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source, extractor_name, field_name, time_bucket)
);

CREATE INDEX IF NOT EXISTS idx_health_metrics_source ON extraction_health_metrics(source, time_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_health_metrics_field ON extraction_health_metrics(field_name, time_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_health_metrics_rate ON extraction_health_metrics(success_rate) WHERE success_rate < 90;

-- ============================================
-- 3. EXTRACTION DRIFT ALERTS
-- ============================================
-- Tracks when extraction quality changes significantly

CREATE TABLE IF NOT EXISTS extraction_drift_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What's drifting
  source TEXT NOT NULL,
  extractor_name TEXT NOT NULL,
  field_name TEXT NOT NULL,

  -- Alert details
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'success_rate_drop',     -- Success rate dropped below threshold
    'confidence_drop',       -- Average confidence dropped
    'new_error_pattern',     -- New error code appearing frequently
    'field_missing_spike',   -- Sudden increase in "not_found"
    'extraction_timeout',    -- Extraction time exceeding threshold
    'cross_validation_fail'  -- Different sources returning conflicting data
  )),

  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

  -- Metrics at alert time
  current_value NUMERIC,     -- Current metric value
  baseline_value NUMERIC,    -- What it was before drift
  threshold_value NUMERIC,   -- The threshold that triggered alert

  -- Context
  sample_vehicle_ids UUID[], -- Example vehicles affected
  error_pattern JSONB,       -- Common error if error-based alert

  -- Resolution
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'investigating', 'resolved', 'false_positive')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  healing_action_id UUID,    -- Link to healing action if auto-healed

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drift_alerts_status ON extraction_drift_alerts(status, severity DESC);
CREATE INDEX IF NOT EXISTS idx_drift_alerts_source ON extraction_drift_alerts(source, extractor_name);
CREATE INDEX IF NOT EXISTS idx_drift_alerts_created ON extraction_drift_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drift_alerts_open ON extraction_drift_alerts(status) WHERE status = 'open';

-- ============================================
-- 4. HEALING ACTIONS
-- ============================================
-- Tracks automated and manual healing attempts

CREATE TABLE IF NOT EXISTS extraction_healing_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What triggered healing
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'drift_alert',       -- Triggered by drift detection
    'error_pattern',     -- Triggered by repeated error pattern
    'manual',            -- Admin-initiated
    'scheduled',         -- Regular maintenance
    'user_report'        -- User flagged incorrect data
  )),
  drift_alert_id UUID REFERENCES extraction_drift_alerts(id),

  -- Scope
  source TEXT,
  extractor_name TEXT,
  field_name TEXT,
  vehicle_ids UUID[],        -- Specific vehicles if targeted

  -- Action taken
  action_type TEXT NOT NULL CHECK (action_type IN (
    'retry_extraction',      -- Re-run extractor
    'fallback_extractor',    -- Switch to backup extractor
    'adjust_confidence',     -- Lower confidence on affected data
    'flag_for_review',       -- Mark data as needing human review
    'invalidate_data',       -- Mark extracted data as invalid
    'queue_for_backfill',    -- Add to backfill queue
    'disable_extractor',     -- Temporarily disable failing extractor
    'notify_admin',          -- Just send notification
    'cross_validate'         -- Validate against other sources
  )),

  -- Execution
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'executing', 'completed', 'failed', 'cancelled'
  )),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  vehicles_affected INTEGER DEFAULT 0,
  fields_corrected INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  execution_log JSONB,       -- Detailed execution results

  -- Metadata
  created_by TEXT DEFAULT 'system', -- 'system' or user_id
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_healing_actions_status ON extraction_healing_actions(status);
CREATE INDEX IF NOT EXISTS idx_healing_actions_pending ON extraction_healing_actions(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_healing_actions_source ON extraction_healing_actions(source, extractor_name);
CREATE INDEX IF NOT EXISTS idx_healing_actions_trigger ON extraction_healing_actions(trigger_type, created_at DESC);

-- ============================================
-- 5. ERROR PATTERN REGISTRY
-- ============================================
-- Tracks known error patterns and their healing strategies

CREATE TABLE IF NOT EXISTS error_pattern_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern identification
  pattern_name TEXT NOT NULL UNIQUE,
  pattern_description TEXT,

  -- Matching rules
  source_pattern TEXT,        -- Regex for source (e.g., 'craigslist|ksl')
  field_pattern TEXT,         -- Regex for field name
  error_code_pattern TEXT,    -- Regex for error codes
  error_message_pattern TEXT, -- Regex for error messages

  -- Detection thresholds
  min_occurrences INTEGER DEFAULT 5,     -- How many times before triggering
  time_window_hours INTEGER DEFAULT 24,  -- Within what time period

  -- Auto-healing configuration
  auto_heal_enabled BOOLEAN DEFAULT false,
  healing_action TEXT,        -- What action to take
  healing_config JSONB,       -- Configuration for healing action

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  trigger_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. CROSS-VALIDATION LOG
-- ============================================
-- Tracks when data from different sources is compared

CREATE TABLE IF NOT EXISTS cross_validation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,

  -- Sources compared
  primary_source TEXT NOT NULL,
  secondary_source TEXT NOT NULL,

  -- Values
  primary_value TEXT,
  secondary_value TEXT,

  -- Result
  match_status TEXT CHECK (match_status IN (
    'exact_match',     -- Values identical
    'fuzzy_match',     -- Values similar (within tolerance)
    'conflict',        -- Values different
    'one_missing'      -- One source has value, other doesn't
  )),
  similarity_score NUMERIC(3,2), -- 0-1 for fuzzy matching

  -- Resolution
  resolved_value TEXT,
  resolution_method TEXT, -- 'primary_wins', 'secondary_wins', 'manual', 'consensus'
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cross_validation_vehicle ON cross_validation_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_cross_validation_conflicts ON cross_validation_log(match_status)
  WHERE match_status = 'conflict';

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Log a field extraction attempt (called by extractors)
CREATE OR REPLACE FUNCTION log_field_extraction(
  p_vehicle_id UUID,
  p_extraction_run_id UUID,
  p_source TEXT,
  p_source_url TEXT,
  p_extractor_name TEXT,
  p_extractor_version TEXT,
  p_field_name TEXT,
  p_extraction_status TEXT,
  p_extracted_value TEXT DEFAULT NULL,
  p_confidence_score NUMERIC DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_details JSONB DEFAULT NULL,
  p_extraction_time_ms INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO field_extraction_log (
    vehicle_id, extraction_run_id, source, source_url,
    extractor_name, extractor_version,
    field_name, extraction_status,
    extracted_value, confidence_score,
    error_code, error_details, extraction_time_ms
  )
  VALUES (
    p_vehicle_id, p_extraction_run_id, p_source, p_source_url,
    p_extractor_name, p_extractor_version,
    p_field_name, p_extraction_status,
    p_extracted_value, p_confidence_score,
    p_error_code, p_error_details, p_extraction_time_ms
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- Aggregate metrics hourly
CREATE OR REPLACE FUNCTION aggregate_extraction_metrics()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_time_bucket TIMESTAMPTZ;
BEGIN
  -- Round to current hour
  v_time_bucket := date_trunc('hour', NOW());

  -- Aggregate last hour's data
  INSERT INTO extraction_health_metrics (
    source,
    extractor_name,
    field_name,
    time_bucket,
    total_attempts,
    successful_extractions,
    not_found_count,
    parse_errors,
    validation_failures,
    low_confidence_count,
    avg_confidence,
    min_confidence,
    max_confidence,
    avg_extraction_time_ms,
    p95_extraction_time_ms
  )
  SELECT
    source,
    extractor_name,
    field_name,
    v_time_bucket,
    COUNT(*),
    COUNT(*) FILTER (WHERE extraction_status = 'extracted'),
    COUNT(*) FILTER (WHERE extraction_status = 'not_found'),
    COUNT(*) FILTER (WHERE extraction_status = 'parse_error'),
    COUNT(*) FILTER (WHERE extraction_status = 'validation_fail'),
    COUNT(*) FILTER (WHERE extraction_status = 'low_confidence'),
    AVG(confidence_score),
    MIN(confidence_score),
    MAX(confidence_score),
    AVG(extraction_time_ms)::INTEGER,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY extraction_time_ms)::INTEGER
  FROM field_extraction_log
  WHERE created_at >= v_time_bucket - INTERVAL '1 hour'
    AND created_at < v_time_bucket
  GROUP BY source, extractor_name, field_name
  ON CONFLICT (source, extractor_name, field_name, time_bucket) DO UPDATE SET
    total_attempts = EXCLUDED.total_attempts,
    successful_extractions = EXCLUDED.successful_extractions,
    not_found_count = EXCLUDED.not_found_count,
    parse_errors = EXCLUDED.parse_errors,
    validation_failures = EXCLUDED.validation_failures,
    low_confidence_count = EXCLUDED.low_confidence_count,
    avg_confidence = EXCLUDED.avg_confidence,
    min_confidence = EXCLUDED.min_confidence,
    max_confidence = EXCLUDED.max_confidence,
    avg_extraction_time_ms = EXCLUDED.avg_extraction_time_ms,
    p95_extraction_time_ms = EXCLUDED.p95_extraction_time_ms,
    updated_at = NOW();
END;
$$;

-- Detect extraction drift
CREATE OR REPLACE FUNCTION detect_extraction_drift()
RETURNS INTEGER -- Returns number of alerts created
LANGUAGE plpgsql
AS $$
DECLARE
  v_alert_count INTEGER := 0;
  v_current RECORD;
  v_baseline RECORD;
  v_threshold_drop NUMERIC := 15.0; -- Alert if rate drops more than 15%
  v_sample_vehicles UUID[];
BEGIN
  -- Compare last 6 hours to previous 7 days baseline
  FOR v_current IN
    SELECT
      source,
      extractor_name,
      field_name,
      AVG(success_rate) as current_rate,
      AVG(avg_confidence) as current_confidence,
      SUM(total_attempts) as total_attempts
    FROM extraction_health_metrics
    WHERE time_bucket > NOW() - INTERVAL '6 hours'
    GROUP BY source, extractor_name, field_name
    HAVING SUM(total_attempts) > 10 -- Only alert on fields with enough data
  LOOP
    -- Get baseline (7 days excluding last 6 hours)
    SELECT
      AVG(success_rate) as baseline_rate,
      AVG(avg_confidence) as baseline_confidence
    INTO v_baseline
    FROM extraction_health_metrics
    WHERE source = v_current.source
      AND extractor_name = v_current.extractor_name
      AND field_name = v_current.field_name
      AND time_bucket > NOW() - INTERVAL '7 days'
      AND time_bucket <= NOW() - INTERVAL '6 hours';

    -- Skip if no baseline data
    IF v_baseline.baseline_rate IS NULL THEN
      CONTINUE;
    END IF;

    -- Get sample vehicle IDs for context
    SELECT ARRAY_AGG(DISTINCT vehicle_id) INTO v_sample_vehicles
    FROM (
      SELECT vehicle_id
      FROM field_extraction_log
      WHERE source = v_current.source
        AND extractor_name = v_current.extractor_name
        AND field_name = v_current.field_name
        AND extraction_status != 'extracted'
        AND created_at > NOW() - INTERVAL '6 hours'
      LIMIT 5
    ) s;

    -- Check for success rate drop
    IF v_current.current_rate < v_baseline.baseline_rate - v_threshold_drop THEN
      INSERT INTO extraction_drift_alerts (
        source, extractor_name, field_name,
        alert_type, severity,
        current_value, baseline_value, threshold_value,
        sample_vehicle_ids,
        status
      )
      VALUES (
        v_current.source, v_current.extractor_name, v_current.field_name,
        'success_rate_drop',
        CASE
          WHEN v_current.current_rate < 50 THEN 'critical'
          WHEN v_current.current_rate < 70 THEN 'warning'
          ELSE 'info'
        END,
        v_current.current_rate, v_baseline.baseline_rate, v_threshold_drop,
        v_sample_vehicles,
        'open'
      )
      ON CONFLICT DO NOTHING; -- Avoid duplicate alerts

      v_alert_count := v_alert_count + 1;
    END IF;

    -- Check for confidence drop (only if we have baseline)
    IF v_baseline.baseline_confidence IS NOT NULL
       AND v_current.current_confidence < v_baseline.baseline_confidence - 0.15 THEN
      INSERT INTO extraction_drift_alerts (
        source, extractor_name, field_name,
        alert_type, severity,
        current_value, baseline_value, threshold_value,
        sample_vehicle_ids,
        status
      )
      VALUES (
        v_current.source, v_current.extractor_name, v_current.field_name,
        'confidence_drop',
        CASE
          WHEN v_current.current_confidence < 0.5 THEN 'critical'
          WHEN v_current.current_confidence < 0.7 THEN 'warning'
          ELSE 'info'
        END,
        v_current.current_confidence, v_baseline.baseline_confidence, 0.15,
        v_sample_vehicles,
        'open'
      )
      ON CONFLICT DO NOTHING;

      v_alert_count := v_alert_count + 1;
    END IF;
  END LOOP;

  RETURN v_alert_count;
END;
$$;

-- Detect error patterns
CREATE OR REPLACE FUNCTION detect_error_patterns()
RETURNS INTEGER -- Returns number of patterns detected
LANGUAGE plpgsql
AS $$
DECLARE
  v_pattern RECORD;
  v_occurrence_count INTEGER;
  v_detected_count INTEGER := 0;
  v_sample_vehicles UUID[];
BEGIN
  FOR v_pattern IN
    SELECT * FROM error_pattern_registry WHERE is_active = true
  LOOP
    -- Count occurrences matching pattern
    SELECT COUNT(*) INTO v_occurrence_count
    FROM field_extraction_log
    WHERE created_at > NOW() - (v_pattern.time_window_hours || ' hours')::INTERVAL
      AND (v_pattern.source_pattern IS NULL OR source ~ v_pattern.source_pattern)
      AND (v_pattern.field_pattern IS NULL OR field_name ~ v_pattern.field_pattern)
      AND (v_pattern.error_code_pattern IS NULL OR error_code ~ v_pattern.error_code_pattern)
      AND extraction_status != 'extracted';

    IF v_occurrence_count >= v_pattern.min_occurrences THEN
      -- Get sample vehicles
      SELECT ARRAY_AGG(DISTINCT vehicle_id) INTO v_sample_vehicles
      FROM (
        SELECT vehicle_id
        FROM field_extraction_log
        WHERE created_at > NOW() - (v_pattern.time_window_hours || ' hours')::INTERVAL
          AND (v_pattern.source_pattern IS NULL OR source ~ v_pattern.source_pattern)
          AND (v_pattern.field_pattern IS NULL OR field_name ~ v_pattern.field_pattern)
          AND extraction_status != 'extracted'
        LIMIT 5
      ) s;

      -- Pattern detected - create drift alert
      INSERT INTO extraction_drift_alerts (
        source, extractor_name, field_name,
        alert_type, severity,
        current_value, threshold_value,
        error_pattern,
        sample_vehicle_ids,
        status
      )
      VALUES (
        COALESCE(v_pattern.source_pattern, '*'),
        '*',
        COALESCE(v_pattern.field_pattern, '*'),
        'new_error_pattern',
        'warning',
        v_occurrence_count, v_pattern.min_occurrences,
        jsonb_build_object(
          'pattern_name', v_pattern.pattern_name,
          'pattern_id', v_pattern.id
        ),
        v_sample_vehicles,
        'open'
      );

      -- Update pattern stats
      UPDATE error_pattern_registry
      SET last_triggered_at = NOW(),
          trigger_count = trigger_count + 1,
          updated_at = NOW()
      WHERE id = v_pattern.id;

      -- Auto-heal if enabled
      IF v_pattern.auto_heal_enabled AND v_pattern.healing_action IS NOT NULL THEN
        INSERT INTO extraction_healing_actions (
          trigger_type,
          source, field_name,
          action_type,
          vehicle_ids,
          status
        )
        VALUES (
          'error_pattern',
          v_pattern.source_pattern,
          v_pattern.field_pattern,
          v_pattern.healing_action,
          v_sample_vehicles,
          'pending'
        );
      END IF;

      v_detected_count := v_detected_count + 1;
    END IF;
  END LOOP;

  RETURN v_detected_count;
END;
$$;

-- ============================================
-- DASHBOARD VIEWS
-- ============================================

-- Overall system health
CREATE OR REPLACE VIEW extraction_health_dashboard AS
SELECT
  -- Overall stats (last 24 hours)
  (
    SELECT jsonb_build_object(
      'total_extractions_24h', COUNT(*),
      'successful_24h', COUNT(*) FILTER (WHERE extraction_status = 'extracted'),
      'failed_24h', COUNT(*) FILTER (WHERE extraction_status != 'extracted'),
      'overall_success_rate', ROUND(
        COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC /
        NULLIF(COUNT(*), 0) * 100, 1
      ),
      'avg_confidence', ROUND(AVG(confidence_score)::NUMERIC, 2)
    )
    FROM field_extraction_log
    WHERE created_at > NOW() - INTERVAL '24 hours'
  ) as overall_stats,

  -- By source
  (
    SELECT jsonb_agg(source_stat)
    FROM (
      SELECT jsonb_build_object(
        'source', source,
        'total', COUNT(*),
        'success_rate', ROUND(
          COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC /
          NULLIF(COUNT(*), 0) * 100, 1
        ),
        'status', CASE
          WHEN COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC / NULLIF(COUNT(*), 0) >= 0.9 THEN 'healthy'
          WHEN COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC / NULLIF(COUNT(*), 0) >= 0.7 THEN 'degraded'
          ELSE 'failing'
        END
      ) as source_stat
      FROM field_extraction_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY source
      ORDER BY COUNT(*) DESC
    ) s
  ) as by_source,

  -- Top 10 problematic fields
  (
    SELECT jsonb_agg(field_stat)
    FROM (
      SELECT jsonb_build_object(
        'field', field_name,
        'source', source,
        'success_rate', ROUND(
          COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC /
          NULLIF(COUNT(*), 0) * 100, 1
        ),
        'avg_confidence', ROUND(AVG(confidence_score)::NUMERIC, 2),
        'common_error', MODE() WITHIN GROUP (ORDER BY error_code)
          FILTER (WHERE error_code IS NOT NULL)
      ) as field_stat
      FROM field_extraction_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY field_name, source
      HAVING COUNT(*) > 10
      ORDER BY COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC /
               NULLIF(COUNT(*), 0) ASC
      LIMIT 10
    ) f
  ) as problematic_fields,

  -- Active alerts
  (
    SELECT jsonb_build_object(
      'critical', COUNT(*) FILTER (WHERE severity = 'critical' AND status = 'open'),
      'warning', COUNT(*) FILTER (WHERE severity = 'warning' AND status = 'open'),
      'info', COUNT(*) FILTER (WHERE severity = 'info' AND status = 'open')
    )
    FROM extraction_drift_alerts
    WHERE created_at > NOW() - INTERVAL '7 days'
  ) as active_alerts,

  -- Healing actions
  (
    SELECT jsonb_build_object(
      'pending', COUNT(*) FILTER (WHERE status = 'pending'),
      'executing', COUNT(*) FILTER (WHERE status = 'executing'),
      'completed_24h', COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'),
      'failed_24h', COUNT(*) FILTER (WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '24 hours'),
      'fields_corrected_24h', COALESCE(SUM(fields_corrected) FILTER (WHERE completed_at > NOW() - INTERVAL '24 hours'), 0)
    )
    FROM extraction_healing_actions
  ) as healing_stats,

  NOW() as generated_at;

-- Field completeness by source (for drill-down)
CREATE OR REPLACE VIEW field_completeness_by_source AS
SELECT
  source,
  field_name,
  COUNT(*) as total_attempts,
  ROUND(
    COUNT(*) FILTER (WHERE extraction_status = 'extracted')::NUMERIC /
    NULLIF(COUNT(*), 0) * 100, 1
  ) as extraction_rate,
  ROUND(AVG(confidence_score)::NUMERIC, 2) as avg_confidence,
  COUNT(*) FILTER (WHERE extraction_status = 'not_found') as not_found_count,
  COUNT(*) FILTER (WHERE extraction_status = 'parse_error') as parse_error_count,
  COUNT(*) FILTER (WHERE extraction_status = 'validation_fail') as validation_fail_count,
  MAX(created_at) as last_extraction
FROM field_extraction_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY source, field_name
ORDER BY extraction_rate ASC, total_attempts DESC;

-- Trending metrics (last 48 hours)
CREATE OR REPLACE VIEW extraction_trends AS
SELECT
  time_bucket,
  source,
  field_name,
  success_rate,
  avg_confidence,
  total_attempts,
  LAG(success_rate) OVER (
    PARTITION BY source, field_name
    ORDER BY time_bucket
  ) as prev_success_rate,
  success_rate - LAG(success_rate) OVER (
    PARTITION BY source, field_name
    ORDER BY time_bucket
  ) as rate_change
FROM extraction_health_metrics
WHERE time_bucket > NOW() - INTERVAL '48 hours'
ORDER BY time_bucket DESC, source, field_name;

-- ============================================
-- SEED ERROR PATTERNS
-- ============================================

INSERT INTO error_pattern_registry (pattern_name, pattern_description, field_pattern, error_code_pattern, min_occurrences, time_window_hours, auto_heal_enabled, healing_action)
VALUES
  ('vin_format_errors', 'VIN extraction returns invalid format', '^vin$', 'INVALID_VIN_FORMAT|VIN_CHECKSUM_FAIL', 5, 24, false, 'flag_for_review'),
  ('price_parse_failures', 'Price field cannot be parsed', 'price|sold_price', 'PARSE_ERROR|CURRENCY_UNKNOWN', 10, 24, true, 'fallback_extractor'),
  ('image_extraction_timeout', 'Image URLs taking too long to extract', '^images$', 'TIMEOUT', 5, 6, true, 'retry_extraction'),
  ('bot_protection_blocks', 'Source is blocking scraper', NULL, 'BOT_PROTECTION|403_FORBIDDEN|CAPTCHA', 3, 1, true, 'notify_admin'),
  ('empty_listing_pages', 'Listing page appears empty/deleted', NULL, 'EMPTY_CONTENT|404_NOT_FOUND', 10, 24, false, 'invalidate_data')
ON CONFLICT (pattern_name) DO NOTHING;

-- ============================================
-- CRON JOBS (pg_cron)
-- ============================================

-- Aggregate metrics hourly (5 minutes past the hour)
SELECT cron.schedule(
  'aggregate-extraction-metrics',
  '5 * * * *',
  'SELECT aggregate_extraction_metrics()'
);

-- Detect drift every 6 hours
SELECT cron.schedule(
  'detect-extraction-drift',
  '0 */6 * * *',
  $$
  DO $$
  DECLARE
    v_alert_count INTEGER;
  BEGIN
    SELECT detect_extraction_drift() INTO v_alert_count;
    IF v_alert_count > 0 THEN
      INSERT INTO admin_notifications (
        notification_type, title, message, priority, metadata
      )
      VALUES (
        'system_alert',
        'Extraction Drift Detected',
        v_alert_count || ' new extraction drift alerts require attention',
        CASE WHEN v_alert_count > 5 THEN 5 ELSE 3 END,
        jsonb_build_object('alert_count', v_alert_count, 'detected_at', NOW())
      );
    END IF;
  END $$;
  $$
);

-- Detect error patterns hourly
SELECT cron.schedule(
  'detect-error-patterns',
  '15 * * * *',
  'SELECT detect_error_patterns()'
);

-- Cleanup old logs (keep 30 days of field logs, 90 days of metrics)
SELECT cron.schedule(
  'cleanup-extraction-logs',
  '0 3 * * *',
  $$
  DELETE FROM field_extraction_log WHERE created_at < NOW() - INTERVAL '30 days';
  DELETE FROM extraction_health_metrics WHERE time_bucket < NOW() - INTERVAL '90 days';
  $$
);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE field_extraction_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_drift_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_healing_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_pattern_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE cross_validation_log ENABLE ROW LEVEL SECURITY;

-- Service role full access (for edge functions)
CREATE POLICY "Service role access" ON field_extraction_log FOR ALL USING (true);
CREATE POLICY "Service role access" ON extraction_health_metrics FOR ALL USING (true);
CREATE POLICY "Service role access" ON extraction_drift_alerts FOR ALL USING (true);
CREATE POLICY "Service role access" ON extraction_healing_actions FOR ALL USING (true);
CREATE POLICY "Service role access" ON error_pattern_registry FOR ALL USING (true);
CREATE POLICY "Service role access" ON cross_validation_log FOR ALL USING (true);

-- ============================================
-- TABLE COMMENTS
-- ============================================

COMMENT ON TABLE field_extraction_log IS 'Logs every field extraction attempt for granular health monitoring. Core of the self-healing system.';
COMMENT ON TABLE extraction_health_metrics IS 'Pre-aggregated hourly metrics for fast dashboard queries. Updated by cron.';
COMMENT ON TABLE extraction_drift_alerts IS 'Alerts when extraction quality drifts from baseline. Triggers healing actions.';
COMMENT ON TABLE extraction_healing_actions IS 'Tracks automated and manual healing attempts with results.';
COMMENT ON TABLE error_pattern_registry IS 'Known error patterns and their healing strategies. Config-driven.';
COMMENT ON TABLE cross_validation_log IS 'Cross-validation results when comparing data from multiple sources.';
COMMENT ON FUNCTION log_field_extraction IS 'Called by extractors to log each field extraction attempt.';
COMMENT ON FUNCTION aggregate_extraction_metrics IS 'Aggregates field_extraction_log into hourly metrics. Run by cron.';
COMMENT ON FUNCTION detect_extraction_drift IS 'Compares current metrics to baseline and creates alerts. Run every 6 hours.';
COMMENT ON FUNCTION detect_error_patterns IS 'Matches errors against pattern registry and triggers healing. Run hourly.';
