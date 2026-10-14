-- vehicle_card_images: one thumbnail per vehicle for a list of vehicles, read through the indexes, not sorted from every image.
--
-- Measured 2026-10-14. The organization pages (OrganizationProfile, in chunks of 200 vehicle ids; OrganizationAuctionsTab,
-- up to 600) read every image of every listed vehicle only to keep the first per vehicle:
--   select vehicle_id, thumbnail_url, medium_url, image_url, variants, is_primary, created_at from vehicle_images
--   where vehicle_id = any($1) order by is_primary desc, created_at asc          -- PostgREST adds limit 1000
-- pg_stat_statements since 2026-09-29 09:20Z: authenticated 34 calls, mean 7,950 ms, max 14,385 ms; anon 15 calls, mean
-- 2,579 ms, max 6,189 ms. As authenticated for 200 image-rich vehicles: 5,389 ms cold, 458 ms warm (one earlier run timed
-- out at 10 s); the same 200 as anon 383 ms warm.
-- Cause: the order by cannot use an index across 200 vehicles, so the planner reads every image of all of them (48,763 rows
-- estimated, at 80-400 images a vehicle) and evaluates the row policies on each. For an authenticated caller that is the
-- policy chain: the caller's own images, an EXISTS over vehicles for the owner, an EXISTS over the organization tables,
-- and the public gate with an EXISTS over vehicles. The page then keeps one row per vehicle and drops the rest, and
-- PostgREST's 1,000-row cap means vehicles past the cap got no thumbnail at all (12 of 200 in the sample above).
--
-- This reader answers the question the pages ask: for each vehicle, the primary image the caller can see, else the earliest
-- one the caller can see. It reads vehicles once, then per vehicle one probe of idx_vehicle_images_vehicle_primary
-- (vehicle_id, is_primary, created_at) WHERE is_primary and, only if that finds none, one backward probe of
-- idx_vehicle_images_created_at (vehicle_id, created_at DESC). Cold, as authenticated, 200 image-rich vehicles: 577 ms
-- (the old query on a comparable set: 5,389 ms); warm 8.4 ms (458 ms). For every vehicle the old query covered (188 of 200)
-- the chosen image was identical, as authenticated and as anon; the other 12 now get one.
-- It is flat, not free: about 2 ms a vehicle cold (one vehicle probe plus one or two image probes), so 200 vehicles take 0.25-0.6 s
-- whatever their image counts. On real 200-vehicle chunks of four organizations the old read took 143-196 ms for a thin one
-- (the reader 265-288 ms) and 640-960 ms for three image-rich ones (the reader 410-600 ms); for the six heaviest vehicles
-- (12-14k images each) 2,477 ms against 9.8 ms.
--
-- SECURITY DEFINER with the visibility rule inside, the four SELECT policies of vehicle_images that apply to a row with a
-- vehicle, evaluated per vehicle instead of per image:
--   * the caller's own image (user_id = auth.uid());
--   * the caller's own vehicle (vehicles.user_id, uploaded_by or owner_id = auth.uid());
--   * a vehicle of an organization the caller is an active contributor of (the org tables are publicly selectable);
--   * a public vehicle's image that is not sensitive, not superseded, and not held by the vision gate
--     (rejected_personal, rejected_misattributed, review_needed), as #1107 set it.
-- The caller is resolved once from auth.uid(); anon gets the last rule alone. Nothing of another user's private rows is
-- returned. Difference from the old ordering: is_primary NULL (none in a 0.02% sample of 11,107 rows) counts as not primary.
-- At most 1,000 distinct ids are read per call; the pages send at most 600.
-- Pure addition: one function and its grants. No table, policy, index, row or cron change.
-- Contract: supabase/sql/test_vehicle_card_images.sql (CI job vehicle-card-images-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

DO $guard$ BEGIN
  IF to_regclass('public.idx_vehicle_images_vehicle_primary') IS NULL
     OR to_regclass('public.idx_vehicle_images_created_at') IS NULL THEN
    RAISE EXCEPTION 'vehicle_card_images relies on idx_vehicle_images_vehicle_primary and idx_vehicle_images_created_at; one is missing';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.vehicle_card_images(p_vehicle_ids uuid[])
RETURNS TABLE (
  vehicle_id uuid,
  thumbnail_url text,
  medium_url text,
  image_url text,
  variants jsonb,
  is_primary boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT (SELECT auth.uid()) AS uid),
  ids AS (
    SELECT DISTINCT u.id
    FROM unnest(p_vehicle_ids) AS u(id)
    WHERE u.id IS NOT NULL
    LIMIT 1000
  ),
  veh AS (
    SELECT v.id, v.is_public,
           me.uid,
           (me.uid IS NOT NULL AND (
              v.user_id = me.uid OR v.uploaded_by = me.uid OR v.owner_id = me.uid
              OR EXISTS (SELECT 1
                         FROM organization_vehicles ov
                         JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
                         WHERE ov.vehicle_id = v.id AND oc.user_id = me.uid AND oc.status = 'active')
           )) AS mine
    FROM ids
    JOIN vehicles v ON v.id = ids.id
    CROSS JOIN me
  )
  SELECT best.vehicle_id, best.thumbnail_url, best.medium_url, best.image_url, best.variants, best.is_primary, best.created_at
  FROM veh
  CROSS JOIN LATERAL (
    -- the primary image if the caller can see one, else the earliest the caller can see
    (SELECT i.vehicle_id, i.thumbnail_url, i.medium_url, i.image_url, i.variants, i.is_primary, i.created_at
       FROM vehicle_images i
      WHERE i.vehicle_id = veh.id
        AND i.is_primary
        AND (veh.mine OR i.user_id = veh.uid
             OR (veh.is_public AND NOT i.is_sensitive AND i.is_superseded IS NOT TRUE
                 AND (i.vision_gate_status IS NULL
                      OR i.vision_gate_status NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed'))))
      ORDER BY i.created_at ASC
      LIMIT 1)
    UNION ALL
    (SELECT i.vehicle_id, i.thumbnail_url, i.medium_url, i.image_url, i.variants, i.is_primary, i.created_at
       FROM vehicle_images i
      WHERE i.vehicle_id = veh.id
        AND (veh.mine OR i.user_id = veh.uid
             OR (veh.is_public AND NOT i.is_sensitive AND i.is_superseded IS NOT TRUE
                 AND (i.vision_gate_status IS NULL
                      OR i.vision_gate_status NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed'))))
      ORDER BY i.created_at ASC
      LIMIT 1)
    LIMIT 1
  ) best
$$
;

REVOKE ALL ON FUNCTION public.vehicle_card_images(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_card_images(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.vehicle_card_images(uuid[]) IS
  'One image per listed vehicle for a card or a row: the primary image the caller can see, else the earliest one the caller can see (thumbnail_url, medium_url, image_url, variants, is_primary, created_at). Visibility is the vehicle_images SELECT policies for a row with a vehicle, applied per vehicle: own image, own vehicle (user_id, uploaded_by, owner_id), vehicle of an organization the caller actively contributes to, or a public vehicle''s image that is not sensitive, superseded or held by the vision gate. SECURITY DEFINER; the caller comes from auth.uid(), anon gets the public rule only. Up to 1,000 distinct ids per call. Replaces a read of every image of every listed vehicle sorted by is_primary desc, created_at asc (5,389 ms cold for 200 vehicles as authenticated, 2026-10-14). Used by the organization pages.';

COMMIT;

-- Live verification (after apply), as anon and as authenticated through PostgREST:
--   POST /rest/v1/rpc/vehicle_card_images {"p_vehicle_ids":["<a vehicle id>", ...]}   -- one row per vehicle that has a visible image
