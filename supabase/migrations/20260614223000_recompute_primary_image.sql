-- Refined lead picker: a restoration is in flux, so the hero must show CURRENT
-- state — the latest analyzed owner photo — but prefer a full-car EXTERIOR shot
-- when a recent one exists (within 120d of the latest). Index-fast (rides
-- vehicle_images(vehicle_id, taken_at)); no unbounded full-vehicle sort.
CREATE OR REPLACE FUNCTION public.recompute_vehicle_primary_image(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_old text; v_any_taken timestamptz;
  v_id uuid; v_url text; v_taken timestamptz; v_zone text;
  c_owner text[] := ARRAY['iphoto','user_upload','capture_relay','capture_relay_ios','daily_receipt','photo_auto_sync','drop-folder'];
BEGIN
  SELECT primary_image_url INTO v_old FROM vehicles WHERE id = p_vehicle_id;

  -- The latest analyzed owner photo = current state (index-fast).
  SELECT taken_at INTO v_any_taken FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
    AND ai_processing_status IN ('analyzed','completed')
    AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
    AND image_url IS NOT NULL AND image_url <> '' AND taken_at IS NOT NULL
  ORDER BY taken_at DESC LIMIT 1;

  IF v_any_taken IS NULL THEN
    RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',false,
      'reason','no_owner_analyzed_candidate','primary',v_old);
  END IF;

  -- Prefer the latest EXTERIOR within the recent window (≤120d behind latest).
  SELECT id,image_url,taken_at,vehicle_zone INTO v_id,v_url,v_taken,v_zone
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
    AND ai_processing_status IN ('analyzed','completed')
    AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
    AND image_url IS NOT NULL AND image_url <> '' AND vehicle_zone ILIKE 'ext%'
    AND taken_at >= v_any_taken - interval '120 days'
  ORDER BY taken_at DESC LIMIT 1;

  -- No recent exterior → the absolute latest analyzed owner photo (current state).
  IF v_id IS NULL THEN
    SELECT id,image_url,taken_at,vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND ai_processing_status IN ('analyzed','completed')
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND image_url IS NOT NULL AND image_url <> '' AND taken_at IS NOT NULL
    ORDER BY taken_at DESC LIMIT 1;
  END IF;

  UPDATE vehicle_images SET is_primary=false WHERE vehicle_id=p_vehicle_id AND is_primary=true AND id<>v_id;
  UPDATE vehicle_images SET is_primary=true  WHERE id=v_id AND COALESCE(is_primary,false)=false;
  UPDATE vehicles SET primary_image_url=v_url WHERE id=p_vehicle_id AND primary_image_url IS DISTINCT FROM v_url;

  RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS DISTINCT FROM v_url),
    'chosen_image_id',v_id,'taken_at',v_taken,'zone',v_zone,'was',v_old,'now',v_url);
END;
$$;

-- Bulk repair / post-attribution refresh for one owner (call per-vehicle in a
-- loop if the owner has many vehicles — the all-at-once form can exceed the
-- statement timeout on large fleets).
CREATE OR REPLACE FUNCTION public.recompute_user_primaries(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE vid uuid; r jsonb; out jsonb := '[]'::jsonb;
BEGIN
  FOR vid IN
    SELECT DISTINCT id FROM vehicles
    WHERE owner_id = p_user_id OR user_id = p_user_id OR created_by_user_id = p_user_id
  LOOP
    r := public.recompute_vehicle_primary_image(vid);
    IF (r->>'changed')::boolean THEN out := out || jsonb_build_array(r); END IF;
  END LOOP;
  RETURN out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.recompute_vehicle_primary_image(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_user_primaries(uuid)        TO authenticated, service_role;
