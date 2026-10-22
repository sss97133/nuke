-- Capture-set linking: a shop shoot is one set; a VIN read in the set names the vehicle for every photo in it.
-- Review: nuke-strategy/image-linking-review.md (2026-10-22). Spec (owner): one shoot = one set (session, tight time,
-- same place, visual similarity); the VIN photo's read is inherited by the set as a cited claim; the set attaches to the
-- roster vehicle with that VIN or proposes a new profile; no VIN -> location fallback or review.
--
-- Thresholds are measured, not chosen (see the review, section "Thresholds"):
--   gap 480 s   : log-spaced histogram of the 5,859 consecutive-capture gaps in the owner's phone library. The in-shoot
--                 mode (1-60 s) decays to its floor at 422-562 s (30 gaps per bin); beyond that the density is the flat
--                 between-shoot background (35-48 per bin) out to 3 h.
--   radius 100 m: 98.9% of consecutive captures less than 1 h apart are within 100 m; 100-500 m is a trough (43 pairs)
--                 before a second mode at 500-1000 m (moving between places).
--   confidences : p_oncar_conf / p_doc_conf defaults are the measured agreement rates (Beta posterior mean) of VIN
--                 reads against already-filed sets; see capture_set_calibration rows written with each run.
-- Writers in this file are the sanctioned path for these tables. Every link goes through attribute_testimony and is
-- logged with its before-image so capture_sets_revert(run) restores it.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- 1. Contributor for box-side passes (probation: its claims never auto-file below the measured bar).
INSERT INTO public.contributors (contributor_type, agent_key, agent_version, status)
SELECT 'agent', 'agent:grok-bot', 'capture-sets-v1', 'probation'
WHERE NOT EXISTS (SELECT 1 FROM public.contributors WHERE agent_key = 'agent:grok-bot');

-- 2. Cited text reads (OCR) of an image's own bytes. Additive; revoked, never deleted.
CREATE TABLE IF NOT EXISTS public.image_text_reads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id        uuid NOT NULL REFERENCES public.vehicle_images(id),
  user_id         uuid,
  run_id          uuid NOT NULL,
  contributor_id  uuid NOT NULL REFERENCES public.contributors(id),
  method          text NOT NULL,                 -- 'rapidocr-onnx/1.3 on 1600px JPEG of the stored original'
  source_sha256   text,                          -- vehicle_images.file_hash at read time
  is_document     boolean NOT NULL,              -- the frame is paper (title, registration), not the car
  lines           jsonb NOT NULL,                -- [[text, confidence], ...] exactly as read
  vin_candidates  jsonb NOT NULL DEFAULT '[]',   -- [{"vin":..,"kind":"vin17|classic|assigned","conf":..,"line":..}]
  observed_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_reason  text,
  CONSTRAINT itr_lines_array CHECK (jsonb_typeof(lines) = 'array'),
  CONSTRAINT itr_vins_array CHECK (jsonb_typeof(vin_candidates) = 'array')
);
CREATE INDEX IF NOT EXISTS itr_image ON public.image_text_reads (image_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS itr_run ON public.image_text_reads (run_id);
ALTER TABLE public.image_text_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY itr_owner_read ON public.image_text_reads FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. Link log: one row per image a capture-set run filed, with the before-image for revert.
CREATE TABLE IF NOT EXISTS public.capture_set_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL,
  set_key      text NOT NULL,
  image_id     uuid NOT NULL REFERENCES public.vehicle_images(id),
  vehicle_id   uuid NOT NULL REFERENCES public.vehicles(id),
  confidence   numeric(4,3) NOT NULL,
  evidence     jsonb NOT NULL,
  before_image jsonb NOT NULL,
  result       jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reverted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS csl_run ON public.capture_set_links (run_id);
ALTER TABLE public.capture_set_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY csl_owner_read ON public.capture_set_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicle_images vi WHERE vi.id = image_id AND vi.user_id = auth.uid()));

-- 4. Helpers.
CREATE OR REPLACE FUNCTION public.vin_check_digit_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN upper(coalesce(p, '')) !~ '^[A-HJ-NPR-Z0-9]{17}$' THEN false ELSE (
    SELECT substr(upper(p), 9, 1) = CASE WHEN sum(val * w) % 11 = 10 THEN 'X' ELSE (sum(val * w) % 11)::text END
    FROM (SELECT CASE WHEN ch ~ '[0-9]' THEN ch::int
                      ELSE (position(ch IN 'ABCDEFGHJKLMNPRSTUVWXYZ') - 1)::int END idx, ch, i,
                 ('{8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2}'::int[])[i] w
          FROM (SELECT substr(upper(p), i, 1) ch, i FROM generate_series(1, 17) i) c) c2
    CROSS JOIN LATERAL (SELECT CASE WHEN c2.ch ~ '[0-9]' THEN c2.idx
      ELSE ('{1,2,3,4,5,6,7,8,1,2,3,4,5,7,9,2,3,4,5,6,7,8,9}'::int[])[c2.idx + 1] END val) v) END
$$;

-- OCR confusables folded so a read and a roster VIN compare equal (S/5, O/0, I/1, B/8, Z/2, G/6); separators dropped.
CREATE OR REPLACE FUNCTION public.vin_match_key(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(translate(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), 'OQISBZG', '0015826'), '')
$$;

-- 5. Writer: cited text reads.
CREATE OR REPLACE FUNCTION public.record_image_text_reads(p_run_id uuid, p_contributor_key text, p_method text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_contrib uuid; it jsonb; n int := 0; skipped int := 0; v_img record;
BEGIN
  SELECT id INTO v_contrib FROM contributors WHERE agent_key = p_contributor_key AND status <> 'frozen';
  IF v_contrib IS NULL THEN RAISE EXCEPTION 'record_image_text_reads: unknown or frozen contributor %', p_contributor_key; END IF;
  IF p_method IS NULL OR btrim(p_method) = '' THEN RAISE EXCEPTION 'record_image_text_reads: method required'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT id, user_id, file_hash INTO v_img FROM vehicle_images WHERE id = (it->>'image_id')::uuid;
    -- A read is of particular bytes: refuse it when the row's bytes changed since the read.
    IF v_img.id IS NULL OR (v_img.file_hash IS NOT NULL AND it->>'source_sha256' IS NOT NULL
                            AND v_img.file_hash <> it->>'source_sha256') THEN
      skipped := skipped + 1; CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM image_text_reads WHERE image_id = v_img.id AND run_id = p_run_id) THEN
      skipped := skipped + 1; CONTINUE;
    END IF;
    INSERT INTO image_text_reads (image_id, user_id, run_id, contributor_id, method, source_sha256, is_document, lines, vin_candidates)
    VALUES (v_img.id, v_img.user_id, p_run_id, v_contrib, p_method, coalesce(it->>'source_sha256', v_img.file_hash),
            coalesce((it->>'is_document')::boolean, false), coalesce(it->'lines', '[]'), coalesce(it->'vin_candidates', '[]'));
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('recorded', n, 'skipped', skipped, 'run_id', p_run_id);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_image_text_reads(p_run_id uuid, p_reason text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n int;
BEGIN
  UPDATE image_text_reads SET revoked_at = now(), revoked_reason = p_reason WHERE run_id = p_run_id AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- 6. Set builder (read-only). One row per set with its decision.
--    attach : exactly one VIN key in the set, it matches exactly one of the owner's vehicles, no linked photo in the set
--             points elsewhere, and that vehicle's stored VIN does not conflict. confidence = on-car or document rate.
--    create : exactly one VIN key, check digit valid (17) or a labelled classic serial, not on the roster.
--    review : two or more VIN keys; a VIN that conflicts with the set's filed vehicle; or no VIN but the set is
--             partly filed to one vehicle / the GPS matcher names one above its bar.
--    nothing: no VIN and no location or set lead, or nothing left to file.
CREATE OR REPLACE FUNCTION public.capture_sets_build(p_user uuid, p_gap_s int DEFAULT 480, p_radius_m numeric DEFAULT 100,
  p_oncar_conf numeric DEFAULT NULL, p_doc_conf numeric DEFAULT NULL)
RETURNS TABLE (set_key text, t0 timestamptz, t1 timestamptz, n int, image_ids uuid[], unlinked_ids uuid[],
  filed_vehicle_ids uuid[], vin_keys text[], anchors jsonb, decision text, target_vehicle_id uuid,
  proposed_vin text, confidence numeric, reasons text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '170s' AS $$
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
      AND length(coalesce(v.vin, '')) >= 8
  ), reads AS MATERIALIZED (
    -- uploaded on-device reads (vehicle_vin) and cited text reads
    SELECT g.sid, g.id image_id, g.is_doc doc, vin_match_key(g.vehicle_vin) k, g.vehicle_vin vin,
           coalesce(g.vehicle_vin_confidence, 0.9) conf, 'upload' via
    FROM g WHERE length(coalesce(g.vehicle_vin, '')) >= 8
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
END $$;

-- 7. Apply: file the unfiled photos of approved segments. Segments come from the box segmenter (time/place runs split
--    at visual change points; see nuke-strategy/image-linking-review.md) as explicit photo lists. Each item is
--    re-validated here: every photo is the owner's, unfiled and not blocked; and the target is backed either by a cited
--    text read in the segment whose VIN equals the target's VIN after confusable folding, or by set agreement (at least
--    3 photos of the segment already filed to the target and none filed elsewhere). Before-images are logged for revert.
--    item: {set_key, vehicle_id, segment_ids[], image_ids[], confidence, basis: 'vin_read'|'set_agreement', evidence}
CREATE OR REPLACE FUNCTION public.capture_sets_apply(p_run_id uuid, p_user uuid, p_items jsonb, p_min_conf numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '170s' AS $$
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
  RETURN jsonb_build_object('run_id', p_run_id, 'sets', sets_done, 'photos_filed', filed, 'sets_refused', refused);
END $$;

-- 8. Revert a run: restore each photo the run filed that is still on the vehicle it was filed to.
CREATE OR REPLACE FUNCTION public.capture_sets_revert(p_run_id uuid, p_actor uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  RETURN n;
END $$;

REVOKE ALL ON TABLE public.image_text_reads, public.capture_set_links FROM anon, authenticated;
GRANT SELECT ON public.image_text_reads, public.capture_set_links TO authenticated;
REVOKE ALL ON FUNCTION public.record_image_text_reads(uuid, text, text, jsonb), public.revoke_image_text_reads(uuid, text),
  public.capture_sets_build(uuid, int, numeric, numeric, numeric), public.capture_sets_apply(uuid, uuid, jsonb, numeric),
  public.capture_sets_revert(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_image_text_reads(uuid, text, text, jsonb), public.revoke_image_text_reads(uuid, text),
  public.capture_sets_build(uuid, int, numeric, numeric, numeric), public.capture_sets_apply(uuid, uuid, jsonb, numeric),
  public.capture_sets_revert(uuid, uuid) TO service_role;
