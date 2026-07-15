-- Primary-image selection: prefer the actual confirmed subject, and use analysis
-- scene_type for "exterior" since vehicle_zone is largely unpopulated.
--
-- recompute_vehicle_primary_image picked the LATEST eligible owner photo, treating an
-- unclassified frame (image_vehicle_match_status NULL/'pending') the same as a confirmed
-- one. On libraries whose newest uploads are off-subject shop/parts/documentation photos,
-- the lead image kept landing on junk (observed live: a Mustang whose primary was a
-- "parts-bin hardware wall, no vehicle"; before that, a "garage bay, Mustang absent").
-- The old "prefer exterior" tier relied on vehicle_zone ILIKE 'ext%', but that column is
-- mostly NULL, so it never fired.
--
-- Fix: add a confirmed-subject-first preference, and detect "exterior" from the
-- deep-analysis scene_type ('body_exterior') in addition to vehicle_zone. Selection order:
--   1. latest CONFIRMED exterior (scene_type body_exterior OR zone ext*)
--   2. latest CONFIRMED (any view)
--   3. latest eligible owner exterior within 120d of the latest owner photo  [prior behavior]
--   4. latest eligible owner photo                                            [prior behavior]
--   5. any approved non-dup image (scraped-only comps)                        [prior behavior]
-- Eligibility everywhere still excludes mismatch/unrelated, duplicates, superseded, and
-- non-approved (attribution-gated, NOT analysis-gated). Confirmed-first means that once a
-- frame is classified as truly depicting the vehicle, it outranks an unclassified newer
-- frame — which is exactly what a lead image should be.

CREATE OR REPLACE FUNCTION public.recompute_vehicle_primary_image(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old text; v_latest timestamptz;
  v_id uuid; v_url text; v_taken timestamptz; v_zone text; v_tier text := 'none';
  c_owner text[] := ARRAY['iphoto','user_upload','capture_relay','capture_relay_ios','daily_receipt',
                          'photo_auto_sync','drop-folder','owner_import','user-submission','owner_submission'];
BEGIN
  SELECT primary_image_url INTO v_old FROM vehicles WHERE id = p_vehicle_id;

  -- Tier 1: latest CONFIRMED exterior (depth scene_type or zone).
  SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
    AND image_vehicle_match_status = 'confirmed'
    AND image_url IS NOT NULL AND image_url <> ''
    AND ((ai_scan_metadata->'byok_deep_analysis'->>'scene_type') = 'body_exterior' OR vehicle_zone ILIKE 'ext%')
  ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
  IF v_id IS NOT NULL THEN v_tier := 'confirmed_exterior'; END IF;

  -- Tier 2: latest CONFIRMED (any view).
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND image_vehicle_match_status = 'confirmed'
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'confirmed_any'; END IF;
  END IF;

  -- Tiers 3-4: prior behavior — latest eligible OWNER photo, exterior-preferred.
  IF v_id IS NULL THEN
    SELECT COALESCE(taken_at, created_at) INTO v_latest
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at, created_at) DESC LIMIT 1;

    IF v_latest IS NOT NULL THEN
      SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
      FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
        AND COALESCE(vision_gate_status,'approved') = 'approved'
        AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
        AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
        AND image_url IS NOT NULL AND image_url <> ''
        AND ((ai_scan_metadata->'byok_deep_analysis'->>'scene_type') = 'body_exterior' OR vehicle_zone ILIKE 'ext%')
        AND COALESCE(taken_at,created_at) >= v_latest - interval '120 days'
      ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
      IF v_id IS NOT NULL THEN v_tier := 'owner_exterior'; END IF;

      IF v_id IS NULL THEN
        SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
        FROM vehicle_images
        WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
          AND COALESCE(vision_gate_status,'approved') = 'approved'
          AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
          AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
          AND image_url IS NOT NULL AND image_url <> ''
        ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
        IF v_id IS NOT NULL THEN v_tier := 'owner_latest'; END IF;
      END IF;
    END IF;
  END IF;

  -- Tier 5: any approved non-dup image (scraped-only comps).
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(is_primary,false) DESC, COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'any_approved'; END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',false,'reason','no_candidate','primary',v_old);
  END IF;

  UPDATE vehicle_images SET is_primary=false WHERE vehicle_id=p_vehicle_id AND is_primary=true AND id<>v_id;
  UPDATE vehicle_images SET is_primary=true  WHERE id=v_id AND COALESCE(is_primary,false)=false;
  UPDATE vehicles SET primary_image_url=v_url WHERE id=p_vehicle_id AND primary_image_url IS DISTINCT FROM v_url;

  RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS DISTINCT FROM v_url),
    'tier',v_tier,'chosen_image_id',v_id,'taken_at',v_taken,'zone',v_zone,'was',left(v_old,40),'now',left(v_url,40));
END $function$;
