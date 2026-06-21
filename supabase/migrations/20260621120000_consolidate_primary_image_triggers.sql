-- Consolidate primary-image selection on vehicle_images.
--
-- PROBLEM (measured 2026-06-21): FIVE competing triggers set the primary image with
-- contradictory rules — auto_set_primary_image (arbitrary first row),
-- sync_vehicle_primary_image (oldest-first, created_at ASC),
-- set_first_image_as_primary_if_none (newest-first, taken_at DESC),
-- set_vehicle_primary_image_from_vehicle_images (only-if-missing). They raced on every
-- write, producing "random" lead-image promotion and a garage/profile mismatch: the
-- garage reads vehicles.primary_image_url (set oldest-first) while the profile reads the
-- is_primary row (set newest-first), so they disagreed. recompute_vehicle_primary_image
-- (the only correct chooser) was an RPC that nothing called automatically, and it gated
-- on analysis completion, so a brand-new photo couldn't become primary until analyzed.
--
-- FIX: one deterministic rule. The primary is the latest APPROVED OWNER photo (prefer a
-- recent exterior), gated on ATTRIBUTION (vision_gate approved), NOT on analysis. We
-- swap function bodies only (no CREATE/DROP TRIGGER) because vehicle_images is a large
-- hot table where acquiring ACCESS EXCLUSIVE for DDL times out; the existing
-- trg_sync_vehicle_primary_image (AFTER INSERT/UPDATE/DELETE) is repurposed as the sole
-- maintainer, and the other three choosers are neutered to no-ops. trigger_ensure_single
-- _primary_image is kept (harmless single-primary guard). Applied live + backfilled the
-- test user's 97 vehicles: garage≠profile 3→0, zero_primary 2→0, idempotent (0 still
-- changing).

CREATE OR REPLACE FUNCTION public.recompute_vehicle_primary_image(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_old text; v_latest timestamptz;
  v_id uuid; v_url text; v_taken timestamptz; v_zone text;
  c_owner text[] := ARRAY['iphoto','user_upload','capture_relay','capture_relay_ios','daily_receipt',
                          'photo_auto_sync','drop-folder','owner_import','user-submission','owner_submission'];
BEGIN
  SELECT primary_image_url INTO v_old FROM vehicles WHERE id = p_vehicle_id;

  -- Latest eligible OWNER photo. Gated on ATTRIBUTION (vision_gate approved), NOT on
  -- analysis completion — a brand-new approved photo is the primary immediately.
  SELECT COALESCE(taken_at, created_at) INTO v_latest
  FROM vehicle_images
  WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
    AND COALESCE(vision_gate_status,'approved') = 'approved'
    AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
    AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
    AND image_url IS NOT NULL AND image_url <> ''
  ORDER BY COALESCE(taken_at, created_at) DESC LIMIT 1;

  IF v_latest IS NULL THEN
    -- No owner photo (e.g. scraped-only comp): fall back to any approved non-dup image.
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(is_primary,false) DESC, COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',false,'reason','no_candidate','primary',v_old);
    END IF;
  ELSE
    -- Prefer the latest EXTERIOR within 120d of the latest owner photo; else the latest owner photo.
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND image_url IS NOT NULL AND image_url <> '' AND vehicle_zone ILIKE 'ext%'
      AND COALESCE(taken_at,created_at) >= v_latest - interval '120 days'
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;

    IF v_id IS NULL THEN
      SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
      FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
        AND COALESCE(vision_gate_status,'approved') = 'approved'
        AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
        AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
        AND image_url IS NOT NULL AND image_url <> ''
      ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    END IF;
  END IF;

  UPDATE vehicle_images SET is_primary=false WHERE vehicle_id=p_vehicle_id AND is_primary=true AND id<>v_id;
  UPDATE vehicle_images SET is_primary=true  WHERE id=v_id AND COALESCE(is_primary,false)=false;
  UPDATE vehicles SET primary_image_url=v_url WHERE id=p_vehicle_id AND primary_image_url IS DISTINCT FROM v_url;

  RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'changed',(v_old IS DISTINCT FROM v_url),
    'chosen_image_id',v_id,'taken_at',v_taken,'zone',v_zone,'was',left(v_old,40),'now',left(v_url,40));
END $function$;

-- Sole maintainer (repurposes the existing AFTER INSERT/UPDATE/DELETE trigger function).
CREATE OR REPLACE FUNCTION public.sync_vehicle_primary_image()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_vehicle uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;   -- stop self-recursion
  v_vehicle := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  IF v_vehicle IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- On UPDATE, skip unless a field that affects selection changed.
  IF TG_OP = 'UPDATE'
     AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id
     AND NEW.is_primary IS NOT DISTINCT FROM OLD.is_primary
     AND NEW.vision_gate_status IS NOT DISTINCT FROM OLD.vision_gate_status
     AND NEW.is_duplicate IS NOT DISTINCT FROM OLD.is_duplicate
     AND NEW.is_superseded IS NOT DISTINCT FROM OLD.is_superseded
     AND NEW.image_vehicle_match_status IS NOT DISTINCT FROM OLD.image_vehicle_match_status
     AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url
     AND NEW.taken_at IS NOT DISTINCT FROM OLD.taken_at THEN
    RETURN NEW;
  END IF;

  PERFORM recompute_vehicle_primary_image(v_vehicle);
  IF TG_OP = 'UPDATE' AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id AND OLD.vehicle_id IS NOT NULL THEN
    PERFORM recompute_vehicle_primary_image(OLD.vehicle_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- Neuter the three conflicting choosers (their triggers still fire but do nothing).
CREATE OR REPLACE FUNCTION public.auto_set_primary_image()
RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RETURN NEW; END $function$;

CREATE OR REPLACE FUNCTION public.set_vehicle_primary_image_from_vehicle_images()
RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RETURN NEW; END $function$;

CREATE OR REPLACE FUNCTION public.set_first_image_as_primary_if_none()
RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RETURN NEW; END $function$;