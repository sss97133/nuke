-- Live definitions as production had them on 2026-10-14 (pg_get_functiondef), the "before" state of
-- supabase/migrations/20261014051500_burst_total_one_pass.sql and its contract
-- supabase/sql/test_burst_total_one_pass.sql.
--   compute_active_minutes_burst_total(uuid,integer)  md5(pg_get_functiondef) 7c2d2f3d8bf6196b9a5c6b46de945f23  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
--   compute_active_minutes_burst(uuid,date,integer)   md5(pg_get_functiondef) 5cc599c768be5898b0528a7acd99ff49  -- gitleaks:allow (md5 checksum of a function definition, not a secret)
-- The per-day function is what the total called once per photo day; the migration does not change it.

CREATE OR REPLACE FUNCTION public.compute_active_minutes_burst(p_vehicle_id uuid, p_date date, p_burst_gap_minutes integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.compute_active_minutes_burst_total(p_vehicle_id uuid, p_burst_gap_minutes integer DEFAULT 30)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_total BIGINT := 0;
  v_day_total INT;
  v_date DATE;
BEGIN
  FOR v_date IN
    SELECT DISTINCT taken_at::date
      FROM vehicle_images
     WHERE vehicle_id = p_vehicle_id
       AND taken_at IS NOT NULL
  LOOP
    v_day_total := compute_active_minutes_burst(p_vehicle_id, v_date, p_burst_gap_minutes);
    v_total := v_total + COALESCE(v_day_total, 0);
  END LOOP;
  RETURN v_total;
END;
$function$;
