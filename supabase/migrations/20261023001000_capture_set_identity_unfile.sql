-- Visual identity mismatch basis for capture_set_correct, a cited unfile-by-supersession path (no target vehicle:
-- the photo goes back to unlinked with its evidence and before-image, never deleted), and an additive
-- 'unverified ownership' flag for empty owner-import shells. All writers are service_role only and revertable.
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.capture_set_unfiled (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL, set_key text NOT NULL, image_id uuid NOT NULL, from_vehicle_id uuid NOT NULL,
  confidence numeric NOT NULL, evidence jsonb NOT NULL DEFAULT '{}', before_image jsonb NOT NULL,
  refiled_vehicle_id uuid, created_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz);
CREATE INDEX IF NOT EXISTS capture_set_unfiled_run ON public.capture_set_unfiled (run_id);
CREATE INDEX IF NOT EXISTS capture_set_unfiled_image ON public.capture_set_unfiled (image_id);
ALTER TABLE public.capture_set_unfiled ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.capture_set_correct(p_run_id uuid, p_user uuid, p_items jsonb,
  p_min_conf numeric DEFAULT 0.9, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
          WHERE r.image_id = ANY(v_ids) AND r.revoked_at IS NULL AND vin_match_key(c->>'vin') = v_key) THEN
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
END $$;

-- Revert an unfile run: photos still unlinked go back to the vehicle they were on, with their before-image state.
CREATE OR REPLACE FUNCTION public.capture_set_unfile_revert(p_run_id uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; n int := 0;
BEGIN
  FOR l IN SELECT * FROM capture_set_unfiled WHERE run_id = p_run_id AND reverted_at IS NULL LOOP
    UPDATE vehicle_images SET vehicle_id = l.from_vehicle_id,
           is_primary = coalesce((l.before_image->>'is_primary')::boolean, false), updated_at = now()
     WHERE id = l.image_id AND vehicle_id IS NULL;
    IF FOUND THEN
      INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
      VALUES ('image', l.image_id, NULL, l.image_id, l.from_vehicle_id, 'revert of capture-set unfile run ' || p_run_id, p_actor);
      n := n + 1;
    END IF;
    UPDATE capture_set_unfiled SET reverted_at = now() WHERE id = l.id;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'refiled', n);
END $$;

-- Unverified-ownership flag (additive). A shell qualifies only if it is on the user's account from their own import,
-- has no photos, no active permission and no ownership verification. Revert sets reverted_at.
CREATE TABLE IF NOT EXISTS public.ownership_claim_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id), user_id uuid NOT NULL, flag text NOT NULL
    CHECK (flag IN ('unverified_ownership')),
  run_id uuid NOT NULL, actor text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}', reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS ownership_claim_flags_live ON public.ownership_claim_flags (vehicle_id, user_id, flag) WHERE reverted_at IS NULL;
ALTER TABLE public.ownership_claim_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ownership_claim_flags_owner_read ON public.ownership_claim_flags;
CREATE POLICY ownership_claim_flags_owner_read ON public.ownership_claim_flags FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.flag_unverified_ownership_shells(p_run_id uuid, p_user uuid, p_vehicle_ids uuid[], p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; n int := 0; skipped jsonb := '[]';
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  FOR v IN SELECT x.id, ve.source, ve.owner_id, ve.user_id FROM unnest(p_vehicle_ids) x(id) LEFT JOIN vehicles ve ON ve.id = x.id LOOP
    IF v.source IS DISTINCT FROM 'owner_import' OR NOT (v.owner_id = p_user OR v.user_id = p_user)
       OR EXISTS (SELECT 1 FROM vehicle_images i WHERE i.vehicle_id = v.id)
       OR EXISTS (SELECT 1 FROM vehicle_user_permissions p WHERE p.vehicle_id = v.id AND p.user_id = p_user
                  AND coalesce(p.is_active, true) AND p.revoked_at IS NULL)
       OR EXISTS (SELECT 1 FROM ownership_verifications w WHERE w.vehicle_id = v.id AND w.user_id = p_user) THEN
      skipped := skipped || to_jsonb(v.id); CONTINUE;
    END IF;
    INSERT INTO ownership_claim_flags (vehicle_id, user_id, flag, run_id, actor, evidence, reason)
    VALUES (v.id, p_user, 'unverified_ownership', p_run_id, 'agent:grok-bot',
            jsonb_build_object('source', v.source, 'photos', 0, 'active_permission', false, 'verification', false), p_reason)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'flagged', n, 'skipped', skipped);
END $$;

CREATE OR REPLACE FUNCTION public.ownership_claim_flags_revert(p_run_id uuid)
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (UPDATE ownership_claim_flags SET reverted_at = now() WHERE run_id = p_run_id AND reverted_at IS NULL RETURNING 1)
  SELECT count(*)::int FROM u
$$;

REVOKE ALL ON FUNCTION public.capture_set_correct(uuid,uuid,jsonb,numeric,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_set_unfile_revert(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flag_unverified_ownership_shells(uuid,uuid,uuid[],text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ownership_claim_flags_revert(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_set_correct(uuid,uuid,jsonb,numeric,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_set_unfile_revert(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_unverified_ownership_shells(uuid,uuid,uuid[],text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ownership_claim_flags_revert(uuid) TO service_role;
