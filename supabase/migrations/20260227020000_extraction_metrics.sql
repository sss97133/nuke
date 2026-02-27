-- Extraction Metrics
-- Tracks per-invocation success/failure, latency, and error types for each extractor.
-- Written by continuous-queue-processor and individual extractors via extractionMetrics.ts.

CREATE TABLE IF NOT EXISTS extraction_metrics (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  extractor_name TEXT        NOT NULL,       -- e.g. 'extract-bat-core', 'extract-mecum'
  source         TEXT,                       -- e.g. 'bat', 'mecum', 'bonhams'
  run_id         TEXT        NOT NULL,       -- worker_id or caller-provided run identifier
  source_url     TEXT,                       -- URL processed (nullable for batch summaries)
  vehicle_id     UUID,                       -- vehicle produced, if any
  success        BOOLEAN     NOT NULL,       -- did the extraction succeed?
  latency_ms     INTEGER,                    -- wall-clock time for the extraction
  error_type     TEXT,                       -- categorized: rate_limited, blocked, timeout, etc.
  error_message  TEXT,                       -- raw error (truncated to 500 chars)
  http_status    SMALLINT,                   -- HTTP response code if applicable
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_extraction_metrics_extractor_created
  ON extraction_metrics (extractor_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_metrics_source_created
  ON extraction_metrics (source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_metrics_run_id
  ON extraction_metrics (run_id);

CREATE INDEX IF NOT EXISTS idx_extraction_metrics_error_type
  ON extraction_metrics (error_type) WHERE error_type IS NOT NULL;

-- Hourly rollup view: success rates, latency percentiles, error breakdown per extractor
-- Uses two-level query so the correlated subquery can reference stable computed columns.
CREATE OR REPLACE VIEW extraction_metrics_hourly AS
SELECT
  base.extractor_name,
  base.source,
  base.hour,
  base.total,
  base.succeeded,
  base.failed,
  ROUND(100.0 * base.succeeded / NULLIF(base.total, 0), 1) AS success_rate_pct,
  base.avg_latency_ms,
  base.p50_latency_ms,
  base.p95_latency_ms,
  (
    SELECT COALESCE(jsonb_object_agg(et, cnt), '{}'::jsonb)
    FROM (
      SELECT e2.error_type AS et, COUNT(*) AS cnt
      FROM extraction_metrics e2
      WHERE e2.extractor_name = base.extractor_name
        AND e2.source IS NOT DISTINCT FROM base.source
        AND date_trunc('hour', e2.created_at) = base.hour
        AND e2.error_type IS NOT NULL
      GROUP BY e2.error_type
    ) errs
  ) AS error_breakdown
FROM (
  SELECT
    extractor_name,
    source,
    date_trunc('hour', created_at)                                         AS hour,
    COUNT(*)                                                               AS total,
    COUNT(*) FILTER (WHERE success)                                        AS succeeded,
    COUNT(*) FILTER (WHERE NOT success)                                    AS failed,
    ROUND(AVG(latency_ms))                                                 AS avg_latency_ms,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric) AS p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric) AS p95_latency_ms
  FROM extraction_metrics
  GROUP BY extractor_name, source, date_trunc('hour', created_at)
) base;

-- 24-hour summary view: per-extractor health at a glance
CREATE OR REPLACE VIEW extraction_metrics_24h AS
SELECT
  base.extractor_name,
  base.source,
  base.total_24h,
  base.succeeded_24h,
  base.failed_24h,
  ROUND(100.0 * base.succeeded_24h / NULLIF(base.total_24h, 0), 1) AS success_rate_pct,
  base.avg_latency_ms,
  base.p50_latency_ms,
  base.p95_latency_ms,
  base.last_run_at,
  (
    SELECT COALESCE(jsonb_object_agg(et, cnt), '{}'::jsonb)
    FROM (
      SELECT e2.error_type AS et, COUNT(*) AS cnt
      FROM extraction_metrics e2
      WHERE e2.extractor_name = base.extractor_name
        AND e2.source IS NOT DISTINCT FROM base.source
        AND e2.created_at >= NOW() - INTERVAL '24 hours'
        AND e2.error_type IS NOT NULL
      GROUP BY e2.error_type
    ) errs
  ) AS error_breakdown
FROM (
  SELECT
    extractor_name,
    source,
    COUNT(*)                                                               AS total_24h,
    COUNT(*) FILTER (WHERE success)                                        AS succeeded_24h,
    COUNT(*) FILTER (WHERE NOT success)                                    AS failed_24h,
    ROUND(AVG(latency_ms))                                                 AS avg_latency_ms,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric) AS p50_latency_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric) AS p95_latency_ms,
    MAX(created_at)                                                        AS last_run_at
  FROM extraction_metrics
  WHERE created_at >= NOW() - INTERVAL '24 hours'
  GROUP BY extractor_name, source
) base
ORDER BY base.failed_24h DESC, base.total_24h DESC;

-- RLS: service role can insert; authenticated users can read (internal dashboards)
ALTER TABLE extraction_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON extraction_metrics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON extraction_metrics
  FOR SELECT TO authenticated USING (true);
