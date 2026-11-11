-- Make check counts the make reads of capture-set siblings already filed on the target.
--
-- Why (2026-11-09): IMG_5085 (1f08cdaa), a Trans Am interior, was refused on every re-plan of its day because the
-- classifier read "Corvette" (0.9) on the steering wheel and the v3.1 veto only counted the set's NEW photos: 1 contra of
-- 1 read = veto, although its 140 session siblings are already filed on the red 1973 Firebird 20d21fb0.
-- Change (one WHERE clause in capture_sets_apply, scored_session basis): the reads counted are the set's photos plus the
-- segment siblings already filed on the target vehicle (vi.vehicle_id = tgt). Siblings on other vehicles never count.
-- Replay on live data (2026-11-09): of 10 refused sets, 1 was refused by the veto and it flips (that same Firebird photo,
-- hand-viewed correct, since filed by set_agreement run 560f784c); of 62 filed sets, 0 would now be refused.
-- Refuses on drift (live body read 2026-11-09). Revert: supabase/sql/revert_20261113120300_capture_apply_sibling_make_reads.sql.
-- Contract: supabase/sql/test_capture_apply_sibling_make_reads.sql. Lane: photo/document/library (Codex reviews).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.capture_sets_apply(uuid, uuid, jsonb, numeric)'::regprocedure)) <> 'a91e17f5078d5890a46f0a8e5ab39439' THEN -- gitleaks:allow (function fingerprint)
    RAISE EXCEPTION 'capture_sets_apply drifted from the body read 2026-11-09; re-record before patching';
  END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.capture_sets_apply(p_run_id uuid, p_user uuid, p_items jsonb, p_min_conf numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '170s'
AS $function$
DECLARE it jsonb; seg uuid[]; imgs uuid[]; tgt uuid; v_vin text; ok boolean; img uuid; b jsonb; res jsonb;
  filed int := 0; refused jsonb := '[]'; sets_done int := 0;
BEGIN
  IF p_min_conf IS NULL OR p_min_conf < 0.5 THEN RAISE EXCEPTION 'capture_sets_apply: p_min_conf required (>= 0.5)'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    tgt := (it->>'vehicle_id')::uuid;
    seg := ARRAY(SELECT jsonb_array_elements_text(it->'segment_ids')::uuid);
    imgs := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    SELECT vin INTO v_vin FROM vehicles WHERE id = tgt AND (owner_id = p_user OR user_id = p_user)
      AND deleted_at IS NULL AND merged_into_vehicle_id IS NULL;
    ok := FOUND AND coalesce((it->>'confidence')::numeric, 0) >= p_min_conf AND imgs <@ seg AND cardinality(imgs) > 0
      AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.id = ANY (imgs) AND (vi.user_id IS DISTINCT FROM p_user
            OR vi.vehicle_id IS NOT NULL OR coalesce(vi.is_duplicate, false) OR coalesce(vi.is_sensitive, false)
            OR vi.vision_gate_status::text IN ('rejected_personal', 'rejected_misattributed')))
      AND (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY (seg)) = cardinality(seg);
    IF ok THEN
      ok := CASE it->>'basis'
        WHEN 'vin_read' THEN EXISTS (SELECT 1 FROM image_text_reads r CROSS JOIN LATERAL jsonb_array_elements(r.vin_candidates) c
                 WHERE r.image_id = ANY (seg) AND r.revoked_at IS NULL AND vin_match_key(c->>'vin') = vin_match_key(v_vin))
                 OR EXISTS (SELECT 1 FROM vehicle_identifier_observations o JOIN vehicle_images ou ON ou.id = o.image_id WHERE o.image_id = ANY (seg) AND o.user_id = p_user AND o.kind = 'vin' AND o.status = 'candidate' AND o.confidence >= 0.8 AND NOT coalesce(ou.is_document, false) AND public.capture_vin_plausible(o.value_norm) AND vin_match_key(o.value_norm) = vin_match_key(v_vin)) /* g1: observation-backed vin_read */ OR EXISTS (SELECT 1 FROM vehicle_images u WHERE u.id = ANY (seg) AND coalesce(u.vehicle_vin_confidence, 0) >= 0.8
                 AND NOT coalesce(u.is_document, false) AND vin_match_key(u.vehicle_vin) = vin_match_key(v_vin))
        WHEN 'set_agreement' THEN (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY (seg) AND vi.vehicle_id = tgt) >= 3
                 AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.id = ANY (seg) AND vi.vehicle_id IS NOT NULL
                                 AND vi.vehicle_id <> tgt)
        WHEN 'scored_session' THEN EXISTS (SELECT 1 FROM capture_set_candidates c
                 WHERE c.run_id = p_run_id AND c.set_key = it->>'set_key' AND c.vehicle_id = tgt AND c.user_id = p_user
                   AND c.method = 'scored_session_v1' AND c.rank = 1 AND c.band = 'clear' AND c.revoked_at IS NULL
                   AND imgs <@ c.image_ids
                   AND (c.signals->>'score')::numeric >= 2.5 AND (c.signals->>'margin_raw')::numeric >= 1)
                 -- re-check at apply time: recompute the score for this set and veto on any strong classifier make contradiction
                 AND coalesce((SELECT (x.signals->>'score')::numeric FROM public.capture_sets_score(p_user, NULL, NULL, 'live', seg) x
                               WHERE x.vehicle_id = tgt AND x.rank = 1 AND (x.signals->>'margin_raw')::numeric >= 1 LIMIT 1), 0) >= 2.5
                 -- v3.1: strong classifier make contradictions veto the set unless they are a small minority (< 25%) of the
                 -- set's strong make reads (one misread emblem in a 141-photo set no longer blocks it; a 1-photo set still vetoes)
                 -- 20261113120300: the reads of segment siblings already filed on the target count too (a lone new photo of a
                 -- 140-photo session is judged with its session, not alone)
                 AND (SELECT count(*) FILTER (WHERE z.contra) = 0 OR count(*) FILTER (WHERE z.contra) * 4 < count(*)
                      FROM (SELECT (lower(btrim(f->>'value')) <> lower(btrim(tv.make))
                                    AND NOT (lower(tv.make) IN ('chevrolet','chevy') AND lower(f->>'value') IN ('chevrolet','chevy','gmc'))
                                    AND NOT (lower(tv.make) = 'gmc' AND lower(f->>'value') IN ('chevrolet','chevy'))) contra
                            FROM vehicle_images vi CROSS JOIN LATERAL jsonb_array_elements(coalesce(vi.ai_scan_metadata#>'{classification,v2,vehicle_fields}','[]')) f
                            JOIN vehicles tv ON tv.id = tgt
                            WHERE (vi.id = ANY (imgs) OR (vi.id = ANY (seg) AND vi.vehicle_id = tgt)) AND f->>'field_name' = 'make' AND coalesce((f->>'confidence')::numeric,0) >= 0.7
                              AND nullif(tv.make,'') IS NOT NULL AND nullif(btrim(f->>'value'),'') IS NOT NULL) z)
        ELSE false END;
    END IF;
    IF NOT ok THEN refused := refused || jsonb_build_array(it->>'set_key'); CONTINUE; END IF;
    sets_done := sets_done + 1;
    FOREACH img IN ARRAY imgs LOOP
      SELECT jsonb_build_object('vehicle_id', vehicle_id, 'vision_gate_status', vision_gate_status, 'is_approved', is_approved,
             'approval_status', approval_status, 'is_primary', is_primary) INTO b FROM vehicle_images WHERE id = img;
      res := attribute_testimony('image', img, tgt,
        'capture_set_' || (it->>'basis') || ': segment ' || (it->>'set_key'), p_user, (it->>'confidence')::numeric,
        'capture_set_' || (it->>'basis'));
      INSERT INTO capture_set_links (run_id, set_key, image_id, vehicle_id, confidence, evidence, before_image, result)
      VALUES (p_run_id, it->>'set_key', img, tgt, (it->>'confidence')::numeric,
              jsonb_build_object('basis', it->>'basis', 'segment_ids', it->'segment_ids', 'evidence', it->'evidence'), b, res);
      IF coalesce((res->>'success')::boolean, false) THEN filed := filed + 1; END IF;
    END LOOP;
  END LOOP;
  PERFORM record_vin_upload_exposures(p_run_id, p_user, ARRAY(SELECT jsonb_array_elements_text(x->'segment_ids')::uuid
    FROM jsonb_array_elements(p_items) x));
  RETURN jsonb_build_object('run_id', p_run_id, 'sets', sets_done, 'photos_filed', filed, 'sets_refused', refused);
END $function$;
COMMIT;
