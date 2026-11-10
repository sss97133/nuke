-- Cover ranking alone must not reward uncited physical pose numbers.
-- The current BYOK contract has no measurement citation/calibration receipt.
-- Omit those two dimensions only from the in-memory score input. Preserve image
-- testimony, shared duplicate-selection scoring, eligibility and all other terms.
-- No reprocessing, schedules or fleet cover rewrite.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $guard$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.recompute_vehicle_primary_image(uuid)'::regprocedure) <> '5f22db4bceacaaac581d55b5a437d940'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.image_hero_score(jsonb,bigint)'::regprocedure) <> '82556c15e9cb5d0eebb03668e7b852ef' THEN
   RAISE EXCEPTION 'cover scorer owner drifted; review current definitions';
 END IF;
END $guard$;
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

  -- Tier 1 (quality-first): highest hero-scored CONFIRMED frame that has analysis.
  -- Best-of-set, burst-deduped by construction, date-independent.
  SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id
    AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
    AND image_vehicle_match_status = 'confirmed'
    AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
    AND image_url IS NOT NULL AND image_url <> ''
  ORDER BY public.image_hero_score(ai_scan_metadata
      #- '{byok_deep_analysis,camera_pose,azimuth_deg}'
      #- '{byok_deep_analysis,camera_pose,distance_est}', file_size) DESC, COALESCE(taken_at,created_at) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN v_tier := 'hero_score'; END IF;

  -- Tier 2: any CONFIRMED frame (no analysis yet) — latest.
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND image_vehicle_match_status = 'confirmed'
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'confirmed_any'; END IF;
  END IF;

  -- Tiers 3-4: no confirmed frames yet — prior behavior, but rank eligible owner frames
  -- by hero score (still excludes mismatch/unrelated) so the cover is the best available,
  -- not merely the newest.
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY public.image_hero_score(ai_scan_metadata
      #- '{byok_deep_analysis,camera_pose,azimuth_deg}'
      #- '{byok_deep_analysis,camera_pose,distance_est}', file_size) DESC, COALESCE(taken_at,created_at) DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_hero'; END IF;
  END IF;

  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_latest'; END IF;
  END IF;

  -- Tier 5: any approved non-dup image (scraped-only comps).
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(is_sensitive,false)=false
      AND COALESCE(vision_gate_status::text,'approved') NOT IN ('rejected_personal','rejected_misattributed','review_needed')
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(is_primary,false) DESC, COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'any_approved'; END IF;
  END IF;

  IF v_id IS NULL THEN
    -- No frame the public may read: a held frame must not stay the cover, so clear it rather than keep it.
    UPDATE vehicle_images SET is_primary = false
     WHERE vehicle_id = p_vehicle_id AND is_primary = true;
    IF FOUND OR v_old IS NOT NULL THEN
      UPDATE vehicles SET primary_image_url = NULL WHERE id = p_vehicle_id AND primary_image_url IS NOT NULL;
      RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS NOT NULL),'reason','no_public_frame','was',left(v_old,40));
    END IF;
    RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',false,'reason','no_candidate','primary',v_old);
  END IF;

  UPDATE vehicle_images SET is_primary=false WHERE vehicle_id=p_vehicle_id AND is_primary=true AND id<>v_id;
  UPDATE vehicle_images SET is_primary=true  WHERE id=v_id AND COALESCE(is_primary,false)=false;
  UPDATE vehicles SET primary_image_url=v_url WHERE id=p_vehicle_id AND primary_image_url IS DISTINCT FROM v_url;

  RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS DISTINCT FROM v_url),
    'tier',v_tier,'chosen_image_id',v_id,'taken_at',v_taken,'zone',v_zone,'was',left(v_old,40),'now',left(v_url,40));
END $function$;

COMMENT ON FUNCTION public.recompute_vehicle_primary_image(uuid) IS
 'Existing eligible cover selection. BYOK physical pose numbers are omitted only from cover score input: this contract has no measurement citation. Stored observations and shared image_hero_score used by duplicate owners are unchanged. Does not recompute any vehicle on migration.';
COMMIT;
