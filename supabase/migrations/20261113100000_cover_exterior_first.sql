-- Cover chooser picks a whole-vehicle exterior before an interior, engine bay, close-up, VIN plate or paperwork.
--
-- Why (owner, 2026-11-09): garage covers are wrong. Measured live: no garage vehicle has image_vehicle_match_status
-- 'confirmed' frames and few have byok_deep_analysis, so recompute_vehicle_primary_image falls to tier 4 (owner_latest),
-- which takes the newest owner frame whatever it shows. Covers seen on 2026-11-09: a texture close-up (1966 C10, after a
-- wrong-vehicle hold), engine bays (1967 C10 SWB, 1970 Mercedes 280SL), interiors (1960 VW Type 3, 1965 Mustang Sage Gold),
-- a VIN plate (gray-primer Mustang), a close-up (1989 GMC Jimmy) and a paper receipt (1987 GMC V15), while each had
-- classifier vehicle_exterior frames.
-- Change: one IMMUTABLE ranking, image_cover_rank(ai_scan_metadata, is_document), is the first ORDER BY key in all five
-- tiers. Eligibility (gate, privacy, match status, tiers) is unchanged, so no new frame becomes a cover candidate; only
-- the order among eligible frames changes. Within a rank the old order (hero score, then recency) holds.
--   0 classifier image_type vehicle_exterior, or byok scene_type body_exterior
--   1 not classified yet (unless the local analysis pass labelled it; see image_cover_rank(uuid, jsonb, boolean))
--   2 any other vehicle view (interior, engine_bay, undercarriage, detail_closeup, progress_shot, part_closeup, ...)
--   3 is_document, or image_type document / receipt_document / vin_plate / screenshot / other
-- Covers change only when recompute_vehicle_primary_image runs for a vehicle (its existing callers); nothing is backfilled here.
-- Refuses on drift: the live body must be the 20261016151000 body (md5 0abc418f16fa239c346397f060bba3e9, read 2026-11-09).
-- Revert: supabase/sql/revert_20261113100000_cover_exterior_first.sql. Contract: supabase/sql/test_cover_exterior_first.sql.
-- Lane: photo/document/library (Codex reviews). Not applied live.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.recompute_vehicle_primary_image(uuid)'::regprocedure)) <> '0abc418f16fa239c346397f060bba3e9' THEN -- gitleaks:allow (function fingerprint)
    RAISE EXCEPTION 'recompute_vehicle_primary_image drifted from the 20261016151000 body; re-record before patching';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.image_cover_rank(meta jsonb, is_doc boolean)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $f$
  SELECT CASE
    WHEN coalesce(is_doc, false)
      OR coalesce(meta #>> '{classification,image_type}', '') IN ('document','receipt_document','vin_plate','screenshot','other') THEN 3
    WHEN meta #>> '{classification,image_type}' = 'vehicle_exterior'
      OR meta #>> '{byok_deep_analysis,scene_type}' = 'body_exterior' THEN 0
    WHEN meta #>> '{classification,image_type}' IS NULL THEN 1
    ELSE 2 END
$f$;
COMMENT ON FUNCTION public.image_cover_rank(jsonb, boolean) IS
  'Cover preference among eligible frames: 0 exterior, 1 unclassified, 2 other vehicle views, 3 paperwork/VIN plate/screenshot/other. Lower is better.';
REVOKE ALL ON FUNCTION public.image_cover_rank(jsonb, boolean) FROM PUBLIC, anon;

-- Unlabelled frames: when the classifier has not read a frame (rank 1), use the free local analysis pass's view label
-- (image_observations, observed_by local_image_analysis_v1, scripts/photo-pipeline/local_image_analysis.py on branch
-- photo-pipeline/local-image-analysis, first run 192ec5d8). Only an active row counts, so reverting that run
-- (is_active=false) returns its frames to rank 1. The classifier always wins where it has a label.
--   exterior_front / exterior_rear / exterior_side with view_confidence >= 0.4 and p_vehicle >= 0.5 -> 0
--   document / screenshot / person / other -> 3     interior / engine / undercarriage / detail -> 2
--   no active local reading, or a low-confidence exterior -> 1 (unchanged)
CREATE OR REPLACE FUNCTION public.image_cover_rank(p_image_id uuid, meta jsonb, is_doc boolean)
RETURNS integer LANGUAGE sql STABLE PARALLEL SAFE SET search_path TO 'public' AS $f$
  SELECT CASE WHEN r.base <> 1 THEN r.base ELSE coalesce((
    SELECT CASE
      WHEN rd->>'view' IN ('exterior_front','exterior_rear','exterior_side')
       AND coalesce((rd->>'view_confidence')::numeric, 0) >= 0.4 AND coalesce((rd->>'p_vehicle')::numeric, 0) >= 0.5 THEN 0
      WHEN rd->>'view' IN ('document','screenshot','person','other') THEN 3
      WHEN rd->>'view' IN ('interior','engine','undercarriage','detail') THEN 2
      ELSE 1 END
    FROM (SELECT o.confidence_basis->'local_image_analysis_v1'->'reading' AS rd, o.observed_at
            FROM public.image_observations o
           WHERE o.image_id = p_image_id AND o.observed_by = 'local_image_analysis_v1' AND o.is_active
           ORDER BY o.observed_at DESC LIMIT 1) l), 1) END
  FROM (SELECT public.image_cover_rank(meta, is_doc) AS base) r
$f$;
COMMENT ON FUNCTION public.image_cover_rank(uuid, jsonb, boolean) IS
  'Cover preference: the classifier rank (image_cover_rank(jsonb, boolean)); for a frame the classifier has not read, the active local_image_analysis_v1 view label decides (exterior 0, other vehicle view 2, paperwork/screenshot/person/other 3). Lower is better.';
REVOKE ALL ON FUNCTION public.image_cover_rank(uuid, jsonb, boolean) FROM PUBLIC, anon;

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

  -- Every tier ranks whole-vehicle exteriors first, then unclassified frames, then interiors/engine/detail/progress
  -- frames, and paperwork, VIN plates, screenshots and 'other' last (image_cover_rank, 20261113100000).
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
  ORDER BY public.image_cover_rank(id, ai_scan_metadata, is_document), public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
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
    ORDER BY public.image_cover_rank(id, ai_scan_metadata, is_document), COALESCE(taken_at,created_at) DESC LIMIT 1;
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
    ORDER BY public.image_cover_rank(id, ai_scan_metadata, is_document), public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
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
    ORDER BY public.image_cover_rank(id, ai_scan_metadata, is_document), COALESCE(taken_at,created_at) DESC LIMIT 1;
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
    ORDER BY public.image_cover_rank(id, ai_scan_metadata, is_document), COALESCE(is_primary,false) DESC, COALESCE(taken_at,created_at) DESC LIMIT 1;
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

DO $chk$
BEGIN
  IF position('image_cover_rank' IN pg_get_functiondef('public.recompute_vehicle_primary_image(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'cover chooser not replaced';
  END IF;
END $chk$;
COMMIT;
