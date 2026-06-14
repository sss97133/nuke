-- ============================================================================
-- auto_match_image_to_vehicles: ambiguity guard (the cross-vehicle leak fix)
-- Filed 2026-06-10 (overnight prod-eng), diagnosed by Skylar.
--
-- THE LEAK: the orchestrator auto-assigns a photo's vehicle when this RPC
-- returns confidence > 0.7 (photo-pipeline-orchestrator/index.ts:490). The old
-- RPC returned the single closest vehicle (LIMIT 1). At a SHARED shop — Skylar
-- works both his K5 Blazer and '66 Mustang at Ernie's (35.977,-114.854) — the
-- car with more reference photos at that GPS always wins, so a Mustang photo
-- shot at Ernie's gets filed to the K5. GPS cannot tell two of the owner's cars
-- apart at the same location; only frame content or the owner can. This is the
-- same defect that put "iBooster brake planning" (a K5 system) on the Mustang.
--
-- THE GUARD: compute the best confidence PER candidate vehicle, take the top 2.
-- If a 2nd distinct vehicle scores within 0.15 of the top, the GPS is ambiguous
-- between the owner's cars → cap the returned confidence at 0.5 (below the 0.7
-- assign threshold). The orchestrator then leaves it in the inbox for content
-- analysis or owner confirmation instead of guessing. Unique-location matches
-- (one car at that GPS) are unaffected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auto_match_image_to_vehicles(
  p_image_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_taken_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(vehicle_id uuid, confidence numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5s'
AS $function$
DECLARE
  v_lat_delta DOUBLE PRECISION := 0.0045;
  v_lon_delta DOUBLE PRECISION := 0.0045 / GREATEST(cos(radians(p_latitude)), 0.2);
  v_ambiguity_margin CONSTANT numeric := 0.15;
  v_top_vehicle uuid;
  v_top_conf numeric;
  v_second_conf numeric;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN;
  END IF;

  -- Best confidence per candidate vehicle in the GPS box (one row per vehicle).
  CREATE TEMP TABLE _cand ON COMMIT DROP AS
  SELECT
    vi.vehicle_id AS vid,
    MAX(ROUND(GREATEST(0.05,
      0.95
      - LEAST(
          (111320.0 * sqrt(
            pow(vi.latitude - p_latitude, 2) +
            pow((vi.longitude - p_longitude) * cos(radians(p_latitude)), 2)
          )) / 100.0 * 0.05,
          0.30)
      - CASE WHEN p_user_id IS NOT NULL AND vi.user_id = p_user_id THEN 0.0 ELSE 0.35 END
      - CASE WHEN p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL
             THEN LEAST(abs(EXTRACT(EPOCH FROM (p_taken_at - vi.taken_at))) / 86400.0 / 180.0 * 0.15, 0.15)
             ELSE 0.10 END
    )::numeric, 3)) AS conf
  FROM vehicle_images vi
  WHERE vi.latitude  BETWEEN p_latitude  - v_lat_delta AND p_latitude  + v_lat_delta
    AND vi.longitude BETWEEN p_longitude - v_lon_delta AND p_longitude + v_lon_delta
    AND vi.vehicle_id IS NOT NULL
    AND vi.id IS DISTINCT FROM p_image_id
    AND COALESCE(vi.is_duplicate, false) = false
  GROUP BY vi.vehicle_id;

  SELECT vid, conf INTO v_top_vehicle, v_top_conf
  FROM _cand ORDER BY conf DESC LIMIT 1;

  IF v_top_vehicle IS NULL THEN
    RETURN;  -- nothing nearby
  END IF;

  SELECT conf INTO v_second_conf
  FROM _cand WHERE vid IS DISTINCT FROM v_top_vehicle ORDER BY conf DESC LIMIT 1;

  -- Ambiguous: a 2nd distinct vehicle is within the margin → GPS can't decide.
  -- Cap below the orchestrator's 0.7 assign threshold so it lands in inbox.
  IF v_second_conf IS NOT NULL AND (v_top_conf - v_second_conf) < v_ambiguity_margin THEN
    RETURN QUERY SELECT v_top_vehicle, LEAST(v_top_conf, 0.5::numeric);
  ELSE
    RETURN QUERY SELECT v_top_vehicle, v_top_conf;
  END IF;
END;
$function$;
