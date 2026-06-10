-- ============================================================================
-- PIPELINE PULSE — throughput-based control surface
-- Filed: 2026-06-10
--
-- "Green workflow runs" lied: Mecum/KSL workflows reported success on
-- 2026-06-09 while ZERO vehicles were created Jun 3-10 (measured live:
-- 7,845 → 11,159 → 2,555 → 0 weekly). Health = rows landing per organ per
-- day, not exit codes. This RPC is the single source for the control room:
-- daily ingest counts for the acquisition organs + queue backlogs.
--
-- All counts are bounded index-range scans over created_at (last N days);
-- backlogs use existing partial/status indexes.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_pipeline_pulse(p_days INT DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '8s'
AS $$
DECLARE
  v_since TIMESTAMPTZ := date_trunc('day', now()) - make_interval(days => p_days - 1);
  v_vehicles JSONB;
  v_images JSONB;
  v_observations JSONB;
  v_comments JSONB;
  v_backlogs JSONB;
BEGIN
  -- Daily new vehicles (discovery + extraction organs land here)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
  INTO v_vehicles
  FROM (
    SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
    FROM vehicles WHERE created_at >= v_since
    GROUP BY 1
  ) t;

  -- Daily new images (capture + media organs)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
  INTO v_images
  FROM (
    SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
    FROM vehicle_images WHERE created_at >= v_since
    GROUP BY 1
  ) t;

  -- Daily new observations (enrichment organ)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
  INTO v_observations
  FROM (
    -- vehicle_observations has no created_at; ingestion time is ingested_at
    SELECT date_trunc('day', ingested_at)::date AS d, count(*) AS n
    FROM vehicle_observations WHERE ingested_at >= v_since
    GROUP BY 1
  ) t;

  -- Daily new auction comments (market-live organ)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
  INTO v_comments
  FROM (
    SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
    FROM auction_comments WHERE created_at >= v_since
    GROUP BY 1
  ) t;

  -- Backlogs: work waiting for an organ that may be dead
  SELECT jsonb_build_object(
    'import_queue_pending',
      (SELECT count(*) FROM import_queue WHERE status = 'pending'),
    'images_analysis_pending',
      (SELECT count(*) FROM vehicle_images WHERE ai_processing_status = 'pending'),
    'images_analysis_failed',
      (SELECT count(*) FROM vehicle_images WHERE ai_processing_status = 'failed')
  ) INTO v_backlogs;

  RETURN jsonb_build_object(
    'since', v_since,
    'days', p_days,
    'organs', jsonb_build_object(
      'vehicles', v_vehicles,
      'images', v_images,
      'observations', v_observations,
      'auction_comments', v_comments
    ),
    'backlogs', v_backlogs,
    'generated_at', now()
  );
EXCEPTION WHEN others THEN
  RETURN jsonb_build_object('error', SQLERRM, 'generated_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION get_pipeline_pulse(INT) TO anon, authenticated;

-- Range scans above need created_at indexes; vehicles/vehicle_images have
-- them. Ensure the two that commonly lack one:
CREATE INDEX IF NOT EXISTS idx_vehicle_observations_ingested_at
  ON vehicle_observations (ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_comments_created_at
  ON auction_comments (created_at DESC);
