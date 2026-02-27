-- Data Quality Snapshots table
-- Stores periodic snapshots of field completion rates across the vehicles table
-- Used by the Data Quality Command Center dashboard at /admin/data-quality

CREATE TABLE IF NOT EXISTS data_quality_snapshots (
  id BIGSERIAL PRIMARY KEY,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  sample_size INTEGER,
  total_vehicles INTEGER,
  field_stats JSONB,        -- {"make": 97.9, "vin": 18.0, ...} (pct complete, 0-100)
  pipeline_stats JSONB,     -- {active_cron_jobs, recent_runs, velocities}
  workforce_status JSONB    -- {active workers, rates, ETAs}
);

CREATE INDEX IF NOT EXISTS idx_data_quality_snapshots_captured_at
  ON data_quality_snapshots (captured_at DESC);

-- Auto-cleanup: retain 7 days of snapshots
-- (called by pg_cron or by the edge function itself)
CREATE OR REPLACE FUNCTION cleanup_old_quality_snapshots()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM data_quality_snapshots
  WHERE captured_at < NOW() - INTERVAL '7 days';
$$;

COMMENT ON TABLE data_quality_snapshots IS
  'Periodic snapshots of field completion rates. Captured every 10 minutes by compute-data-quality-snapshot edge function. Retained 7 days.';
COMMENT ON COLUMN data_quality_snapshots.field_stats IS
  'JSONB map of field_name -> completion_pct (0.0-100.0). Computed from TABLESAMPLE SYSTEM(3) of non-deleted vehicles.';
COMMENT ON COLUMN data_quality_snapshots.pipeline_stats IS
  'JSONB with active_cron_jobs array and per-function last_run/velocity info from cron.job_run_details.';
COMMENT ON COLUMN data_quality_snapshots.workforce_status IS
  'JSONB summary of which enrichment workers are active, their rates, and ETAs to 95% completion.';

-- ----------------------------------------------------------------
-- get_data_quality_field_stats()
-- TABLESAMPLE SYSTEM(3) scan → JSONB of field completion rates
-- Called by compute-data-quality-snapshot edge function via RPC
-- Columns reflect actual vehicles schema (torque, color, etc.)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_data_quality_field_stats()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH sample AS (
    SELECT * FROM vehicles TABLESAMPLE SYSTEM(3)
    WHERE deleted_at IS NULL
  ),
  totals AS (SELECT COUNT(*) as n FROM sample)
  SELECT jsonb_build_object(
    'sample_size',       (SELECT n FROM totals),
    'make',              ROUND(COUNT(make)::numeric              / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'model',             ROUND(COUNT(model)::numeric             / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'year',              ROUND(COUNT(year)::numeric              / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'vin',               ROUND(COUNT(vin)::numeric               / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'trim',              ROUND(COUNT(trim)::numeric              / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'series',            ROUND(COUNT(series)::numeric            / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'body_style',        ROUND(COUNT(body_style)::numeric        / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'engine_type',       ROUND(COUNT(engine_type)::numeric       / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'engine_liters',     ROUND(COUNT(engine_liters)::numeric     / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'drivetrain',        ROUND(COUNT(drivetrain)::numeric        / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'transmission_type', ROUND(COUNT(transmission_type)::numeric / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'fuel_type',         ROUND(COUNT(fuel_type)::numeric         / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'doors',             ROUND(COUNT(doors)::numeric             / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'seats',             ROUND(COUNT(seats)::numeric             / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'horsepower',        ROUND(COUNT(horsepower)::numeric        / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'torque',            ROUND(COUNT(torque)::numeric            / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'mpg_city',          ROUND(COUNT(mpg_city)::numeric          / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'mpg_highway',       ROUND(COUNT(mpg_highway)::numeric       / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'weight_lbs',        ROUND(COUNT(weight_lbs)::numeric        / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'wheelbase_inches',  ROUND(COUNT(wheelbase_inches)::numeric  / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'description',       ROUND(COUNT(description)::numeric       / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'listing_url',       ROUND(COUNT(listing_url)::numeric       / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'image_url',         ROUND(COUNT(image_url)::numeric         / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'color',             ROUND(COUNT(color)::numeric             / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'interior_color',    ROUND(COUNT(interior_color)::numeric    / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'city',              ROUND(COUNT(city)::numeric              / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'state',             ROUND(COUNT(state)::numeric             / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'country',           ROUND(COUNT(country)::numeric           / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'nuke_estimate',     ROUND(COUNT(nuke_estimate)::numeric     / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'deal_score',        ROUND(COUNT(deal_score)::numeric        / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'heat_score',        ROUND(COUNT(heat_score)::numeric        / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'signal_score',      ROUND(COUNT(signal_score)::numeric      / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'asking_price',      ROUND(COUNT(asking_price)::numeric      / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'mileage',           ROUND(COUNT(mileage)::numeric           / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'source',            ROUND(COUNT(source)::numeric            / NULLIF((SELECT n FROM totals), 0) * 100, 1),
    'auction_status',    ROUND(COUNT(auction_status)::numeric    / NULLIF((SELECT n FROM totals), 0) * 100, 1)
  ) FROM sample
$$;

-- ----------------------------------------------------------------
-- get_pipeline_cron_stats()
-- Returns last-run info for key enrichment cron jobs
-- Called by compute-data-quality-snapshot edge function via RPC
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_pipeline_cron_stats()
RETURNS TABLE(
  jobname TEXT,
  active BOOLEAN,
  schedule TEXT,
  last_start_time TIMESTAMPTZ,
  last_end_time TIMESTAMPTZ,
  last_status TEXT,
  last_return_message TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    j.jobname::TEXT,
    j.active,
    j.schedule::TEXT,
    d.start_time   AS last_start_time,
    d.end_time     AS last_end_time,
    d.status::TEXT AS last_status,
    d.return_message AS last_return_message
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT start_time, end_time, status, return_message
    FROM cron.job_run_details
    WHERE jobid = j.jobid
    ORDER BY start_time DESC
    LIMIT 1
  ) d ON true
  WHERE j.jobname ILIKE ANY(ARRAY[
    '%batch-vin-decode%',
    '%enrich-factory-specs%',
    '%enrich-vehicle-profile-ai%',
    '%batch-ymm-propagate%',
    '%enrich-bulk%',
    '%compute-vehicle-valuation%',
    '%data-quality-workforce%',
    '%compute-data-quality-snapshot%'
  ])
  ORDER BY j.jobname
$$;
