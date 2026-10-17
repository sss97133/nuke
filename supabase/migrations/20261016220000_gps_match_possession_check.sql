-- ============================================================================
-- auto_match_image_to_vehicles: GPS files a photo only onto a vehicle its user held when it was taken
-- ============================================================================
--
-- WHY (2026-10-15, measured on prod):
--   * 20260928213000 paused the photo-pipeline drain (cron 478, now job 556 photo-pipeline-drain) "until its GPS
--     resolver checks that a vehicle is still in the owner's possession before assigning". On 09-28 it had filed 21
--     synced photos onto two cars the owner no longer had: 18 onto the GMC K2500 a90c008a (ownership_transfers: sold
--     2026-02-22; photos taken 2026-06-30..07-22) and 3 onto the 1932 Ford Hot Rod 21ee373f. The live function
--     (identical to 20260610011000) has no possession test.
--   * The GPS box compared the numeric latitude/longitude columns with double precision bounds, so the columns were
--     cast and idx_vehicle_images_gps had no index condition: EXPLAIN shows a full index scan with the bounds as a
--     filter. On 2026-10-15, 7 of 7 timed calls for the photos above ran into the 10 s statement timeout (10.5 s each,
--     scripts/data/q.sh); the same box with numeric bounds returned in 0.5-0.8 s (one cold read 3.1 s). When the RPC
--     errored, the orchestrator ignored the error and fell through to its upload-clock guess (retired in the same PR).
--
-- WHAT:
--   1. user_vehicle_possession_at(user, vehicle, at) -> 'held' | 'not_held' | 'unknown', from what is recorded:
--        ownership_transfers   from_user_id / to_user_id at sale_date (seeded from sold lots whose seller or buyer
--                              resolved to a user, plus private transfers); a cancelled transfer moved nothing
--        vehicle_ownerships    owner periods (start_date, end_date, is_current)
--        vehicle_contributors  roles owner, previous_owner, consigner with start_date / end_date
--      Not read, on purpose: organization_vehicles (an org's link is not the person's possession; owner ruling
--      2026-09-28 "Viva routing an error; Skylar is the author"), vehicle_user_permissions.revoked_at (one bulk revoke
--      on 2026-05-06, not a possession event), vehicles.owner_id / user_id (current pointers with no start), and the
--      photographer contributor role (written from the photos themselves).
--   2. auto_match_image_to_vehicles:
--        - drops merged or deleted vehicles and every 'not_held' vehicle from the candidates;
--        - scores above 0.5 only when the top vehicle is 'held' at p_taken_at (no taken_at means no holding can be
--          shown); the orchestrator's assign bar stays 0.7, so an unknown holding lands in the inbox;
--        - keeps the ambiguity guard (2nd vehicle within 0.15 caps at 0.5) over the remaining candidates;
--        - casts the box bounds to numeric so the index bounds the scan;
--        - judges possession only for the caller when an end user calls it (anon or authenticated passing another
--          user's id gets the no-user score), so the score reveals nothing about someone else's holdings.
--      Signature, return shape, SECURITY DEFINER, search_path, the 5 s timeout and the ACL are unchanged.
--
-- Not in this migration: re-enabling job 556. That is the next step once this and the orchestrator change are live.
-- Contract: supabase/sql/test_gps_match_possession.sql.
-- Live verification after CI applies:
--   select public.user_vehicle_possession_at('0b9f107a-d124-49de-9ded-94698f63c1c4', 'a90c008a-3379-41d8-9eb2-b4eda365d74c',
--     '2026-07-15 01:04:19Z');   -- not_held
--   select * from public.auto_match_image_to_vehicles('da2fb46c-ef9f-44bc-b76b-1eaf62d21741', 17.899525, -62.84995333,
--     '2026-07-15 01:04:19.025Z', '0b9f107a-d124-49de-9ded-94698f63c1c4');   -- no K2500, confidence <= 0.5, < 5 s
-- Reversal: re-apply the function body from 20260610011000_gps_match_ambiguity_guard.sql and drop
--   user_vehicle_possession_at(uuid, uuid, timestamptz).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.user_vehicle_possession_at(p_user_id uuid, p_vehicle_id uuid, p_at timestamptz)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH moves AS (
    SELECT ot.sale_date AS at, (ot.to_user_id IS NOT DISTINCT FROM p_user_id) AS arrives
    FROM ownership_transfers ot
    WHERE ot.vehicle_id = p_vehicle_id
      AND ot.sale_date IS NOT NULL
      AND ot.status <> 'cancelled'
      AND p_user_id IN (ot.from_user_id, ot.to_user_id)
  ), last_move AS (
    -- The user's latest transfer at or before p_at; on a tie the departure wins.
    SELECT m.at, m.arrives FROM moves m WHERE m.at <= p_at ORDER BY m.at DESC, m.arrives LIMIT 1
  ), spans AS (
    SELECT vo.start_date AS s, vo.end_date AS e, (vo.end_date IS NULL AND vo.is_current IS TRUE) AS open_end
    FROM vehicle_ownerships vo
    WHERE vo.vehicle_id = p_vehicle_id AND vo.owner_profile_id = p_user_id
    UNION ALL
    SELECT vc.start_date, vc.end_date, (vc.end_date IS NULL AND vc.status = 'active')
    FROM vehicle_contributors vc
    WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id
      AND vc.role IN ('owner', 'previous_owner', 'consigner')
  ), day AS (
    SELECT (p_at AT TIME ZONE 'UTC')::date AS d
  )
  SELECT CASE
    WHEN p_user_id IS NULL OR p_vehicle_id IS NULL OR p_at IS NULL THEN 'unknown'
    -- Held: the last transfer at or before p_at brought the vehicle to the user, or a holding period with a known start
    -- covers p_at and began after the user's last transfer away.
    WHEN (SELECT lm.arrives FROM last_move lm) IS TRUE THEN 'held'
    WHEN EXISTS (
      SELECT 1 FROM spans sp, day
      WHERE sp.s IS NOT NULL AND sp.s <= day.d
        AND (sp.e >= day.d OR (sp.e IS NULL AND sp.open_end))
        AND sp.s > coalesce((SELECT (lm.at AT TIME ZONE 'UTC')::date FROM last_move lm WHERE NOT lm.arrives), '-infinity'::date)
    ) THEN 'held'
    -- Not held: transferred away at or before p_at and not back since.
    WHEN (SELECT lm.arrives FROM last_move lm) IS FALSE THEN 'not_held'
    -- A period whose start or end is unrecorded may still cover p_at.
    WHEN EXISTS (
      SELECT 1 FROM spans sp, day
      WHERE (sp.s IS NULL OR sp.s <= day.d) AND (sp.e IS NULL OR sp.e >= day.d)
    ) THEN 'unknown'
    -- Every recorded period ended before p_at or began after it, or the user acquired the vehicle after p_at.
    WHEN EXISTS (SELECT 1 FROM spans) OR EXISTS (SELECT 1 FROM moves mv WHERE mv.at > p_at AND mv.arrives) THEN 'not_held'
    ELSE 'unknown'
  END
$function$;

REVOKE ALL ON FUNCTION public.user_vehicle_possession_at(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_vehicle_possession_at(uuid, uuid, timestamptz) TO service_role;
COMMENT ON FUNCTION public.user_vehicle_possession_at(uuid, uuid, timestamptz) IS
  'Whether a user held a vehicle at a moment: held, not_held or unknown, from ownership_transfers (cancelled ignored), '
  'vehicle_ownerships periods and vehicle_contributors owner/previous_owner/consigner periods. Organization links, '
  'permission revocations and current owner pointers are not possession evidence. Read by auto_match_image_to_vehicles '
  '(20261016220000). service_role only: holdings are private.';

CREATE OR REPLACE FUNCTION public.auto_match_image_to_vehicles(p_image_id uuid, p_latitude double precision, p_longitude double precision, p_taken_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_user_id uuid DEFAULT NULL::uuid)
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
  v_user uuid := p_user_id;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN;
  END IF;

  -- An end user is judged only as themselves: another user's id gets the no-user score, so neither the same-user term
  -- nor a holding can be probed through this function. The photo pipeline calls it with the service role.
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated') AND p_user_id IS DISTINCT FROM auth.uid() THEN
    v_user := NULL;
  END IF;

  RETURN QUERY
  WITH box AS MATERIALIZED (
    -- Best confidence per candidate vehicle in the GPS box (one row per vehicle). The bounds are numeric, the columns'
    -- type, so idx_vehicle_images_gps bounds the scan (double precision bounds cast the columns and walked the index).
    -- MATERIALIZED keeps the possession test below at one call per vehicle, not one per photo in the box.
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
        - CASE WHEN v_user IS NOT NULL AND vi.user_id = v_user THEN 0.0 ELSE 0.35 END
        - CASE WHEN p_taken_at IS NOT NULL AND vi.taken_at IS NOT NULL
               THEN LEAST(abs(EXTRACT(EPOCH FROM (p_taken_at - vi.taken_at))) / 86400.0 / 180.0 * 0.15, 0.15)
               ELSE 0.10 END
      )::numeric, 3)) AS conf
    FROM vehicle_images vi
    WHERE vi.latitude  BETWEEN (p_latitude  - v_lat_delta)::numeric AND (p_latitude  + v_lat_delta)::numeric
      AND vi.longitude BETWEEN (p_longitude - v_lon_delta)::numeric AND (p_longitude + v_lon_delta)::numeric
      AND vi.vehicle_id IS NOT NULL
      AND vi.id IS DISTINCT FROM p_image_id
      AND COALESCE(vi.is_duplicate, false) = false
    GROUP BY vi.vehicle_id
  ), cand AS (
    -- Merged or deleted vehicles receive nothing, and a vehicle this user did not hold at taken_at is not a candidate.
    SELECT b.vid, b.conf, public.user_vehicle_possession_at(v_user, b.vid, p_taken_at) AS held
    FROM box b
    JOIN vehicles v ON v.id = b.vid
    WHERE v.merged_into_vehicle_id IS NULL AND v.deleted_at IS NULL
  ), ranked AS (
    SELECT c.vid, c.conf, c.held, row_number() OVER (ORDER BY c.conf DESC, c.vid) AS rk
    FROM cand c
    WHERE c.held <> 'not_held'
  )
  SELECT r1.vid,
    CASE
      -- Only a recorded holding that covers taken_at may score above 0.5 (below the orchestrator's 0.7 assign bar).
      WHEN r1.held <> 'held' THEN LEAST(r1.conf, 0.5::numeric)
      -- Ambiguous: a 2nd distinct vehicle is within the margin, so GPS can't decide.
      WHEN r2.conf IS NOT NULL AND (r1.conf - r2.conf) < v_ambiguity_margin THEN LEAST(r1.conf, 0.5::numeric)
      ELSE r1.conf
    END
  FROM ranked r1
  LEFT JOIN ranked r2 ON r2.rk = 2
  WHERE r1.rk = 1;
END;
$function$;

COMMENT ON FUNCTION public.auto_match_image_to_vehicles(uuid, double precision, double precision, timestamp with time zone, uuid) IS
  'GPS-proximity vehicle matcher. Above 0.5 only for a vehicle the user held at p_taken_at '
  '(user_vehicle_possession_at = held) with no 2nd vehicle within 0.15; vehicles not held then, merged or deleted are '
  'not candidates (20261016220000, after 20260610011000 ambiguity guard). An end user is judged only as themselves.';

COMMIT;
