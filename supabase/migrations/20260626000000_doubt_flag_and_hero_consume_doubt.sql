-- Surface + consume the agent's attribution doubt.
--
-- STAGED for Skylar's deploy (prod-function edit) — verified against live data on the
-- 1983 GMC K2500 (a90c008a-3379-41d8-9eb2-b4eda365d74c), 2026-06-26.
--
-- Root cause: the BYOK verdict stores the "is this the subject vehicle?" doubt as
-- byok_deep_analysis.needs_clarification, but BOTH the owner-facing RPC and the lead
-- picker only ever read needs_review — which on the silver-truck lead (IMG_9036,
-- "Silver square-body — NOT the Midnight Blue subject") is false while
-- needs_clarification is TRUE. So the doubt the agent already produced was thrown away:
-- the drill flag never lit, and the picker anointed the flagged image as the cover.
--
-- Two surgical changes, both CREATE OR REPLACE (no signature change, no DROP, grants
-- preserved):

-- ── 1. get_image_deep_analysis: report doubt from EITHER key ──────────────────────
-- The iOS drill flag ("Nuke flagged this — is it the right vehicle?") reads needs_review;
-- have that column report needs_review OR needs_clarification so it lights on the
-- actually-flagged images. (iOS also reads needs_clarification directly now; either path
-- works after this.)
CREATE OR REPLACE FUNCTION public.get_image_deep_analysis(p_image_id uuid)
 RETURNS TABLE(image_id uuid, narrative text, intent text, intent_confidence numeric, scene_type text, build_phase text, place_hint text, confidence numeric, agent_model text, agent_notes text, analyzed_at timestamp with time zone, paint_state text, rust_severity text, completeness text, damage_callouts jsonb, components jsonb, open_questions jsonb, needs_review boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    vi.id,
    b->>'narrative_one_line',
    b->>'intent',
    nullif(b->>'intent_confidence','')::numeric,
    b->>'scene_type',
    b->>'build_phase_guess',
    b->'presence'->>'place_hint',
    nullif(b->>'confidence','')::numeric,
    b->>'agent_model',
    b->>'agent_notes',
    nullif(b->>'analyzed_at','')::timestamptz,
    b->'state_observations'->>'paint_state',
    b->'state_observations'->>'rust_severity',
    b->'state_observations'->>'completeness',
    b->'state_observations'->'damage_callouts',
    b->'components_seen',
    b->'open_questions',
    -- DOUBT FIX: needs_review is usually false; needs_clarification carries the real
    -- "wrong vehicle?" doubt. Report either so the flag is accurate, not silent.
    (COALESCE(nullif(b->>'needs_review','')::boolean, false)
     OR COALESCE(nullif(b->>'needs_clarification','')::boolean, false))
  from public.vehicle_images vi
  cross join lateral (select vi.ai_scan_metadata->'byok_deep_analysis' as b) j
  where vi.id = p_image_id
    and vi.ai_scan_metadata ? 'byok_deep_analysis';
$function$;

-- ── 2. recompute_vehicle_primary_image: never hero a flagged frame ────────────────
-- The owner tiers (3–5) accepted any owner/approved frame whose match_status wasn't
-- 'mismatch'/'unrelated' — but a needs_clarification image has match_status NULL, so the
-- silver truck qualified and won on hero_score. Exclude frames the agent flagged
-- (needs_clarification OR needs_review) from the UN-confirmed tiers. The confirmed tiers
-- (1–2) are owner-resolved, so they are deliberately left untouched (owner > agent).
--
-- Verified: with this exclusion, Tier 3 on the K2500 picks IMG_5778 (ext_front_driver,
-- confidence 0.9) — a real exterior of the actual truck — not the silver stablemate.
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

  -- Tier 3: owner frames WITH analysis, hero-ranked — now also excluding any frame the
  -- agent flagged as possibly-the-wrong-vehicle (needs_clarification / needs_review).
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND ai_scan_metadata->'byok_deep_analysis' IS NOT NULL
      AND COALESCE((ai_scan_metadata->'byok_deep_analysis'->>'needs_clarification')::boolean,false)=false
      AND COALESCE((ai_scan_metadata->'byok_deep_analysis'->>'needs_review')::boolean,false)=false
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY public.image_hero_score(ai_scan_metadata, file_size) DESC, COALESCE(taken_at,created_at) DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_hero'; END IF;
  END IF;

  -- Tier 4: owner frames (no analysis required), latest — exclude flagged (frames with
  -- no analysis have no flag, so they still pass via COALESCE(...,false)).
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id AND source = ANY(c_owner)
      AND COALESCE(vision_gate_status,'approved') = 'approved'
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND COALESCE((ai_scan_metadata->'byok_deep_analysis'->>'needs_clarification')::boolean,false)=false
      AND COALESCE((ai_scan_metadata->'byok_deep_analysis'->>'needs_review')::boolean,false)=false
      AND image_url IS NOT NULL AND image_url <> ''
    ORDER BY COALESCE(taken_at,created_at) DESC LIMIT 1;
    IF v_id IS NOT NULL THEN v_tier := 'owner_latest'; END IF;
  END IF;

  -- Tier 5: any approved non-dup image (scraped-only comps) — exclude flagged.
  IF v_id IS NULL THEN
    SELECT id,image_url,COALESCE(taken_at,created_at),vehicle_zone INTO v_id,v_url,v_taken,v_zone
    FROM vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND COALESCE(is_superseded,false)=false AND COALESCE(is_duplicate,false)=false
      AND COALESCE(image_vehicle_match_status,'pending') NOT IN ('mismatch','unrelated')
      AND COALESCE((ai_scan_metadata->'byok_deep_analysis'->>'needs_clarification')::boolean,false)=false
      AND COALESCE((ai_scan_metadata->'byok_deep_analysis'->>'needs_review')::boolean,false)=false
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

-- After deploy, re-pick the cover for any vehicle whose current primary is now flagged.
-- The K2500 specifically (silver-truck lead → real Midnight-Blue exterior):
--   SELECT public.recompute_vehicle_primary_image('a90c008a-3379-41d8-9eb2-b4eda365d74c');
-- Or sweep every vehicle whose current primary is a flagged frame:
--   SELECT public.recompute_vehicle_primary_image(v.id)
--   FROM vehicles v JOIN vehicle_images vi ON vi.vehicle_id=v.id AND vi.is_primary=true
--   WHERE COALESCE((vi.ai_scan_metadata->'byok_deep_analysis'->>'needs_clarification')::boolean,false)=true;
