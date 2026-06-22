-- Data-derived image quality ("hero") score + quality-first primary-image selection.
--
-- The lead image was chosen by RECENCY ("latest confirmed exterior"), which on a burst
-- picks the last frame, not the best, and with broken dates smears build-era and
-- finished-era shots together. "Best" is not a policy to hard-code — it is *measured from
-- the data the analysis already produced*: camera_pose (framing/distance/angle), presence
-- (people/pets), state_observations.completeness, build_phase_guess, and resolution.
--
-- image_hero_score(meta, file_size) turns those signals into one number:
--   + full-vehicle exterior (scene_type), assembled, finished build phase
--   + framed as a whole car (~2–4 m) at a three-quarter/profile angle
--   - close-up / rotated / window-cowl-decklid crops, people or pets in frame
--   + a small resolution/confidence nudge
-- It is IMMUTABLE (depends only on its inputs) so it can be used in ORDER BY / indexes.
--
-- recompute_vehicle_primary_image then selects the highest-scoring CONFIRMED frame as the
-- cover (best-of-set), falling back to the prior recency tiers only when nothing is
-- classified yet. Picking the single max score also means the cover is burst-deduped by
-- construction. No date dependency: quality drives the cover, not upload time.

CREATE OR REPLACE FUNCTION public.image_hero_score(meta jsonb, fsize bigint)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  a jsonb := meta->'byok_deep_analysis';
  s numeric := 0;
  framing text; az numeric; dist numeric;
BEGIN
  IF a IS NULL THEN RETURN 0; END IF;
  framing := coalesce(a->'camera_pose'->>'framing','');
  BEGIN az := nullif(a->'camera_pose'->>'azimuth_deg','')::numeric; EXCEPTION WHEN others THEN az := NULL; END;
  BEGIN dist := nullif(regexp_replace(coalesce(a->'camera_pose'->>'distance_est',''),'[^0-9.]','','g'),'')::numeric; EXCEPTION WHEN others THEN dist := NULL; END;

  -- what the frame is OF: a whole-vehicle exterior is the hero material
  s := s + CASE a->>'scene_type'
             WHEN 'body_exterior' THEN 1.5
             WHEN 'body_interior' THEN 0.3
             ELSE 0 END;
  -- the car as a finished, whole object
  s := s + CASE WHEN a->'state_observations'->>'completeness' = 'assembled' THEN 0.5 ELSE 0 END;
  s := s + CASE WHEN a->>'build_phase_guess' IN ('final_assembly','drivable','show_finish') THEN 0.5 ELSE 0 END;
  -- framed as a whole car, not a close-up
  s := s + CASE WHEN dist BETWEEN 2 AND 4 THEN 1.0
                WHEN dist BETWEEN 1.5 AND 5 THEN 0.5
                ELSE 0.15 END;
  -- three-quarter/profile angle reads best; head-on/rear-flat less so
  IF az IS NOT NULL THEN
    s := s + (1 - least(least(abs(az-45), least(abs(az-135), least(abs(az-225), abs(az-315)))), 90) / 90.0) * 0.8;
  END IF;
  -- framing language: reward whole-car shots, punish crops / orientation problems / clutter
  s := s + CASE WHEN framing ~* '(profile|three-quarter|3/4|full)' THEN 0.4 ELSE 0 END;
  s := s + CASE WHEN framing ~* '(rotated|window|cowl|windshield|roof and rear|decklid|opening|macro|close)' THEN -0.7 ELSE 0 END;
  s := s + CASE WHEN framing ~* '(dog|tools|packaging|clutter)' THEN -0.3 ELSE 0 END;
  -- people in a hero shot are a distraction
  s := s + CASE WHEN a->'presence'->>'person' = 'true' THEN -1.0 ELSE 0 END;
  -- small nudges: analyst confidence + resolution proxy
  BEGIN s := s + coalesce((a->>'confidence')::numeric, 0) * 0.3; EXCEPTION WHEN others THEN NULL; END;
  s := s + coalesce(fsize, 0) / 1.0e7;
  RETURN s;
END $$;

COMMENT ON FUNCTION public.image_hero_score(jsonb, bigint) IS
  'Data-derived quality score for a frame as a cover/hero image, from byok_deep_analysis camera_pose/presence/state + resolution. Higher = better whole-car exterior. IMMUTABLE.';

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
    AND image_vehicle_match_status = 'confirmed'
    AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
    AND image_url IS NOT NULL AND image_url <> ''
  ORDER BY public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN v_tier := 'hero_score'; END IF;

  -- Tier 2: any CONFIRMED frame (no analysis yet) — latest.
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

  -- Tiers 3-4: no confirmed frames yet — prior behavior, but rank eligible owner frames
  -- by hero score (still excludes mismatch/unrelated) so the cover is the best available,
  -- not merely the newest.
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_hero'; END IF;
  END IF;

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
