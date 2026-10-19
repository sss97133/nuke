-- Device-triage holds, and a cover photo the public may read.
--
-- 1. hold_frames_by_device_triage(p_verdicts jsonb): the writer for the iOS app's own photo rule, run off the phone.
--    The app decides on the phone which pixels may leave it (apps/nuke-capture-ios/Sources/NukeCapture/
--    VisionEngine.swift): a frame whose top three labels include a document, receipt, web or product capture is
--    clutter (isUnnecessary), and a prominent face with no vehicle is personal; anything else, including a part
--    close-up Apple does not tag as a vehicle, is a work photo and stays. Frames that reached storage by other paths
--    (iPhoto, archive imports) never met that rule. scripts/ios-vision-triage compiles VisionEngine.swift unchanged
--    for the Mac and posts its holds here. The writer only hides: it moves a frame the public can read today
--    (vision_gate_status approved, pending or null) to rejected_personal, with the rule, the engine version, the top
--    labels, the prior status and the prior reasoning in vision_gate_agent_reasoning, and the labels in
--    apple_ml_labels when empty. It never touches a frame already held, never un-hides, and recomputes the cover of
--    every vehicle it touched. service_role only. Measured 2026-10-15 on the featured K5 (e08bf694): of its 1,612
--    readable frames, 96 approved and 1 ungated frame are clutter by the rule (invoices showing names, addresses and
--    amounts, receipts, packing slips, instruction sheets, shopping screenshots).
--
-- 2. recompute_vehicle_primary_image(uuid): its first two tiers (hero-scored and any confirmed frame) and the last
--    (any frame) never read the vision gate or is_sensitive, so a held frame could become the cover. The cover is
--    vehicles.primary_image_url, a storage URL every card renders, so it routes around the public read gate: the
--    K5's cover on 2026-10-15 is a frame held as rejected_misattributed (62ab9997). Every tier now requires a frame
--    the public read policy would show (not sensitive, not superseded, gate status not rejected_personal,
--    rejected_misattributed or review_needed), and when no such frame exists the cover is cleared instead of kept.
--    The rest of the live definition (sha256 of prosrc in the guard, read 2026-10-15) is unchanged.
-- Contract: supabase/sql/test_device_triage_holds_and_public_cover.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO cur
    FROM pg_proc WHERE oid = 'public.recompute_vehicle_primary_image(uuid)'::regprocedure;
  IF cur IS DISTINCT FROM '9ib0ngsZM2nuBGOu29BbdQKzh9uZ7OHnK4Beov6h7Fk=' AND cur IS DISTINCT FROM 'MgDQZsXwEQqIhsQx1W56iOxz05iAecjtdJ41YS/c58A=' THEN
    RAISE EXCEPTION 'recompute_vehicle_primary_image drifted from the definition this migration patches (sha256 %)', cur;
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

COMMENT ON FUNCTION public.recompute_vehicle_primary_image(uuid) IS
  'Pick a vehicle''s cover (vehicle_images.is_primary + vehicles.primary_image_url) from frames the public read policy '
  'would show: hero-scored confirmed, any confirmed, owner hero, owner latest, any. Clears the cover when no such frame '
  'exists. 2026-10-15: every tier reads the gate.';

CREATE OR REPLACE FUNCTION public.hold_frames_by_device_triage(p_verdicts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items int;
  v_held int := 0;
  v_vehicles uuid[];
  v_vehicle uuid;
  v_covers jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_verdicts) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_verdicts must be a json array of {image_id, hold, engine, labels}';
  END IF;
  v_items := jsonb_array_length(p_verdicts);
  IF v_items > 2000 THEN
    RAISE EXCEPTION 'at most 2000 verdicts per call (got %)', v_items;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_verdicts) x
             WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
                OR coalesce(x->>'hold', '') NOT IN ('clutter', 'personal')
                OR coalesce(x->>'engine', '') = ''
                OR coalesce(x->>'image_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR (x ? 'labels' AND jsonb_typeof(x->'labels') IS DISTINCT FROM 'array')) THEN
    RAISE EXCEPTION 'each verdict needs image_id (uuid), hold (clutter or personal), engine, and labels as an array';
  END IF;

  WITH v AS (
    SELECT DISTINCT ON ((x->>'image_id')::uuid)
           (x->>'image_id')::uuid AS image_id, x->>'hold' AS hold, x->>'engine' AS engine,
           ARRAY(SELECT jsonb_array_elements_text(coalesce(x->'labels', '[]'::jsonb))) AS labels
    FROM jsonb_array_elements(p_verdicts) x
    ORDER BY (x->>'image_id')::uuid
  ), held AS (
    UPDATE vehicle_images vi
       SET vision_gate_status = 'rejected_personal',
           vision_gate_agent_reasoning = format(
             'Held by the iOS VisionEngine rule (%s; VisionEngine.swift %s, run on a Mac): top labels %s. Was %s, visible to the public.%s',
             CASE v.hold WHEN 'clutter' THEN 'a document, receipt, screenshot or product capture'
                         ELSE 'a prominent face and no vehicle' END,
             v.engine,
             coalesce(nullif(array_to_string(v.labels[1:3], ', '), ''), 'none'),
             coalesce(vi.vision_gate_status::text, 'ungated'),
             CASE WHEN vi.vision_gate_agent_reasoning IS NOT NULL
                  THEN ' Prior reasoning: ' || vi.vision_gate_agent_reasoning ELSE '' END),
           vision_gate_processed_at = now(),
           apple_ml_labels = coalesce(vi.apple_ml_labels, nullif(v.labels, '{}'))
      FROM v
     WHERE vi.id = v.image_id
       AND (vi.vision_gate_status IS NULL OR vi.vision_gate_status IN ('approved', 'pending'))
    RETURNING vi.vehicle_id
  )
  SELECT count(*), array_agg(DISTINCT vehicle_id) FILTER (WHERE vehicle_id IS NOT NULL)
    INTO v_held, v_vehicles
    FROM held;

  -- A held frame is never a cover: recompute each touched vehicle's cover from what the public may still read.
  FOREACH v_vehicle IN ARRAY coalesce(v_vehicles, '{}'::uuid[]) LOOP
    v_covers := v_covers || jsonb_build_array(public.recompute_vehicle_primary_image(v_vehicle));
  END LOOP;

  RETURN jsonb_build_object('received', v_items, 'held', v_held, 'not_public_or_unknown', v_items - v_held,
                            'vehicles', coalesce(cardinality(v_vehicles), 0), 'covers', v_covers);
END
$function$;
REVOKE ALL ON FUNCTION public.hold_frames_by_device_triage(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_frames_by_device_triage(jsonb) TO service_role;
COMMENT ON FUNCTION public.hold_frames_by_device_triage(jsonb) IS
  'Hide frames the iOS VisionEngine rule holds (clutter: document, receipt, screenshot or product capture; personal: '
  'a prominent face and no vehicle), run off the phone by scripts/ios-vision-triage. Only moves public frames '
  '(approved, pending, null) to rejected_personal, keeps the prior status and reasoning, never un-hides, and '
  'recomputes the touched vehicles'' covers. service_role only. 2026-10-15.';

COMMIT;
