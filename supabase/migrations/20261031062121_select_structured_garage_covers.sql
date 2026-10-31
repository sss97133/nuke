BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF encode(digest(pg_get_functiondef('public.get_first_image_batch(uuid[])'::regprocedure), 'sha256'), 'base64')
      NOT IN ('AHdlNKU0QYDca6HzHU5I9rOQ5KsgweWIAVTuErYNp9I=', 'lPl2ECJftKAkaYeatu2a+kQQggERNDO8ljBzLPeh8I8=') THEN
    RAISE EXCEPTION 'get_first_image_batch changed since the reviewed live definition';
  END IF;
END
$guard$;

-- This is a display preference over the existing admitted gallery. It neither
-- files images nor establishes vehicle identity. Explicit account cover
-- statements remain the final override in applyGarageOwnerCorrections.
CREATE OR REPLACE FUNCTION public.get_first_image_batch(vehicle_ids uuid[])
RETURNS TABLE(vehicle_id uuid, image_url text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
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
  'Garage cover display v2: eligible photographic exterior views, then exterior bodies, unknown views and detail/interior fallback; primary, retained quality, source clocks and stable ID break ties. Existing viewer RLS and gallery eligibility apply; no image or ownership testimony is changed.';

COMMIT;
