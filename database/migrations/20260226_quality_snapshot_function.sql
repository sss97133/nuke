-- ============================================================
-- QUALITY SNAPSHOT CRON FUNCTION
-- Computes per-source quality metrics and stores in snapshots.
-- Called by pg_cron daily: SELECT cron.schedule(...)
-- ============================================================

CREATE OR REPLACE FUNCTION snapshot_source_quality()
RETURNS INT AS $$
DECLARE
  inserted_count INT;
BEGIN
  INSERT INTO source_quality_snapshots (
    source_name, total_vehicles, ymm_coverage_pct, vin_valid_pct,
    price_valid_pct, avg_quality_score, null_year_count, null_make_count,
    null_model_count, model_polluted_count, junk_price_count, bad_vin_count,
    quality_grade, alerts
  )
  SELECT
    COALESCE(discovery_source, '__unknown__') AS source_name,
    COUNT(*) AS total_vehicles,
    ROUND(100.0 * COUNT(*) FILTER (
      WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
        AND make IS NOT NULL AND make <> ''
        AND model IS NOT NULL AND model <> '' AND length(model) <= 80
    ) / COUNT(*), 2) AS ymm_coverage_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE vin IS NOT NULL AND length(vin) = 17 AND year >= 1981)
      / NULLIF(COUNT(*) FILTER (WHERE year >= 1981), 0), 2) AS vin_valid_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price >= 100)
      / COUNT(*), 2) AS price_valid_pct,
    ROUND(AVG(data_quality_score)::NUMERIC, 3) AS avg_quality_score,
    COUNT(*) FILTER (WHERE year IS NULL) AS null_year_count,
    COUNT(*) FILTER (WHERE make IS NULL OR make = '') AS null_make_count,
    COUNT(*) FILTER (WHERE model IS NULL OR model = '' OR length(model) > 80) AS null_model_count,
    COUNT(*) FILTER (WHERE length(model) > 80 AND model IS NOT NULL) AS model_polluted_count,
    COUNT(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price < 100) AS junk_price_count,
    COUNT(*) FILTER (WHERE vin IS NOT NULL AND length(vin) != 17 AND year IS NOT NULL AND year >= 1981) AS bad_vin_count,
    -- Grade
    CASE
      WHEN ROUND(100.0 * COUNT(*) FILTER (
        WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
          AND make IS NOT NULL AND make <> ''
          AND model IS NOT NULL AND model <> '' AND length(model) <= 80
      ) / COUNT(*), 2) >= 95 THEN 'A'
      WHEN ROUND(100.0 * COUNT(*) FILTER (
        WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
          AND make IS NOT NULL AND make <> ''
          AND model IS NOT NULL AND model <> '' AND length(model) <= 80
      ) / COUNT(*), 2) >= 85 THEN 'B'
      WHEN ROUND(100.0 * COUNT(*) FILTER (
        WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
          AND make IS NOT NULL AND make <> ''
          AND model IS NOT NULL AND model <> '' AND length(model) <= 80
      ) / COUNT(*), 2) >= 70 THEN 'C'
      WHEN ROUND(100.0 * COUNT(*) FILTER (
        WHERE year IS NOT NULL AND year >= 1885 AND year <= 2027
          AND make IS NOT NULL AND make <> ''
          AND model IS NOT NULL AND model <> '' AND length(model) <= 80
      ) / COUNT(*), 2) >= 50 THEN 'D'
      ELSE 'F'
    END AS quality_grade,
    NULL AS alerts
  FROM vehicles
  WHERE status != 'deleted'
  GROUP BY COALESCE(discovery_source, '__unknown__')
  HAVING COUNT(*) >= 50;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Schedule daily at 2am UTC
SELECT cron.schedule(
  'daily-source-quality-snapshot',
  '0 2 * * *',
  'SELECT snapshot_source_quality()'
) ON CONFLICT DO NOTHING;

-- Run first snapshot now
SELECT snapshot_source_quality() AS sources_snapshotted;
