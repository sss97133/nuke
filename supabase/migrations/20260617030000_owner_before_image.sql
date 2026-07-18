-- Owner-designated "before" image for the build before/after.
--
-- The vehicle profile's before/after picked the EARLIEST taken_at frame — but EXIF
-- dates are unreliable (defaulted/clustered: the K5 has 6+ frames stamped the same
-- 2016-04-23), so it grabbed the wrong shot. The owner knows the true first/acquisition
-- image; only owner-designation is ground truth (per the lead-image-is-owner-confirmed
-- rule). This owner-gated writer marks the before image as a vehicle_observation
-- (kind=media, role=before_image) — testimony, superseded (never deleted) when reset.
-- loadBookends prefers this designation over min(taken_at).

CREATE OR REPLACE FUNCTION public.set_vehicle_before_image(p_vehicle_id uuid, p_image_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_uid uuid := auth.uid(); v_owns boolean; v_source uuid; v_obs uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth_required'); END IF;
  SELECT (
    EXISTS(SELECT 1 FROM vehicle_ownerships WHERE vehicle_id=p_vehicle_id AND owner_profile_id=v_uid AND is_current=true)
    OR EXISTS(SELECT 1 FROM vehicles WHERE id=p_vehicle_id AND (user_id=v_uid OR owner_id=v_uid))
  ) INTO v_owns;
  IF NOT coalesce(v_owns,false) THEN RETURN jsonb_build_object('ok', false, 'error', 'not_owner'); END IF;
  IF NOT EXISTS(SELECT 1 FROM vehicle_images WHERE id=p_image_id AND vehicle_id=p_vehicle_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'image_mismatch');
  END IF;
  UPDATE vehicle_observations SET is_superseded=true, superseded_at=now()
   WHERE vehicle_id=p_vehicle_id AND kind='media'
     AND structured_data->>'role'='before_image' AND is_superseded IS NOT TRUE;
  SELECT id INTO v_source FROM observation_sources WHERE slug='owner-input';
  INSERT INTO vehicle_observations (
    vehicle_id, observed_at, source_id, kind, content_hash, structured_data,
    confidence, confidence_score, submitted_by_user_id, observer_raw
  ) VALUES (
    p_vehicle_id, now(), v_source, 'media',
    md5('before_image|'||p_vehicle_id::text||'|'||p_image_id::text||'|'||clock_timestamp()::text),
    jsonb_build_object('role','before_image','image_id',p_image_id::text,'authored','user_interaction'),
    'high', 0.95, v_uid, jsonb_build_object('user_id', v_uid)
  ) RETURNING id INTO v_obs;
  RETURN jsonb_build_object('ok', true, 'observation_id', v_obs, 'image_id', p_image_id);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.set_vehicle_before_image(uuid, uuid) TO authenticated;
