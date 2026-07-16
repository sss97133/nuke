-- recompute_profile_stats(uuid): authoritative refresh of profile_stats from real attribution paths.
--
-- The trigger-maintained increments (vehicles_stats_aiud, handle_image_activity) drift when data lands
-- via COPY / bulk migration / direct INSERT-without-trigger. This function does a fresh COUNT and UPSERTs.
-- Safe to call any time. Idempotent. Cheap for a single user.

CREATE OR REPLACE FUNCTION public.recompute_profile_stats(p_user_id uuid)
RETURNS TABLE(
  vehicles_count integer,
  total_vehicles integer,
  total_images integer,
  total_timeline_events integer,
  total_contributions integer,
  last_activity timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vehicles_count integer := 0;
  v_total_vehicles integer := 0;
  v_total_images integer := 0;
  v_timeline integer := 0;
  v_contrib integer := 0;
  v_last timestamptz;
BEGIN
  -- Distinct vehicles where this user is the principal (user_id ∪ uploaded_by ∪ owner_id ∪ created_by_user_id)
  SELECT COUNT(DISTINCT v.id) INTO v_total_vehicles
  FROM vehicles v
  WHERE v.user_id = p_user_id
     OR v.uploaded_by = p_user_id
     OR v.owner_id = p_user_id
     OR v.created_by_user_id = p_user_id;

  -- vehicles_count: distinct vehicles touched via events (more conservative "actually worked on")
  SELECT COUNT(DISTINCT vte.vehicle_id) INTO v_vehicles_count
  FROM vehicle_timeline_events vte
  WHERE vte.user_id = p_user_id;

  -- Images attributed to this user (via user_id; the other paths are redundant in practice)
  SELECT COUNT(*) INTO v_total_images
  FROM vehicle_images
  WHERE user_id = p_user_id;

  -- Timeline events authored by this user (vehicle + business)
  SELECT
    (SELECT COUNT(*) FROM vehicle_timeline_events WHERE user_id = p_user_id)
    + (SELECT COUNT(*) FROM business_timeline_events WHERE created_by = p_user_id)
  INTO v_timeline;

  -- Total contributions: timeline events + image uploads + observations submitted
  SELECT v_timeline
    + v_total_images
    + (SELECT COUNT(*) FROM vehicle_observations WHERE submitted_by_user_id = p_user_id)
  INTO v_contrib;

  -- Most recent activity across the contribution sources
  SELECT MAX(t) INTO v_last
  FROM (
    SELECT MAX(event_date) AS t FROM vehicle_timeline_events WHERE user_id = p_user_id
    UNION ALL SELECT MAX(taken_at)  FROM vehicle_images WHERE user_id = p_user_id
    UNION ALL SELECT MAX(created_at) FROM business_timeline_events WHERE created_by = p_user_id
  ) s;

  INSERT INTO public.profile_stats AS ps (
    user_id, vehicles_count, total_vehicles, total_images,
    total_timeline_events, total_contributions, last_activity, updated_at
  )
  VALUES (
    p_user_id, v_vehicles_count, v_total_vehicles, v_total_images,
    v_timeline, v_contrib, v_last, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    vehicles_count        = EXCLUDED.vehicles_count,
    total_vehicles        = EXCLUDED.total_vehicles,
    total_images          = EXCLUDED.total_images,
    total_timeline_events = EXCLUDED.total_timeline_events,
    total_contributions   = EXCLUDED.total_contributions,
    last_activity         = EXCLUDED.last_activity,
    updated_at            = NOW();

  RETURN QUERY
  SELECT v_vehicles_count, v_total_vehicles, v_total_images,
         v_timeline, v_contrib, v_last;
END;
$$;

COMMENT ON FUNCTION public.recompute_profile_stats(uuid) IS
'Authoritative refresh of profile_stats from real attribution paths. Idempotent.
Use when trigger-maintained increments have drifted (bulk loads, migration backfills).
Called from edge functions or directly from psql. Cheap for a single user.';
