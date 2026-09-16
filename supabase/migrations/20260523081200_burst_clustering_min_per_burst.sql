-- 20260523081200_burst_clustering_min_per_burst.sql
--
-- Worth Engine calibration: v3 under-counts sparse-photo bursts.
--
-- Observation from running vehicle_full_picture across 5 vehicles:
--   1995 Suburban: v2=$18,400, v3=$1,256 → 14.6× spread
--   Why: each photo in the Suburban's history is its own ~lone-photo burst, so
--   span=0min + 10min trailing = 10min credit per "burst". With 750 photos but
--   only 75-100 actual bursts, total active minutes = 750-1000min ≈ $1,200.
--
-- Reality check: each photo represents AT LEAST a few minutes of presence on the
-- vehicle (you don't walk up, snap one pic, and instantly leave — there's a
-- reason for the photo). Bump per-burst credit to MAX(span, photos × 5min) + 10
-- so sparse-photo bursts still get realistic time credit.
--
-- This brings v3 closer to v2 without over-counting dense bursts (where span
-- dominates the MAX). Calibration ground truth: a single-photo burst now gets
-- 15min credit (5min/photo + 10min trailing), not 10min.

CREATE OR REPLACE FUNCTION public.compute_active_minutes_burst(
  p_vehicle_id        UUID,
  p_date              DATE,
  p_burst_gap_minutes INT DEFAULT 30
) RETURNS INT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_total_min INT := 0;
BEGIN
  WITH photos AS (
    SELECT taken_at, LAG(taken_at) OVER (ORDER BY taken_at) AS prev_taken
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND taken_at::date = p_date
    ORDER BY taken_at
  ),
  bursts AS (
    SELECT taken_at, prev_taken,
      CASE WHEN prev_taken IS NULL OR taken_at - prev_taken > (p_burst_gap_minutes || ' min')::interval
           THEN 1 ELSE 0 END AS is_new_burst
    FROM photos
  ),
  burst_groups AS (
    SELECT taken_at, SUM(is_new_burst) OVER (ORDER BY taken_at) AS burst_id
    FROM bursts
  ),
  burst_stats AS (
    SELECT
      burst_id,
      MIN(taken_at) AS burst_start,
      MAX(taken_at) AS burst_end,
      count(*) AS photos_in_burst
    FROM burst_groups GROUP BY burst_id
  )
  SELECT COALESCE(SUM(
    -- Per-burst credit = max(actual span, 5min × photo count) + 10min trailing
    -- For dense bursts: span dominates (photos × 5min < span)
    -- For sparse bursts: photos × 5min dominates (small bursts get reasonable time)
    GREATEST(
      EXTRACT(EPOCH FROM (burst_end - burst_start))/60,
      photos_in_burst * 5
    ) + 10
  )::INT, 0) INTO v_total_min FROM burst_stats;

  RETURN LEAST(v_total_min, 480);  -- per-day 8hr cap
END;
$$;

COMMENT ON FUNCTION public.compute_active_minutes_burst(UUID, DATE, INT) IS
'Worth Engine v3 (calibrated): per-day burst-clustered active minutes. Each burst credited GREATEST(span, photos×5min) + 10min trailing. Per-day 480 cap.';
