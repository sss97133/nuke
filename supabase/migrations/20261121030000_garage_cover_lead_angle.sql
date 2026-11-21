-- Garage covers open on one lead angle (owner, 2026-11-20: "id like all images are a lead angle thats consistent so
-- it looks goo so theres some kind of continuity across cards").
--
-- Measured 2026-11-20 on the owner's garage (get_user_garage, 138 cars): 124 get a cover from this reader; 35 of those
-- covers are front three-quarter driver-side views today (vehicle_zone = ext_front_driver), and 58 of the 124 hold an
-- admissible one (55 whose view reading agrees). exterior_three_quarter alone (86 of 124) does not say front or rear,
-- so it is the third tier, after the passenger-side front corner. Cars with no lead angle keep the v2 order, with the
-- owner's primary photo first.
--
-- Same signature, same admission, same gallery gate; only the ORDER BY changes. Display preference only: it files no
-- image and establishes nothing about the vehicle. Explicit account cover statements remain the final override in
-- applyGarageOwnerCorrections.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF encode(extensions.digest(pg_get_functiondef('public.get_first_image_batch(uuid[])'::regprocedure), 'sha256'), 'base64')
      <> 'lPl2ECJftKAkaYeatu2a+kQQggERNDO8ljBzLPeh8I8=' THEN
    RAISE EXCEPTION 'get_first_image_batch changed since the reviewed live definition';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.get_first_image_batch(vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, image_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT wanted.vehicle_id, cover.image_url
  FROM (SELECT DISTINCT unnest(vehicle_ids) AS vehicle_id) wanted
  CROSS JOIN LATERAL (
    SELECT admitted.image_url
    FROM (
    SELECT vi.id
    FROM public.vehicle_images_public vi
    WHERE vi.vehicle_id = wanted.vehicle_id
      AND vi.image_url IS NOT NULL
      AND vi.is_document IS NOT TRUE
      AND vi.is_duplicate IS NOT TRUE
      AND vi.is_superseded IS NOT TRUE
      AND vi.is_video IS NOT TRUE
      -- Preserve the existing cover source policy. Native capture relay is
      -- also a supported supplied-photo path; publication eligibility still
      -- applies below and source labels never establish ownership.
      AND coalesce(vi.source, '') NOT IN ('ssd_blast', 'drop-folder', 'hd_archive')
      AND (vi.is_primary = true OR vi.source IN
        ('iphoto', 'user_upload', 'manual', 'tech_capture', 'photo_auto_sync', 'capture_relay_ios'))
      AND coalesce(vi.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated')
      AND lower(coalesce(vi.image_medium, '')) NOT IN
        ('rendering', 'illustration', 'drawing', 'screenshot', 'document', 'logo')
      AND lower(coalesce(vi.image_category, '')) NOT IN
        ('documentation', 'document', 'receipt', 'screenshot', 'brochure', 'illustration', 'rendering', 'logo')
    ORDER BY
      -- The lead angle first, so every card that has one opens on the same view: the front three-quarter from
      -- the driver's side, then from the other front corner, then a three-quarter view no reading placed at the
      -- rear. A view reading or a zone reading is display evidence only; it decides no fact about the car.
      CASE
        WHEN vi.image_category IN ('interior', 'engine_mechanical', 'undercarriage', 'exterior_detail')
          OR coalesce(vi.ai_detected_angle, '') LIKE 'interior_%' THEN 9
        WHEN vi.vehicle_zone = 'ext_front_driver'
          AND coalesce(vi.ai_detected_angle, vi.angle, 'exterior_three_quarter') IN
            ('exterior_three_quarter', 'front_three_quarter', 'front_3quarter', 'front_3quarter_driver') THEN 0
        WHEN vi.vehicle_zone IN ('ext_front_passenger', 'ext_front_3q')
          AND coalesce(vi.ai_detected_angle, vi.angle, 'exterior_three_quarter') IN
            ('exterior_three_quarter', 'front_three_quarter', 'front_3quarter', 'front_3quarter_passenger') THEN 1
        WHEN coalesce(vi.ai_detected_angle, vi.angle) IN
            ('exterior_three_quarter', 'front_three_quarter', 'front_3quarter', 'front_3quarter_driver', 'front_3quarter_passenger')
          AND coalesce(vi.vehicle_zone, '') NOT LIKE 'ext_rear%' THEN 2
        ELSE 9
      END,
      -- Without a lead angle, the owner's chosen primary; then the v2 cover order.
      vi.is_primary DESC NULLS LAST,
      CASE
        WHEN vi.image_category IN ('interior', 'engine_mechanical', 'undercarriage', 'exterior_detail')
          OR coalesce(vi.ai_detected_angle, '') LIKE 'interior_%' THEN 3
        WHEN vi.ai_detected_angle IN
          ('exterior_three_quarter', 'front_three_quarter', 'rear_three_quarter',
           'exterior_front', 'front', 'exterior_side', 'side_profile', 'exterior_rear', 'rear') THEN 0
        WHEN vi.image_category = 'exterior_body' THEN 1
        ELSE 2
      END,
      vi.is_primary DESC NULLS LAST,
      vi.photo_quality_score DESC NULLS LAST,
      vi.taken_at DESC NULLS LAST,
      vi.created_at DESC NULLS LAST,
      vi.id
    -- Rank first, then test admission in order until one cover qualifies.
    -- OFFSET prevents the gate from being pushed ahead of this ordering.
    OFFSET 0
    ) ranked
    CROSS JOIN LATERAL (
      SELECT vi.image_url
      FROM public.vehicle_images_public vi
      WHERE vi.id = ranked.id AND vi.vehicle_id = wanted.vehicle_id
        AND vi.vehicle_image_gallery_eligible = true
      OFFSET 0
    ) admitted
    LIMIT 1
  ) cover
  ORDER BY wanted.vehicle_id;
$function$;

COMMENT ON FUNCTION public.get_first_image_batch(uuid[]) IS
  'Garage cover display v3: the lead angle first (front three-quarter, driver side, then the other front corner, then a three-quarter view not placed at the rear), then the primary photo, then the v2 order (photographic exterior views, exterior bodies, unknown views, detail/interior fallback; retained quality, source clocks and stable ID break ties). Existing viewer RLS and gallery eligibility apply; no image or ownership testimony is changed.';

COMMIT;
