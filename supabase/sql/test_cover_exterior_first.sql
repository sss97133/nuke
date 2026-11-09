-- Cover chooser exterior-first (20261113100000): among the frames recompute_vehicle_primary_image may already use, a
-- whole-vehicle exterior beats a newer interior, engine bay, close-up, VIN plate or paperwork; eligibility is unchanged
-- (a held or personal exterior never becomes the cover); the revert restores the old newest-first choice.
-- Requires empty disposable dm_refinement_cover_exterior_first* database.
\set ON_ERROR_STOP on
SET client_min_messages = warning;
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_cover_exterior_first%' THEN RAISE EXCEPTION 'refusing: not a disposable contract database'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, primary_image_url text);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, image_url text, source text, taken_at timestamptz,
  created_at timestamptz DEFAULT now(), vehicle_zone text, file_size bigint, is_primary boolean DEFAULT false,
  is_superseded boolean, is_duplicate boolean, is_sensitive boolean, is_document boolean, vision_gate_status text,
  image_vehicle_match_status text, ai_scan_metadata jsonb DEFAULT '{}');
CREATE TABLE public.image_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, vehicle_id uuid,
  observed_by text, is_active boolean DEFAULT true, confidence_basis jsonb, observed_at timestamptz DEFAULT now());
CREATE FUNCTION public.image_hero_score(meta jsonb, fsize bigint) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 0::numeric $$;

-- the 20261016151000 cover chooser, verbatim
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
  ORDER BY public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
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

SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.recompute_vehicle_primary_image(uuid)'::regprocedure)) = '0abc418f16fa239c346397f060bba3e9', 'stand-in body matches the live fingerprint the migration pins');

INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000a1', 'old-cover');
INSERT INTO vehicle_images(id, vehicle_id, image_url, source, taken_at, vision_gate_status, is_document, ai_scan_metadata) VALUES
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'u-exterior', 'iphoto', '2024-01-01', 'approved', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'u-closeup', 'iphoto', '2024-04-18', 'approved', false, '{"classification":{"image_type":"detail_closeup"}}'),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', 'u-receipt', 'iphoto', '2025-10-19', NULL, false, '{"classification":{"image_type":"receipt_document"}}'),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a1', 'u-held-exterior', 'iphoto', '2026-03-26', 'review_needed', false, '{"classification":{"image_type":"vehicle_exterior"}}'),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', 'u-personal-exterior', 'iphoto', '2026-03-27', 'rejected_personal', false, '{"classification":{"image_type":"vehicle_exterior"}}');

SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles) = 'u-receipt', 'before: the old chooser takes the newest owner frame, a receipt');

\i supabase/migrations/20261113100000_cover_exterior_first.sql
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.image_cover_rank(jsonb, boolean)', 'EXECUTE'), 'anon cannot call the rank');
SELECT pg_temp.assert_true(public.image_cover_rank('{"classification":{"image_type":"vehicle_exterior"}}', false) = 0
  AND public.image_cover_rank('{"byok_deep_analysis":{"scene_type":"body_exterior"}}', false) = 0
  AND public.image_cover_rank('{}', false) = 1
  AND public.image_cover_rank('{"classification":{"image_type":"engine_bay"}}', false) = 2
  AND public.image_cover_rank('{"classification":{"image_type":"vin_plate"}}', false) = 3
  AND public.image_cover_rank('{"classification":{"image_type":"vehicle_exterior"}}', true) = 3, 'rank order: exterior, unclassified, other views, paperwork');

SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000a1') AS r \gset
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles) = 'u-exterior', 'after: the exterior is the cover, though older');
SELECT pg_temp.assert_true((SELECT count(*) FROM vehicle_images WHERE is_primary) = 1 AND (SELECT is_primary FROM vehicle_images WHERE image_url = 'u-exterior'), 'exactly one is_primary, on the exterior');
SELECT pg_temp.assert_true((:'r')::jsonb->>'tier' = 'owner_latest', 'same tier as before: eligibility unchanged');

UPDATE vehicle_images SET vision_gate_status = 'review_needed' WHERE image_url = 'u-exterior';
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles) = 'u-closeup', 'a held exterior is never the cover; a vehicle view beats the receipt');
UPDATE vehicle_images SET vision_gate_status = 'approved' WHERE image_url = 'u-exterior';

-- Unlabelled frames: the local analysis pass's active view label ranks them; the classifier still wins where it has a label.
CREATE FUNCTION pg_temp.obs(img text, view text, vc numeric, pv numeric, run text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.image_observations(image_id, observed_by, confidence_basis) VALUES (img::uuid, 'local_image_analysis_v1',
    jsonb_build_object('local_image_analysis_v1', jsonb_build_object('run_id', run, 'reading', jsonb_build_object('view', view, 'view_confidence', vc, 'p_vehicle', pv)))) $$;
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000b1', 'old-cover-b');
INSERT INTO vehicle_images(id, vehicle_id, image_url, source, taken_at, vision_gate_status, ai_scan_metadata) VALUES
 ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000b1', 'b-local-exterior', 'iphoto', '2024-01-01', 'approved', '{}'),
 ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-0000000000b1', 'b-no-reading', 'iphoto', '2024-06-01', 'approved', '{}'),
 ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-0000000000b1', 'b-local-detail', 'iphoto', '2025-01-01', 'approved', '{}'),
 ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-0000000000b1', 'b-local-person', 'iphoto', '2025-06-01', 'approved', '{}'),
 ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-0000000000b1', 'b-weak-exterior', 'iphoto', '2026-01-01', 'approved', '{}'),
 ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-0000000000b1', 'b-classified-engine', 'iphoto', '2026-02-01', 'approved', '{"classification":{"image_type":"engine_bay"}}');
SELECT pg_temp.obs('00000000-0000-4000-8000-000000000011', 'exterior_side', 0.71, 0.93, '192ec5d8');
SELECT pg_temp.obs('00000000-0000-4000-8000-000000000013', 'detail', 0.6, 0.9, '192ec5d8');
SELECT pg_temp.obs('00000000-0000-4000-8000-000000000014', 'person', 0.8, 0.1, '192ec5d8');
SELECT pg_temp.obs('00000000-0000-4000-8000-000000000015', 'exterior_front', 0.22, 0.9, '192ec5d8');
SELECT pg_temp.obs('00000000-0000-4000-8000-000000000016', 'exterior_front', 0.9, 0.95, '192ec5d8');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.image_cover_rank(uuid, jsonb, boolean)', 'EXECUTE'), 'anon cannot call the labelled rank');
SELECT pg_temp.assert_true(
      public.image_cover_rank('00000000-0000-4000-8000-000000000011'::uuid, '{}', false) = 0
  AND public.image_cover_rank('00000000-0000-4000-8000-000000000012'::uuid, '{}', false) = 1
  AND public.image_cover_rank('00000000-0000-4000-8000-000000000013'::uuid, '{}', false) = 2
  AND public.image_cover_rank('00000000-0000-4000-8000-000000000014'::uuid, '{}', false) = 3
  AND public.image_cover_rank('00000000-0000-4000-8000-000000000015'::uuid, '{}', false) = 1
  AND public.image_cover_rank('00000000-0000-4000-8000-000000000016'::uuid, '{"classification":{"image_type":"engine_bay"}}', false) = 2
  AND public.image_cover_rank('00000000-0000-4000-8000-000000000011'::uuid, '{}', true) = 3,
  'local labels: confident exterior 0, none 1, detail 2, person 3, weak exterior 1; the classifier and is_document win');
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000b1');
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles WHERE id = '00000000-0000-4000-8000-0000000000b1') = 'b-local-exterior',
  'an unlabelled vehicle gets the oldest frame the local pass reads as a confident exterior, not the newest frame');
UPDATE public.image_observations SET is_active = false WHERE confidence_basis->'local_image_analysis_v1'->>'run_id' = '192ec5d8';
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000b1');
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles WHERE id = '00000000-0000-4000-8000-0000000000b1') = 'b-weak-exterior',
  'reverting the analysis run returns to the classifier-only order (newest unclassified)');
UPDATE public.image_observations SET is_active = true;

-- Tier 6: every public frame is a duplicate copy (originals held for review). The cover must be
-- the public exterior copy, never empty and never the paperwork copy or the held original.
INSERT INTO vehicles VALUES ('00000000-0000-4000-8000-0000000000c1', 'c-old-receipt');
INSERT INTO vehicle_images(id, vehicle_id, image_url, source, taken_at, vision_gate_status, is_duplicate, ai_scan_metadata) VALUES
 ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-0000000000c1', 'c-held-original', 'ssd_blast', '2021-11-09', 'review_needed', false, '{"classification":{"image_type":"exterior"}}'),
 ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-0000000000c1', 'c-dup-exterior', 'iphoto', '2021-11-09', 'approved', true, '{"classification":{"image_type":"exterior"}}'),
 ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-0000000000c1', 'c-dup-receipt', 'iphoto', '2021-11-10', 'approved', true, '{"classification":{"image_type":"receipt_document"}}');
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000c1');
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles WHERE id = '00000000-0000-4000-8000-0000000000c1') = 'c-dup-exterior',
  'all-duplicate gallery: the public exterior copy, not an empty cover, the receipt, or the held original');

\i supabase/sql/revert_20261113100000_cover_exterior_first.sql
SELECT pg_temp.assert_true(md5(pg_get_functiondef('public.recompute_vehicle_primary_image(uuid)'::regprocedure)) = '0abc418f16fa239c346397f060bba3e9'
  AND to_regprocedure('public.image_cover_rank(jsonb, boolean)') IS NULL
  AND to_regprocedure('public.image_cover_rank(uuid, jsonb, boolean)') IS NULL, 'revert restores the 20261016151000 body and drops the rank');
SELECT public.recompute_vehicle_primary_image('00000000-0000-4000-8000-0000000000a1');
SELECT pg_temp.assert_true((SELECT primary_image_url FROM vehicles WHERE id = '00000000-0000-4000-8000-0000000000a1') = 'u-receipt', 'after revert the old choice returns');
SELECT 'cover exterior-first contract: ok' AS result;
