-- Phone VIN uploads (vehicle_images.vehicle_vin from iOS #2498) become capture-set anchors and cited photo exposures.
--  * capture_sets_build: roster and uploaded reads accept 5-7 char classic serials (read confidence >= 0.8).
--  * capture_sets_apply / capture_set_correct: basis vin_read also accepts an uploaded read >= 0.8 that matches the target.
--  * capture_sets_apply records exposures for the filed photos; capture_sets_revert supersedes them.
--  * new writer record_vin_upload_exposures + identifier_exposures_revert (service_role only).
-- Revert: identifier_exposures_revert(run); prior function bodies are in migration history.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- Phone VIN reads (vehicle_images.vehicle_vin, uploaded by iOS) on photos filed to a vehicle become cited photo
-- exposures, which the exposure trigger mirrors into vehicle_identifiers, so they feed identifier_consensus.
-- Only reads that match the vehicle's own VIN (vin_match_key) are cited; a read that disagrees is a misfiling
-- question, not a claim about this vehicle. Idempotent (unique image/kind/value/reader). Revert by run id.
CREATE OR REPLACE FUNCTION public.record_vin_upload_exposures(p_run_id uuid, p_user uuid, p_image_ids uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE n int;
BEGIN
  IF p_run_id IS NULL OR p_user IS NULL THEN RAISE EXCEPTION 'record_vin_upload_exposures: run id and user required'; END IF;
  INSERT INTO identifier_exposures (vehicle_id, image_id, kind, read_value, evidence_class, reader, reader_confidence, quote, run_id)
  SELECT vi.vehicle_id, vi.id, CASE WHEN length(vin_match_key(vi.vehicle_vin)) = 17 THEN 'vin' ELSE 'chassis' END,
         upper(btrim(vi.vehicle_vin)),
         CASE WHEN coalesce(vi.is_document, false) OR coalesce(vi.doc_flag, false) THEN 'document' ELSE 'photo_text' END,
         'ios_vision_v1', least(1, greatest(0, coalesce(vi.vehicle_vin_confidence, 0.5))),
         'on-device read uploaded with the photo', p_run_id
  FROM vehicle_images vi JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE vi.user_id = p_user AND (p_image_ids IS NULL OR vi.id = ANY (p_image_ids))
    AND length(coalesce(vi.vehicle_vin, '')) >= 5 AND coalesce(vi.vehicle_vin_confidence, 0) >= 0.8
    AND NOT coalesce(vi.is_sensitive, false) AND NOT coalesce(vi.is_duplicate, false)
    AND vin_match_key(vi.vehicle_vin) = vin_match_key(v.vin)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $f$;

CREATE OR REPLACE FUNCTION public.identifier_exposures_revert(p_run_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
DECLARE n int;
BEGIN
  IF p_run_id IS NULL THEN RETURN 0; END IF;
  UPDATE identifier_exposures SET superseded_at = now() WHERE run_id = p_run_id AND superseded_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE vehicle_identifiers SET superseded_at = now()
  WHERE run_id = p_run_id AND extractor = 'ios_vision_v1' AND superseded_at IS NULL;
  RETURN n;
END $f$;

CREATE OR REPLACE FUNCTION public.capture_sets_build(p_user uuid, p_gap_s integer DEFAULT 480, p_radius_m numeric DEFAULT 100, p_oncar_conf numeric DEFAULT NULL::numeric, p_doc_conf numeric DEFAULT NULL::numeric)
 RETURNS TABLE(set_key text, t0 timestamp with time zone, t1 timestamp with time zone, n integer, image_ids uuid[], unlinked_ids uuid[], filed_vehicle_ids uuid[], vin_keys text[], anchors jsonb, decision text, target_vehicle_id uuid, proposed_vin text, confidence numeric, reasons text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '170s'
AS $function$
DECLARE
  v_oncar numeric := coalesce(p_oncar_conf, 0.95);
  v_doc   numeric := coalesce(p_doc_conf, 0.80);
BEGIN
  RETURN QUERY
  WITH p AS MATERIALIZED (
    SELECT vi.id, vi.taken_at, vi.latitude::float8 lat, vi.longitude::float8 lon, vi.vehicle_id, vi.vehicle_vin,
           vi.vehicle_vin_confidence, coalesce(vi.is_document, false) OR coalesce(vi.doc_flag, false) is_doc,
           coalesce(vi.is_duplicate, false) OR coalesce(vi.is_superseded, false) OR coalesce(vi.is_sensitive, false)
             OR coalesce(vi.vision_gate_status::text, '') IN ('rejected_personal', 'rejected_misattributed') blocked,
           lag(vi.taken_at) OVER w pt, lag(vi.latitude::float8) OVER w plat, lag(vi.longitude::float8) OVER w plon
    FROM vehicle_images vi
    WHERE vi.user_id = p_user AND vi.source = 'capture_relay_ios' AND vi.taken_at IS NOT NULL
      AND nullif(vi.image_url, '') IS NOT NULL
    WINDOW w AS (ORDER BY vi.taken_at, vi.id)
  ), g AS MATERIALIZED (
    SELECT p.*, sum(CASE WHEN p.pt IS NULL OR extract(epoch FROM p.taken_at - p.pt) > p_gap_s
                      OR (p.lat IS NOT NULL AND p.plat IS NOT NULL AND
                          6371000 * 2 * asin(sqrt(least(1, power(sin(radians(p.lat - p.plat) / 2), 2) +
                            cos(radians(p.lat)) * cos(radians(p.plat)) * power(sin(radians(p.lon - p.plon) / 2), 2)))) > p_radius_m)
                    THEN 1 ELSE 0 END) OVER (ORDER BY p.taken_at, p.id) sid
    FROM p
  ), roster AS MATERIALIZED (
    SELECT v.id, v.vin, vin_match_key(v.vin) k FROM vehicles v
    WHERE (v.owner_id = p_user OR v.user_id = p_user) AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
      AND length(coalesce(v.vin, '')) >= 5
  ), reads AS MATERIALIZED (
    -- uploaded on-device reads (vehicle_vin) and cited text reads
    SELECT g.sid, g.id image_id, g.is_doc doc, vin_match_key(g.vehicle_vin) k, g.vehicle_vin vin,
           coalesce(g.vehicle_vin_confidence, 0.9) conf, 'upload' via
    FROM g WHERE length(coalesce(g.vehicle_vin, '')) >= 8
       OR (length(g.vehicle_vin) BETWEEN 5 AND 7 AND g.vehicle_vin ~ '[0-9]' AND coalesce(g.vehicle_vin_confidence, 0) >= 0.8)
    UNION ALL
    SELECT g.sid, g.id, r.is_document OR g.is_doc, vin_match_key(c->>'vin'), c->>'vin', coalesce((c->>'conf')::numeric, 0.5),
           'text_read:' || r.id
    FROM g JOIN image_text_reads r ON r.image_id = g.id AND r.revoked_at IS NULL
    CROSS JOIN LATERAL jsonb_array_elements(r.vin_candidates) c
  ), anch AS MATERIALIZED (
    SELECT r.sid, r.k, bool_or(NOT r.doc) on_car, max(r.conf) conf, min(r.vin) vin,
           (SELECT array_agg(DISTINCT ro.id) FROM roster ro WHERE ro.k = r.k) roster_ids,
           jsonb_agg(jsonb_build_object('image_id', r.image_id, 'vin', r.vin, 'document', r.doc, 'conf', r.conf, 'via', r.via)) cites
    FROM reads r WHERE r.k IS NOT NULL GROUP BY r.sid, r.k
  ), sets AS (
    SELECT g.sid, min(g.taken_at) t0, max(g.taken_at) t1, count(*)::int n, array_agg(g.id ORDER BY g.taken_at) ids,
           array_agg(g.id ORDER BY g.taken_at) FILTER (WHERE g.vehicle_id IS NULL AND NOT g.blocked) unl,
           array_agg(DISTINCT g.vehicle_id) FILTER (WHERE g.vehicle_id IS NOT NULL
             AND g.vehicle_id <> '14447ecd-293e-4203-9045-90102559c904'::uuid) filed,
           (array_agg(g.id ORDER BY g.taken_at) FILTER (WHERE g.lat IS NOT NULL AND g.vehicle_id IS NULL))[1] gps_img
    FROM g GROUP BY g.sid
  ), j AS (
    SELECT s.*, (SELECT array_agg(a.k ORDER BY a.k) FROM anch a WHERE a.sid = s.sid) keys,
           (SELECT jsonb_agg(jsonb_build_object('vin', a.vin, 'on_car', a.on_car, 'roster', a.roster_ids, 'cites', a.cites))
              FROM anch a WHERE a.sid = s.sid) anchors_j,
           (SELECT a.k FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_k,
           (SELECT a.vin FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_vin,
           (SELECT a.on_car FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_on_car,
           (SELECT a.roster_ids FROM anch a WHERE a.sid = s.sid ORDER BY a.k LIMIT 1) one_roster
    FROM sets s
  )
  SELECT 'ios:' || p_user || ':' || to_char(j.t0 AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS'), j.t0, j.t1, j.n, j.ids,
         coalesce(j.unl, '{}'), coalesce(j.filed, '{}'), coalesce(j.keys, '{}'), coalesce(j.anchors_j, '[]'),
         dd.decision, d.target, d.pvin, d.conf, d.reasons
  FROM j
  CROSS JOIN LATERAL (SELECT
      CASE
        WHEN coalesce(cardinality(j.unl), 0) = 0 THEN 'nothing'
        WHEN coalesce(cardinality(j.keys), 0) >= 2 THEN 'review'
        WHEN cardinality(j.keys) = 1 AND cardinality(j.one_roster) = 1
             AND (j.filed IS NULL OR j.filed = j.one_roster) THEN 'attach'
        WHEN cardinality(j.keys) = 1 AND j.one_roster IS NULL AND j.filed IS NULL
             AND (vin_check_digit_ok(j.one_vin) OR length(j.one_k) BETWEEN 8 AND 13) THEN 'create'
        WHEN cardinality(j.keys) = 1 THEN 'review'
        WHEN cardinality(j.filed) = 1 THEN 'review'
        ELSE 'nothing'
      END decision) dd
  CROSS JOIN LATERAL (SELECT
      CASE WHEN dd.decision = 'attach' THEN j.one_roster[1]
           WHEN dd.decision = 'review' AND j.keys IS NULL AND cardinality(j.filed) = 1 THEN j.filed[1]
           WHEN dd.decision = 'review' AND cardinality(j.keys) = 1 THEN j.one_roster[1] END target,
      CASE WHEN cardinality(j.keys) = 1 THEN j.one_vin END pvin,
      CASE WHEN dd.decision IN ('attach', 'create') THEN CASE WHEN j.one_on_car THEN v_oncar ELSE v_doc END END conf,
      array_remove(ARRAY[
        CASE WHEN coalesce(cardinality(j.keys), 0) >= 2 THEN 'two_or_more_vins' END,
        CASE WHEN cardinality(j.keys) = 1 AND j.filed IS NOT NULL AND j.filed <> coalesce(j.one_roster, '{}')
             THEN 'vin_conflicts_with_filed_vehicle' END,
        CASE WHEN cardinality(j.keys) = 1 AND cardinality(j.one_roster) > 1 THEN 'vin_on_several_roster_vehicles' END,
        CASE WHEN cardinality(j.keys) = 1 AND NOT j.one_on_car THEN 'vin_from_document_only' END,
        CASE WHEN cardinality(j.keys) = 1 AND j.one_on_car THEN 'vin_on_car' END,
        CASE WHEN j.keys IS NULL AND cardinality(j.filed) = 1 THEN 'set_partly_filed' END
      ], NULL) reasons) d;
END $function$;

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
                 OR EXISTS (SELECT 1 FROM vehicle_images u WHERE u.id = ANY (seg) AND coalesce(u.vehicle_vin_confidence, 0) >= 0.8
                 AND NOT coalesce(u.is_document, false) AND vin_match_key(u.vehicle_vin) = vin_match_key(v_vin))
        WHEN 'set_agreement' THEN (SELECT count(*) FROM vehicle_images vi WHERE vi.id = ANY (seg) AND vi.vehicle_id = tgt) >= 3
                 AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.id = ANY (seg) AND vi.vehicle_id IS NOT NULL
                                 AND vi.vehicle_id <> tgt)
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

CREATE OR REPLACE FUNCTION public.capture_sets_revert(p_run_id uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE l record; n int := 0;
BEGIN
  FOR l IN SELECT * FROM capture_set_links WHERE run_id = p_run_id AND reverted_at IS NULL AND (result->>'success')::boolean LOOP
    UPDATE vehicle_images SET vehicle_id = NULL,
      vision_gate_status = (l.before_image->>'vision_gate_status')::public.vision_gate_status,
      is_approved = (l.before_image->>'is_approved')::boolean,
      approval_status = (l.before_image->>'approval_status')::public.content_approval_status,
      is_primary = coalesce((l.before_image->>'is_primary')::boolean, false), updated_at = now()
    WHERE id = l.image_id AND vehicle_id = l.vehicle_id;
    IF FOUND THEN
      INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
      VALUES ('image', l.image_id, l.vehicle_id, l.image_id, NULL, 'capture_set_revert: run ' || p_run_id, p_actor);
      n := n + 1;
    END IF;
    UPDATE capture_set_links SET reverted_at = now() WHERE id = l.id;
  END LOOP;
  PERFORM identifier_exposures_revert(p_run_id);
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.capture_set_correct(p_run_id uuid, p_user uuid, p_items jsonb, p_min_conf numeric DEFAULT 0.9, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it jsonb; v_ids uuid[]; v_to uuid; v_conf numeric; v_basis text; v_ok boolean; v_why text; v_key text;
  img record; res jsonb; v_from uuid; n_unfiled int := 0; v_before jsonb; n_moved int := 0; n_review int := 0; n_items int := 0; out jsonb := '[]';
BEGIN
  FOR it IN SELECT jsonb_array_elements(p_items) LOOP
    n_items := n_items + 1;
    v_ids := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    v_to := (it->>'to_vehicle_id')::uuid; v_conf := coalesce((it->>'confidence')::numeric,0); v_basis := it->>'basis';
    v_ok := true; v_why := NULL;
    IF v_to IS NULL AND v_basis IS DISTINCT FROM 'visual_identity_mismatch' THEN
      v_ok := false; v_why := 'target required';
    ELSIF v_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_to AND (v.owner_id = p_user OR v.user_id = p_user
                   OR v.uploaded_by = p_user) AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) THEN
      v_ok := false; v_why := 'target not on this account';
    ELSIF EXISTS (SELECT 1 FROM unnest(v_ids) x LEFT JOIN vehicle_images vi ON vi.id = x WHERE vi.user_id IS DISTINCT FROM p_user) THEN
      v_ok := false; v_why := 'photo not owned by user';
    ELSIF v_basis = 'vin_read' THEN
      SELECT vin_match_key(vin) INTO v_key FROM vehicles WHERE id = v_to;
      IF v_key IS NULL OR NOT EXISTS (SELECT 1 FROM image_text_reads r, jsonb_array_elements(r.vin_candidates) c
          WHERE r.image_id = ANY(v_ids) AND r.revoked_at IS NULL AND vin_match_key(c->>'vin') = v_key)
          AND NOT EXISTS (SELECT 1 FROM vehicle_images u WHERE u.id = ANY(v_ids) AND coalesce(u.vehicle_vin_confidence, 0) >= 0.8
          AND NOT coalesce(u.is_document, false) AND vin_match_key(u.vehicle_vin) = v_key) THEN
        v_ok := false; v_why := 'no recorded read in the set matches the target VIN'; END IF;
    ELSIF v_basis = 'created_profile' THEN
      IF v_to IS NULL AND v_basis IS DISTINCT FROM 'visual_identity_mismatch' THEN
      v_ok := false; v_why := 'target required';
    ELSIF v_to IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_to
          AND (v.origin_metadata->'capture_set'->>'anchor_image_id')::uuid = ANY(v_ids)
         UNION ALL SELECT 1 FROM vehicles v WHERE v.id = v_to AND v.vin_source_image_id = ANY(v_ids)) THEN
        v_ok := false; v_why := 'target was not created from this set'; END IF;
    ELSIF v_basis = 'segment_majority' THEN
      IF (SELECT count(*) FILTER (WHERE vi.vehicle_id = v_to) * 2 <= count(*) FROM vehicle_images vi WHERE vi.id = ANY(v_ids))
         OR coalesce((it->'evidence'->>'purity')::numeric,0) < 0.9 THEN
        v_ok := false; v_why := 'target does not hold a majority of a pure segment'; END IF;
    ELSIF v_basis = 'visual_identity_mismatch' THEN
      -- The run looks like a different make/model than the vehicle it is filed to. Evidence must carry the score,
      -- margin, run length and detector run id; every photo must sit on evidence.from_vehicle_id.
      v_from := (it->'evidence'->>'from_vehicle_id')::uuid;
      IF v_from IS NULL OR (it->'evidence'->>'detector_run_id') IS NULL OR (it->'evidence'->>'margin') IS NULL
         OR coalesce((it->'evidence'->>'run_length')::int,0) < 6 OR coalesce((it->'evidence'->>'mismatch_score')::numeric,0) < 0.8 THEN
        v_ok := false; v_why := 'identity evidence incomplete (needs from_vehicle_id, mismatch_score>=0.8, margin, run_length>=6, detector_run_id)';
      ELSIF EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.id = ANY(v_ids) AND vi.vehicle_id IS DISTINCT FROM v_from) THEN
        v_ok := false; v_why := 'photos are not all filed to from_vehicle_id';
      ELSIF v_to = v_from THEN v_ok := false; v_why := 'target equals the contradicted vehicle'; END IF;
    ELSE v_ok := false; v_why := 'unknown basis'; END IF;
    IF v_ok AND v_conf < p_min_conf THEN v_ok := false; v_why := format('confidence %s below %s', v_conf, p_min_conf); END IF;

    IF NOT v_ok THEN
      n_review := n_review + 1;
      IF NOT p_dry_run THEN
        INSERT INTO capture_set_review (run_id, user_id, set_key, image_ids, to_vehicle_id, confidence, basis, evidence, reason)
        VALUES (p_run_id, p_user, it->>'set_key', v_ids, v_to, v_conf, v_basis, coalesce(it->'evidence','{}'), v_why)
        ON CONFLICT (run_id, set_key) DO NOTHING;
      END IF;
      out := out || jsonb_build_object('set_key', it->>'set_key', 'action', 'review', 'reason', v_why);
      CONTINUE;
    END IF;

    FOR img IN SELECT vi.id, vi.vehicle_id FROM vehicle_images vi WHERE vi.id = ANY(v_ids)
               AND vi.vehicle_id IS DISTINCT FROM v_to LOOP
      IF p_dry_run THEN IF v_to IS NULL THEN n_unfiled := n_unfiled + 1; ELSE n_moved := n_moved + 1; END IF; CONTINUE; END IF;
      v_before := capture_set_before_image(img.id);
      IF v_to IS NULL THEN
        -- Unfile by supersession: the photo returns to unlinked, the before-image and evidence are kept, nothing deleted.
        UPDATE vehicle_images SET vehicle_id = NULL, is_primary = false,
               merged_from_vehicle_id = coalesce(merged_from_vehicle_id, img.vehicle_id), updated_at = now()
         WHERE id = img.id AND vehicle_id = img.vehicle_id;
        IF FOUND THEN
          INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
          VALUES ('image', img.id, img.vehicle_id, img.id, NULL, format('cited correction by agent:grok-bot, run %s: capture set %s '
            || '(visual_identity_mismatch, confidence %s) contradicts the link to %s; unfiled to unlinked', p_run_id, it->>'set_key', v_conf, img.vehicle_id), p_user);
          INSERT INTO capture_set_unfiled (run_id, set_key, image_id, from_vehicle_id, confidence, evidence, before_image)
          VALUES (p_run_id, it->>'set_key', img.id, img.vehicle_id, v_conf, coalesce(it->'evidence','{}'), v_before);
          n_unfiled := n_unfiled + 1;
        END IF;
        CONTINUE;
      ELSIF img.vehicle_id IS NULL THEN
        res := attribute_testimony('image', img.id, v_to, format('capture set %s (%s, run %s)', it->>'set_key', v_basis, p_run_id),
                                   p_user, v_conf, 'capture_set_' || v_basis);
      ELSE
        res := relink_testimony('image', img.id, v_to, format('cited correction by agent:grok-bot, run %s: capture set %s '
          || 'evidence (%s, confidence %s) contradicts the link to %s; supersedes the earlier filing', p_run_id,
          it->>'set_key', v_basis, v_conf, img.vehicle_id), p_user);
      END IF;
      IF coalesce((res->>'success')::boolean,false) THEN
        n_moved := n_moved + 1;
        INSERT INTO capture_set_links (run_id, set_key, image_id, vehicle_id, confidence, evidence, before_image, result)
        VALUES (p_run_id, it->>'set_key', img.id, v_to, v_conf,
                jsonb_build_object('basis', v_basis, 'action','correction') || coalesce(it->'evidence','{}'),
                v_before, res);
      END IF;
    END LOOP;
    out := out || jsonb_build_object('set_key', it->>'set_key', 'action', 'correct', 'to', v_to);
  END LOOP;
  RETURN jsonb_build_object('success',true,'dry_run',p_dry_run,'items',n_items,'photos_moved',n_moved,'photos_unfiled',n_unfiled,
                            'review',n_review,'detail',out);
END $function$;

REVOKE EXECUTE ON FUNCTION public.record_vin_upload_exposures(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.identifier_exposures_revert(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vin_upload_exposures(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.identifier_exposures_revert(uuid) TO service_role;
COMMIT;
