-- Capture-set corrections: an automated correction action that supersedes a contradicted vehicle link (owner-confirmed
-- links included) with a cited correction by agent:grok-bot. Every change is logged in capture_set_links with its
-- before-image and is reverted by capture_set_corrections_revert. Below-threshold conflicts go to capture_set_review.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_set_review (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL,
  user_id      uuid NOT NULL,
  set_key      text NOT NULL,
  image_ids    uuid[] NOT NULL,
  from_vehicle_id uuid,
  to_vehicle_id   uuid,
  confidence   numeric NOT NULL,
  basis        text,
  evidence     jsonb NOT NULL DEFAULT '{}',
  reason       text NOT NULL,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, set_key)
);
ALTER TABLE public.capture_set_review ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capture_set_review_owner_read ON public.capture_set_review;
CREATE POLICY capture_set_review_owner_read ON public.capture_set_review FOR SELECT USING (user_id = auth.uid());

-- Before-image of a photo's filing state, in the shape capture_sets_revert restores.
CREATE OR REPLACE FUNCTION public.capture_set_before_image(p_image uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('vehicle_id', vehicle_id, 'vision_gate_status', vision_gate_status, 'is_approved', is_approved,
    'approval_status', approval_status, 'is_primary', is_primary) FROM vehicle_images WHERE id = p_image
$$;

-- (2) Correction action. p_items: [{set_key, image_ids[], to_vehicle_id, confidence, basis, evidence}] where basis is
-- 'vin_read' (a recorded read in the set matches the target VIN), 'created_profile' (target created from this set's
-- anchor), or 'segment_majority' (most of a visually pure segment already sits on the target). Photos currently on
-- another vehicle are moved with relink_testimony, superseding whatever filed them (owner confirms included), with
-- a cited reason. Items below p_min_conf, or whose basis does not check out, go to capture_set_review.
CREATE OR REPLACE FUNCTION public.capture_set_correct(p_run_id uuid, p_user uuid, p_items jsonb,
  p_min_conf numeric DEFAULT 0.9, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb; v_ids uuid[]; v_to uuid; v_conf numeric; v_basis text; v_ok boolean; v_why text; v_key text;
  img record; res jsonb; v_before jsonb; n_moved int := 0; n_review int := 0; n_items int := 0; out jsonb := '[]';
BEGIN
  FOR it IN SELECT jsonb_array_elements(p_items) LOOP
    n_items := n_items + 1;
    v_ids := ARRAY(SELECT jsonb_array_elements_text(it->'image_ids')::uuid);
    v_to := (it->>'to_vehicle_id')::uuid; v_conf := coalesce((it->>'confidence')::numeric,0); v_basis := it->>'basis';
    v_ok := true; v_why := NULL;
    IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_to AND (v.owner_id = p_user OR v.user_id = p_user
                   OR v.uploaded_by = p_user) AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL) THEN
      v_ok := false; v_why := 'target not on this account';
    ELSIF EXISTS (SELECT 1 FROM unnest(v_ids) x LEFT JOIN vehicle_images vi ON vi.id = x WHERE vi.user_id IS DISTINCT FROM p_user) THEN
      v_ok := false; v_why := 'photo not owned by user';
    ELSIF v_basis = 'vin_read' THEN
      SELECT vin_match_key(vin) INTO v_key FROM vehicles WHERE id = v_to;
      IF v_key IS NULL OR NOT EXISTS (SELECT 1 FROM image_text_reads r, jsonb_array_elements(r.vin_candidates) c
          WHERE r.image_id = ANY(v_ids) AND r.revoked_at IS NULL AND vin_match_key(c->>'vin') = v_key) THEN
        v_ok := false; v_why := 'no recorded read in the set matches the target VIN'; END IF;
    ELSIF v_basis = 'created_profile' THEN
      IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_to
          AND (v.origin_metadata->'capture_set'->>'anchor_image_id')::uuid = ANY(v_ids)
         UNION ALL SELECT 1 FROM vehicles v WHERE v.id = v_to AND v.vin_source_image_id = ANY(v_ids)) THEN
        v_ok := false; v_why := 'target was not created from this set'; END IF;
    ELSIF v_basis = 'segment_majority' THEN
      IF (SELECT count(*) FILTER (WHERE vi.vehicle_id = v_to) * 2 <= count(*) FROM vehicle_images vi WHERE vi.id = ANY(v_ids))
         OR coalesce((it->'evidence'->>'purity')::numeric,0) < 0.9 THEN
        v_ok := false; v_why := 'target does not hold a majority of a pure segment'; END IF;
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
      IF p_dry_run THEN n_moved := n_moved + 1; CONTINUE; END IF;
      v_before := capture_set_before_image(img.id);
      IF img.vehicle_id IS NULL THEN
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
  RETURN jsonb_build_object('success',true,'dry_run',p_dry_run,'items',n_items,'photos_moved',n_moved,
                            'review',n_review,'detail',out);
END $$;

-- Revert a correction/creation run: moved photos go back to their logged vehicle (if still on the logged target),
-- first attributions are un-filed by capture_sets_revert, and an emptied capture_set profile is archived.
CREATE OR REPLACE FUNCTION public.capture_set_corrections_revert(p_run_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; res jsonb; n int := 0; v uuid; u int;
BEGIN
  FOR l IN SELECT * FROM capture_set_links WHERE run_id = p_run_id AND reverted_at IS NULL
           AND (before_image->>'vehicle_id') IS NOT NULL AND coalesce((result->>'success')::boolean,false) LOOP
    IF EXISTS (SELECT 1 FROM vehicle_images WHERE id = l.image_id AND vehicle_id = l.vehicle_id) THEN
      res := relink_testimony('image', l.image_id, (l.before_image->>'vehicle_id')::uuid,
                              format('revert of capture-set run %s', p_run_id), p_actor);
      IF coalesce((res->>'success')::boolean,false) THEN n := n + 1; END IF;
    END IF;
    UPDATE capture_set_links SET reverted_at = now() WHERE id = l.id;
  END LOOP;
  u := capture_sets_revert(p_run_id, p_actor);
  FOR v IN SELECT DISTINCT (result->>'created_vehicle')::uuid FROM capture_set_links
           WHERE run_id = p_run_id AND result ? 'created_vehicle' LOOP
    IF NOT EXISTS (SELECT 1 FROM vehicle_images WHERE vehicle_id = v) THEN
      UPDATE vehicles SET status = 'archived' WHERE id = v AND profile_origin = 'capture_set';
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true,'relinked_back',n,'unfiled',u);
END $$;

REVOKE ALL ON FUNCTION public.capture_set_correct(uuid,uuid,jsonb,numeric,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_set_corrections_revert(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_correct(uuid,uuid,jsonb,numeric,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_set_corrections_revert(uuid,uuid) TO service_role;
